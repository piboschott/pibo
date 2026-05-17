# Ink CLI Session UI V2 Web Parity Implementation Progress

## Ralph job setup

- Created: 2026-05-17
- Owner scope: `user:ueR3mwuqBMPNTber3xuTwLmODbUlF4Sa`
- Target room: `room_557eda90-943d-4fc0-b2d6-c13b44d080cc`
- Profile: `pibo-agent`
- Template: `prd-batch-stories`
- Total PRD stories: 33
- Max iterations: 99
- Worktree: `/root/code/pibo/.worktrees/ink-cli-v2-web-parity`
- Branch: `ink-cli-v2-web-parity`
- Docker dev worker: `pibo-dev-ink-cli-v2-web-parity`
- Container workspace: `/workspace`
- Docker web port: `4822`
- Docker gateway port: `4820`
- Docker CDP port: `4821`
- Docker Chat UI port: `4823`
- Docker Context Files UI port: `4824`

## Scope

Implement PRDs under:

`docs/specs/changes/ink-cli-session-ui-v2-web-parity/prds/prd_*.json`

Related specs:

- `docs/specs/changes/ink-cli-session-ui-v2-web-parity/proposal.md`
- `docs/specs/changes/ink-cli-session-ui-v2-web-parity/spec.md`
- `docs/specs/changes/ink-cli-session-ui-v2-web-parity/design.md`
- `docs/specs/changes/ink-cli-session-ui-v2-web-parity/tasks.md`

## Operating notes

- Keep implementation work in the dedicated host worktree above.
- The Pibo room should be configured to start agents in `/root/code/pibo/.worktrees/ink-cli-v2-web-parity`.
- Reuse the dedicated Docker dev worker for runtime, tests, dev gateway, browser checks, and real PTY-backed checks.
- Container path is `/workspace`; host worktree is bind-mounted there.
- Run container commands as `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && <command>'`.
- Git metadata may be unreliable inside the container; run git operations and commits on the host worktree path.
- Do not create or release Docker workers unless explicitly asked.
- Do not restart or modify host `pibo-web.service`.
- Do not expose credentials in prompts, logs, commits, PTY artifacts, or reports.
- Use `pibo debug pty ...` for real PTY-backed CLI/TUI smoke tests, scripted input, assertions, and raw/clean artifacts.
- Fake/demo/mocked checks are supporting evidence only; user-facing CLI/TUI stories need the closest practical real/default path when feasible.
- Batch user stories sensibly. A run may complete multiple coherent stories, but must stop rather than push through ambiguity, failed tests, or unsafe changes.
- Commit after each completed story or coherent story group.
- Before starting new work, review recent commits in this worktree/branch.
- When a story is marked `passes: true`, its `notes` must record concrete evidence: commands run, PTY scenario if relevant, raw/clean artifact paths, Web/browser checks if relevant, and commit hash.

## Codebase Patterns

- Shared Web/CLI terminal presentation should live in renderer-neutral `src/session-ui` modules.
- Ink renderer modules must not import Web DOM/CSS/browser presentation dependencies.
- Web DOM components must not be imported into CLI renderer modules.
- Host-root CLI owner impersonation is a deliberate local recovery/admin mode and must show the active owner before actions.
- New CLI sessions must never silently use `user:unknown`.

## Progress log

- 2026-05-17: Created worktree, committed V2 specs/PRDs, spawned dedicated dev worker, and prepared Ralph prompt parameters.

## 2026-05-17 run: PRD 01 current-state audit batch

Selected story group:

- `prd_01_product_scope_and_current_state.json` / `US-001` — Audit current Web and Ink terminal sharing.
- `prd_01_product_scope_and_current_state.json` / `US-002` — Document V2 parity scope and command inventory.
- `prd_01_product_scope_and_current_state.json` / `US-003` — Reproduce/document owner-scope visibility bug.

Intended validation plan:

- Add a canonical current-state report under `docs/reports/` covering shared `src/session-ui`, Web compact terminal DOM components, Ink components, CLI source/runtime integration, V2 command inventory, unsupported/product-area boundaries, PTY validation conventions, and the `user:unknown` Web visibility bug.
- Add a focused test fixture documenting the current owner fallback and a pending regression for the future no-`user:unknown` behavior.
- Run focused build/test for the new/changed tests inside `pibo-dev-ink-cli-v2-web-parity`.
- Run `npm run typecheck` inside `pibo-dev-ink-cli-v2-web-parity`.
- Update PRD JSON story notes with evidence and commit hash, then commit the coherent audit batch from the host worktree.

Validation and results for PRD 01 current-state audit batch:

- Added `docs/reports/ink-cli-session-ui-v2-current-state.md` with the current shared Web/Ink surface, DOM-only Web compact terminal map, Ink renderer map, CLI source/runtime integration map, V2 scope matrix, gateway/Web/CLI command inventory, unsupported/product-area boundaries, owner-scope bug analysis, and PTY validation convention.
- Added `test/ink-cli-v2-current-state.test.mjs`:
  - active report coverage test for shared surface, command inventory, owner-scope fields, and PTY convention;
  - active persistent-path reproduction showing no-owner CLI creation writes `sessions.owner_scope = user:unknown` and message ingest writes `session_navigation.owner_scope = user:unknown`, making the session absent from `find({ ownerScope: "user:real-web-owner" })`;
  - skipped pending regression fixture for the future V2 no-implicit-`user:unknown` behavior.
- Validation commands:
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run dev -- debug pty --help'` — passed; confirmed PTY debug command surface for documentation.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run build && node --test test/ink-cli-v2-current-state.test.mjs'` — build passed; first test run exposed the fixture used unavailable `pibo-agent` in this registry, then the fixture was corrected to `codex-compat-openai-web`.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && node --test test/ink-cli-v2-current-state.test.mjs'` — passed: 2 passing, 1 skipped pending fixture.
  - `docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run typecheck'` — passed.
- Path classification: documentation/test audit plus real persistent local source reproduction. No user-facing TUI behavior changed, so no PTY raw/clean artifacts were required for this batch.
- Completed stories marked `passes: true`: PRD 01 `US-001`, `US-002`, `US-003`.
- Implementation commit: `d8095bc` (`Audit Ink CLI V2 current state`).
- Next recommended group: PRD 02 `US-001` owner discovery and Root recovery owner, then PRD 04 `US-001` source owner/room contract expansion if needed as a dependency.

## 2026-05-17 run: PRD 02 owner discovery and source contract batch

Selected story group:

- `prd_02_owner_scope_recovery_profile.json` / `US-001` — Add owner discovery and Root recovery owner.
- `prd_04_room_session_navigation.json` / `US-001` — Expand CLI source owner and room contracts, limited to the source/API foundation needed by owner discovery and default-room mapping.

Intended validation plan:

- Add renderer-neutral CLI session source owner types/methods for active owner, discovered owners, owner-scoped room/session listing, and room-scoped creation.
- Implement local owner discovery from session store, session navigation, rooms, event log, custom agents when available, plus explicit configured owner scope.
- Define a stable Root recovery owner scope and ensure a selected/fallback owner has a Personal Chat/default room available through local data room service when available, or a deterministic virtual room for memory-only tests.
- Preserve `--session`/existing source compatibility by defaulting local sources with no explicit owner to the resolved single/fallback owner rather than `user:unknown`.
- Add focused source tests for no owners, one owner, multiple owners, owner/room/session filtering, and create-session owner/default-room behavior.
- Run `npm run build`, focused source tests, and `npm run typecheck` inside `pibo-dev-ink-cli-v2-web-parity` before committing.
