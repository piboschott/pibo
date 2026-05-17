import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CliToolStatus } from './registry.js';

export const BROWSER_USE_DEFAULT_PROFILE = 'PIBo';
export const BROWSER_USE_FRESH_PROFILE_FLAG = '--fresh-profile';

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createBrowserUseWrapper(realExecutablePath: string): string {
  return `#!/bin/sh
set -eu

real_browser_use=${shellQuote(realExecutablePath)}
default_profile=\${PIBO_BROWSER_USE_DEFAULT_PROFILE:-${shellQuote(BROWSER_USE_DEFAULT_PROFILE)}}
fresh_flag=${shellQuote(BROWSER_USE_FRESH_PROFILE_FLAG)}
python_cmd=\${PIBO_BROWSER_USE_PYTHON:-$(dirname "$real_browser_use")/python}
if [ ! -x "$python_cmd" ]; then
  python_cmd=$(command -v python3 || command -v python || printf '%s' "$python_cmd")
fi

session=\${PIBO_BROWSER_USE_SESSION:-default}
explicit_profile=0
fresh_profile=0
starts_browser=0
show_help=0
headed=0
pibo_ensure_chrome=0
sanitized_args=

append_arg() {
  if [ "$#" -eq 0 ]; then
    return
  fi
  if [ -z "$sanitized_args" ]; then
    sanitized_args=$(printf '%s\\n' "$1")
  else
    sanitized_args=$(printf '%s\\n%s\\n' "$sanitized_args" "$1")
  fi
}

find_chrome() {
  if [ -n "\${PIBO_BROWSER_USE_CHROME:-}" ]; then
    printf '%s\\n' "$PIBO_BROWSER_USE_CHROME"
    return
  fi
  for candidate in google-chrome chrome chromium chromium-browser /opt/google/chrome/chrome; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return
    fi
    if [ -x "$candidate" ]; then
      printf '%s\\n' "$candidate"
      return
    fi
  done
}

resolve_profile_directory() {
  user_data_dir=$1
  profile_name=$2

  if [ -n "\${PIBO_BROWSER_USE_CHROME_PROFILE_DIRECTORY:-}" ]; then
    printf '%s\\n' "$PIBO_BROWSER_USE_CHROME_PROFILE_DIRECTORY"
    return
  fi

  "$python_cmd" - "$user_data_dir" "$profile_name" <<'PY'
import json
import sys
from pathlib import Path

user_data_dir = Path(sys.argv[1])
profile_name = sys.argv[2]
local_state = user_data_dir / "Local State"
try:
    data = json.loads(local_state.read_text())
except Exception:
    print(profile_name if (user_data_dir / profile_name).is_dir() else "Default")
    raise SystemExit

info_cache = data.get("profile", {}).get("info_cache", {})
if profile_name in info_cache:
    print(profile_name)
    raise SystemExit

profile_name_lower = profile_name.lower()
for directory, info in info_cache.items():
    if str(info.get("name", directory)).lower() == profile_name_lower:
        print(directory)
        raise SystemExit

for directory in info_cache:
    if directory.lower() == profile_name_lower:
        print(directory)
        raise SystemExit

print(profile_name if (user_data_dir / profile_name).is_dir() else "Default")
PY
}

find_free_port() {
  "$python_cmd" - <<'PY'
import socket

with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
}

pibo_cdp_is_ready() {
  "$python_cmd" - "$1" <<'PY'
import socket
import sys

port = int(sys.argv[1])
try:
    with socket.create_connection(("127.0.0.1", port), timeout=0.2) as sock:
        sock.sendall(b"GET /json/version HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nConnection: close\\r\\n\\r\\n")
        data = sock.recv(128)
    raise SystemExit(0 if b"200" in data else 1)
except Exception:
    raise SystemExit(1)
PY
}

find_chrome_pids_for_profile() {
  user_data_dir=$1
  "$python_cmd" - "$user_data_dir" <<'PYFINDCHROME'
import os
import shlex
import subprocess
import sys

managed_dir = os.path.normpath(os.path.abspath(sys.argv[1]))
browser_names = {"chrome", "google-chrome", "chromium", "chromium-browser"}

def normalize_path(value):
    return os.path.normpath(os.path.abspath(value))

def has_managed_user_data_dir(args):
    for index, arg in enumerate(args):
        if arg.startswith("--user-data-dir="):
            return normalize_path(arg.split("=", 1)[1]) == managed_dir
        if arg == "--user-data-dir" and index + 1 < len(args):
            return normalize_path(args[index + 1]) == managed_dir
    return False

try:
    output = subprocess.check_output(["ps", "-eo", "pid=,args="], text=True, stderr=subprocess.DEVNULL)
except Exception:
    raise SystemExit(0)

for line in output.splitlines():
    line = line.strip()
    if not line:
        continue
    pid_text, _, command = line.partition(" ")
    if not pid_text.isdigit() or not command:
        continue
    try:
        args = shlex.split(command)
    except ValueError:
        continue
    if not args:
        continue
    command_name = os.path.basename(args[0]).lower()
    if command_name not in browser_names:
        continue
    if has_managed_user_data_dir(args):
        print(pid_text)
PYFINDCHROME
}

kill_stale_chrome_for_profile() {
  user_data_dir=$1

  # Find and terminate any Chrome process using this profile directory
  stale_pids=$(find_chrome_pids_for_profile "$user_data_dir")
  for stale_pid in $stale_pids; do
    if [ -n "$stale_pid" ] && kill -0 "$stale_pid" 2>/dev/null; then
      echo "pibo browser-use: terminating stale Chrome process $stale_pid for profile..." >&2
      kill -TERM "$stale_pid" 2>/dev/null || true
    fi
  done

  # Give processes a moment to exit gracefully
  sleep 0.5
  for stale_pid in $stale_pids; do
    if [ -n "$stale_pid" ] && kill -0 "$stale_pid" 2>/dev/null; then
      kill -KILL "$stale_pid" 2>/dev/null || true
    fi
  done
  sleep 0.2

  # Remove stale lock files if they remain
  for stale_file in SingletonLock SingletonCookie SingletonSocket; do
    if [ -f "$user_data_dir/$stale_file" ]; then
      rm -f "$user_data_dir/$stale_file" 2>/dev/null || true
    fi
  done

  # Also clean up stale state files for this session
  safe_session=$(printf '%s' "$session" | tr -c 'A-Za-z0-9_.-' '_')
  state_dir=\${BROWSER_USE_HOME:-$HOME/.browser-use}/pibo-cdp
  rm -f "$state_dir/$safe_session.pid" "$state_dir/$safe_session.port" 2>/dev/null || true
}

persistent_chrome_url_if_alive() {
  safe_session=$(printf '%s' "$session" | tr -c 'A-Za-z0-9_.-' '_')
  state_dir=\${BROWSER_USE_HOME:-$HOME/.browser-use}/pibo-cdp
  pid_file=$state_dir/$safe_session.pid
  port_file=$state_dir/$safe_session.port

  if [ -s "$pid_file" ] && [ -s "$port_file" ]; then
    chrome_pid=$(cat "$pid_file" 2>/dev/null || true)
    chrome_port=$(cat "$port_file" 2>/dev/null || true)
    if [ -n "$chrome_pid" ] && [ -n "$chrome_port" ] && kill -0 "$chrome_pid" 2>/dev/null && pibo_cdp_is_ready "$chrome_port"; then
      printf 'http://127.0.0.1:%s\\n' "$chrome_port"
      return 0
    fi
    # Clean up stale state files when process is dead or CDP unreachable
    rm -f "$pid_file" "$port_file" 2>/dev/null || true
  fi

  return 1
}

start_persistent_chrome() {
  safe_session=$(printf '%s' "$session" | tr -c 'A-Za-z0-9_.-' '_')
  state_dir=\${BROWSER_USE_HOME:-$HOME/.browser-use}/pibo-cdp
  mkdir -p "$state_dir"
  pid_file=$state_dir/$safe_session.pid
  port_file=$state_dir/$safe_session.port
  log_file=$state_dir/$safe_session.chrome.log

  chrome_bin=$(find_chrome)
  if [ -z "$chrome_bin" ]; then
    echo "pibo browser-use: could not find Chrome; managed browser-pool acquire cannot start a browser. Install Chrome/Chromium or use $fresh_flag for Browser Use managed Chromium." >&2
    return 1
  fi

  user_data_dir=\${PIBO_BROWSER_USE_CHROME_USER_DATA_DIR:-}
  if [ -z "$user_data_dir" ]; then
    user_data_dir=\${BROWSER_USE_HOME:-$HOME/.browser-use}/chrome-profiles/$default_profile
  fi

  mkdir -p "$user_data_dir"

  retry=0
  while [ "$retry" -lt 2 ]; do
    kill_stale_chrome_for_profile "$user_data_dir"
    profile_directory=$(resolve_profile_directory "$user_data_dir" "$default_profile")
    chrome_port=$(find_free_port)
    headless_arg=
    if [ "$headed" -eq 0 ]; then
      headless_arg=--headless=new
    fi
    rm -f "$log_file"
    if command -v setsid >/dev/null 2>&1; then
      setsid "$chrome_bin" \
        --user-data-dir="$user_data_dir" \
        --profile-directory="$profile_directory" \
        --remote-debugging-port="$chrome_port" \
        --no-first-run \
        --no-default-browser-check \
        --disable-default-apps \
        --no-sandbox \
        --disable-setuid-sandbox \
        --disable-dev-shm-usage \
        $headless_arg \
        about:blank >"$log_file" 2>&1 &
    else
      nohup "$chrome_bin" \
        --user-data-dir="$user_data_dir" \
        --profile-directory="$profile_directory" \
        --remote-debugging-port="$chrome_port" \
        --no-first-run \
        --no-default-browser-check \
        --disable-default-apps \
        --no-sandbox \
        --disable-setuid-sandbox \
        --disable-dev-shm-usage \
        $headless_arg \
        about:blank >"$log_file" 2>&1 &
    fi
    chrome_pid=$!

    ready=0
    if [ "\${PIBO_BROWSER_USE_SKIP_CDP_WAIT:-}" = "1" ]; then
      ready=1
    fi
    attempt=0
    while [ "$ready" -ne 1 ] && [ "$attempt" -lt 50 ]; do
      if pibo_cdp_is_ready "$chrome_port"; then
        ready=1
        break
      fi
      if ! kill -0 "$chrome_pid" 2>/dev/null; then
        break
      fi
      attempt=$((attempt + 1))
      sleep 0.1
    done

    if [ "$ready" -eq 1 ]; then
      printf '%s\n' "$chrome_pid" > "$pid_file"
      printf '%s\n' "$chrome_port" > "$port_file"
      printf 'pibo browser-use: started Chrome profile "%s" (%s/%s) on CDP port %s.\n' "$default_profile" "$user_data_dir" "$profile_directory" "$chrome_port" >&2
      printf '%s\n%s\nhttp://127.0.0.1:%s\n%s\n' "$chrome_pid" "$chrome_port" "$chrome_port" "$user_data_dir"
      return 0
    fi

    echo "pibo browser-use: Chrome did not expose CDP on port $chrome_port (attempt $retry)." >&2
    sed -n '1,80p' "$log_file" >&2 2>/dev/null || true
    if grep -q "SingletonLock" "$log_file" 2>/dev/null; then
      echo "pibo browser-use: retrying after lock cleanup..." >&2
    fi
    retry=$((retry + 1))
    sleep 0.5
  done

  echo "pibo browser-use: Chrome failed to start after retries." >&2
  return 1
}

browser_pool_safe_segment() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9_.-' '_'
}

browser_pool_worker_id() {
  printf '%s\n' "\${PIBO_BROWSER_POOL_WORKER_ID:-\${PIBO_COMPUTE_WORKER_ID:-\${HOSTNAME:-local}}}"
}

browser_pool_id() {
  printf '%s\n' "\${PIBO_BROWSER_POOL_ID:-default}"
}

browser_pool_root() {
  printf '%s\n' "\${PIBO_BROWSER_POOL_ROOT:-\${BROWSER_USE_HOME:-$HOME/.browser-use}/pibo-browser-pool}"
}

browser_pool_paths() {
  worker=$(browser_pool_safe_segment "$(browser_pool_worker_id)")
  pool=$(browser_pool_safe_segment "$(browser_pool_id)")
  base=$(browser_pool_root)/browser-pools/$worker/$pool
  printf '%s\n%s\n' "$base/state.json" "$base/state.lock"
}

browser_pool_read_summary() {
  state_file=$1
  "$python_cmd" - "$state_file" <<'PYSUMMARY'
import json
import sys
from pathlib import Path
path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text())
except FileNotFoundError:
    print("missing")
    raise SystemExit(0)
except Exception as exc:
    print("malformed")
    print(str(exc))
    raise SystemExit(0)
for key in ("state", "pid", "cdpPort", "cdpUrl", "userDataDir", "activeLeaseId", "idleExpiresAt", "owner"):
    value = data.get(key, "")
    print(value if value is not None else "")
PYSUMMARY
}

browser_pool_lease_is_busy() {
  active_lease=$1
  requested_lease=$2
  idle_expires_at=$3
  if [ -z "$active_lease" ] || [ "$active_lease" = "$requested_lease" ]; then
    return 1
  fi
  "$python_cmd" - "$idle_expires_at" <<'PYBUSY'
import sys
from datetime import datetime, timezone
value = sys.argv[1]
if not value:
    raise SystemExit(0)
try:
    expires_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
except Exception:
    raise SystemExit(0)
if expires_at.tzinfo is None:
    expires_at = expires_at.replace(tzinfo=timezone.utc)
raise SystemExit(1 if expires_at <= datetime.now(timezone.utc) else 0)
PYBUSY
}

browser_pool_write_state() {
  state_file=$1
  lifecycle_state=$2
  chrome_pid=$3
  chrome_port=$4
  cdp_url=$5
  user_data_dir=$6
  active_lease_id=$7
  owner=$8
  last_error=$9
  "$python_cmd" - "$state_file" "$(browser_pool_worker_id)" "$(browser_pool_id)" "\${PIBO_BROWSER_POOL_MAX_PROCESSES:-1}" "$lifecycle_state" "$chrome_pid" "$chrome_port" "$cdp_url" "$user_data_dir" "$active_lease_id" "$owner" "$last_error" <<'PYSTATE'
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
state_file = Path(sys.argv[1])
worker_id, pool_id, max_processes, lifecycle_state = sys.argv[2:6]
pid, port, cdp_url, user_data_dir, lease_id, owner, last_error = sys.argv[6:13]
now = datetime.now(timezone.utc)
record = {
    "workerId": worker_id,
    "poolId": pool_id,
    "maxBrowserProcesses": int(max_processes or "1"),
    "state": lifecycle_state,
    "lastUsedAt": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
}
if pid:
    record["pid"] = int(pid)
    record["processGroupId"] = int(pid)
if port:
    record["cdpPort"] = int(port)
if cdp_url:
    record["cdpUrl"] = cdp_url
if user_data_dir:
    record["userDataDir"] = user_data_dir
if lease_id:
    record["activeLeaseId"] = lease_id
    record["idleExpiresAt"] = (now + timedelta(milliseconds=int(os.environ.get("PIBO_BROWSER_POOL_IDLE_TIMEOUT_MS", "600000")))).isoformat(timespec="milliseconds").replace("+00:00", "Z")
if owner:
    record["owner"] = owner
if last_error:
    record["lastError"] = last_error
state_file.parent.mkdir(parents=True, exist_ok=True)
tmp = state_file.with_name(f"{state_file.name}.{os.getpid()}.tmp")
tmp.write_text(json.dumps(record, indent=2) + "\\n")
tmp.replace(state_file)
PYSTATE
}

browser_pool_acquire() {
  paths=$(browser_pool_paths)
  state_file=$(printf '%s\n' "$paths" | sed -n '1p')
  lock_dir=$(printf '%s\n' "$paths" | sed -n '2p')
  mkdir -p "$(dirname "$state_file")"
  safe_session=$(browser_pool_safe_segment "$session")
  lease_id=\${PIBO_BROWSER_POOL_LEASE_ID:-browser-use:$safe_session}
  owner=\${PIBO_BROWSER_POOL_OWNER:-browser-use:$session}
  attempts=0
  while ! mkdir "$lock_dir" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge "\${PIBO_BROWSER_POOL_LOCK_ATTEMPTS:-100}" ]; then
      echo "pibo browser-use: managed browser-pool acquire timed out waiting for $lock_dir" >&2
      return 1
    fi
    sleep 0.05
  done
  trap 'rm -rf "$lock_dir"' EXIT INT TERM

  summary=$(browser_pool_read_summary "$state_file")
  summary_state=$(printf '%s\n' "$summary" | sed -n '1p')
  if [ "$summary_state" = "malformed" ]; then
    malformed_reason=$(printf '%s\n' "$summary" | sed -n '2p')
    browser_pool_write_state "$state_file" dirty "" "" "" "" "" "$owner" "Malformed browser pool state: $malformed_reason"
  elif [ "$summary_state" != "missing" ]; then
    recorded_state=$summary_state
    recorded_pid=$(printf '%s\n' "$summary" | sed -n '2p')
    recorded_port=$(printf '%s\n' "$summary" | sed -n '3p')
    recorded_cdp_url=$(printf '%s\n' "$summary" | sed -n '4p')
    recorded_user_data_dir=$(printf '%s\n' "$summary" | sed -n '5p')
    recorded_active_lease_id=$(printf '%s\n' "$summary" | sed -n '6p')
    recorded_idle_expires_at=$(printf '%s\n' "$summary" | sed -n '7p')
    recorded_owner=$(printf '%s\n' "$summary" | sed -n '8p')
    if [ "$recorded_state" = "leased" ] && browser_pool_lease_is_busy "$recorded_active_lease_id" "$lease_id" "$recorded_idle_expires_at" && [ -n "$recorded_pid" ] && [ -n "$recorded_port" ] && [ -n "$recorded_cdp_url" ] && kill -0 "$recorded_pid" 2>/dev/null && pibo_cdp_is_ready "$recorded_port"; then
      busy_reason="pool-exhausted: browser pool $(browser_pool_id) is already leased by $recorded_active_lease_id until \${recorded_idle_expires_at:-unknown}"
      echo "pibo browser-use: $busy_reason" >&2
      rm -rf "$lock_dir"
      trap - EXIT INT TERM
      return 1
    fi
    if [ "$recorded_state" != "dirty" ] && [ -n "$recorded_pid" ] && [ -n "$recorded_port" ] && [ -n "$recorded_cdp_url" ] && kill -0 "$recorded_pid" 2>/dev/null && pibo_cdp_is_ready "$recorded_port"; then
      browser_pool_write_state "$state_file" leased "$recorded_pid" "$recorded_port" "$recorded_cdp_url" "$recorded_user_data_dir" "$lease_id" "$owner" ""
      rm -rf "$lock_dir"
      trap - EXIT INT TERM
      printf '%s\n' "$recorded_cdp_url"
      return 0
    fi
    browser_pool_write_state "$state_file" stale "$recorded_pid" "$recorded_port" "$recorded_cdp_url" "$recorded_user_data_dir" "" "$owner" "Recorded browser is not alive or CDP is unreachable"
  fi

  start_result=$(start_persistent_chrome) || {
    browser_pool_write_state "$state_file" dirty "" "" "" "" "" "$owner" "Managed browser start failed"
    rm -rf "$lock_dir"
    trap - EXIT INT TERM
    return 1
  }
  chrome_pid=$(printf '%s\n' "$start_result" | sed -n '1p')
  chrome_port=$(printf '%s\n' "$start_result" | sed -n '2p')
  cdp_url=$(printf '%s\n' "$start_result" | sed -n '3p')
  user_data_dir=$(printf '%s\n' "$start_result" | sed -n '4p')
  browser_pool_write_state "$state_file" leased "$chrome_pid" "$chrome_port" "$cdp_url" "$user_data_dir" "$lease_id" "$owner" ""
  rm -rf "$lock_dir"
  trap - EXIT INT TERM
  printf '%s\n' "$cdp_url"
}

ensure_persistent_chrome() {
  if cdp_url=$(browser_pool_acquire); then
    printf '%s\n' "$cdp_url"
    return 0
  fi
  echo "pibo browser-use: managed browser-pool acquire failed; refusing to start an unmanaged browser." >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  arg=$1
  shift

  case "$arg" in
    "$fresh_flag")
      fresh_profile=1
      continue
      ;;
    --help|-h)
      show_help=1
      ;;
    --headed)
      headed=1
      ;;
    --profile)
      explicit_profile=1
      append_arg "$arg"
      continue
      ;;
    --cdp-url)
      explicit_profile=1
      append_arg "$arg"
      if [ "$#" -gt 0 ]; then
        append_arg "$1"
        shift
      fi
      continue
      ;;
    --profile=*|--cdp-url=*|--connect|--mcp|--use-cloud|--cloud-profile-id|--cloud-profile-id=*)
      explicit_profile=1
      ;;
    --session)
      append_arg "$arg"
      if [ "$#" -gt 0 ]; then
        session=$1
        append_arg "$1"
        shift
      fi
      continue
      ;;
    --session=*)
      session=\${arg#--session=}
      ;;
    --pibo-ensure-chrome)
      pibo_ensure_chrome=1
      continue
      ;;
    -*)
      ;;
    open|click|type|input|scroll|back|screenshot|state|switch|close-tab|keys|select|upload|eval|extract|hover|dblclick|rightclick|cookies|wait|get|python)
      starts_browser=1
      ;;
    close|sessions|install|init|setup|doctor|cloud|profile)
      ;;
  esac

  append_arg "$arg"
done

if [ "$pibo_ensure_chrome" -eq 1 ]; then
  cdp_url=$(ensure_persistent_chrome)
  printf '%s\\n' "$cdp_url"
  exit 0
fi

if [ "$show_help" -eq 1 ]; then
  {
    echo "Pibo browser-use wrapper:"
    echo "  New browser-use daemon sessions default to persistent Chrome profile \\"$default_profile\\" via CDP."
    echo "  Use $fresh_flag to start a fresh temporary browser profile."
    echo "  Use --pibo-ensure-chrome to only start Chrome and print the CDP URL."
    echo ""
  } >&2
fi

set --
if [ -n "$sanitized_args" ]; then
  while IFS= read -r item; do
    set -- "$@" "$item"
  done <<EOF
$sanitized_args
EOF
fi

# Prepend --session if the user did not pass it explicitly and a non-default session is set.
has_session_arg=0
for a in "$@"; do
  case "$a" in
    --session|--session=*) has_session_arg=1; break ;;
  esac
done
if [ "$has_session_arg" -eq 0 ] && [ "$session" != "default" ]; then
  set -- --session "$session" "$@"
fi

session_pid_file=\${BROWSER_USE_HOME:-$HOME/.browser-use}/$session.pid
session_alive=0
if [ -s "$session_pid_file" ]; then
  session_pid=$(cat "$session_pid_file" 2>/dev/null || true)
  if [ -n "$session_pid" ] && kill -0 "$session_pid" 2>/dev/null; then
    session_alive=1
  else
    # Clean up stale session pid file
    rm -f "$session_pid_file" 2>/dev/null || true
  fi
fi

if [ "$starts_browser" -eq 1 ] && [ "$explicit_profile" -eq 0 ] && [ "$fresh_profile" -eq 0 ]; then
  if [ "$session_alive" -eq 1 ]; then
    "$real_browser_use" --session "$session" close >/dev/null 2>&1 || true
    sleep 0.2
  fi
  cdp_url=$(ensure_persistent_chrome)
  exec "$real_browser_use" --cdp-url "$cdp_url" "$@"
fi

exec "$real_browser_use" "$@"
`;
}

export function ensureBrowserUseWrapper(status: CliToolStatus): string | undefined {
  if (status.entry.name !== 'browser-use') return undefined;
  const wrapperPath = join(status.homeDir, 'bin', 'browser-use');
  mkdirSync(dirname(wrapperPath), { recursive: true });
  writeFileSync(wrapperPath, createBrowserUseWrapper(status.executablePath));
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}
