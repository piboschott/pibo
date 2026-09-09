//! Pibo's opt-in, native-owned prefix boundary for rust-v0.153.2.
//! Ordinary requests never serialize or clone the conversation history here.
use codex_api::ResponsesApiRequest;
use codex_protocol::ResponseItemId;
use codex_protocol::models::{ContentItem, ResponseItem};
use codex_protocol::openai_models::ModelInfo;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::ffi::CString;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use uuid::Uuid;

pub const CODEC: &str = "codex-0.153.2/responses/pibo-v1";
const LIMIT: usize = 128 * 1024 * 1024;
static STATE: OnceLock<Mutex<State>> = OnceLock::new();
tokio::task_local! { static COMPACTION: (); }

#[derive(Clone)]
struct Connection {
    address: SocketAddr,
    token: String,
}
struct Owner(*mut libsqlite3_sys::sqlite3);
// Every connection uses SQLite FULLMUTEX and is retained behind STATE's mutex.
unsafe impl Send for Owner {}
impl Drop for Owner {
    fn drop(&mut self) {
        unsafe {
            libsqlite3_sys::sqlite3_close(self.0);
        }
    }
}

struct State {
    connection: Connection,
    root: PathBuf,
    owners: Vec<Owner>,
    native_id: Option<String>,
    snapshot: Option<Snapshot>,
    sealing: bool,
    failed: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Snapshot {
    format: u8,
    native_session_id: String,
    model_info: ModelInfo,
    instructions: String,
    tools: Option<String>,
    configuration: Value,
    input_prefix: Vec<ResponseItem>,
}

// Cold, authorized native derivation. Preserve serde's exact tool-number and
// model representations; only native identity and deterministic item IDs vary.
fn derive_snapshot(snapshot: &mut Snapshot, source: &str, target: &str) -> anyhow::Result<()> {
    if source.is_empty()
        || source.len() > 1024
        || source == target
        || snapshot.native_session_id != source
        || snapshot.format != 1
    {
        return Err(failure());
    }
    if snapshot.configuration["promptCacheKey"] != source {
        return Err(failure());
    }
    snapshot.configuration["promptCacheKey"] = Value::String(target.to_owned());
    let old_namespace = Uuid::new_v5(&Uuid::NAMESPACE_OID, source.as_bytes());
    let new_namespace = Uuid::new_v5(&Uuid::NAMESPACE_OID, target.as_bytes());
    if snapshot.input_prefix.len() > 2 {
        return Err(failure());
    }
    for item in &mut snapshot.input_prefix {
        let (id, suffix, bytes) = match item {
            ResponseItem::AdditionalTools { id, tools, role } if role == "developer" => {
                (id, "at", serde_json::to_vec(tools)?)
            }
            ResponseItem::Message {
                id, role, content, ..
            } if role == "developer" => {
                let [ContentItem::InputText { text }] = content.as_slice() else {
                    return Err(failure());
                };
                (id, "msg", text.as_bytes().to_vec())
            }
            _ => return Err(failure()),
        };
        if id.as_ref()
            != Some(&ResponseItemId::with_suffix(
                suffix,
                Uuid::new_v5(&old_namespace, &bytes),
            ))
        {
            return Err(failure());
        }
        *id = Some(ResponseItemId::with_suffix(
            suffix,
            Uuid::new_v5(&new_namespace, &bytes),
        ));
    }
    snapshot.native_session_id = target.to_owned();
    Ok(())
}

fn failure() -> anyhow::Error {
    anyhow::anyhow!("Pibo native prefix recovery required")
}

fn lock(root: &std::path::Path, identity: &str) -> anyhow::Result<Owner> {
    let directory = root.join("ownership");
    fs::create_dir_all(&directory)?;
    let path = directory.join(format!("{:x}.sqlite", Sha256::digest(identity.as_bytes())));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&path) {
        Ok(file) => {
            file.sync_all()?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.into()),
    }
    if !fs::symlink_metadata(&path)?.file_type().is_file() {
        return Err(failure());
    }
    let filename = CString::new(path.to_str().ok_or_else(failure)?)?;
    let mut database = std::ptr::null_mut();
    let result = unsafe {
        libsqlite3_sys::sqlite3_open_v2(
            filename.as_ptr(),
            &mut database,
            libsqlite3_sys::SQLITE_OPEN_READWRITE
                | libsqlite3_sys::SQLITE_OPEN_FULLMUTEX
                | libsqlite3_sys::SQLITE_OPEN_NOFOLLOW,
            std::ptr::null(),
        )
    };
    if database.is_null() {
        return Err(failure());
    }
    let owner = Owner(database);
    if result != libsqlite3_sys::SQLITE_OK {
        return Err(failure());
    }
    let sql = c"PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE;";
    if unsafe {
        libsqlite3_sys::sqlite3_exec(
            database,
            sql.as_ptr(),
            None,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } != libsqlite3_sys::SQLITE_OK
    {
        return Err(failure());
    }
    Ok(owner)
}

// Private loopback HTTP only. No provider traffic or authentication is proxied.
fn request(
    connection: &Connection,
    method: &str,
    path: &str,
    body: &[u8],
    native: Option<&str>,
) -> anyhow::Result<(u16, Vec<u8>)> {
    request_authorized(connection, method, path, body, native, None)
}

fn request_authorized(
    connection: &Connection, method: &str, path: &str, body: &[u8],
    native: Option<&str>, rebaseline: Option<&str>,
) -> anyhow::Result<(u16, Vec<u8>)> {
    if body.len() > LIMIT {
        return Err(failure());
    }
    let mut socket = TcpStream::connect_timeout(&connection.address, Duration::from_secs(5))?;
    socket.set_read_timeout(Some(Duration::from_secs(if path == "/activate" {
        15
    } else {
        5
    })))?;
    socket.set_write_timeout(Some(Duration::from_secs(5)))?;
    let mut identity = native
        .map(|id| format!("x-native-session-id: {id}\r\nx-native-has-history: false\r\n"))
        .unwrap_or_default();
    if let Some(id) = rebaseline {
        if Uuid::parse_str(id).is_err() { return Err(failure()); }
        identity.push_str(&format!("x-prefix-rebaseline-id: {id}\r\n"));
    }
    write!(
        socket,
        "{method} {path} HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer {}\r\nConnection: close\r\nContent-Length: {}\r\n{identity}\r\n",
        connection.address,
        connection.token,
        body.len()
    )?;
    socket.write_all(body)?;
    let mut response = Vec::new();
    socket
        .take((LIMIT + 65537) as u64)
        .read_to_end(&mut response)?;
    if response.len() > LIMIT + 65536 {
        return Err(failure());
    }
    let separator = response
        .windows(4)
        .position(|bytes| bytes == b"\r\n\r\n")
        .ok_or_else(failure)?;
    if separator > 16384 {
        return Err(failure());
    }
    let header = std::str::from_utf8(&response[..separator])?;
    let status: u16 = header
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(failure)?
        .parse()?;
    let chunked = header
        .lines()
        .any(|line| line.eq_ignore_ascii_case("transfer-encoding: chunked"));
    let mut body = &response[separator + 4..];
    if !chunked {
        return Ok((status, body.to_vec()));
    }
    let mut decoded = Vec::new();
    loop {
        let line = body
            .windows(2)
            .position(|bytes| bytes == b"\r\n")
            .ok_or_else(failure)?;
        if line > 16 {
            return Err(failure());
        }
        let length = usize::from_str_radix(std::str::from_utf8(&body[..line])?, 16)?;
        body = &body[line + 2..];
        if length == 0 {
            break;
        }
        if length > LIMIT - decoded.len()
            || body.len() < length + 2
            || &body[length..length + 2] != b"\r\n"
        {
            return Err(failure());
        }
        decoded.extend_from_slice(&body[..length]);
        body = &body[length + 2..];
    }
    Ok((status, decoded))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Activation {
    args: Vec<String>,
    environment: std::collections::BTreeMap<String, String>,
}

/// Called from CLI main BEFORE arg0 dispatch, Tokio, or native discovery starts.
pub fn startup() -> anyhow::Result<Option<Vec<String>>> {
    let Some(endpoint) = std::env::var_os("PIBO_PREFIX_ENDPOINT") else {
        return Ok(None);
    };
    let endpoint = endpoint
        .to_str()
        .ok_or_else(failure)?
        .strip_prefix("http://")
        .ok_or_else(failure)?;
    let address: SocketAddr = endpoint.parse()?;
    if address.ip() != std::net::Ipv4Addr::LOCALHOST {
        return Err(failure());
    }
    let token = std::env::var("PIBO_PREFIX_TOKEN")?;
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(failure());
    }
    let root = PathBuf::from(std::env::var("PIBO_PREFIX_ROOT")?);
    let pibo_id = std::env::var("PIBO_PREFIX_SESSION")?;
    if !root.is_absolute() || pibo_id.len() > 1024 || pibo_id.is_empty() {
        return Err(failure());
    }
    let native_id = std::env::var("PIBO_PREFIX_NATIVE_SESSION").ok();
    let mut identities = vec![serde_json::to_string(&["pibo", &pibo_id])?];
    if let Some(id) = &native_id {
        if id.is_empty() || id.len() > 1024 || id.contains(['\r', '\n']) {
            return Err(failure());
        }
        identities.push(serde_json::to_string(&["native", "codex-native", id])?);
    }
    identities.sort();
    let owners = identities
        .iter()
        .map(|identity| lock(&root, identity))
        .collect::<anyhow::Result<Vec<_>>>()?;
    let connection = Connection { address, token };
    let (status, body) = request(&connection, "GET", "/snapshot", &[], None)?;
    let mut snapshot: Option<Snapshot> = match status {
        404 => None,
        200 => Some(serde_json::from_slice(&body)?),
        _ => return Err(failure()),
    };
    if let Ok(source) = std::env::var("PIBO_PREFIX_DERIVED_FROM") {
        derive_snapshot(
            snapshot.as_mut().ok_or_else(failure)?,
            &source,
            native_id.as_deref().ok_or_else(failure)?,
        )?;
    }
    if snapshot.as_ref().is_some_and(|snapshot| {
        snapshot.format != 1 || native_id.as_ref() != Some(&snapshot.native_session_id)
    }) {
        return Err(failure());
    }
    let (status, body) = request(&connection, "GET", "/activate", &[], None)?;
    if status != 200 || body.len() > 131072 {
        return Err(failure());
    }
    let activation: Activation = serde_json::from_slice(&body)?;
    if activation.args.len() > 256
        || activation.environment.len() > 256
        || activation.args.iter().any(|arg| arg.contains('\0'))
    {
        return Err(failure());
    }
    for (key, value) in &activation.environment {
        if key.is_empty()
            || key.starts_with("PIBO_PREFIX_")
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            || value.contains('\0')
        {
            return Err(failure());
        }
    }
    // No threads have been started: startup uses only blocking std networking.
    unsafe {
        for key in [
            "PIBO_PREFIX_ENDPOINT",
            "PIBO_PREFIX_TOKEN",
            "PIBO_PREFIX_ROOT",
            "PIBO_PREFIX_SESSION",
            "PIBO_PREFIX_NATIVE_SESSION",
            "PIBO_PREFIX_DERIVED_FROM",
        ] {
            std::env::remove_var(key);
        }
        for (key, value) in activation.environment {
            std::env::set_var(key, value);
        }
    }
    STATE
        .set(Mutex::new(State {
            connection,
            root,
            owners,
            native_id,
            snapshot,
            sealing: false,
            failed: false,
        }))
        .map_err(|_| failure())?;
    let mut args = vec!["codex".to_string()];
    args.extend(activation.args);
    Ok(Some(args))
}

fn configuration(request: &ResponsesApiRequest) -> Value {
    // Exhaustive destructuring makes an added upstream wire field a build error.
    let ResponsesApiRequest {
        model,
        instructions: _,
        input: _,
        tools: _,
        tool_choice,
        parallel_tool_calls,
        reasoning,
        store,
        stream,
        stream_options,
        include,
        service_tier,
        prompt_cache_key,
        text,
        client_metadata: _,
        access_programs,
    } = request;
    json!({ "model": model, "toolChoice": tool_choice, "parallelToolCalls": parallel_tool_calls,
        "reasoning": reasoning, "store": store, "stream": stream, "streamOptions": stream_options,
        "include": include, "serviceTier": service_tier, "promptCacheKey": prompt_cache_key,
        "text": text, "accessPrograms": access_programs })
}

pub fn is_active() -> bool {
    STATE.get().is_some()
}

pub fn restore_model_info(candidate: ModelInfo) -> ModelInfo {
    let Some(state) = STATE.get() else { return candidate; };
    let state = state.lock().expect("Pibo prefix ownership poisoned");
    match &state.snapshot {
        Some(snapshot) if snapshot.model_info.slug == candidate.slug => snapshot.model_info.clone(),
        _ => candidate,
    }
}

pub fn needs_native_persistence(model: &ModelInfo) -> bool {
    STATE
        .get()
        .is_some_and(|state| state.lock().map_or(true, |state| state.snapshot.as_ref()
            .is_none_or(|snapshot| snapshot.model_info.slug != model.slug)))
}

/// First-dispatch barrier only; no extra native file scans on ordinary turns.
pub async fn sync_native(path: PathBuf) -> anyhow::Result<()> {
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW);
        }
        let file = options.open(&path)?;
        if !file.metadata()?.is_file() {
            return Err(failure());
        }
        file.sync_all()?;
        let mut parent = path.parent();
        while let Some(directory) = parent {
            fs::File::open(directory)?.sync_all()?;
            parent = directory.parent();
        }
        Ok(())
    })
    .await??;
    Ok(())
}

/// Only native compaction entrypoints may relax the ordinary request boundary.
/// The task-local scope cannot authorize another concurrent model request.
pub(crate) async fn compact<T>(
    sess: &crate::session::session::Session,
    operation: impl std::future::Future<Output = codex_protocol::error::Result<T>>,
) -> codex_protocol::error::Result<T> {
    use codex_protocol::error::CodexErr;
    let Some(state) = STATE.get() else {
        return operation.await;
    };
    let fatal = || CodexErr::Fatal("Pibo native prefix recovery required: compaction".to_string());
    let connection = {
        let state = state.lock().map_err(|_| fatal())?;
        if state.failed || state.sealing || state.snapshot.is_none() {
            return Err(fatal());
        }
        state.connection.clone()
    };
    sess.flush_rollout().await.map_err(|_| fatal())?;
    let path = sess
        .current_rollout_path()
        .await
        .ok()
        .flatten()
        .ok_or_else(fatal)?;
    sync_native(path.clone()).await.map_err(|_| fatal())?;
    let length = fs::metadata(&path).map_err(|_| fatal())?.len();
    let begin_connection = connection.clone();
    let body = serde_json::to_vec(&json!({"sourceHead": format!("offset:{length}")}))
        .map_err(|_| fatal())?;
    // Close ordinary dispatch before the first await that can publish a receipt.
    // Cancellation while awaiting the durable acknowledgement must stay closed.
    state.lock().map_err(|_| fatal())?.failed = true;
    let (status, receipt) = tokio::task::spawn_blocking(move || {
        request(&begin_connection, "POST", "/compaction/begin", &body, None)
    })
    .await
    .map_err(|_| fatal())?
    .map_err(|_| fatal())?;
    if status != 200 {
        return Err(fatal());
    }
    let receipt: Value = serde_json::from_slice(&receipt).map_err(|_| fatal())?;
    let id = receipt["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 128)
        .ok_or_else(fatal)?
        .to_owned();
    // Any interrupted operation leaves a durable pending receipt. Ordinary
    // dispatch stays closed until restart examines the native checkpoint.
    let result = COMPACTION.scope((), operation).await;
    sess.flush_rollout().await.map_err(|_| fatal())?;
    sync_native(path.clone()).await.map_err(|_| fatal())?;
    if result.is_err() && fs::metadata(&path).map_err(|_| fatal())?.len() != length {
        return result;
    }
    let body =
        serde_json::to_vec(&json!({"id": id, "changed": result.is_ok()})).map_err(|_| fatal())?;
    let (status, _) = tokio::task::spawn_blocking(move || {
        request(&connection, "POST", "/compaction/finish", &body, None)
    })
    .await
    .map_err(|_| fatal())?
    .map_err(|_| fatal())?;
    if status != 200 {
        return Err(fatal());
    }
    state.lock().map_err(|_| fatal())?.failed = false;
    result
}

pub async fn validate(
    request_value: &ResponsesApiRequest,
    model: &ModelInfo,
    native_id: &str,
    prefix_length: usize,
) -> anyhow::Result<()> {
    let Some(state) = STATE.get() else {
        return Ok(());
    };
    if COMPACTION.try_with(|_| ()).is_ok() {
        return Ok(());
    }
    // No IPC on ordinary dispatch. A different selected model requires the
    // parent's durable, explicit authorization before replacing the capsule.
    let authorization_connection = {
        let state = state.lock().map_err(|_| failure())?;
        state.snapshot.as_ref().filter(|snapshot| snapshot.model_info.slug != model.slug)
            .map(|_| state.connection.clone())
    };
    let rebaseline = if let Some(connection) = authorization_connection {
        let (status, body) = tokio::task::spawn_blocking(move ||
            request(&connection, "GET", "/rebaseline", &[], None)).await??;
        if status != 200 { return Err(failure()); }
        let value: Value = serde_json::from_slice(&body)?;
        if value["reason"] != "model-change" || value["nativeSessionId"] != native_id
            || value["targetModel"]["provider"] != "openai-codex"
            || value["targetModel"]["id"] != model.slug { return Err(failure()); }
        let id = value["id"].as_str().ok_or_else(failure)?;
        Uuid::parse_str(id)?;
        Some(id.to_owned())
    } else { None };
    let operation = {
        let mut state = state.lock().map_err(|_| failure())?;
        if state.failed
            || state.sealing
            || native_id.is_empty()
            || native_id.len() > 1024
            || native_id.contains(['\r', '\n'])
        {
            return Err(failure());
        }
        if let Some(expected) = &state.native_id {
            if expected != native_id {
                return Err(failure());
            }
        } else {
            let owner = lock(
                &state.root,
                &serde_json::to_string(&["native", "codex-native", native_id])?,
            )?;
            state.owners.push(owner);
            state.native_id = Some(native_id.to_string());
        }
        let configuration = configuration(request_value);
        let tools = request_value
            .tools
            .as_ref()
            .map(|tools| tools.as_raw_value().get());
        if (model.use_responses_lite && !(1..=2).contains(&prefix_length))
            || (!model.use_responses_lite && prefix_length != 0)
        {
            return Err(failure());
        }
        let prefix = request_value
            .input
            .get(..prefix_length)
            .ok_or_else(failure)?;
        if let Some(snapshot) = &state.snapshot && rebaseline.is_none() {
            if snapshot.model_info != *model
                || snapshot.instructions != request_value.instructions
                || snapshot.tools.as_deref() != tools
                || snapshot.configuration != configuration
                || snapshot.input_prefix != prefix
            {
                return Err(failure());
            }
            return Ok(());
        }
        // Only the first dispatch can capture. Never claim old assistant/tool
        // history as a newly created original, even with incomplete metadata.
        if rebaseline.is_none() && request_value.input.iter().any(|item| !matches!(item,
            ResponseItem::Message { role, .. } if matches!(role.as_str(), "user" | "developer" | "system"))
            && !matches!(item, ResponseItem::AdditionalTools { .. })) { return Err(failure()); }
        let snapshot = Snapshot {
            format: 1,
            native_session_id: native_id.to_string(),
            model_info: model.clone(),
            instructions: request_value.instructions.clone(),
            tools: tools.map(str::to_owned),
            configuration,
            input_prefix: prefix.to_vec(),
        };
        let bytes = serde_json::to_vec(&snapshot)?;
        if bytes.len() > LIMIT {
            return Err(failure());
        }
        state.sealing = true;
        (state.connection.clone(), snapshot, bytes)
    };
    let (connection, snapshot, bytes) = operation;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let id = native_id.to_string();
    let result = tokio::task::spawn_blocking(move || {
        request_authorized(&connection, "POST", "/seal", &bytes, Some(&id), rebaseline.as_deref())
    })
    .await;
    let mut state = state.lock().map_err(|_| failure())?;
    state.sealing = false;
    let valid = match result {
        Ok(Ok((200, body))) => serde_json::from_slice::<Value>(&body).is_ok_and(|receipt| {
            receipt["digest"] == digest && receipt["epoch"].as_u64().is_some_and(|epoch| epoch > 0)
        }),
        _ => false,
    };
    if !valid {
        state.failed = true;
        return Err(failure());
    }
    state.snapshot = Some(snapshot);
    Ok(())
}
