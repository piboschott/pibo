# Pibo 1.4.6

Patch release promoting the July 1, 2026 fixes and CLI/tooling improvements from `main`.

## Highlights

- Added `pibo --version` and `pibo -V`, with compact root help advertising the version flag.
- Added Graphify as a curated Pibo CLI tool and built-in skill, with updated Graphify v2 workflow guidance.
- Improved Compact Terminal rendering with Prism-backed syntax highlighting for fenced code blocks.
- Fixed several Chat Web and Compact Terminal streaming/scrolling regressions.
- Improved custom-agent rename resilience, audit history, and session recovery.
- Fixed MCP config discovery by merging configured lookup paths for read operations.
- Added `pibo gateway:web --gateway-port` for running multiple web gateway runtimes on one host.

## Fixed issues and merged PRs

- #127 / PR #148: Agent Designer can re-check managed context files and recover valid context links without visiting the Context Files view first.
- #132 / PR #153: `pibo gateway:web` now accepts `--gateway-port`, separate from `--web-port`, so multiple runtimes can run with distinct HTTP and runtime gateway ports.
- #133 / PR #154: MCP read operations merge all existing config lookup paths, while writes still target the selected config file; diagnostics now show per-path lookup details.
- #136 / PR #155: Renamed custom agents keep old profile-name aliases so existing sessions can resume after a rename.
- #137 / PR #149: Custom agent profile/display-name changes and deletes are recorded in an append-only audit history.
- #138 / PR #156: Compact Terminal code fences now get syntax highlighting for common languages and aliases, with safe fallback for unknown languages and no-color mode.
- #139 / PR #152: Graphify integration guidance was corrected for current `graphifyy` behavior and added as a curated tool plus built-in skill.
- #142 / PR #145: Thinking-level changes render as compact terminal lines instead of duplicating Thinking cards.
- #143 / PR #146: Upward mouse-wheel intent now reliably detaches sticky terminal auto-scroll.
- #144 / PR #147: Live streaming keeps reasoning rows before assistant-message rows for the same model turn.
- PR #163: Added root-level `pibo --version` / `pibo -V` support.
- PR #162 and PR #164: Promoted the reviewed development work from `dev` to `main`.

## Validation

- `./node_modules/.bin/tsc -p tsconfig.json`
- `./node_modules/.bin/vite build --config src/apps/chat-ui/vite.config.ts`
- `./node_modules/.bin/vite build --config src/apps/context-files-ui/vite.config.ts`
- `./node_modules/.bin/vite build --config src/apps/chat-vscode/extension/webview/vite.config.ts`
- `./node_modules/.bin/esbuild src/apps/chat-vscode/extension/src/extension.ts --bundle --platform=node --target=node24 --format=cjs --outfile=src/apps/chat-vscode/dist/extension/extension.cjs --external:vscode --sourcemap=inline`
- `node scripts/ensure-bin-executable.mjs`
