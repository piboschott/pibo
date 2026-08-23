# Session Live Previews Validation Report

Date: 2026-08-23

## Scope

Validated session-linked live previews from CLI registration through the authenticated public Chat Web UI. Coverage includes isolated preview authentication, HTTP streaming, SSE, WebSockets, HMR-compatible proxying, Session and Project views, trusted application fullscreen, revocation, and Preview-owned managed server lifecycles that remain independent of agent turns and yielded runs.

## Source and package

- Feature branch: `feature/session-live-previews`
- Feature commit: `c529ac9804e585aa7f88d3180feb3b482cc89d46`
- Feature PR: `Pascapone/pibo#543`
- MCP home-config hotfix: `65bbd565d4a920743be109bf777beef217f6c1b2`
- Hotfix PR: `Pascapone/pibo#549`
- Final Pibo2 integration commit: `103c4a7d9df1204fc950d611ee3031d55024f513`
- Package SHA-256: `f8c5763499fdaf9d6b3b31584735d419d3e12a504f199e6d89e8452b3614e0c0`
- Pibo2 active candidate: `pr543-pr549-managed-preview`

The final Pibo2 artifact combines the Preview feature and MCP home-config hotfix without adding the hotfix to the focused Preview PR.

## Automated validation

Validation of the feature revision and final integration included:

- `npm run typecheck`: passed.
- `npm run build`: passed.
- Focused Preview manager, store, migration, CLI, web API, Settings, UI, accessibility, network, and MCP configuration tests: passed.
- Full `npm test` on the final integration: 1,895 passed, 0 failed, 0 skipped.
- Listener-replacement coverage confirmed that a Linux exposure pinned to one listener reports offline after a different process occupies the same port.
- Managed lifecycle race coverage confirmed that superseded starts cannot publish stale process identity or leave orphaned processes.
- Capacity coverage confirmed that concurrent starts are admitted atomically and pool exhaustion rejects new starts without stopping an existing server.
- Process-tree coverage confirmed that stop and removal terminate the complete managed server tree.
- Browser-response assertions confirmed that commands, workspaces, PIDs, manager identifiers, and internal diagnostics are not exposed.
- External-listener validation confirmed that processes running in `pibo-yielded` units are rejected instead of being registered as persistent Preview servers.

## Managed server lifecycle validation on Pibo2

The exact feature candidate was first exercised on Pibo2 through the real service and public browser path. Validation confirmed:

- `pibo preview expose --command` stores the start command server-side and starts a Preview-owned server;
- Linux hosts prefer a dedicated transient systemd unit rather than a `pibo-yielded` resource;
- stopped managed previews remain restartable;
- Start, Stop, and Remove work through both the CLI and authenticated Chat Web controls;
- a one-minute test lease stopped the managed server automatically at the fixed deadline;
- request activity did not extend the lease;
- a constrained pool rejected an additional start while preserving the existing running server;
- Settings changes persisted through `Settings > Previews`;
- the configured defaults were restored to three concurrent servers and a ten-minute fixed runtime lease after testing.

## Agent-turn decoupling proof

A final proof used managed preview `pv-7c7a95b85a039784a6` for session `ps_c6c2355a-e746-4e2f-8b0c-0484d27cea01`. The server ran in `pibo-preview-7c7a95b85a039784a6-4ab26b.service` with no active yielded runs.

While that unit remained active, a normal Chat Web user message was accepted at `2026-08-23T09:45:16.303Z`, started normally, and completed at `2026-08-23T09:45:26.404Z` with the expected assistant response. Gateway inspection showed `processing=false`, `streaming=false`, `queued=0`, and zero active yielded runs while the managed Preview unit was still running. This demonstrates that the Preview process neither kept the agent turn active nor forced Steering/Queue delivery.

The feature-only deployment used during the first attempt did not contain PR #549 and reproduced the historical MCP home-config error. Activating the final integration candidate restored `~/mcp_servers.json` discovery from `/root/code/pibo`; the active candidate exposed all 29 `chrome-devtools` tools and the follow-up turn completed without a new runtime-resource error.

## Public-path validation

Temporary loopback fixtures and temporary exact-host TLS were used during validation of the public preview path. The fixtures exercised:

- HTML and nested JavaScript assets;
- streaming HTTP and SSE (`stream-ready`);
- WebSocket upgrade and traffic (`hmr-ready`);
- one-time authenticated ticket exchange;
- preview-only partitioned browser cookies;
- isolated preview-origin rendering inside Chat Web;
- HTTP 401 for direct unauthenticated preview access.

The authenticated headful browser confirmed:

- Preview appears only when the selected Pibo Session has an active exposure;
- Session and Project Preview views render the same exposure workflow;
- offline, starting, stopped, error, and online states use trusted Pibo controls;
- iframe, open-window, reload, and fullscreen actions are unavailable while a preview is offline;
- trusted application fullscreen retains Preview lifecycle and exit controls outside the iframe;
- mobile-width layout remains usable;
- public lifecycle API responses contain only browser-safe fields;
- final browser console inspection reported no warnings or errors.

## Cleanup and final health

After validation:

- the proof Preview was removed and its database record was closed;
- its systemd unit was removed;
- temporary fixture files and uploaded candidate tarballs were removed;
- active Preview exposure count was zero;
- temporary `preview.baseURL` configuration was removed;
- Preview settings remained at the production defaults of three servers and ten minutes;
- Pibo2 `pibo-web.service` remained active on `pr543-pr549-managed-preview` at `103c4a7d9df1204fc950d611ee3031d55024f513`;
- local and public health endpoints returned HTTP 200;
- the authenticated headful browser remained healthy with an empty console.

Permanent arbitrary preview hostnames still require operator-provided wildcard DNS and TLS for the configured Preview base domain.
