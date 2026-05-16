# Design: PTY Debug and E2E Tooling

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `proposal.md`, `spec.md`, `tasks.md`

## Overview

`pibo debug pty` provides a small PTY runner plus scenario executor. It is intended for debugging and validation, not as a production runtime. The design follows proven patterns from terminal projects: PTY process driver, terminal-size control, output capture, cleaned text assertions, and optional tmux/manual smoke workflows.

## Command Structure

```bash
pibo debug pty run [options] -- <command...>
pibo debug pty scenario [options] <file>
pibo debug pty list-scenarios
```

## Execution Backends

### Host backend

Runs the command directly on the host through a PTY.

Use cases:

- validate installed/global `pibo`
- reproduce SSH-like behavior
- verify host custom agents and local data stores

### Docker backend

Runs a PTY session inside a named Docker worker.

Expected shape:

```bash
pibo debug pty scenario scenario.json \
  --docker-worker pibo-dev-example \
  --workdir /workspace
```

Implementation may use one of these approaches:

1. Preferred: run a small PTY driver inside the container.
2. Fallback: use Python `pty` or `script` in the container when available.
3. Optional: tmux-based capture if tmux exists.

The tool must report missing container capabilities clearly.

## Scenario Schema

Initial JSON shape:

```json
{
  "name": "cli-session-ui-mocked-e2e",
  "command": ["pibo", "tui:sessions"],
  "cwd": "/root/code/pibo",
  "rows": 24,
  "cols": 100,
  "timeoutMs": 60000,
  "idleTimeoutMs": 10000,
  "inputDelayMs": 40,
  "providerMode": "mocked",
  "maxIterations": 10,
  "artifactDir": "tmp/pty-smoke-artifacts/cli-session-ui",
  "steps": [
    { "waitFor": "Pibo CLI Sessions", "timeoutMs": 10000 },
    { "typeText": "/status" },
    { "press": "Enter" },
    { "waitFor": "source=", "timeoutMs": 5000 },
    { "typeText": "/quit" },
    { "press": "Enter" }
  ],
  "expect": ["Pibo CLI Sessions"],
  "reject": ["UnhandledPromiseRejection", "source_closed"]
}
```

## Step Types

Minimum supported steps:

- `waitFor`: wait until cleaned output contains text.
- `typeText`: type characters one by one using `inputDelayMs`.
- `writeBytes`: write raw bytes for advanced cases.
- `press`: named key such as `Enter`, `Escape`, `CtrlC`, `Up`, `Down`.
- `sleepMs`: wait without input.
- `expect`: immediate assertion against cleaned output.
- `reject`: immediate forbidden-text assertion.

## Iteration Counting

For real-provider scenarios, an iteration is one model-backed interaction boundary. Initial implementation may approximate this with one of:

- number of submitted user messages,
- number of observed assistant-message completions,
- number of scenario loop steps marked `iteration: true`.

The scenario executor must fail closed if it cannot enforce the configured max iteration bound in real-provider mode.

Default real-provider limit:

```text
maxIterations = 10
```

## Provider Modes

### mocked

Default. Uses deterministic local provider/server/source hooks where the scenario requires assistant output.

### real

Enabled only by CLI flag:

```bash
--real-provider
```

Requires safety bounds:

- max iterations
- wall-clock timeout
- idle timeout
- stop pattern or expected output

## Artifacts

Each run gets an artifact directory. Failed runs always preserve artifacts.

Required files:

```text
metadata.json       # command, cwd, env summary, backend, timings, exit code
input.json          # expanded input steps and timing
raw.ansi.log        # exact PTY output
clean.txt           # ANSI-stripped normalized text
screen.txt          # best final visible screen/capture, if available
assertions.json     # expected/rejected patterns and results
```

Optional files:

```text
events.jsonl        # timestamped input/output events
frames/             # screen snapshots over time
provider.log        # mocked provider request/response trace
```

## ANSI and Screen Handling

The runner should store raw PTY bytes first. Cleaned text is derived and must not replace raw output.

For final screen capture, acceptable implementations include:

- terminal emulator/parser based capture,
- tmux `capture-pane`,
- best-effort cleaned tail when no screen parser exists.

## Canonical CLI Session UI Scenario

A canonical scenario should validate the real default source path, not only `--demo`.

Mocked-provider target flow:

1. Start `pibo tui:sessions` under PTY.
2. Create/open a controlled test session.
3. Verify `pibo-agent` or configured test profile is visible when expected.
4. Send `Hi`.
5. Wait for deterministic assistant response.
6. Run `/status` and assert session/source details.
7. Exit with `/quit`.
8. Verify artifacts.

Real-provider target flow is the same, but requires `--real-provider` and max iterations.

## Ralph Guidance

Future Ralph prompts for CLI/TUI changes should require:

- unit tests for pure logic,
- renderer/screen tests for visual state,
- `pibo debug pty scenario ...` for real command path,
- host or Docker target selected explicitly,
- artifacts attached or path reported in progress notes.

## Open Implementation Choices

- Whether to implement the PTY runner in TypeScript using Node APIs/dependencies or shell out to Python PTY for V1.
- Whether to add a terminal parser dependency for robust `screen.txt` or use best-effort cleaned captures initially.
- Exact mocked-provider injection seam for `pibo tui:sessions`.
