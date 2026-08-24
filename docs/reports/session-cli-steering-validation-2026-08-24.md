# Session CLI steering validation — 2026-08-24

## Contract review

PR #485 explicitly describes `--host` and `--port` as options for deterministic gateway use. Neither the PR description nor the existing console-client documentation limits `pibo client` to loopback endpoints or interactive terminals. The project documents TTY-only behavior explicitly where it is required, such as `pibo tui:sessions`, while other CLI surfaces support stdin pipelines.

The refreshed implementation therefore keeps arbitrary gateway hosts and supports both terminal and piped input:

- prompts are emitted only when stdin and stdout are TTYs;
- piped input is consumed line by line without dropping buffered lines;
- EOF waits for every submitted gateway request response with a bounded timeout;
- rejected or locally invalid piped input produces a non-zero exit code.

## Scope

Branch `feature/session-cli-steering` adds session-scoped delivery selection to `pibo client` while preserving existing plain-message queue behavior:

- plain text queues as before;
- `/queue <message>` explicitly queues a follow-up turn;
- `/steer <message>` steers the currently active streaming turn;
- delivery commands accept normal whitespace separators, including tabs;
- empty delivery commands fail locally with usage guidance;
- accepted steering prints the active turn id when the gateway provides it;
- `pibo client --help` and root discovery expose the feature;
- `--host` and `--port` select the gateway endpoint.

## Review repairs

The semantic rebase onto current `upstream/dev` repairs three correctness defects in the old PR head:

1. Every client request now receives a stable event id, using the request id when the event does not already provide one. This preserves Pibo event identity for steering, queueing, signals, and response correlation.
2. The client sends a server-side session subscription before accepting input and verifies that the gateway acknowledged the requested Pibo Session ID. It no longer remains in the legacy all-session fanout mode.
3. `/queue` and `/steer` parsing recognizes arbitrary whitespace separators instead of treating tab-separated delivery commands as ordinary queued text.

The gateway protocol validator accepts only `queue` and `steer` delivery values and rejects empty request ids, invalid event ids, empty Pibo Session IDs, and empty message text.

## Verification

Base: `upstream/dev` at `32d2e61b2d197d2e158bfb0a6570d52821568152`.

- `npm run typecheck` — passed.
- `npm run build` — passed.
- Focused gateway client tests — 9 passed, 0 failed.
- Focused gateway, request, routed-steering, and session-router tests — 48 passed, 0 failed.
- Targeted Chat Web queue/steer delivery tests — 2 passed, 0 failed.
- Broad relevant gateway and session suite — 119 passed, 0 failed across 4 suites.
- `git diff --check` — passed before final commit.

## Pipe validation

The built CLI was spawned with piped stdin against a deterministic TCP gateway fixture. Three input lines were submitted before EOF while gateway responses were deliberately delayed:

```text
/steer<TAB>change the active approach
/queue follow up afterward
plain default queue
```

Observed behavior:

- the session subscription was the first gateway frame;
- all three messages arrived without loss;
- every request id matched its generated event id;
- no `you>` prompt appeared in stdout or stderr;
- the process waited for all delayed responses and exited with status 0;
- a separately rejected steering request printed the gateway error and exited with status 1.

## PTY validation

The built CLI was run through `pibo debug pty scenario` in the Docker development worker against a deterministic TCP gateway fixture. The PTY completed with exit status 0 and observed:

```text
fixture subscription ps_running
fixture received steer eventMatch=true
steer: delivered to active turn active-turn-1
fixture received queue eventMatch=true
```

The temporary PTY artifact was written to `/tmp/pibo-pty-session-cli-steering-20260824` during validation and removed during final cleanup. No live user or Loop session was modified.

## Baseline note

The complete `test/chat-web-app-sessions.test.mjs` file reports asynchronous activity after its disposal test closes a database (`Error: database is not open`). The same failure was reproduced unchanged on exact base `32d2e61b2d197d2e158bfb0a6570d52821568152`; it is not caused by this PR. The two queue/steer delivery tests from that file pass when run directly. No unrelated baseline repair is included here.

## Boundaries

Validation was local-only in isolated Docker workers. No Pibo2 deployment, production deployment, live-session steering, merge, or release was performed.
