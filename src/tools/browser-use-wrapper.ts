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

session=default
explicit_profile=0
fresh_profile=0
starts_browser=0
show_help=0
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

if [ "$show_help" -eq 1 ]; then
  {
    echo "Pibo browser-use wrapper:"
    echo "  New browser-use daemon sessions default to Chrome profile \\"$default_profile\\"."
    echo "  Use $fresh_flag to start a fresh temporary browser profile."
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

session_pid_file=\${BROWSER_USE_HOME:-$HOME/.browser-use}/$session.pid
session_alive=0
if [ -s "$session_pid_file" ]; then
  session_pid=$(cat "$session_pid_file" 2>/dev/null || true)
  if [ -n "$session_pid" ] && kill -0 "$session_pid" 2>/dev/null; then
    session_alive=1
  fi
fi

if [ "$starts_browser" -eq 1 ] && [ "$session_alive" -eq 0 ] && [ "$explicit_profile" -eq 0 ] && [ "$fresh_profile" -eq 0 ]; then
  echo "pibo browser-use: starting new session with Chrome profile \\"$default_profile\\" (use $fresh_flag for a fresh temporary profile)." >&2
  exec "$real_browser_use" --profile "$default_profile" "$@"
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
