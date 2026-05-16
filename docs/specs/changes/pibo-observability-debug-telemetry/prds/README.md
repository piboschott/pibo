# PRD Catalog: Pibo Observability and Debug Telemetry

**Status:** Draft  
**Created:** 2026-05-16  
**Source change:** `docs/specs/changes/pibo-observability-debug-telemetry/`

This directory translates the observability/debug telemetry proposal, spec, design, task list, and incident report into implementation-grade PRDs and Ralph-ready `prd_*.json` files.

## Source Documents

- `../proposal.md`
- `../spec.md`
- `../design.md`
- `../tasks.md`
- `../../../../reports/incident-2026-05-16-stuck-toolcall-stream.md`

## PRDs

| PRD | Scope | Primary implementers | Ralph JSON |
|---|---|---|---|
| `01-product-overview.md` | End-to-end product, personas, success criteria, rollout decisions | Product, engineering leads | `prd_01_product_overview.json` |
| `02-telemetry-store-redaction-retention.md` | Telemetry schema, typed store/service, redaction, retention, pruning | Storage/runtime engineers | `prd_02_telemetry_store_redaction_retention.json` |
| `03-runtime-provider-tool-capture.md` | Queue/turn/phase capture, provider stream diagnostics, tool-call progress, tool execution | Runtime/provider engineers | `prd_03_runtime_provider_tool_capture.json` |
| `04-debug-telemetry-cli.md` | Progressive `pibo debug telemetry` command surface, bounded output, JSON output | CLI/debug engineers | `prd_04_debug_telemetry_cli.json` |
| `05-signals-staleness-docs-validation.md` | Live hints, stale detection, operational playbooks, validation fixtures, rollout checks | Full-stack/QA/SRE engineers | `prd_05_signals_staleness_docs_validation.json` |

## Global Decisions Inherited by All PRDs

- Telemetry follows the existing `pibo debug` progressive-discovery pattern: broad summaries first, drill-down by id, explicit payload fetches only.
- Default command output must be bounded and must not print full provider payloads, headers, transcripts, or secrets.
- Raw provider payload storage is not a product goal. V1 stores structured summaries and optional redacted bounded previews only.
- Telemetry records must be explicitly correlated through Pibo Session, room, turn, phase, provider request, upstream response, tool call, run, and event-stream identifiers when available.
- Signals and Chat Web status surfaces may expose compact active-phase/stale hints, but detailed evidence lives in telemetry commands.
- Runtime hardening such as automatic abort/retry on provider inactivity is separate from this telemetry feature.
- External observability SaaS integration is out of scope; V1 is local-first.

## Assumptions / TBD

The source specs intentionally left several choices open. These PRDs use the following implementation assumptions so Ralph can proceed in small loops. Update before execution if the project decides differently.

- **Telemetry storage:** implement in the existing local SQLite store boundary that best matches current debug/event storage conventions; keep schema additive and idempotent.
- **Payload preview mode:** default to `summary_only`; enable redacted previews only through explicit config or command path.
- **Default stale threshold:** use 5 minutes unless an existing config value is available.
- **Chat Web V1 scope:** expose compact signal/status hints only; no full telemetry drill-down panel in V1.
- **Incident pinning:** defer beyond V1 unless it falls out naturally from retention classes.

## Traceability Matrix

| Spec requirement | PRD coverage |
|---|---|
| Progressive telemetry discovery | `01`, `04`, `05` |
| Correlated telemetry records | `02`, `03`, `04` |
| Explicit runtime phases | `02`, `03`, `04`, `05` |
| Provider request lifecycle | `02`, `03`, `04` |
| Raw provider summaries, not dumps | `02`, `03`, `04` |
| Tool-call argument progress | `02`, `03`, `04` |
| Stale active work discovery | `03`, `04`, `05` |
| Context-budget protection | `01`, `04`, `05` |
| Safe-by-default redaction | `02`, `03`, `04`, `05` |
| Explicit retention and prune behavior | `02`, `04`, `05` |
| Signal hints with telemetry evidence | `05` |
| Stable JSON output for agents | `04`, `05` |

## Ralph Execution Note

Use the JSON files in dependency order. Earlier PRDs establish schema/services before capture and CLI stories consume them. Each story is intended to fit into one Ralph iteration and includes `Typecheck passes` as a completion gate.
