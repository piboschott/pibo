# Compute Browser Resource Lifecycle Implementation Progress

## Ralph job setup

- Created: 2026-05-17
- Owner scope: `user:ueR3mwuqBMPNTber3xuTwLmODbUlF4Sa`
- Target room: `room_378b95da-ae39-4154-bd2e-5177cd741780`
- Profile: `pibo-agent`
- Template: `prd-batch-stories`
- Worktree: `/root/code/pibo/.worktrees/compute-browser-resource-lifecycle`
- Branch: `compute-browser-resource-lifecycle`
- Docker dev worker: `pibo-dev-compute-browser-resource-lifecycle`
- Docker web port: `4832`
- Docker gateway port: `4830`
- Docker CDP port: `4831`

## Scope

Implement the PRD JSON stories under:

`docs/specs/changes/compute-browser-resource-lifecycle/prds/prd_*.json`

Related docs:

- `docs/specs/changes/compute-browser-resource-lifecycle/proposal.md`
- `docs/specs/changes/compute-browser-resource-lifecycle/spec.md`
- `docs/specs/changes/compute-browser-resource-lifecycle/design.md`
- `docs/specs/changes/compute-browser-resource-lifecycle/tasks.md`

## Operating notes

- Keep implementation work in this dedicated host worktree.
- Use the dedicated Docker dev worker for runtime, tests, builds, dev gateway restarts, and browser checks.
- Do not create or release Docker workers unless explicitly asked.
- Do not restart or modify host `pibo-web.service`, `pibo-web-dev.service`, or production services.
- Run container commands as `docker exec <worker> bash -lc 'cd /workspace && <command>'`.
- Git operations and commits must be done on the host worktree path.
- Commit after each completed story or coherent story group.
- Before starting new work, review recent commits in this worktree/branch.
- For incomplete work, say `completion marker omitted` instead of writing the XML completion marker.

## Progress log

- 2026-05-17: Created worktree, copied specs/PRDs/JSON files, and prepared Ralph loop baseline.
- 2026-05-17: Rebuilt `pibo:latest` and started Docker dev worker `pibo-dev-compute-browser-resource-lifecycle` with manual safety limits (`2g` memory, `512` PIDs, `512m` shm).
- 2026-05-17: Started Xvfb inside the Docker dev worker on `DISPLAY=:99`; browser commands should export `DISPLAY=:99` when needed.
- 2026-05-17: Selected PRD 01 documentation baseline group (`US-001` through `US-004`) as the first coherent slice: incident report, resource model, rollout checklist, PRD/spec links, and capability-doc traceability. Verification target: docs updated, PRD JSON pass flags only after `npm run typecheck` in the Docker worker.
- 2026-05-17: Completed PRD 01 docs slice. Evidence: host read-only baseline commands (`docker system df`, `docker ps -a`, `docker inspect`, host/container `pgrep`, `free -h`) recorded 1 Docker image, 4 Pibo containers, 10.75 GB BuildKit cache, 0 stopped/OOM Pibo containers at snapshot time, 0 real Chrome/Chromium processes in reachable workers, and 7.7 GiB RAM / 0 B swap. Added `docs/reports/compute-browser-resource-lifecycle-incident-baseline-2026-05-17.md`, `docs/project/compute-browser-resource-operating-model.md`, and `docs/project/compute-browser-resource-rollout-checklist.md`; linked them from PRD catalog/change docs; updated Docker/browser/Ralph capability docs and `GLOSSARY.md`. Verification tier: documentation/source inspection plus real host read-only Docker/process evidence; no destructive cleanup. Typecheck evidence: Docker worker command `docker exec pibo-dev-compute-browser-resource-lifecycle bash -lc 'export DISPLAY=:99; cd /workspace && npm run typecheck'` passed, and was rerun after final doc edits with the same passing result.
- 2026-05-17: Selected PRD 02 `US-001` as the next slice: add the worker-scoped browser pool state model, safe state read/write behavior, and bounded file lock mutations. Verification target: focused browser-pool unit tests in the Docker worker plus full `npm run typecheck` before marking the story passed.
- 2026-05-17: Completed PRD 02 `US-001`. Implementation: added `src/tools/browser-pool.ts` with the persisted worker-scoped browser-pool state model (`workerId`, `poolId`, `maxBrowserProcesses`, `pid`, `processGroupId`, `cdpPort`, `cdpUrl`, `userDataDir`, `activeLeaseId`, `owner`, `lastUsedAt`, `idleExpiresAt`, `state`, `lastError`), safe state path construction, missing-state empty initialization, malformed-state dirty fallback or strict throw by context, atomic JSON writes, bounded file-lock acquisition, and locked acquire/release/reap mutation helper. Tests: added `test/browser-pool-state.test.mjs` covering lock success, lock timeout, missing state, malformed state fallback/throw, state write/read round trip, and release/reap mutation kinds. Evidence tier: focused fake filesystem/unit validation inside the Docker worker; no browser process started for this state-model-only story. Command `docker exec pibo-dev-compute-browser-resource-lifecycle bash -lc 'export DISPLAY=:99; cd /workspace && npx tsc -p tsconfig.json && node --test test/browser-pool-state.test.mjs'` passed 6/6 tests. Full typecheck command `docker exec pibo-dev-compute-browser-resource-lifecycle bash -lc 'export DISPLAY=:99; cd /workspace && npm run typecheck'` passed (`tsc`, chat UI typecheck, context-files UI typecheck). Limitation: managed CDP health/reuse and wrapper routing remain in later PRD 02 stories.
- 2026-05-17: Selected PRD 02 `US-002` as the next slice: managed CDP health checks and reuse/replacement decisions for the worker-scoped browser pool. Verification target: focused browser-pool acquire/health unit tests in the Docker worker plus full `npm run typecheck` before marking the story passed.
- 2026-05-17: Completed PRD 02 `US-002`. Implementation: extended `src/tools/browser-pool.ts` with bounded CDP `/json/version` health checks, recorded pid liveness checks, managed acquire/reuse decisions, stale/dirty state marking for dead pids, unreachable CDP, malformed CDP responses, and identity-invalid state, plus locked replacement startup that lets later callers reuse the replacement. Tests: extended `test/browser-pool-state.test.mjs` to cover healthy reuse, dead pid, unreachable CDP, malformed CDP response, state identity mismatch, and concurrent replacement start decision. Evidence tier: focused fake filesystem/unit validation plus local HTTP CDP-health fixture inside the Docker worker; no real Chromium process was started for this library-level story. Command `docker exec pibo-dev-compute-browser-resource-lifecycle bash -lc 'export DISPLAY=:99; cd /workspace && npx tsc -p tsconfig.json && node --test test/browser-pool-state.test.mjs'` passed 12/12 tests. Full typecheck command `docker exec pibo-dev-compute-browser-resource-lifecycle bash -lc 'export DISPLAY=:99; cd /workspace && npm run typecheck'` passed (`tsc`, chat UI typecheck, context-files UI typecheck). Limitation: browser-use wrapper routing, explicit busy-pool policy, status CLI, and real Chromium startup remain in later PRD 02 stories.

- 2026-05-17: Selected PRD 02 `US-003` as the next slice: route compute-worker browser-use wrapper invocations through managed browser-pool acquire, pass the managed CDP URL to browser-use, and fail clearly if acquire cannot provide a managed browser. Verification target: focused wrapper/pool tests plus a real-path CLI/wrapper validation in the Docker worker and full `npm run typecheck` before marking the story passed.
- 2026-05-17: Completed PRD 02 `US-003`. Implementation: routed default browser-starting browser-use wrapper commands through a managed browser-pool acquire path in `src/tools/browser-use-wrapper.ts`; the wrapper now locks a worker/pool-scoped state directory, records/reuses managed CDP state (`workerId`, `poolId`, `maxBrowserProcesses`, pid/process group, CDP port/URL, user-data dir, active lease id, owner, timestamps), starts one managed Chrome/Chromium when needed, passes the acquired CDP URL to browser-use via `--cdp-url`, and exits with a clear managed-pool failure instead of falling back to unmanaged browser startup. Tests: extended `test/tools-cli.test.mjs` to assert real wrapper-generated browser-pool state and lease metadata. Evidence tier: focused unit/CLI validation plus real Docker-worker wrapper/Chromium validation. Command `docker exec pibo-dev-compute-browser-resource-lifecycle bash -lc 'export DISPLAY=:99; cd /workspace && npx tsc -p tsconfig.json && node --test test/tools-cli.test.mjs test/browser-pool-state.test.mjs'` passed 22/22 tests. Real-path validation command in the Docker worker used `eval "$(npm run --silent dev -- tools env browser-use)"` and `timeout 20s browser-use --pibo-ensure-chrome` with `PIBO_BROWSER_POOL_WORKER_ID=validation-worker`; it started Chromium, returned `http://127.0.0.1:47489`, wrote leased state for `validation-lease`/`validation-owner`, and the validation cleaned up the recorded pid and validation state. Full typecheck command `docker exec pibo-dev-compute-browser-resource-lifecycle bash -lc 'export DISPLAY=:99; cd /workspace && npm run typecheck'` passed (`tsc`, chat UI typecheck, context-files UI typecheck). Limitation: explicit busy-pool policy/concurrency max-process enforcement and status CLI remain in PRD 02 `US-004`/`US-005`; release/reap cleanup remains in later PRDs.
- 2026-05-17: Selected PRD 02 `US-004` as the next slice: enforce one-lane browser-pool concurrency/max-process policy, make busy-pool behavior explicit, and keep wrapper lease identity stable enough for same-session reuse. Verification target: focused browser-pool concurrency tests, wrapper unit tests, real wrapper validation in the Docker worker, and full `npm run typecheck` before marking the story passed.
- 2026-05-17: Completed PRD 02 `US-004`. Implementation: added explicit one-lane busy-pool enforcement in `src/tools/browser-pool.ts`; a healthy active lease with a different lease id now returns `acquired: false` with a `pool-exhausted` reason under the existing lock instead of starting another browser, while same-lease reuse and expired-lease takeover remain allowed. Updated the browser-use wrapper to use a stable per-session default pool lease id, detect healthy leased state for other leases, emit a clear `pool-exhausted` error, and refuse unmanaged fallback. Tests: extended `test/browser-pool-state.test.mjs` for one-lane concurrent acquire/start-count behavior, busy-pool failure, same-lease reuse, and expired lease takeover; extended `test/tools-cli.test.mjs` for wrapper busy-pool failure. Evidence tier: focused unit/CLI validation plus real Docker-worker wrapper/Chromium validation. Command `docker exec pibo-dev-compute-browser-resource-lifecycle bash -lc 'export DISPLAY=:99; cd /workspace && npx tsc -p tsconfig.json && node --test test/browser-pool-state.test.mjs test/tools-cli.test.mjs'` passed 24/24 tests. Real-path validation in the Docker worker started Chromium for worker `validation-us004` with lease `lease-a`, verified a second `--pibo-ensure-chrome` acquire with lease `lease-b` failed with `pool-exhausted` and no unmanaged fallback, observed state remained `leased` by `lease-a`, and cleaned up the recorded pid and temporary state. Full typecheck command `docker exec pibo-dev-compute-browser-resource-lifecycle bash -lc 'export DISPLAY=:99; cd /workspace && npm run typecheck'` passed (`tsc`, chat UI typecheck, context-files UI typecheck). Limitation: status CLI remains in PRD 02 `US-005`; release/reap cleanup remains in later PRDs.
