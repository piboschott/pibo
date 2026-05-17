# Ink CLI Terminal Rendering Parity Implementation Progress

## Ralph job setup

- Created: 2026-05-17
- Owner scope: `user:ueR3mwuqBMPNTber3xuTwLmODbUlF4Sa`
- Target room: `room_d45b1be3-7317-4c35-86b3-5e4550336cdc`
- Profile: `pibo-agent`
- Ralph job: `ralph_2573cc4a-d1d4-4a0e-88e9-c6224222c2d4`
- Max iterations: `105` (3x 35 PRD user stories)
- Template: `prd-batch-stories` with flexible coherent story batching
- Host worktree: `/root/code/pibo/.worktrees/ink-cli-terminal-rendering-parity`
- Branch: `ralph/ink-cli-terminal-rendering-parity`
- Docker dev worker: `pibo-dev-ink-cli-terminal-rendering-parity`
- Container workspace: `/workspace`
- Web: `http://127.0.0.1:4842/apps/chat`
- Gateway port: `4840`
- CDP port: `4841`
- Chat UI dev port: `4843`
- Context Files UI dev port: `4844`

## Scope

Implement:

- `docs/specs/changes/ink-cli-terminal-rendering-parity/proposal.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/spec.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/design.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/tasks.md`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/prd_*.json`
- `docs/specs/changes/ink-cli-terminal-rendering-parity/prds/*.md`
- `TERMINAL_DESIGN.md`

## Operating notes

- Work in the dedicated host worktree above.
- Reuse the existing Docker dev worker for runtime, tests, builds, dev gateway/browser checks, and PTY validation.
- Do not create or release Docker workers unless explicitly asked.
- Do not restart or modify host services.
- Run container commands as `docker exec pibo-dev-ink-cli-terminal-rendering-parity bash -lc 'cd /workspace && <command>'`.
- Git metadata is not available inside the container. Git operations and commits must be done on the host worktree path.
- Clean stale Chrome/Chromium/Playwright/Puppeteer processes inside the Docker worker at the start and end of every Ralph session, and after any browser/CDP validation.
- Batch stories fluidly: choose as many related failing stories as can be implemented, fully verified, and committed safely. There is no fixed cap of three stories.
- If a story is large or risky, do only that story or a smaller coherent slice.
- Commit after each completed story or coherent story group.
- Before starting new work, review recent commits in this worktree/branch.

## Progress log

- 2026-05-17: Created worktree, committed PRD Markdown/JSON batch, started Docker dev worker, prepared Ralph job prompt, and created stopped Ralph job `ralph_2573cc4a-d1d4-4a0e-88e9-c6224222c2d4`.
- 2026-05-17: Validated Docker worker access and replaced the Ralph prompt Chrome cleanup command with exact-name `pkill -x` cleanup so the cleanup command does not match and terminate its own shell.
- 2026-05-17: Confirmed target room `room_d45b1be3-7317-4c35-86b3-5e4550336cdc`, set Ralph max iterations to 105, and tightened the job prompt using outcome-first prompting guidance.

## 2026-05-17 Ralph run: PRD 01 design contract and guardrails

### Selected coherent story group

- PRD 01 `US-002` Codify non-negotiable terminal design rules.
- PRD 01 `US-003` Add static renderer-boundary guardrails.
- PRD 01 `US-004` Create audit-backed implementation gate for future stories.
- Opportunistic support for PRD 01 `US-001` only if PTY artifacts can be captured after the worker build is restored; otherwise leave it false.

### Plan and validation approach

1. Add a concrete design-contract/checklist document under `docs/specs/changes/ink-cli-terminal-rendering-parity/` and point the PRD catalog at it.
2. Strengthen static source tests so shared `src/session-ui` stays renderer-neutral, `src/apps/cli-ui` stays Web-free, and supported rich cards are proven to route through shared descriptors with redaction before rendering.
3. Run focused tests in the Docker worker after building dist: `node --test test/session-ui-view-models.test.mjs test/session-ui-terminal-rows.test.mjs test/cli-ui-ink-renderer.test.mjs` and `npm run typecheck`.
4. If feasible, run PTY smoke/audit flows with `pibo debug pty` and save artifacts under `.tmp/ink-cli-terminal-rendering-parity/`, then create an audit report under `docs/reports/`; otherwise document the blocker and keep `US-001` false.
5. Mark only fully verified stories `passes: true`, update notes with commands/evidence/artifacts, run final browser cleanup, and commit the coherent group from the host worktree.

### Result

Completed PRD 01 `US-001` through `US-004`.

Changes:

- Added `docs/specs/changes/ink-cli-terminal-rendering-parity/terminal-design-contract.md` with mandatory pass/fail rendering rules, `state.message` policy, allowed renderer differences, forbidden parity claims, visual evidence checklist, and traceability.
- Added `docs/reports/ink-cli-terminal-rendering-parity-audit-2026-05-17.md` with PTY artifact paths, exact commands, element classification, design comparison, limitations, and visual conversion fallback.
- Linked the PRD catalog to the visual evidence gate.
- Strengthened static/shared descriptor tests in `test/session-ui-view-models.test.mjs` and added `test/ink-cli-terminal-design-contract.test.mjs`.
- Fixed reusable PTY smoke scenario assertions in `scripts/ink-cli-v2-pty-smoke.mjs` and `test/ink-cli-v2-pty-smoke.test.mjs` so they match current compact terminal output and room selection.
- Marked PRD 01 stories `passes: true` with evidence notes.

Validation run in Docker worker:

- `npm run build` — passed.
- `node --test test/ink-cli-terminal-design-contract.test.mjs test/ink-cli-v2-pty-smoke.test.mjs test/session-ui-view-models.test.mjs test/session-ui-terminal-rows.test.mjs test/cli-ui-ink-renderer.test.mjs` — passed, 26 tests.
- `node scripts/ink-cli-v2-pty-smoke.mjs --artifact-root .tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17` — owner/session and slash/status/thinking scenarios passed after smoke assertion updates; existing-session truncation assertion was corrected and rerun separately.
- `node scripts/ink-cli-v2-pty-smoke.mjs --scenario existing-session-hydration --artifact-root .tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17` — passed.
- `node dist/bin/pibo.js debug pty run --artifact --artifact-dir .tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17/running-row-demo ...` — passed.
- `npm run typecheck` — passed.
- `npm test` — passed, 661 tests.

Evidence/artifacts:

- `/workspace/.tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17/owner-room-session-message`
- `/workspace/.tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17/slash-suggestions-status-thinking`
- `/workspace/.tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17/existing-session-hydration`
- `/workspace/.tmp/ink-cli-terminal-rendering-parity/audit-2026-05-17/running-row-demo`

Each artifact directory contains `raw.ansi.log`, `clean.txt`, `screen.txt`, `metadata.json`, `input.json`, `assertions.json`, and `events.jsonl`. Evidence tiers are mocked default TUI path for the first three scenarios and demo renderer PTY for running rows. Visual HTML/SVG/PNG conversion is documented as a fallback in the audit report.

Remaining limitations:

- Running/streaming row evidence is demo-only, not real provider streaming.
- Final installed/global `pibo tui:sessions` smoke remains for PRD 07/final completion.
- PRDs 02-07 remain incomplete.
