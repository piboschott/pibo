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
