# Tasks: Pibo Observability and Debug Telemetry

## 1. Spec and Discovery Foundation

- [ ] 1.1 Review and approve `docs/specs/changes/pibo-observability-debug-telemetry/spec.md`.
- [ ] 1.2 Review and approve `docs/specs/changes/pibo-observability-debug-telemetry/design.md`.
- [ ] 1.3 Decide storage location: `pibo.sqlite`, `pibo-events.sqlite`, or separate telemetry store.
- [ ] 1.4 Decide default stale threshold and payload-preview capture mode.
- [ ] 1.5 Add or update capability spec after design approval if needed.

## 2. Data Model and Redaction

- [ ] 2.1 Add telemetry schema migration for turns, phases, provider requests, provider events, tool calls, and payload previews.
- [ ] 2.2 Add typed telemetry store/service with bounded insert/update methods.
- [ ] 2.3 Add redaction helper for headers, JSON payloads, and text previews.
- [ ] 2.4 Add retention class and stats support.
- [ ] 2.5 Add tests for idempotent migration, missing store behavior, redaction, truncation, and prune dry-run.

## 3. Runtime and Provider Capture

- [ ] 3.1 Capture queue and turn lifecycle in session router / routed session.
- [ ] 3.2 Capture phase transitions from normalized events.
- [ ] 3.3 Capture provider request lifecycle around stream calls.
- [ ] 3.4 Capture raw provider event summaries in OpenAI/Codex Responses stream parser.
- [ ] 3.5 Capture parse error and unknown-event counters.
- [ ] 3.6 Capture tool-call argument progress metadata, including deltas as counters and timestamps.
- [ ] 3.7 Capture tool execution start/update/finish summaries.
- [ ] 3.8 Add tests for partial tool-call stream, malformed SSE event, unknown event type, and interleaved tool calls where feasible.

## 4. Signals and Staleness Hints

- [ ] 4.1 Add active phase and last progress summary to runtime status or signal projection.
- [ ] 4.2 Add stale work detector that reads telemetry without aborting work.
- [ ] 4.3 Expose stale hints through gateway status when available.
- [ ] 4.4 Add tests for active stale session and non-stale active session.

## 5. Debug CLI

- [ ] 5.1 Add `pibo debug telemetry --help` with compact progressive discovery.
- [ ] 5.2 Add `sessions`, `session`, and `turn` commands with bounded text and JSON output.
- [ ] 5.3 Add `provider`, `provider events`, and `provider payload` commands with cursors, limits, fields, redaction, and truncation indicators.
- [ ] 5.4 Add `tool` command for tool-call argument and execution telemetry.
- [ ] 5.5 Add `stale` command with threshold option.
- [ ] 5.6 Add `stats` and `prune` commands with dry-run default.
- [ ] 5.7 Add next-command suggestions to text and JSON output.
- [ ] 5.8 Add tests mirroring existing debug CLI patterns.

## 6. Validation

- [ ] 6.1 Run `npm run typecheck`.
- [ ] 6.2 Run debug CLI tests.
- [ ] 6.3 Reproduce a synthetic partial-tool-call telemetry fixture and verify drill-down path:
  - [ ] `pibo debug telemetry session ps_...`
  - [ ] `pibo debug telemetry turn <turn-id>`
  - [ ] `pibo debug telemetry provider <provider-request-id>`
  - [ ] `pibo debug telemetry tool <tool-call-id>`
- [ ] 6.4 Verify no default command prints raw provider payloads or secrets.
- [ ] 6.5 Verify payload preview command reports truncation and redaction metadata.

## 7. Documentation and Handoff

- [ ] 7.1 Add examples to the Debug CLI capability spec or a dedicated telemetry capability spec.
- [ ] 7.2 Add an incident-debug playbook: stuck streaming session, partial tool call, provider parse error, stale tool execution.
- [ ] 7.3 Document retention defaults and pruning commands.
- [ ] 7.4 Document how agents should drill down without overflowing context.
