# Tasks: Session Live Previews

## 1. Foundation

- [x] 1.1 Add preview config, types, SQLite store, URL construction, validation, and tests.
- [x] 1.2 Add progressively discoverable `pibo preview` lifecycle commands and tests.

## 2. Authenticated proxy

- [x] 2.1 Extend the web-app contract with hostname and upgrade routing.
- [x] 2.2 Add authenticated management/open APIs and opaque ticket exchange.
- [x] 2.3 Add streaming HTTP, SSE, redirect/cookie sanitation, and WebSocket proxying.
- [x] 2.4 Add auth, isolation, proxy, and lifecycle integration tests.

## 3. Chat Web

- [x] 3.1 Add Preview API client and session query.
- [x] 3.2 Add Preview tab, selector, status controls, iframe, and empty/error states.
- [x] 3.3 Add trusted Preview fullscreen top bar and application-shell behavior.
- [x] 3.4 Add focused component/source tests and accessibility checks.

## 4. Managed server lifecycle

- [x] 4.1 Persist optional start commands, managed process identity, runtime state, and stop deadlines.
- [x] 4.2 Add Preview-owned detached process start/stop/reconcile behavior with whole-tree cleanup.
- [x] 4.3 Enforce the configurable concurrent-server limit and fixed automatic-stop lease.
- [x] 4.4 Add CLI managed expose/start/stop/remove behavior while preserving external exposure compatibility.
- [x] 4.5 Add authenticated browser Start/Stop/Remove APIs without exposing commands or workspace diagnostics.

## 5. Settings and Chat Web controls

- [x] 5.1 Add Settings > Previews with defaults of three running servers and ten minutes per start.
- [x] 5.2 Add starting/stopped/error states and managed Start/Stop/Remove controls to Session and Project Preview views.
- [x] 5.3 Update Native Tooling guidance so agents use Preview-managed commands instead of yielded runs for web servers.

## 6. Validation

- [x] 6.1 Run the original typecheck, build, focused suites, and Pibo2 public-path validation.
- [x] 6.2 Add managed lifecycle, process separation, pool, automatic-stop, API, settings, and UI tests.
- [x] 6.3 Re-run typecheck, build, focused suites, and the complete test suite.
- [ ] 6.4 Package and install the revised exact branch candidate on Pibo2.
- [ ] 6.5 Validate that the agent turn finishes normally while the Preview server remains running.
- [ ] 6.6 Validate browser Start/Stop/Restart/Remove, automatic stop, pool limits, iframe protocols, and console state.
- [ ] 6.7 Update the validation report and PR evidence.
