# Ink CLI V2 PTY Smoke Scenarios

Reusable PTY smoke runner:

```bash
node scripts/ink-cli-v2-pty-smoke.mjs --list
node scripts/ink-cli-v2-pty-smoke.mjs --scenario slash-suggestions-status-thinking --artifact-root .tmp/ink-cli-v2-pty-smoke
node scripts/ink-cli-v2-pty-smoke.mjs --artifact-root .tmp/ink-cli-v2-pty-smoke
```

Run `npm run build` first. The script invokes `pibo debug pty run` through `node dist/bin/pibo.js`, uses bounded timeouts, and writes each scenario's raw ANSI log, clean text, screen text, metadata, input, assertions, and events under the selected artifact root.

## Scenarios

| Scenario | Coverage | Default artifacts |
| --- | --- | --- |
| `owner-room-session-message` | owner picker, room picker, session creation, message send, mocked assistant reply | `.tmp/ink-cli-v2-pty-smoke/owner-room-session-message/{raw.ansi.log,clean.txt,...}` |
| `slash-suggestions-status-thinking` | slash suggestions, `/status` rich card, `/thinking` keyboard picker | `.tmp/ink-cli-v2-pty-smoke/slash-suggestions-status-thinking/{raw.ansi.log,clean.txt,...}` |
| `existing-session-hydration` | prepared persisted session opened through `--session <id>` with transcript hydration | `.tmp/ink-cli-v2-pty-smoke/existing-session-hydration/{raw.ansi.log,clean.txt,...}` |

## Evidence rules for Ralph agents

When a story uses one of these scenarios as validation evidence, record all of the following in the PRD JSON story notes and `IMPLEMENTATION_PROGRESS.md`:

- exact `node scripts/ink-cli-v2-pty-smoke.mjs ...` command;
- scenario name and whether the path is deterministic mocked, real local source, or live-provider;
- raw artifact path and clean artifact path;
- observed clean-output result;
- any focused test/typecheck/build commands run before the PTY script.

The scenarios use deterministic mocked provider/router behavior unless a future reviewer adds an explicit live-provider scenario with `pibo debug pty --real-provider` and a positive `--max-iterations` safety limit.
