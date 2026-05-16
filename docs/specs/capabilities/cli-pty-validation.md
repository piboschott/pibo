# Spec: CLI PTY Validation

**Status:** Draft  
**Created:** 2026-05-16  
**Owner / Source:** User investigation after Ink CLI Session UI validation gap  
**Related docs:** `docs/specs/changes/pty-debug-e2e-tooling/`, `docs/specs/capabilities/cli-session-ui.md`

## Why

Pibo needs reliable tooling for debugging and validating interactive terminal UIs. The Ink CLI Session UI shipped with unit tests and demo-mode PTY smoke checks, but the real default runtime path was not validated: custom agents were missing, messages did not reach a real router, and Web/CLI session visibility was not proven.

Future agents must be able to run deterministic PTY tests, inspect terminal output, capture artifacts, and optionally run bounded real-provider end-to-end checks without entering unbounded agent-to-agent loops.

## Goal

Provide a standard PTY validation capability, exposed through `pibo debug pty`, that can run on both host and Docker workers, capture terminal artifacts, and verify real CLI behavior with safe bounds.

## Scope

### In Scope

- A `pibo debug pty` command family for interactive CLI/TUI validation.
- PTY-backed command execution with scripted input, terminal size, timeout, and output assertions.
- Artifact capture: raw ANSI output, cleaned text, final screen/capture, command metadata, exit status, and failure diagnostics.
- Deterministic mocked-provider flows for repeatable E2E tests.
- Optional real-provider execution behind an explicit flag.
- Safety bounds for real-provider tests, including default maximum interaction/turn count of 10.
- Support for host and Docker-worker execution.
- Clear guidance for Ralph/agent validation gates.

### Out of Scope

- Running real-provider PTY E2E tests by default in `npm test`.
- Replacing normal unit/component tests.
- Visual screenshot diffing as the primary assertion mechanism.
- Unbounded autonomous agent-to-agent conversations.

## Requirements

### Requirement: PTY command execution is first-class

Pibo MUST provide a `pibo debug pty` command that can run an interactive CLI process under a pseudo-terminal.

#### Acceptance

A maintainer can run a Pibo CLI command through `pibo debug pty` with configured rows, columns, timeout, and scripted input, then inspect captured output artifacts.

### Requirement: Artifacts are captured on every failure

PTY validation MUST write diagnostic artifacts when a run fails and SHOULD support artifact capture for successful runs.

#### Acceptance

A failed run produces at least raw ANSI output, cleaned text output, final visible screen/capture where available, command metadata, input script, exit code, timing, and assertion failure details.

### Requirement: Host and Docker execution are supported

PTY validation MUST work on the host and inside a dedicated Docker worker.

#### Acceptance

The same validation scenario can target the installed host `pibo` binary or run inside a named Docker worker with a specified workdir.

### Requirement: Mocked provider mode is deterministic

The default E2E mode SHOULD avoid live model calls by using mocked provider responses or deterministic local sources.

#### Acceptance

A CLI session test can assert assistant output without requiring external network access or real provider credentials.

### Requirement: Real-provider mode is explicit and bounded

Real provider E2E tests MUST require an explicit flag such as `--real-provider` and MUST enforce safety bounds.

#### Acceptance

A real-provider PTY run defaults to at most 10 interaction/agent-turn iterations and fails closed if the bound is exceeded. The limit can be lowered or explicitly raised by a human-provided option.

### Requirement: Agent-to-agent loops are prevented

PTY validation MUST avoid unbounded loops when a CLI-controlled agent sends messages to another model-backed agent.

#### Acceptance

Validation scenarios include max iterations, wall-clock timeout, idle timeout, and stop-pattern checks. Exceeding any bound terminates the PTY process and records diagnostics.

### Requirement: Scenarios are scriptable and reviewable

PTY validation scenarios SHOULD be expressible as small scripts or JSON/YAML definitions that agents can read and execute.

#### Acceptance

A scenario can declare command, environment, terminal size, input steps, waits, expected output, forbidden output, timeouts, artifact path, and provider mode.

## Edge Cases

- Ink/React input requires per-character typing with small delays.
- Terminal apps using alternate screen buffers.
- Commands that do not exit after `/quit` or Ctrl+C.
- Provider streaming takes longer than expected.
- Docker worker lacks `tmux` but has Python PTY or `script`.
- ANSI output includes control sequences that cleaned text should remove without hiding raw output.
- The CLI starts but no assistant answer arrives.
- Custom agents exist on host but not inside Docker worker.

## Constraints

- **Safety:** Real-provider runs require explicit opt-in and bounded iterations.
- **Determinism:** Mocked-provider mode is preferred for repeatable CI/Ralph validation.
- **Artifacts:** Failures must leave enough output to diagnose rendering, input, and runtime issues.
- **Portability:** Host and Docker-worker execution must be supported; optional tmux features may be skipped when unavailable.

## Success Criteria

- [ ] SC-001: `pibo debug pty` can run a scripted PTY session and capture artifacts.
- [ ] SC-002: A deterministic mocked-provider CLI Session UI scenario verifies `/new`, message send, assistant response, `/status`, and `/quit`.
- [ ] SC-003: A real-provider scenario requires `--real-provider` and enforces `--max-iterations` defaulting to 10.
- [ ] SC-004: A scenario can run on both host and Docker worker targets.
- [ ] SC-005: Failed PTY runs produce raw and cleaned artifacts with actionable diagnostics.

## Traceability

| Requirement | Consumer | Status |
|---|---|---|
| PTY command execution | CLI/TUI validation | Draft |
| Artifact capture | Debugging/Ralph review | Draft |
| Host + Docker targets | Local and Ralph workflows | Draft |
| Mocked provider | Deterministic E2E | Draft |
| Real provider safety | Human-approved live checks | Draft |
