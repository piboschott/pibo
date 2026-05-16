# PRD: Pibo Observability and Debug Telemetry — Store, Redaction, and Retention

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: Pibo lacks a structured telemetry data model that can persist correlated runtime facts without relying on timestamp inference or raw log dumps.
- **Proposed Solution**: Add additive SQLite-backed telemetry tables plus typed store/service APIs for turns, phases, provider requests, provider event summaries, tool calls, and optional redacted payload previews, with explicit redaction and retention behavior.
- **Success Criteria**:
  - SC-01: Telemetry rows can be joined by explicit ids across session, room, turn, phase, provider request, upstream response, tool call, run, and event stream where available.
  - SC-02: Schema migrations are idempotent and do not break existing Pibo debug/session/event stores.
  - SC-03: Redaction tests prove known secret keys, auth headers, cookies, bearer tokens, API keys, OAuth token fields, and secret-like text patterns do not appear in persisted previews or command output.
  - SC-04: Store APIs support bounded insert/update/list/detail operations needed by runtime capture and debug CLI.
  - SC-05: Retention stats and prune dry-run can report rows and byte counts by retention class before deletion.

## 2. User Experience & Functionality

- **User Personas**:
  - Runtime engineer writing telemetry events.
  - CLI engineer querying telemetry summaries.
  - Security reviewer auditing redaction behavior.
  - Maintainer operating local stores over time.

- **User Stories**:
  - As a runtime engineer, I want a typed telemetry service so that capture code can write small correlated facts without knowing SQL details.
  - As a CLI engineer, I want list/detail queries with limits and cursors so that debug commands can stay bounded.
  - As a security reviewer, I want a central redaction helper so that all payload previews and headers follow the same safety rules.
  - As a maintainer, I want retention classes and prune dry-runs so that telemetry does not grow without bound.

- **Acceptance Criteria**:
  - Schema supports telemetry turns, phases, provider requests, provider event summaries, tool-call summaries, and payload previews or an equivalent normalized representation.
  - Each table has stable ids, timestamps, status fields, correlation fields, and indexes for common debug paths.
  - Store/service methods are typed and expose insert/update/list/detail APIs without requiring callers to construct raw SQL.
  - Payload previews are optional, redacted, byte-limited, marked with redaction/truncation metadata, and assigned a short retention class.
  - Redaction covers headers and JSON/text payloads before persistence where preview capture is enabled.
  - Retention stats and prune dry-run can be consumed by CLI commands.

- **Non-Goals**:
  - A full external observability datastore.
  - Storing every token or every raw provider event payload indefinitely.
  - Rewriting existing event log storage.
  - Implementing runtime capture hooks beyond store/service call sites.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - SQLite migration and store utilities already used by Pibo.
  - TypeScript types for telemetry records and query results.
  - Redaction utility used consistently by store and CLI rendering.

- **Evaluation Strategy**:
  - Migration tests run twice against an empty database and existing database.
  - Store contract tests insert and update turns, phases, provider requests, provider events, tool calls, and payload previews.
  - Query tests verify limits, cursors, correlation lookup, and missing-store behavior.
  - Redaction tests include nested JSON, arrays, headers, text patterns, and false-positive-safe secret key matching.
  - Retention tests cover stats, dry-run, and apply behavior without touching unrelated stores.

## 4. Technical Specifications

- **Architecture Overview**:
  - Add telemetry record types equivalent to `TelemetryTurn`, `TelemetryPhase`, `TelemetryProviderRequest`, `TelemetryProviderEvent`, `TelemetryToolCall`, and `TelemetryPayloadPreview` from `../design.md`.
  - Add a telemetry store/service layer with small methods such as `upsertTurn`, `startPhase`, `finishPhase`, `upsertProviderRequest`, `appendProviderEventSummary`, `upsertToolCall`, `savePayloadPreview`, `listSessionTelemetry`, `getTurnTimeline`, `getProviderRequest`, `listProviderEvents`, `getToolCall`, `listStaleWork`, `getStats`, and `pruneTelemetry` or style-equivalent names.
  - Keep writes best-effort and small; runtime capture must be able to continue when telemetry is disabled or unavailable.
  - Use indexed ids and timestamps for efficient debug queries.

- **Integration Points**:
  - Existing local database initialization/migration code.
  - Existing debug store access and CLI output helpers.
  - Runtime capture sites added by later PRDs.
  - Retention/prune debug commands added by later PRDs.

- **Security & Privacy**:
  - Default capture mode is `summary_only` unless explicitly configured otherwise.
  - Redaction helper must redact known sensitive keys case-insensitively and common sensitive string patterns.
  - Header summaries must never expose raw `authorization`, `cookie`, `set-cookie`, or secret-bearing headers.
  - Payload preview persistence must record `redacted`, `truncated`, `byteSize`, and `retentionClass` metadata.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: schema, record types, typed store/service, redaction helper, and core contract tests.
  - v1.1: retention stats/prune service and payload preview support.
  - v1.2: optional incident retention/pinning and aggregated provider-event compaction if needed.

- **Technical Risks**:
  - Schema placement may conflict with existing store boundaries; mitigate with additive migrations and clear store ownership.
  - Store writes may become too frequent; mitigate with summary rows, counters, and bounded event summaries.
  - Redaction may remove useful fields; mitigate by exposing safe metadata fields such as event type, ids, counters, byte sizes, and selected safe dot-paths.
  - Retention pruning may delete evidence too soon; mitigate with separate classes and documented defaults.
