---
name: pibo-docker-dev
description: Use whenever you need to develop, modify, test, or debug the Pibo codebase. This includes building new features, fixing bugs, refactoring code, running tests, starting the gateway, building web UIs, or using browser automation to verify changes. Always use this skill when the task involves editing Pibo source files or running Pibo processes that could crash the live host gateway. Also trigger when the user asks to work on Pibo, improve Pibo, fix something in Pibo, or test Pibo changes in isolation.
---

# Pibo Docker Isolated Development

Develop Pibo inside a Docker container. Edit files on the host. Run builds, tests, and the gateway inside the container. This protects the live host gateway.

## The rule

Create a new Git worktree for every task. Work only inside that worktree. Never edit files in the main repository (`/root/code/pibo/`).

## Why

The host runs the live Pibo gateway. If you break it during development, the user loses their connection. A container isolates your experiments. The gateway can crash inside the container without affecting the host.

## Quick reference

```
1. pibo compute dev spawn --worktree <name> --repo /root/code/pibo
2. Parse JSON output → save `id` (container name)
3. Use read/edit/write inside .worktrees/<name>/
4. Run builds/tests with: docker exec -w /workspace <id> <command>
5. Commit in the worktree
6. pibo compute release <id>
```

## Workflow

### 1. Spawn a container

Run:

```bash
pibo compute dev spawn --worktree <branch-name> --repo /root/code/pibo
```

If this command does not exist, the CLI needs updating. Tell the user.

The CLI prints progress:
- Image cached or rebuilding (1-2 minutes if dependencies changed)
- Worktree created at `.worktrees/<branch-name>/`
- Container started with assigned ports

Parse the JSON output. You need these fields:
- `id` — the container name (e.g. `pibo-dev-fix-model-select`). Use this in every `docker exec` call.
- `worktree` — absolute path to the worktree on the host
- `gatewayPort`, `cdpPort`, `webUIPortChat`, `webUIPortContext` — host ports

### 2. Edit on the host

Use `read`, `edit`, and `write` inside `.worktrees/<branch-name>/`. The container sees changes instantly because the mount is live.

Never use `read` or `edit` on `/root/code/pibo/` directly. Always target the worktree path.

### 3. Run commands in the container

Every command that compiles, tests, or starts a process must run inside the container:

```bash
docker exec -w /workspace <id> npm run build
docker exec -w /workspace <id> npm run typecheck
docker exec -w /workspace <id> npm run test
docker exec -w /workspace <id> npm run dev
```

Replace `<id>` with the container name from the JSON output.

You do not need `npm install`. The container mounts the host `node_modules`.

If you add new dependencies to `package.json`, run `npm install` inside the container. The host `node_modules` updates automatically.

### 4. Start the gateway (only inside the container)

```bash
docker exec -w /workspace <id> pibo gateway
```

The gateway binds to `0.0.0.0:4789` inside the container. Access it from the host through the `gatewayHost:gatewayPort` from the JSON output.

Never start `pibo gateway` on the host.

### 5. Debug with browser-use

Browser-use runs inside the container. Use it to inspect web UIs through the exposed host ports.

### 6. Iterate

Keep the container running. Edit on the host. Re-run commands in the container. Do not stop and restart the container between iterations.

### 7. Finish

1. Commit in the worktree:
   ```bash
   cd /root/code/pibo/.worktrees/<branch-name>
   git add -A && git commit -m "your message"
   ```
2. Release the container:
   ```bash
   pibo compute release <id>
   ```
3. Tell the user the branch name and worktree path. They merge when ready.
4. Clean up (only when the user confirms the merge is done):
   ```bash
   cd /root/code/pibo
   git worktree remove <branch-name>
   git branch -d <branch-name>
   ```

## Port ranges

Each container gets a block of 10 ports. The spawn command assigns the next free block automatically.

| Block | Gateway | CDP | Chat UI | Context UI |
|-------|---------|-----|---------|------------|
| 480x  | 4800    | 4801| 4802    | 4803       |
| 481x  | 4810    | 4811| 4812    | 4813       |
| 482x  | 4820    | 4821| 4822    | 4823       |

This prevents collisions when multiple agents work in parallel.

## What to avoid

- Do not edit `/root/code/pibo/` directly. Always use the worktree.
- Do not run `npm run build`, `npm run test`, or `pibo gateway` on the host.
- Do not stop the container between edit-and-test cycles.
- Do not merge the branch yourself unless the user explicitly asks for it.
