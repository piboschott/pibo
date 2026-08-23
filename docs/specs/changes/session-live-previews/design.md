# Design: Session Live Previews

## Context

Pibo's Web Gateway currently routes Fetch-style requests by path and delegates authentication to Better Auth. It does not route by hostname or handle HTTP upgrade events. Chat Web already supports extra session tabs and an application fullscreen pattern.

## Goals / Non-Goals

- Support arbitrary root-hosted development applications without base-path rewriting.
- Keep Preview JavaScript outside the canonical Pibo origin.
- Reuse existing Pibo authentication without forwarding its cookie.
- Keep CLI-created exposures and managed server processes ephemeral and bounded.
- Separate managed development-server lifetime from agent-turn and yielded-run lifetime.
- Do not create anonymous links or let browser APIs define arbitrary commands.

## Decisions

### Decision: One isolated hostname per preview

- **Choice:** Build preview URLs as `<preview-id>.<preview-base-host>`.
- **Rationale:** Root-relative assets, APIs, and HMR paths work without application rewriting, while browser origin isolation protects Pibo.
- **Alternative considered:** Same-origin path prefixes. Rejected because they expose Pibo origin authority and break generic root-relative applications.

### Decision: Opaque one-time tickets and preview-only sessions

- **Choice:** The authenticated main-origin open endpoint creates a short-lived opaque ticket. A generated HTML form POST exchanges it on the preview host for a scoped cookie backed by hashed SQLite records.
- **Rationale:** No Pibo cookie or bearer token reaches the application and the ticket is not placed in a URL.
- **Alternative considered:** Domain-wide Better Auth cookie. Rejected because the preview application could receive it.

### Decision: Persistent SQLite registry with runtime health checks

- **Choice:** Store exposures, optional start commands, managed process identity, runtime leases, tickets, and preview sessions in `previews.sqlite` under `PIBO_HOME`.
- **Rationale:** CLI and gateway are separate processes and need one durable coordination boundary. The command is local operator data and is omitted from every browser response.

### Decision: Extend web apps with host and upgrade handlers

- **Choice:** Add optional host matching and Node HTTP/WebSocket handlers to `PiboWebApp`. Host-routed apps run before canonical-origin redirects.
- **Rationale:** Preview traffic needs streaming and upgrades and should remain a plugin capability rather than hard-coded Chat routing.

### Decision: Preview-owned process supervision

- **Choice:** `pibo preview expose --command` launches the command as a detached Preview resource, preferably in its own transient systemd service and otherwise in a detached process group. The CLI waits only for startup readiness and then exits.
- **Rationale:** A web server must not remain a tracked yielded run or keep the Routed Session active. A Preview-specific process group also permits reliable whole-tree stop and automatic cleanup.
- **Alternative considered:** Continue using `pibo_run_start` or a background shell child. Rejected because yielded runs affect session delivery state and unowned background children accumulate.

### Decision: Fixed runtime lease and bounded pool

- **Choice:** Each managed start receives a fixed runtime lease, default ten minutes, and consumes one pool slot, default maximum three. Settings > Previews changes both instance-wide values. Proxy traffic does not silently extend the lease.
- **Rationale:** Fixed leases are predictable and still stop servers that maintain SSE, WebSocket, or HMR traffic indefinitely. A stopped definition remains restartable with a fresh lease.
- **Alternative considered:** Network-idle timeout. Rejected because normal HMR and streaming traffic can keep an abandoned preview artificially active.

### Decision: Session-level Preview view

- **Choice:** `SessionTracePane` queries previews for its selected Pibo Session and adds a Preview tab. Project sessions inherit the same behavior.
- **Rationale:** The preview stays attached to the work that created it and uses existing extra-tab infrastructure.

### Decision: Application fullscreen, not browser fullscreen

- **Choice:** Generalize the existing Terminal fullscreen shell for Preview.
- **Rationale:** The trusted exit bar stays in the parent application and does not depend on browser fullscreen permissions.

## Risks / Trade-offs

- Wildcard DNS/TLS is required before arbitrary preview ids can operate permanently on a public deployment.
- Preview-managed commands execute with a minimal environment and can load project-specific `.env` files themselves; Pibo provider and authentication secrets are not deliberately forwarded.
- A preview-only session remains valid until its short expiry even if the main Pibo login logs out.
- Linux exposures are pinned to the original listening process and socket; other platforms retain the hard boundary of explicit local CLI registration, loopback-only targeting, port restrictions, and expiry.
- Some applications deliberately reject reverse-proxy Host or Origin values and may require their own development-server configuration.

## Migration / Rollback

The feature is inactive unless `preview.baseURL` is configured and a preview is exposed. Rollback removes the plugin registration and CLI surface; the isolated SQLite database can remain without affecting existing data.

## Open Questions

None blocking. Access policy is resolved: all accounts allowed by the Pibo instance may access previews. Automatic stop is a fixed runtime lease rather than an inactivity timeout.
