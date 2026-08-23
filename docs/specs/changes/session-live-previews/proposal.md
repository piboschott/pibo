# Proposal: Session Live Previews

## Why

Pibo agents commonly develop web applications on remote servers. The user currently has to clone the project or establish a separate tunnel before viewing the running development server. Pibo should expose an explicitly selected local development port through the authenticated Web experience and attach that preview to the Pibo Session doing the work.

## What Changes

- Add a `pibo preview` CLI for external exposure plus Preview-managed start, stop, restart, inspection, and removal of loopback development servers.
- Add a persistent preview registry for start commands, managed process identity, runtime leases, and browser sessions under the current Pibo home.
- Add configurable defaults of three concurrently running managed servers and ten minutes per start.
- Add authenticated preview bootstrap tickets and preview-only browser sessions.
- Add an HTTP and WebSocket reverse proxy on isolated preview hostnames.
- Add a Preview tab and application fullscreen mode to Chat Web sessions and Project sessions, including Start, Stop, and Remove controls for managed servers.
- Keep managed web servers independent of agent turns and yielded runs so a completed agent remains normally messageable.

## Capabilities

### New Capabilities

- `session-live-previews`: Authenticated, session-linked live development previews.

### Modified Capabilities

- `web-auth-and-same-origin-host`: Host-routed preview requests remain isolated from the canonical Pibo origin.
- `chat-web-trace-and-terminal-view`: Session headers can expose a Preview view and fullscreen preview shell.

## Impact

- **Code:** New preview process manager, store, proxy, CLI, plugin, settings surface, Chat Web API client, and UI components; web-host support for host-routed HTTP and WebSocket handling.
- **APIs / CLI:** New `/api/previews` authenticated lifecycle API and `pibo preview` command group.
- **Data:** `previews.sqlite` stores exposure definitions, optional start commands, managed process metadata, runtime leases, and browser sessions under `PIBO_HOME`.
- **Auth / Security:** Any authenticated account allowed by the Pibo instance may open active previews. Preview applications never receive Pibo auth cookies.
- **Host:** Operators configure a preview base domain whose wildcard DNS/TLS route reaches the Pibo Web Gateway.
