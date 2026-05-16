# Spec: PTY Debug and E2E Tooling

**Status:** Draft  
**Created:** 2026-05-16  
**Owner / Source:** User request after Ink CLI Session UI validation failure  
**Related docs:** `proposal.md`, `design.md`, `tasks.md`, `docs/specs/capabilities/cli-pty-validation.md`

## Why

Interactive CLIs fail in ways that unit tests and non-TTY process execution do not catch. Pibo needs built-in PTY tooling so agents can validate real terminal behavior, inspect captures, and run safe E2E tests before declaring CLI/TUI stories complete.

## Goal

Implement `pibo debug pty` as a standard debugging and validation surface for PTY-backed CLI/TUI scenarios on host and Docker targets, with deterministic mocked-provider support and explicit bounded real-provider mode.

## Requirements

### Requirement: `pibo debug pty run` executes arbitrary commands under PTY

The system MUST provide a debug command that runs a command under a pseudo-terminal with configurable terminal size, environment, working directory, timeout, and input script.

#### Acceptance

A command such as `pibo debug pty run --rows 24 --cols 100 -- pibo tui:sessions --demo` starts under PTY and writes artifacts.

### Requirement: Scenarios are declarative

The system MUST support scenario files for repeatable PTY flows.

#### Acceptance

A scenario can define command, target, workdir, env, rows, cols, input steps, waits, expectations, rejection patterns, timeouts, provider mode, max iterations, and artifact settings.

### Requirement: Input steps support terminal-safe typing

The system MUST support both raw bytes and per-character typing with configurable delays.

#### Acceptance

A scenario can reliably enter `/status`, wait for output, then enter `/quit` in an Ink app without merging commands or missing Enter events.

### Requirement: Output assertions include expected and forbidden text

The system MUST support assertions against cleaned terminal text and SHOULD retain raw ANSI for diagnosis.

#### Acceptance

A scenario can fail if expected text is missing or forbidden text appears, while preserving raw output for review.

### Requirement: Artifact capture is mandatory on failure

The system MUST write artifacts for failed PTY runs.

#### Acceptance

A failed run creates an artifact directory containing at least:

- `metadata.json`
- `raw.ansi.log`
- `clean.txt`
- `screen.txt` or best available final capture
- `input.json`
- `assertions.json`

### Requirement: Host and Docker targets are supported

The system MUST support running the PTY process on the host and inside a named Docker worker.

#### Acceptance

A scenario can run with no Docker option on the host, or with `--docker-worker pibo-dev-... --workdir /workspace` inside a worker.

### Requirement: Mocked-provider E2E is the default for model flows

Scenarios that need assistant output SHOULD use a mocked provider unless `--real-provider` is explicitly set.

#### Acceptance

The CLI Session UI scenario can validate assistant response rendering without real provider credentials.

### Requirement: Real provider mode is explicit and bounded

The system MUST require `--real-provider` for live provider calls and MUST enforce safety bounds.

#### Acceptance

When `--real-provider` is set:

- `--max-iterations` defaults to `10`.
- A wall-clock timeout is required or defaulted.
- An idle timeout is required or defaulted.
- Exceeding max iterations terminates the PTY run and marks it failed with diagnostics.

### Requirement: Agent-to-agent loops are guarded

The system MUST prevent unbounded model-backed conversation loops.

#### Acceptance

A real-provider scenario stops on the first satisfied stop condition: expected output, explicit stop pattern, max iterations, wall-clock timeout, idle timeout, process exit, or external cancellation.

### Requirement: CLI Session UI has a canonical scenario

The system MUST include or document a canonical scenario for `pibo tui:sessions`.

#### Acceptance

The canonical scenario covers:

- startup under PTY
- `/new` or opening a test session
- agent/profile visibility where applicable
- sending a message
- receiving assistant output in mocked mode
- `/status`
- `/quit`
- artifact capture

## Edge Cases

- Missing PTY support on a platform.
- Docker worker not running or lacking required command.
- Terminal output uses alternate screen.
- Command exits before expectations are met.
- Command ignores `/quit` and needs Ctrl+C/terminate.
- ANSI cleanup accidentally removes meaningful text.
- Real provider streams partial output but never completes.

## Success Criteria

- [ ] SC-001: PTY run command supports host execution and artifacts.
- [ ] SC-002: PTY scenario command supports declarative scenario files.
- [ ] SC-003: Docker-worker PTY target works or fails with actionable diagnostics.
- [ ] SC-004: Canonical CLI Session UI mocked-provider scenario passes deterministically.
- [ ] SC-005: Real-provider mode requires explicit opt-in and enforces default max iterations of 10.
- [ ] SC-006: Future Ralph prompts can reference this tool as a mandatory validation gate for CLI/TUI work.
