import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { source: { type: "string" }, output: { type: "string" }, companion: { type: "string" },
	"prepare-only": { type: "boolean" }, release: { type: "boolean" }, help: { type: "boolean" } } });
if (values.help || !values.source) {
	process.stdout.write("Build the pinned Pibo Codex prefix candidate in an isolated worker.\n\nUsage:\n  node scripts/build-codex-prefix.mjs --source <extracted-source> --output <directory> [--release] [--companion <official-code-mode-host>]\n  node scripts/build-codex-prefix.mjs --source <extracted-source> --prepare-only\n\nSource:\n  https://codeload.github.com/openai/codex/tar.gz/657a993cbee87acf52d14b758ce49dbd46d1b8eb\n  Archive SHA256: f79602e558bdb311da466919f51a809446268eab935890eab9ee5926866bc9ef\n");
	process.exit(values.help ? 0 : 2);
}
const source = resolve(values.source);
const root = join(source, "codex-rs");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
// Official rust-v0.153.2 Linux x64 companion, downloaded from the same release.
// Archive SHA256: 177a4507b9cc7f97f113ac034697b39f6a71a876a8bd508ff6d7f52f342ebe4a.
if (values.companion && sha(await readFile(values.companion)) !== "f9dc99ef253919b4b48b53a346b1ebec76589eb854a1ab1a64afb4ff51cfbb61") {
	throw new Error("Companion is not the pinned official rust-v0.153.2 Linux x64 release");
}
const expected = {
	"core/src/client.rs": "e77f1dfd562f2c21c1e30a95870bd171d56b1bb46361d07dd82f32992fca28f2",
	"cli/src/main.rs": "beab9cd5ea1cbf6e8762397e39fcdec9f263b675365cd206fd808501a2102c14",
	"core/src/lib.rs": "24134800faba981882f7d0c279a5767643a35517668c4a335ad8090e5c4bbea6",
	"core/Cargo.toml": "235be4c950d332bfbc56e924deb3690ef5969d1e635d67b1ff7dd8548bf850fc",
	"codex-api/src/common.rs": "f525d1593a01b579dd2dcadf96744888b4a7529155dddbf74963ba55cf7f23d5",
	"core/src/session/turn.rs": "231b0818690d0f2fa1afd1f9b5bf4485e7e8f5008670354b412d649e623c4ee1",
	"core/src/compact.rs": "3f3324a1073d6896805c446ea6ebd2983200f0c04eef2188147bfb51b3486567",
	"core/src/compact_remote.rs": "5a51af2ac0a0d083a3e31ff7de5ac1607a91ac20ee904c807faa059dd92bff96",
	"core/src/compact_token_budget.rs": "274a57e36ee1ca74abe73d088867e9b8bde98b66de53a77d004b194bea571d12",
	"core/src/compact_remote_v2.rs": "080a7c3ff1dc0de3c0f7f83b9887609882a4fa7374f24ef48e0fe423f04e5eed",
	"core/src/tasks/compact.rs": "1706f1078ad5ed9b8a8e5e018dfc88d80d39917c6b5d41e425f085eea7cdfe54",
};
const original = {};
const manifestPath = join(source, "pibo-prefix-source.json");
const previous = await readFile(manifestPath, "utf8").then(JSON.parse).catch(error => {
	if (error.code === "ENOENT") return undefined;
	throw error;
});
for (const [path, digest] of Object.entries(expected)) {
	const bytes = await readFile(join(root, path));
	if (previous?.files[path]) {
		if (sha(bytes) !== previous.files[path]) throw new Error(`Patched native source changed: ${path}`);
		original[path] = await readFile(join(source, "pibo-prefix-originals", path), "utf8");
		if (sha(original[path]) !== digest) throw new Error(`Native original changed: ${path}`);
	} else {
		if (sha(bytes) !== digest) throw new Error(`Native source is not the pinned 0.153.2 input: ${path}`);
		original[path] = bytes.toString("utf8");
	}
}
const replace = (text, before, after) => {
	if (text.split(before).length !== 2) throw new Error("Native patch anchor is missing or ambiguous");
	return text.replace(before, after);
};
const updated = { ...original };
updated["core/src/lib.rs"] += "\n// Pinned Pibo native prefix contract.\npub mod pibo_prefix;\n";
updated["core/Cargo.toml"] = replace(updated["core/Cargo.toml"], "[dependencies]\n",
	"[dependencies]\nlibsqlite3-sys = { workspace = true }\nsha2 = { workspace = true }\n");
updated["codex-api/src/common.rs"] = replace(updated["codex-api/src/common.rs"],
	"pub(crate) fn as_raw_value(&self) -> &RawValue", "pub fn as_raw_value(&self) -> &RawValue");
let cli = updated["cli/src/main.rs"];
cli = replace(cli, "fn main() -> anyhow::Result<()> {", `fn main() -> anyhow::Result<()> {
    if std::env::args().any(|arg| arg == "--pibo-prefix-contract") {
        println!("{}", codex_core::pibo_prefix::CODEC);
        return Ok(());
    }
    let prefix_args = codex_core::pibo_prefix::startup()
        .map_err(|_| anyhow::anyhow!("Pibo native prefix recovery required: startup"))?;`);
cli = replace(cli, "cli_main(arg0_paths, remote_control_disabled).await?;", "cli_main(arg0_paths, remote_control_disabled, prefix_args).await?;");
cli = replace(cli, "    remote_control_disabled: bool,\n) -> anyhow::Result<()> {",
	"    remote_control_disabled: bool,\n    prefix_args: Option<Vec<String>>,\n) -> anyhow::Result<()> {");
cli = replace(cli, "    } = MultitoolCli::parse();", "    } = match prefix_args { Some(args) => MultitoolCli::parse_from(args), None => MultitoolCli::parse() };");
updated["cli/src/main.rs"] = cli;
const guard = `            crate::pibo_prefix::validate(&request, model_info,
                &self.client.state.thread_id.to_string(),
                if model_info.use_responses_lite { 1 + usize::from(!prompt.base_instructions.text.is_empty()) } else { 0 })
                .await.map_err(|_| CodexErr::Fatal("Pibo native prefix recovery required: request".to_string()))?;
`;
let client = updated["core/src/client.rs"];
client = replace(client, "            let request_session_telemetry =\n                session_telemetry_for_request(session_telemetry, &request);",
	guard + "            let request_session_telemetry =\n                session_telemetry_for_request(session_telemetry, &request);");
client = replace(client, "            let ws_payload = ResponseCreateWsRequest {", guard + "            let ws_payload = ResponseCreateWsRequest {");
client = replace(client, "    ) -> Result<WebsocketStreamOutcome> {\n        let provider = Arc::clone(&self.client.state.provider);",
	"    ) -> Result<WebsocketStreamOutcome> {\n        if warmup && crate::pibo_prefix::is_active() { return Ok(WebsocketStreamOutcome::FallbackToHttp); }\n        let provider = Arc::clone(&self.client.state.provider);");
const prewarmHeader = `    pub async fn prewarm_websocket(
        &mut self,
        prompt: &Prompt,
        model_info: &ModelInfo,
        session_telemetry: &SessionTelemetry,
        effort: Option<ReasoningEffortConfig>,
        summary: ReasoningSummaryConfig,
        service_tier: Option<String>,
        responses_metadata: &CodexResponsesMetadata,
    ) -> Result<()> {`;
client = replace(client, prewarmHeader, prewarmHeader + "\n        if crate::pibo_prefix::is_active() { return Ok(()); }");
updated["core/src/client.rs"] = client;
updated["core/src/session/turn.rs"] = replace(updated["core/src/session/turn.rs"], "    let mut stream = client_session\n        .stream(", `    if crate::pibo_prefix::needs_native_persistence() {
        sess.try_ensure_rollout_materialized(PersistContext::Standard).await
            .map_err(|_| CodexErr::Fatal("Pibo native prefix recovery required: native persistence".to_string()))?;
        sess.flush_rollout().await
            .map_err(|_| CodexErr::Fatal("Pibo native prefix recovery required: native flush".to_string()))?;
        let path = sess.current_rollout_path().await.ok().flatten()
            .ok_or_else(|| CodexErr::Fatal("Pibo native prefix recovery required: native path".to_string()))?;
        crate::pibo_prefix::sync_native(path).await
            .map_err(|_| CodexErr::Fatal("Pibo native prefix recovery required: native durability".to_string()))?;
    }
    let mut stream = client_session
        .stream(`);
const guardSource = await readFile(new URL("../native/codex-prefix/guard.rs", import.meta.url));
for (const [path, operation, session] of [
	["core/src/compact.rs", "run_compact_task_inner_impl", "&sess"],
	["core/src/compact_remote.rs", "run_remote_compact_task_inner_impl", "sess"],
	["core/src/compact_remote_v2.rs", "run_remote_compact_task_inner_impl", "sess"],
]) {
	let contents = updated[path];
	const start = contents.indexOf(`    let result = ${operation}(`);
	const end = contents.indexOf("    .await;", start);
	if (start < 0 || end < 0) throw new Error("Native compaction entrypoint is unavailable");
	const call = contents.slice(start, end).replace("    let result = ", "").trimEnd();
	contents = contents.slice(0, start) + `    let result = crate::pibo_prefix::compact(${session}, ${call}).await;` + contents.slice(end + "    .await;".length);
	updated[path] = contents;
}
updated["core/src/compact_token_budget.rs"] = replace(updated["core/src/compact_token_budget.rs"],
	"    sess.start_new_context_window(step_context, world_state)\n        .await;",
	`    crate::pibo_prefix::compact(sess, async {
        sess.start_new_context_window(step_context, world_state).await;
        Ok(())
    }).await?;`);
updated["core/src/tasks/compact.rs"] = replace(updated["core/src/tasks/compact.rs"],
	"            && matches!(err.details(), CodexErrorDetails::TurnAborted)",
	"            && (crate::pibo_prefix::is_active() || matches!(err.details(), CodexErrorDetails::TurnAborted))");
for (const [path, contents] of Object.entries(updated)) {
	if (!previous?.files[path]) { const backup = join(source, "pibo-prefix-originals", path); await mkdir(resolve(backup, ".."), { recursive: true }); await writeFile(backup, original[path]); }
	if (await readFile(join(root, path), "utf8") !== contents) await writeFile(join(root, path), contents);
}
const nativeGuard = join(root, "core/src/pibo_prefix.rs");
const existingGuard = await readFile(nativeGuard).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
if (!existingGuard?.equals(guardSource)) await writeFile(nativeGuard, guardSource);
const manifest = { upstreamCommit: "657a993cbee87acf52d14b758ce49dbd46d1b8eb", codec: "codex-0.153.2/responses/pibo-v1",
	guardSha256: sha(guardSource), files: Object.fromEntries(Object.entries(updated).map(([path, contents]) => [path, sha(contents)])) };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
if (!values["prepare-only"]) {
	if (!values.output) throw new Error("--output is required when building");
	await new Promise((done, reject) => {
		const child = spawn("cargo", ["build", "-p", "codex-cli", "--bin", "codex", ...(values.companion ? [] : ["-p", "codex-code-mode-host", "--bin", "codex-code-mode-host"]), ...(values.release ? ["--release"] : [])],
			{ cwd: root, stdio: "inherit", env: { ...process.env, CARGO_BUILD_JOBS: "1", CARGO_PROFILE_DEV_DEBUG: "0", CARGO_INCREMENTAL: "0" } });
		child.once("error", reject); child.once("exit", code => code === 0 ? done() : reject(new Error(`Native build failed (${code})`)));
	});
	await mkdir(values.output, { recursive: true, mode: 0o700 });
	const executable = join(values.output, "codex");
	await copyFile(join(root, "target", values.release ? "release" : "debug", "codex"), executable);
	const companion = values.companion ?? join(root, "target", values.release ? "release" : "debug", "codex-code-mode-host");
	await copyFile(companion, join(values.output, "codex-code-mode-host"));
	await writeFile(join(values.output, "manifest.json"), JSON.stringify({ ...manifest, binarySha256: sha(await readFile(executable)),
		companionSha256: sha(await readFile(companion)), companionSource: values.companion ? "official-release" : "source-build",
		profile: values.release ? "release" : "dev" }, null, 2) + "\n");
}
