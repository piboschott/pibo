# Session Live Previews

Session Live Previews expose an explicitly selected loopback development port through an isolated, authenticated browser origin and attach it to the Pibo Session doing the work.

## Operator setup

Configure a base hostname dedicated to previews:

```bash
pibo config set preview.baseURL https://preview.example.com
```

For a preview id such as `pv-abcd`, Pibo serves `https://pv-abcd.preview.example.com/`. The deployment therefore needs:

1. wildcard DNS for `*.preview.example.com` pointing to the Pibo Web host;
2. TLS valid for `*.preview.example.com`;
3. the wildcard virtual host reverse-proxied to the same Pibo Web Gateway as Chat Web;
4. HTTP upgrade forwarding for development-server WebSockets.

Example reverse-proxy behavior, expressed without host-specific paths:

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name *.preview.example.com;

    # Configure the wildcard certificate and key for this hostname.

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://127.0.0.1:4788;
    }
}
```

Do not proxy preview hostnames directly to development ports. Pibo must remain in the request path so preview authentication, expiration, target validation, and credential stripping are enforced.

## Agent and operator workflow

For development servers, let Preview own the process instead of starting it as a yielded run:

```bash
pibo preview expose 5173 \
  --session ps_... \
  --workspace /path/to/project \
  --name "Website" \
  --command 'npm run dev'
```

The command is saved locally, launched in a transient systemd service when available or a detached process group otherwise, and separated from agent-turn delivery state. The CLI waits for the loopback port to become ready and then exits. Pibo provider and authentication credentials are not deliberately forwarded to the command.

An already-running external loopback server remains supported:

```bash
pibo preview expose 5173 --session ps_... --name "External website"
```

Discover and manage previews incrementally:

```bash
pibo preview
pibo preview list
pibo preview show pv-...
pibo preview start pv-...
pibo preview stop pv-...
pibo preview doctor pv-...
pibo preview remove pv-...
```

`close` remains an alias for `remove`. Stop preserves a managed Preview definition and its saved command so it can be restarted; remove stops it, revokes browser access, and removes it from active lists.

The Chat Web Session and Project session surfaces show a Preview tab while an active definition exists. Managed previews can be started, stopped, and removed there. `starting`, `online`, `offline`, `stopped`, and `error` states are shown without exposing the saved command, workspace, or process identity to browser APIs.

## Managed server limits

Managed starts use an instance-wide pool. The defaults are:

- maximum **3** simultaneously starting or running Preview servers;
- automatic stop **10 minutes** after each successful start attempt begins.

Change both values under **Settings > Previews**. The automatic stop is a fixed runtime lease, not an inactivity timeout: HTTP requests, SSE, WebSockets, and HMR do not extend it. Starting a stopped Preview grants a fresh lease. A periodic gateway reconciler also stops expired leases and processes that no longer match their recorded manager identity.

## Access model

Any account accepted by the Pibo instance may open any active preview. Preview visibility is not partitioned by login identity.

The canonical Pibo auth cookie is never forwarded to the development application. Chat Web creates a one-time ticket, the preview hostname exchanges it for a preview-only cookie, and that cookie grants access only to the selected preview until the preview or browser session expires.

## Security boundary

- Targets are loopback-only and created only through the local CLI.
- Privileged and known sensitive service ports are rejected.
- Exposures require an existing Pibo Session and expire automatically.
- Managed start commands are local-only data and are omitted from browser API responses.
- Managed servers run outside agent turns and yielded runs, have a bounded pool and fixed runtime lease, and are stopped as a whole process tree.
- On Linux, Pibo pins an exposure to the original listening process and rejects a replacement process that later occupies the same port.
- Preview JavaScript runs on a different origin from Chat Web.
- Pibo, Better Auth, machine-session, and preview-auth cookies are stripped before upstream proxying.
- Pibo handles HTTP, streaming responses, SSE, and WebSocket upgrades without giving the application Pibo credentials.
