# Tasks: PTY Debug and E2E Tooling

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `proposal.md`, `spec.md`, `design.md`, `docs/specs/capabilities/cli-pty-validation.md`

## Phase 1: Command and Scenario Contract

- [ ] T1.1 Register `pibo debug pty` command group.
- [ ] T1.2 Add `pibo debug pty run -- <command...>` help and option parsing.
- [ ] T1.3 Add `pibo debug pty scenario <file>` help and option parsing.
- [ ] T1.4 Define scenario JSON schema/types for command, target, steps, assertions, timeouts, provider mode, max iterations, and artifacts.
- [ ] T1.5 Add schema validation errors with actionable messages.

## Phase 2: Host PTY Runner

- [ ] T2.1 Implement host PTY process spawn with rows/cols.
- [ ] T2.2 Implement raw output collection.
- [ ] T2.3 Implement per-character `typeText` with configurable input delay.
- [ ] T2.4 Implement named key presses: Enter, Escape, CtrlC, Up, Down.
- [ ] T2.5 Implement wall-clock timeout and idle timeout termination.
- [ ] T2.6 Add unit/integration tests for a deterministic local command under PTY.

## Phase 3: Assertions and Artifacts

- [ ] T3.1 Implement ANSI-stripped `clean.txt` generation while preserving `raw.ansi.log`.
- [ ] T3.2 Implement expected-text and forbidden-text assertions.
- [ ] T3.3 Implement artifact directory creation.
- [ ] T3.4 Write `metadata.json`, `input.json`, `assertions.json`, `raw.ansi.log`, `clean.txt`, and best-effort `screen.txt`.
- [ ] T3.5 Ensure failed runs always preserve artifacts and print the artifact path.

## Phase 4: Docker Worker Target

- [ ] T4.1 Add `--docker-worker <name>` and `--workdir <path>` support.
- [ ] T4.2 Detect required container capabilities and report missing tools clearly.
- [ ] T4.3 Run a PTY scenario inside the worker.
- [ ] T4.4 Copy or write artifacts where the host can inspect them.
- [ ] T4.5 Add tests or documented smoke checks for Docker execution.

## Phase 5: Provider Modes and Safety Bounds

- [ ] T5.1 Make mocked/deterministic provider mode the default for model-output scenarios.
- [ ] T5.2 Require explicit `--real-provider` for live provider calls.
- [ ] T5.3 Enforce default `--max-iterations 10` for real-provider mode.
- [ ] T5.4 Enforce wall-clock and idle timeout in real-provider mode.
- [ ] T5.5 Fail closed when max-iteration enforcement is unavailable.
- [ ] T5.6 Record provider mode and iteration counts in `metadata.json`.

## Phase 6: Canonical CLI Session UI Scenario

- [ ] T6.1 Add a canonical mocked-provider `pibo tui:sessions` scenario.
- [ ] T6.2 Scenario verifies startup, new/open session, message send, assistant response, `/status`, and `/quit`.
- [ ] T6.3 Scenario verifies expected custom/test agent visibility where configured.
- [ ] T6.4 Scenario can run on host.
- [ ] T6.5 Scenario can run inside Docker worker or documents missing worker capability.
- [ ] T6.6 Add instructions for optional real-provider smoke with `--real-provider --max-iterations 10`.

## Phase 7: Documentation and Ralph Guidance

- [ ] T7.1 Document `pibo debug pty` usage in debug help/docs.
- [ ] T7.2 Document artifact structure and debugging workflow.
- [ ] T7.3 Document host vs Docker target selection.
- [ ] T7.4 Document real-provider safety rules.
- [ ] T7.5 Add Ralph prompt guidance: CLI/TUI stories must include PTY scenario validation when touching interactive terminal behavior.

## Acceptance Checklist

- [ ] `pibo debug pty run` can start an interactive process under PTY.
- [ ] `pibo debug pty scenario` executes scripted input with waits and assertions.
- [ ] Failed runs produce actionable artifacts.
- [ ] Docker-worker execution is supported or fails with clear diagnostics.
- [ ] Real-provider mode requires `--real-provider` and defaults to max 10 iterations.
- [ ] Canonical CLI Session UI scenario catches failures like missing router replies or missing custom agents.
- [ ] PTY E2E scenarios are not part of default `npm test` unless explicitly opted in.
