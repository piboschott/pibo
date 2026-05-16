# PRD: Pibo Observability and Debug Telemetry — Signals, Staleness, Documentation, and Validation

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `../../../capabilities/pibo-session-signals.md`, `../../../../reports/incident-2026-05-16-stuck-toolcall-stream.md`

## 1. Executive Summary

- **Problem Statement**: Even with telemetry rows and CLI commands, operators need a compact way to discover stale active work, see lightweight live hints, and follow repeatable playbooks without flooding context or mutating sessions accidentally.
- **Proposed Solution**: Add active-phase/stale hints to live status/signal projections, implement read-only stale detection over telemetry, document incident-debug playbooks, and validate the full drill-down path with synthetic fixtures and safety checks.
- **Success Criteria**:
  - SC-01: Live status/signal snapshots can expose active phase, last progress time, and stale age without raw provider payloads.
  - SC-02: `pibo debug telemetry stale` can list active stale work above a configurable threshold without aborting it.
  - SC-03: Documentation includes playbooks for stuck streaming session, partial tool call, provider parse error, unknown provider event, stale tool execution, and retention cleanup.
  - SC-04: A synthetic partial-tool-call fixture validates session → turn → provider/tool drill-down.
  - SC-05: Validation proves default outputs preserve context budget and never print secrets or raw payload bodies.

## 2. User Experience & Functionality

- **User Personas**:
  - AI agent monitoring whether its own session is stuck.
  - Human operator checking live gateway/session health.
  - QA engineer validating observability behavior.
  - Maintainer writing incident reports and playbooks.

- **User Stories**:
  - As an operator, I want live session status to show a compact active-phase hint so that I know whether to inspect telemetry.
  - As an agent, I want a stale-work list so that I can identify stuck sessions before sending more queued messages.
  - As a QA engineer, I want synthetic telemetry fixtures so that CLI/debug behavior can be tested without depending on live provider failures.
  - As a maintainer, I want incident-debug playbooks so that future investigations follow a safe, repeatable sequence.
  - As a security reviewer, I want validation that default outputs are bounded and secret-safe.

- **Acceptance Criteria**:
  - Status/signal projection includes active phase, last progress timestamp, stale age, and queue depth when available.
  - Status/signal projection does not include raw provider events, payload previews, headers, transcripts, or tool arguments.
  - Stale detection reads telemetry and live state, applies a configurable threshold with a safe default, and never aborts/mutates work.
  - Stale output points to next commands such as `pibo debug telemetry turn <turn-id>`.
  - Playbooks live in docs and use concrete command sequences with warnings about payload previews and destructive prune flags.
  - Validation fixtures cover partial tool-call stream, malformed provider JSON, unknown provider event, no telemetry available, disabled payload capture, and stale tool execution.

- **Non-Goals**:
  - Full Chat Web telemetry drill-down panel in V1.
  - Automated remediation of stale sessions.
  - External alerting integrations.
  - Incident export or long-term analytics dashboards.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Telemetry store/service from PRD 02.
  - Runtime capture from PRD 03.
  - CLI commands from PRD 04.
  - Signal/status projection utilities.
  - Synthetic test fixture builders for telemetry records.

- **Evaluation Strategy**:
  - Unit tests for stale threshold behavior and read-only operation.
  - Signal/status tests assert compact hints and absence of payload fields.
  - CLI drill-down test starts with only a session id and reaches a stuck `tool_args` or `provider_stream` phase.
  - Documentation checks or review checklist ensures playbooks reference bounded commands first.
  - End-to-end safety check verifies no default command prints strings that look like known test secrets.

## 4. Technical Specifications

- **Architecture Overview**:
  - Signal projection reads active runtime state and/or recent telemetry summaries to expose a small `activeTelemetry`-style hint object.
  - Stale detection compares active/open phase `lastProgressAt` against a threshold and returns bounded rows with ids, phase, stale duration, queue depth, and next commands.
  - Fixture builders insert representative telemetry records and optional payload previews into the local telemetry store for repeatable CLI tests.
  - Docs collect operator playbooks under the change docs or capability docs and link to the incident report.

- **Integration Points**:
  - Pibo session signals capability and live gateway status surfaces.
  - `pibo debug telemetry stale` command from PRD 04.
  - Telemetry service stale query and retention stats from PRD 02.
  - Incident report `docs/reports/incident-2026-05-16-stuck-toolcall-stream.md`.

- **Security & Privacy**:
  - Live hints must be metadata-only.
  - Playbooks must warn operators that payload preview commands are explicit, redacted, bounded, and should be avoided unless summaries are insufficient.
  - Validation fixtures should use fake secrets to prove redaction, never real credentials.
  - Destructive prune examples must show dry-run first.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: stale detector, status/signal active-phase hints, and core CLI drill-down fixture.
  - v1.1: incident playbooks and broader safety validation fixtures.
  - v1.2: optional Chat Web compact stale indicator if existing UI status surfaces can consume the hint safely.
  - v2.0: incident pinning/export and Chat Web telemetry drill-down panel.

- **Technical Risks**:
  - Live state and durable telemetry may disagree; mitigate by labeling source and timestamps in hints.
  - Stale thresholds may be too noisy for long model calls; mitigate with configurable threshold and phase-specific future extension.
  - Documentation may drift from CLI behavior; mitigate with CLI examples covered by tests or reviewed with command help output.
  - Safety tests may miss new secret formats; mitigate with centralized redaction tests and conservative matching.
