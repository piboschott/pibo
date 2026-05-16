# PRD: Pibo Observability and Debug Telemetry — Runtime, Provider, and Tool Capture

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `../../../../reports/incident-2026-05-16-stuck-toolcall-stream.md`

## 1. Executive Summary

- **Problem Statement**: Pibo currently emits useful normalized events, but runtime incidents still require inference because queue state, active turn phase, provider request lifecycle, raw stream progress, parser behavior, tool-argument progress, and tool execution are not captured as first-class telemetry.
- **Proposed Solution**: Instrument routed sessions, provider stream processing, tool-call construction, and tool execution with best-effort telemetry writes that preserve progress, correlation, timing, counters, and terminal states without storing full raw payloads by default.
- **Success Criteria**:
  - SC-01: Queue and turn lifecycle telemetry shows accepted, queued, started, completed, aborted, errored, or timed-out work with queue depth and queued-behind count.
  - SC-02: Turn phase telemetry shows active/open phases and terminal phases with last progress timestamps.
  - SC-03: Provider request telemetry records start, headers/status, first byte, last raw event, last normalized event, upstream response id when observed, counters, parse errors, unknown event counts, and terminal status.
  - SC-04: Tool-call telemetry records argument deltas as progress metadata, parse state, completion state, safe keys, and execution linkage.
  - SC-05: Capture failures do not crash or block normal provider streaming/tool execution paths.

## 2. User Experience & Functionality

- **User Personas**:
  - Runtime engineer diagnosing session routing and queues.
  - Provider integration engineer debugging OpenAI/Codex Responses streams.
  - Tooling engineer debugging tool-call arguments and tool execution.
  - AI operator investigating an incident after the fact.

- **User Stories**:
  - As a runtime engineer, I want queue and turn lifecycle capture so that I can see whether later messages are blocked behind one stuck turn.
  - As a provider engineer, I want request lifecycle telemetry so that I can tell whether the provider never responded, streamed partially, produced unknown events, failed parsing, completed, aborted, or timed out.
  - As a parser engineer, I want raw event-type summaries so that I can see provider event sequences without dumping raw SSE payloads.
  - As a tool engineer, I want tool-call argument progress so that I can distinguish an incomplete argument stream from a completed tool execution failure.
  - As an operator, I want abort/error capture so that the incident timeline explains why a session recovered.

- **Acceptance Criteria**:
  - Session router/routed session capture records message accepted, queue depth, queued-behind count, turn start, turn finish, abort, clear, and dispose where applicable.
  - Phase capture records queue, message start, prompt build when visible, provider request, provider stream, reasoning, assistant text, tool args, tool execution, continuation, abort, finish, error, and timeout states when inferable from runtime events.
  - Provider capture records lifecycle facts and event counters without requiring raw payload capture.
  - Provider event summaries include sequence number, timestamp, event type, byte size, parse status, normalized type, provider item id when known, tool call id when known, and optional payload preview reference.
  - Tool-call capture records first/last delta time, argument byte length, parse status, safe keys, args completion, execution start, execution end, and error category/message when safe.
  - Best-effort telemetry failures are logged or counted safely and do not throw into the streaming path.

- **Non-Goals**:
  - Implementing stream inactivity timeouts or automatic provider abort/retry.
  - Persisting every raw stream byte or full tool argument body by default.
  - Replacing normalized Pibo event emission.
  - Changing provider semantics except for observation hooks.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Telemetry store/service from PRD 02.
  - Hooks in routed session/session router for lifecycle and phase capture.
  - Hooks in OpenAI/Codex Responses stream processing for raw-event summaries and provider lifecycle.
  - Tool-call and tool-execution event observation from the agent loop/runtime path.

- **Evaluation Strategy**:
  - Unit tests for phase transitions from representative normalized event sequences.
  - Provider parser tests for normal completion, partial tool-call stream, malformed JSON, unknown event type, heartbeat/ignored event, and abort.
  - Tool-call tests for empty, partial, valid, invalid, and complete argument states.
  - Integration fixture reproducing the 2026-05-16 stuck pattern: `tool_call` with `argsComplete=false`, no tool execution, and stale provider/tool phase.

## 4. Technical Specifications

- **Architecture Overview**:
  - Runtime capture writes to the telemetry service at natural lifecycle boundaries.
  - Phase capture maintains one active phase per turn when possible, but supports linked open phases for provider stream and tool args where the model stream requires it.
  - Provider request capture assigns a local `providerRequestId` before the network call and updates it as response headers, raw events, normalized events, errors, aborts, and completion occur.
  - Provider stream parser emits raw event summaries and safe fields while continuing to produce existing normalized events.
  - Tool-call capture tracks by `toolCallId` and provider item id where available, avoiding a single global current item for interleaved calls.
  - Tool execution capture links execution start/update/finish to the tool call id and turn id.

- **Integration Points**:
  - `src/core/session-router.ts` and `src/core/routed-session.ts` for queue/turn state.
  - `node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js` behavior as upstream package behavior to observe or wrap in Pibo-owned seams where feasible.
  - `node_modules/@mariozechner/pi-ai/dist/providers/openai-codex-responses.js` and related shared Responses parser behavior as provider capture targets or wrapped seams.
  - Existing Pibo event stream ids and normalized event persistence for correlation.

- **Security & Privacy**:
  - Provider capture stores lifecycle metadata and event summaries by default, not raw payloads.
  - Tool-call capture stores argument size, parse state, and safe keys by default, not full command or argument content.
  - Header summaries and payload previews must pass through the redaction helper before persistence or display.
  - Capture code must treat unknown provider event fields as sensitive unless explicitly allowlisted as safe.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: queue/turn/phase capture plus provider request summary and tool-call summary capture.
  - v1.1: raw provider event summary rows, safe field selection, parse/unknown counters, and payload preview references.
  - v1.2: expanded interleaved tool-call tests and provider parser fixture coverage.

- **Technical Risks**:
  - Some capture targets live inside dependency packages; mitigate by wrapping provider calls or adding narrow instrumentation seams in Pibo-owned code where direct edits are not appropriate.
  - Interleaved provider items may be mis-associated; mitigate by tracking item ids, output indexes, tool call ids, and provider request ids.
  - Telemetry writes may slow streaming; mitigate with bounded summaries, counters, and best-effort error isolation.
  - Argument parsing may be expensive or unsafe on partial JSON; mitigate with byte limits and tolerant parse-state detection.
