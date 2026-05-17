# PRD Catalog: Ink CLI Terminal Rendering Parity

**Status:** Draft  
**Created:** 2026-05-17  
**Source change:** `docs/specs/changes/ink-cli-terminal-rendering-parity/`

This catalog converts the Ink CLI Terminal Rendering Parity change spec into implementation-grade Markdown PRDs and Ralph JSON story batches.

## Source Documents

- `../proposal.md`
- `../spec.md`
- `../design.md`
- `../tasks.md`
- `../../ink-cli-session-ui-v2-web-parity/spec.md`
- `../../../../TERMINAL_DESIGN.md`

## Product Position

`pibo tui:sessions` must become a terminal-native peer of the Web Compact Terminal View. Web and Ink must not share DOM components, but they must share render flow, row/card semantics, command-result behavior, streaming order, status content, and validation fixtures. Ink may use its own ASCII/ANSI style, but the user must recognize the same terminal product immediately.

## PRDs

| PRD | Scope | Ralph JSON |
|---|---|---|
| `01-terminal-design-contract-and-audit.md` | Current-state audit, `TERMINAL_DESIGN.md` conformance, non-negotiable rendering guardrails | `prd_01_terminal_design_contract_and_audit.json` |
| `02-shared-render-flow-and-fixtures.md` | Shared row/card fixtures, ordering, streaming metadata, Web/Ink parity contracts | `prd_02_shared_render_flow_and_fixtures.json` |
| `03-transcript-command-results-and-slash-palette.md` | Slash suggestions/palette placement, command result flow, command result row conversion | `prd_03_transcript_command_results_and_slash_palette.json` |
| `04-ink-compact-terminal-renderer.md` | High-quality Ink rows, user/assistant distinction, spacing, markers, details, narrow/no-color behavior | `prd_04_ink_compact_terminal_renderer.json` |
| `05-status-and-runtime-cards.md` | Status card parity with Web, context/provider quota bars, compact unavailable states, redaction | `prd_05_status_and_runtime_cards.json` |
| `06-pickers-overlays-and-keyboard-flows.md` | Room/session/owner/model/login/thinking pickers as terminal overlays matching Web flow semantics | `prd_06_pickers_overlays_and_keyboard_flows.json` |
| `07-visual-debugging-and-e2e-validation.md` | PTY visual artifacts, golden screen checks, Web screenshot/reference checks, final validation gates | `prd_07_visual_debugging_and_e2e_validation.json` |

## Ralph Batch Summary

- JSON files: 7
- User stories: 35 total
- Ralph input glob: `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/prd_*.json`
- Recommended branch prefix: `ralph/ink-cli-*`

## Mandatory Ralph Validation Rules

- Every TUI story that changes user-visible rendering must include a `pibo debug pty ...` validation scenario when feasible.
- Fake/demo/mocked tests may support a story, but default-path behavior must be validated with a real installed `pibo tui:sessions` path before final completion.
- Web-impacting stories must include Web Compact Terminal regression checks.
- Shared-model stories must include tests that prove Web and Ink consume the same row/card descriptors.
- Every story must include `Typecheck passes`.
- Renderer stories must include focused snapshot/semantic render tests and no-color/narrow-width coverage where relevant.
- Final evidence must record artifact paths: raw ANSI, clean text, final screen, metadata, assertions, and visual HTML/SVG/PNG artifact or documented fallback.
