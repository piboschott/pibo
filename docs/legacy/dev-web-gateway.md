# Dev Web Gateway

Pibo has a staging-grade web gateway for testing changes before production.

## Purpose

Use the dev web gateway after Docker worker validation and before production deployment. It runs the normal Better Auth stack, uses Google OAuth, and keeps its state separate from the production gateway.

```text
Docker compute worker -> Dev web gateway -> Production web gateway
```

## Services and ports

| Environment | systemd service | Web port | Gateway port | Public origin | Pibo home |
| --- | --- | ---: | ---: | --- | --- |
| Dev | `pibo-web-dev.service` | `127.0.0.1:4808` | `127.0.0.1:4809` | `https://dev.pibo.neuralnexus.me` | `~/.pibo-dev` |
| Production | `pibo-web.service` | `127.0.0.1:4788` | `127.0.0.1:4789` | `https://pibo.neuralnexus.me` | `~/.pibo` |

The dev gateway stores Better Auth data at `~/.pibo-dev/auth.sqlite` and keeps chat, session, event, context-file, and agent stores under `~/.pibo-dev`.

## Deployment scripts

Deploy to dev first:

```bash
./scripts/deploy-web-dev.sh
```

Deploy to production only after dev testing succeeds and the user approves production rollout:

```bash
./scripts/deploy-web.sh
```

`deploy-web-dev.sh` builds the current worktree and restarts only `pibo-web-dev.service`. `deploy-web.sh` builds the current worktree, refreshes the stable fallback backup, restarts `pibo-web.service`, and verifies the production URL.

## Public access, TLS, and Google OAuth

The hosted dev gateway is publicly reachable at:

```text
https://dev.pibo.neuralnexus.me/apps/chat
```

`www.dev.pibo.neuralnexus.me` redirects to `dev.pibo.neuralnexus.me`.

DNS is configured for both hosts:

```text
dev.pibo.neuralnexus.me A <SERVER_IP>
www.dev.pibo.neuralnexus.me A <SERVER_IP>
```

Let's Encrypt TLS is installed for both names:

```bash
certbot certificates | grep -A8 dev.pibo.neuralnexus.me
```

Google OAuth is configured for the dev origin and callback URI:

```text
Authorized JavaScript origin:
https://dev.pibo.neuralnexus.me

Authorized redirect URI:
https://dev.pibo.neuralnexus.me/api/auth/callback/google
```

Google OAuth redirects are exact per origin. Do not expect `pibo.neuralnexus.me` to cover `dev.pibo.neuralnexus.me`.

## Operator checks

```bash
systemctl is-active pibo-web-dev
curl -fsS http://127.0.0.1:4808/health
curl -fsS https://dev.pibo.neuralnexus.me/health
PIBO_HOME=~/.pibo-dev npm run --silent dev -- config show
```

Production checks remain separate:

```bash
systemctl is-active pibo-web
curl -fsS http://127.0.0.1:4788/health
```

## Agent rule

Do not use production as the first host-level test target. Validate inside a Docker compute worker first. When host-level testing is needed, deploy with `./scripts/deploy-web-dev.sh` and test `https://dev.pibo.neuralnexus.me`. Use `./scripts/deploy-web.sh` only for approved production deployment.
