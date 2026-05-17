# Spec: Ink CLI Terminal Rendering Parity

**Status:** Draft  
**Created:** 2026-05-17  
**Owner / Source:** User QA of `pibo tui:sessions` V2 after deployed owner/status fixes  
**Related docs:** `proposal.md`, `design.md`, `tasks.md`, `TERMINAL_DESIGN.md`, `docs/specs/changes/ink-cli-session-ui-v2-web-parity/spec.md`, `docs/specs/capabilities/shared-terminal-view-model.md`

## Why

The CLI/TUI is now functionally closer to Web Chat, but the rendering still feels separate. `/status` can appear as a header message instead of a chronological terminal row. Rich Web terminal cards are represented in the CLI as plain text more often than they should be.

Users need the TUI to feel like the same product surface as the Web Compact Terminal View, while still using terminal-native Ink components.

## Goal

Make `pibo tui:sessions` render session transcript, slash-command results, status, tools, and interactive command output through Compact Terminal semantics that follow `TERMINAL_DESIGN.md`, using shared headless models and renderer-specific Web/Ink components.

## Background / Current State

### Implemented

- Web and CLI share compact terminal rows through `src/session-ui/terminalRows.ts`.
- Web and CLI share several descriptors: command catalog, command results, status view model, terminal cards, owner/room/session picker descriptors.
- The CLI has Ink renderers for rows/cards and can render status/thinking/model/login/tool/error descriptors.
- PTY smoke tests produce raw ANSI, clean text, screen text, event logs, and assertions.

### Gaps

- Some slash-command results are assigned to `state.message`, which renders above the transcript and breaks chronological flow.
- `/status` should be a transcript event/result row. It must not replace or float above the current terminal stream.
- The CLI renderer does not yet consistently apply `TERMINAL_DESIGN.md` rules: transcript-first, dense rows, prefix glyphs, semantic color, compact detail panels, and minimal chrome.
- Existing PTY tests assert text presence but do not make visual review easy.
- Existing Web tests and CLI tests do not yet share enough fixtures to prevent render-logic drift.
- Web Compact Terminal components consume shared descriptors in places, but some rendering choices still live only in DOM components and are not mirrored by Ink tests.

## Scope

### In Scope

- CLI rendering conformance to `TERMINAL_DESIGN.md` within terminal constraints.
- Shared fixtures that build the same `CompactTerminalRow[]` and `TerminalCardDescriptor[]` for Web and Ink tests.
- Chronological transcript rendering for command results, including `/status`, `/thinking`, `/model`, `/login`, `/fast`, `/compact`, `/clone`, `/abort`, `/kill`, and errors.
- Ink renderer improvements for status cards, progress bars, unavailable states, badges, details, and narrow terminals.
- Web regression tests that assert Web Compact Terminal still consumes shared descriptors and keeps expected semantic hooks.
- PTY artifact improvements for visual debugging.

### Out of Scope

- Importing Web DOM/Tailwind/lucide components into Ink — renderer separation remains mandatory.
- Pixel-perfect Web reproduction in terminal cells — parity means semantics, ordering, density, tone, and behavior within terminal limits.
- Replacing the Web Compact Terminal UI.
- Full mouse support in the TUI.
- Redesigning owner/room/session data flows already covered by V2.

## Requirements

### Requirement: Terminal design contract is explicit

The Web Compact Terminal and Ink CLI terminal MUST treat `TERMINAL_DESIGN.md` as the canonical visual and interaction design contract.

#### Acceptance

- Tests or checklist assertions verify that both renderers preserve transcript-first flow, compact rows, prefix glyphs, semantic row kinds, and secret redaction.
- Ink renderer tests include representative output for user, assistant, reasoning, tool, status, thinking, model, login, yielded-run, compaction, command, and error rows.
- New renderer behavior that intentionally diverges from `TERMINAL_DESIGN.md` must be documented in this change or a follow-up spec.

### Requirement: Command results render in transcript order

Slash-command results MUST render as chronological terminal rows unless the command opens a picker, prompts for input, or exits the app.

#### Current

Several commands set `state.message`. That message appears above suggestions/pickers/transcript and can look like a detached status panel.

#### Target

Commands append or hydrate rows into `state.rows` using shared row/card descriptors. The result appears after the command event and before later transcript events.

#### Acceptance

- Running `/status` appends a command row and a status result row to the transcript.
- `/status` does not set a top-level `message` for the status payload.
- When a picker is open and the user types `/status`, the command executes and the result appears in the transcript after the existing rows.
- Existing transcript order is preserved.

#### Scenario: Status while room picker is open

- GIVEN startup shows a room picker
- WHEN the operator types `/status` and presses Enter
- THEN the picker closes
- AND the transcript contains a command/status result in chronological order
- AND the status payload is not rendered as a header message.

### Requirement: Shared model is the parity boundary

The system MUST share terminal semantics through renderer-neutral models, not through Web DOM components.

#### Acceptance

- `src/session-ui` modules do not import React, Ink, DOM, browser APIs, CSS, or Web component files.
- `src/apps/cli-ui` does not import Web Compact Terminal DOM components.
- Web and Ink tests use shared fixtures that assert the same row kinds, card kinds, token tones, progress descriptors, labels, and redaction behavior.

### Requirement: Ink renderer has first-class terminal cards

Ink MUST render shared terminal cards as compact terminal-native rows/panels, not as generic JSON or flattened prose.

#### Acceptance

- Status cards show owner, session, profile, model, runtime, queue/streaming, cwd, context, provider quota, thinking, fast mode, warnings, and errors when present.
- Missing context/provider data renders as `unavailable`, not `0` or blank.
- Progress bars use text cells such as `████░░ 50.0%` and remain meaningful with `NO_COLOR=1`.
- Error and warning rows preserve high-signal markers and redact secrets.
- Narrow terminal snapshots keep owner/session/error/status meaning visible.

### Requirement: Web Compact Terminal remains the reference behavior

Web behavior MUST remain compatible while exposing enough semantic hooks to validate parity.

#### Acceptance

- Web Compact Terminal tests verify that status/model/login/thinking/tool cards consume shared descriptors.
- Web rendered output includes stable semantic hooks such as `data-shared-terminal-card`, `data-shared-status-field`, or equivalent test IDs.
- Web tests cover the same shared fixture used by Ink renderer tests.
- Web typecheck/build/tests remain green.

### Requirement: Visual debugging artifacts are reviewable

PTY validation MUST produce artifacts that let an agent or reviewer inspect what the terminal actually rendered.

#### Acceptance

- Every visual PTY smoke test writes raw ANSI, clean text, final screen text, input metadata, and assertions.
- At least one rendering-parity PTY path writes an ANSI-rendered HTML/SVG/PNG-style artifact, or documents why the environment cannot produce it.
- Reports link the artifact directory and name the exact command used.
- Visual artifacts include `/status` in transcript flow, slash suggestions, room/session picker, and at least one rich card scenario.

## Edge Cases

- No active session exists when `/status` runs.
- A picker is open when a slash command is submitted.
- Status provider/context data is missing, partial, zero, high, or stale.
- Command result contains secrets.
- Very narrow terminal widths.
- `NO_COLOR=1` or unsupported color terminal.
- Large JSON or markdown output.
- Web-only commands return unsupported descriptors.
- A command opens a new session (`/clone`) and must preserve result ordering during session switch.

## Constraints

- **Renderer separation:** Web DOM components cannot be imported into Ink.
- **Design:** `TERMINAL_DESIGN.md` wins over ad hoc CLI formatting unless an explicit terminal limitation applies.
- **Security:** Secrets must be redacted in shared descriptors and renderer output.
- **Performance:** Rendering must remain bounded for large traces.
- **SSH-first:** All user-visible validation must work from a real or pseudo TTY.

## Success Criteria

- [ ] SC-001: `/status` renders in the transcript flow, not as a top-level status message.
- [ ] SC-002: Shared fixture tests prove Web and Ink consume the same row/card/status descriptors.
- [ ] SC-003: Ink renderer tests cover rich cards, no-color output, narrow terminals, details, and redaction.
- [ ] SC-004: Web Compact Terminal regression tests cover the same fixture and shared semantic hooks.
- [ ] SC-005: PTY visual smoke tests produce raw/clean/screen artifacts plus a visual artifact or explicit documented fallback.
- [ ] SC-006: `npm test`, `npm run typecheck`, `npm run chat-ui:typecheck`, and `npm run chat-ui:build` pass before merge/deploy.

## Assumptions and Open Questions

### Assumptions

- The best reuse boundary is shared data/view models plus separate Web/Ink renderers.
- ANSI-rendered SVG/HTML is sufficient for most automated visual review if PNG screenshots are unavailable.
- Some local-only command rows may be ephemeral until the runtime persists equivalent events.

### Open Questions

- Should command-result rows from CLI-only commands be persisted into the event log, or remain local UI rows?
- Which ANSI-to-image renderer should be standardized in the repo?
- Should the Web Compact Terminal expose additional test hooks for model/login/thinking cards?
- Should visual artifacts be generated by default in CI or only in explicit PTY smoke commands?

## Traceability

| Requirement | Task Group | Verification |
|---|---|---|
| Terminal design contract | 1, 3, 5 | Design checklist, renderer snapshots |
| Command results in transcript order | 2, 4 | Unit + PTY `/status` tests |
| Shared model parity boundary | 1, 3 | Static import tests, shared fixture tests |
| Ink first-class cards | 3 | Ink render snapshots, no-color/narrow tests |
| Web reference behavior | 4 | Web shared-fixture regression tests |
| Visual debugging artifacts | 5 | PTY artifacts and report |
