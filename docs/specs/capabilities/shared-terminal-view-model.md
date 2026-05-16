# Spec: Shared Terminal View Model

**Status:** Draft  
**Created:** 2026-05-16  
**Owner / Source:** `docs/reports/ink-cli-session-subset-report.md`  
**Related docs:** `docs/specs/capabilities/cli-session-ui.md`, `docs/specs/capabilities/chat-web-trace-and-terminal-view.md`, `docs/specs/changes/ink-cli-session-ui/`

## Why

Pibo needs one stable translation from session trace state into compact terminal rows so the Web Chat UI and native Ink CLI show the same underlying session story without duplicating business logic.

The Web UI and CLI must not share DOM components, but they should share row data, status derivation, tokenization, truncation rules, and basic preview logic where possible.

## Goal

Define a renderer-neutral terminal view model that maps `PiboSessionTraceView` into compact rows usable by both React DOM Web renderers and Ink terminal renderers.

## Background / Current State

The current compact Web terminal view already has `terminalRows.ts` and `terminalValue.ts` under `src/apps/chat-ui/src/session-views/compact-terminal/`. The investigation found that `buildCompactTerminalRows()` is the strongest reuse candidate for an Ink CLI because it produces structured rows rather than DOM output.

Keeping this logic inside a Web-only directory makes CLI reuse awkward and risks duplicate mapping logic. The view model should be moved or re-exported from a UI-neutral location while preserving Web behavior.

## Scope

### In Scope

- Renderer-neutral types for compact terminal rows, lines, inline tokens, statuses, and details.
- A shared function that maps `PiboSessionTraceView` to compact rows.
- Shared helpers for terminal-safe value normalization and preview text.
- Contract tests using representative trace fixtures.
- Backward-compatible Web UI usage.
- Ink CLI usage.

### Out of Scope

- Web-specific DOM components and Tailwind styling.
- Ink-specific `Box`/`Text` components.
- Rich browser markdown rendering.
- Interactive JSON tree rendering.
- Changing trace-event semantics.

## Requirements

### Requirement: Terminal row generation is renderer-neutral

The shared terminal view model MUST avoid imports from React DOM, browser APIs, Tailwind/CSS, Virtuoso, lucide icons, and Ink.

#### Acceptance

The shared row module can be imported by both the Web build and the Node/CLI build without pulling browser-only or Ink-only dependencies.

### Requirement: Shared rows derive from canonical trace view data

The shared terminal view model MUST consume canonical Pibo trace/session structures such as `PiboSessionTraceView` and not Web component props.

#### Acceptance

A test can pass a `PiboSessionTraceView` fixture into `buildCompactTerminalRows()` and receive deterministic rows without rendering React.

### Requirement: Web compact terminal behavior is preserved

Moving or re-exporting the terminal view model MUST preserve existing Web compact terminal behavior.

#### Acceptance

Existing Web typecheck/build passes. Snapshot or unit tests for row generation pass before and after extraction.

### Requirement: CLI renderer consumes the same rows

The Ink CLI transcript MUST render from the same compact row data as the Web compact terminal view.

#### Acceptance

The CLI renderer accepts shared row fixtures and produces terminal output without calling Web row generation alternatives.

### Requirement: Details remain structured but renderer-neutral

Row details MUST expose structured data such as input, output, error, linked session ids, run ids, or event ids without requiring Web-specific detail components.

#### Acceptance

Both Web and CLI detail panels can render row details from the same model while applying different presentation rules.

### Requirement: Preview and truncation rules are explicit

The view model MUST define bounded preview behavior for large values so CLI and Web do not accidentally render unbounded content.

#### Acceptance

Tests cover long text, JSON-like values, empty values, missing values, errors, and truncation markers.

## Edge Cases

- Empty trace view.
- Trace with only user messages.
- Trace with streaming assistant state but no final message.
- Tool call without result.
- Tool result without known call metadata.
- Delegated/child session row.
- Yielded run row with running and finished states.
- Error row with non-Error payload.
- Very large text and JSON values.

## Constraints

- **Compatibility:** Web imports may be updated, but visual Web behavior must not intentionally change as part of extraction.
- **Dependency hygiene:** Shared model modules must remain free of renderer dependencies.
- **Bounded output:** Row generation should provide enough metadata for renderers to limit output.

## Success Criteria

- [ ] SC-001: Shared terminal view-model modules exist outside a Web-only component path or are re-exported through a documented shared boundary.
- [ ] SC-002: Web compact terminal and Ink CLI both import the same row-generation contract.
- [ ] SC-003: Unit tests cover representative row kinds and truncation behavior.
- [ ] SC-004: Typecheck passes for root, Chat Web, and CLI-relevant builds.

## Assumptions and Open Questions

### Assumptions

- The initial implementation can move code into `src/session-ui/` or an equivalent shared path.
- Existing Web files may keep compatibility re-exports to reduce churn.

### Open Questions

- Should the shared model live under `src/shared/`, `src/session-ui/`, or another project convention?
- Which exact row kinds are considered part of the public contract for V1?

## Traceability

| Requirement | Consumer | Status |
|---|---|---|
| Renderer-neutral rows | Web and CLI | Draft |
| Canonical trace input | Trace engine/session UI | Draft |
| Web behavior preserved | Chat Web | Draft |
| CLI renderer reuse | Ink CLI | Draft |
