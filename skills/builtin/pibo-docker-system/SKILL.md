---
name: pibo-docker-system
description: How to use Pibo Docker System. Use this skill when you need an isolated Docker environment to work in, when the user asks about managing compute workers, you want to add a feature to pibo, test or debug gateway related stuff, want to test your implementation or use the browser and see changes made to pibo Web. 
---

# Pibo Docker Compute System

For isolated work. This is the default workflow for developing Pibo itself, especially when gateway restarts, Chat Web changes, browser automation, or end-to-end tests are needed.

## Commands

- `pibo compute spawn [--name <name>]` — Create a fresh worker container. Returns JSON with `id`, `gatewayHost`, `gatewayPort`, `cdpPort`.
- `pibo compute rebuild` — Force a fresh Docker image build before spawning.
- `pibo compute list` — Show running workers.
- `pibo compute release <id>` — Stop and remove a worker.
- `pibo compute reap [--max-age-minutes 60]` — Clean up old workers.

## Pibo Development Rule

Use a Docker compute worker for Pibo development whenever the compute system is available. Do not experiment against the host `pibo-web` gateway: do not restart it, replace it, or run ad hoc host gateways for testing unless the user explicitly asks for host operations or Docker is unavailable.

Dev auth is worker-only. `gateway:web` inside a worker enables dev auth through the Docker entrypoint internal option, not through `PIBO_DEV_AUTH`; the normal host gateway must use Better Auth.

After Docker validation, use the dev web gateway for host-level testing: `./scripts/deploy-web-dev.sh`. Use `./scripts/deploy-web.sh` only after dev testing succeeds and production deployment is approved.

## Healthchecks vs user-visible verification

A gateway healthcheck only proves the service responds. For Web, CLI, TUI, gateway, runtime, auth, or agent-routing work, also verify the relevant user-visible behavior when feasible:

- Use browser/CDP or browser-use for Web UI flows, and capture the route, visible state, screenshot, or DOM evidence.
- Use a pseudo-TTY or interactive shell for Ink/TUI flows, and capture the command plus relevant terminal output.
- Use the real command, API, router, or persistence path for runtime behavior when the default path is locally testable.
- If auth is needed inside a Docker worker, use the `pibo-debug-auth` skill rather than bypassing auth ad hoc.

Fake/demo checks and healthchecks are useful supporting evidence, but do not treat them as final validation for a user-facing default path unless the real path is unavailable or explicitly out of scope.

## Workflow

1. Run `pibo compute spawn`.
2. Connect via `docker exec -it <id> bash` or use the gateway port directly.
3. Do your work inside the container.
4. Run `pibo compute release <id>` to clean up.

## Rules

- Workers are one-time-use. Always release when done.
- If you forget, a cronjob reaps containers after 60 minutes.
- The image auto-rebuilds when source files change (detects changes in `src/`, `package.json`, `Dockerfile`).
- The container runs `pibo gateway` automatically on `0.0.0.0:4789`.
- Dynamic ports are assigned by Docker for gateway (4789) and browser-use CDP (56663).
- `gateway:web` inside a worker enables dev auth through the Docker entrypoint internal option, not through `PIBO_DEV_AUTH`. Do not start the host gateway with dev auth flags; the normal host gateway must use Better Auth.
- Dev-auth web access is loopback-only. If a worker web port is accidentally reached through a public reverse proxy, auth requests are rejected.
