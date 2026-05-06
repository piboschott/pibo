# Pibo Compute Worker

When you need an isolated environment to work in (e.g. to restart the gateway without interrupting the main session, or to run tasks in parallel):

1. Run `pibo compute spawn`.
2. You will receive a JSON response with `id`, `gatewayHost` and `gatewayPort`.
3. Connect to the worker:
   - Shell access: `docker exec -it <id> bash`
   - Gateway access: connect to `gatewayHost:gatewayPort`
4. Do your work inside the worker.
5. When finished, run `pibo compute release <id>` to clean up.

If you are unsure which workers are running, use `pibo compute list`.

If you have recently changed code and need a fresh build, run `pibo compute rebuild` before `spawn`.

After worker validation, use the dev web gateway for host-level Chat Web testing before production:

```bash
./scripts/deploy-web-dev.sh
```

The dev gateway is `pibo-web-dev.service` at `https://dev.pibo.neuralnexus.me`, uses real Better Auth/Google OAuth, and stores state in `/root/.pibo-dev`. Use `./scripts/deploy-web.sh` only after dev testing succeeds and production deployment is approved.
