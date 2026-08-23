# Spec: Session Live Previews

**Status:** Implementing
**Created:** 2026-08-22
**Requester / Source:** User request in Pibo Session `ps_3da7f026-bfbe-4ccb-87b6-370fa8e3c85e`
**Related docs:** [Proposal](./proposal.md), [Design](./design.md), [Tasks](./tasks.md)

## Why

Remote development should be inspectable from the authenticated Pibo Web UI without copying the project to another machine. The preview must support normal development-server traffic while keeping untrusted application JavaScript isolated from Pibo Chat and Pibo authentication.

## Goal

Pibo MUST let an agent register and optionally start a loopback web server as a Preview-owned resource, associate it with a Pibo Session, and let any authenticated account allowed by that Pibo instance open and control it without keeping the agent turn or runtime busy.

## Scope

### In Scope

- Explicit loopback-port exposure through `pibo preview`.
- Session and optional Project metadata.
- Authenticated preview discovery and bootstrap.
- Preview-only sessions, HTTP proxying, SSE, and WebSocket upgrades.
- Session and Project Preview tabs, reload, open-window, start, stop, remove, and fullscreen controls.
- Optional Preview-managed start commands whose process lifetime is independent of the agent runtime.
- Configurable concurrent-server and automatic-stop limits.
- Expiration, health state, and closed/offline/stopped states.

### Out of Scope

- Public anonymous share links.
- Exposing remote hosts, Unix sockets, databases, CDP endpoints, or arbitrary URLs.
- Editing arbitrary start commands from the browser. Start commands remain local CLI inputs and are not returned through browser APIs.
- Per-account product ownership. All Pibo-allowed accounts share access.
- Rewriting applications for path-prefix hosting.

## Requirements

### Requirement: CLI exposure is explicit and discoverable

The CLI MUST expose `pibo preview expose`, `list`, `show`, `doctor`, and `close` through progressive help.

#### Acceptance

- `pibo preview expose 5173 --session ps_...` creates an external exposure only when the port is allowed and reachable on loopback.
- `pibo preview expose 5173 --session ps_... --command "npm run dev"` stores the command, starts it outside the agent run, waits for the requested loopback port, and creates a managed preview.
- The command prints the preview id, configured URL, and managed server state.
- Invalid, privileged, reserved, occupied, unreachable, or missing-session inputs fail without claiming an unrelated listener.

### Requirement: Preview targets remain loopback-only

The system MUST proxy only the exact loopback host and port recorded by the local CLI.

#### Acceptance

- The Web API cannot create or change an upstream target.
- Ports below 1024 and reserved Pibo, CDP, Docker, and common data-service ports are rejected.
- Preview records expire and closed records no longer proxy traffic.

### Requirement: Managed Preview servers do not keep agent sessions active

A Preview-managed server MUST run independently from the model turn, Routed Session processing state, and yielded-run registry.

#### Acceptance

- Starting a managed Preview returns after the loopback listener is ready while the server continues running.
- The CLI rejects registering a detected `pibo-yielded` listener as an external Preview and directs the caller to Preview-managed `--command` lifecycle ownership.
- The originating agent turn can finish normally and the next user message does not require Steering or Queue solely because the Preview server is running.
- Stopping or automatically stopping the Preview server terminates its managed process tree without terminating or changing the Pibo Session.

### Requirement: Managed Preview servers are pooled and time-bounded

The system MUST limit concurrently running managed Preview servers and automatically stop each server after a configurable runtime lease.

#### Acceptance

- Defaults are three concurrently running managed servers and ten minutes per start.
- Settings > Previews can change both values within validated bounds.
- Starting beyond the current limit fails without stopping another server.
- Automatic stop preserves the Preview definition and start command so the user can start it again.
- Restarting a stopped Preview receives a fresh runtime lease.

### Requirement: Pibo authentication gates preview bootstrap

Any account accepted by the Pibo instance MUST be able to list and open active previews. Unauthenticated callers MUST NOT receive a preview session.

#### Acceptance

- Management routes require the existing Pibo web session.
- Opening a preview creates a one-time ticket and exchanges it for a preview-only cookie.
- The development application never receives the Pibo auth cookie or Authorization header.
- Tickets are single-use and expire quickly.

### Requirement: Preview applications use isolated origins

Each preview MUST use a hostname derived from its opaque preview id and the configured preview base domain.

#### Acceptance

- Preview JavaScript is cross-origin from Chat Web.
- Requests on an unknown preview hostname return not found.
- Canonical Pibo redirects do not capture valid preview hosts.

### Requirement: Development-server protocols work through the proxy

The proxy MUST preserve request paths and queries and support streaming HTTP responses, SSE, and WebSocket upgrades.

#### Acceptance

- A fixture page, nested asset, API request, SSE stream, and WebSocket echo all work through a preview hostname.
- Upstream redirect and cookie headers cannot redirect to loopback or broaden cookie scope to the Pibo host.

### Requirement: Chat Web exposes session-linked previews

Chat Web MUST show a Preview tab when the selected Pibo Session has at least one active or recently unavailable preview.

#### Acceptance

- The view loads the selected preview through the authenticated bootstrap endpoint.
- Multiple previews are selectable.
- The view displays online, starting, stopped, offline, error, expired, and closed states.
- Managed previews expose Start and Stop controls; Remove stops the server, revokes browser access, and removes the saved command from active use.
- Stopped managed previews remain visible and restartable until removed or expired.
- Normal session and Project navigation remains available after leaving Preview.

### Requirement: Preview fullscreen keeps a trusted exit control

The Preview view MUST support an application fullscreen mode whose exit controls remain outside the untrusted iframe.

#### Acceptance

- Fullscreen hides normal Pibo chrome and the composer.
- A trusted top bar remains visible with preview label, reload, open-window, and exit actions.
- Exiting restores the previous session view without reloading the Chat application.

## Edge Cases

- The target process exits after exposure or another process later occupies the port.
- A managed command exits before opening its port or opens a different port.
- Two start requests race for the final available pool slot.
- The gateway restarts while managed servers and preview records exist.
- The preview cookie expires while the iframe is open.
- A preview server returns `X-Frame-Options` or a conflicting `frame-ancestors` policy.
- A preview sends absolute loopback redirects or Domain cookies.
- Multiple authenticated accounts open the same preview concurrently.

## Constraints

- **Security / Privacy:** Login identity gates preview access but does not create per-user ownership. Preview apps remain on separate origins and receive no Pibo credentials.
- **Compatibility:** The first release proxies HTTP upstreams on loopback and externally serves the scheme configured by `preview.baseURL`.
- **Performance:** Proxy bodies stream and are not buffered through the normal Fetch request adapter.
- **Dependencies:** Wildcard DNS and TLS for the configured preview base domain are operational prerequisites outside the package.

## Success Criteria

- [ ] SC-001: CLI lifecycle tests cover external expose plus managed expose, start, stop, restart, expiration, and remove.
- [ ] SC-002: A runtime test proves a managed Preview server does not create or retain a yielded run and does not force Steering/Queue delivery.
- [ ] SC-003: Pool and automatic-stop tests cover defaults, configured values, races, restart, and process-tree cleanup.
- [ ] SC-004: Auth/API integration tests reject unauthenticated bootstrap and allow every accepted Pibo account.
- [ ] SC-005: HTTP, SSE, and WebSocket proxy integration fixtures pass.
- [ ] SC-006: Browser validation proves stopped/startable, online, inline, and fullscreen Preview behavior through the authenticated development server.
- [ ] SC-007: An adversarial preview cannot read or receive Pibo authentication material or the saved start command.
