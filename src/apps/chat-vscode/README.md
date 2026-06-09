# Pibo VS Code Extension

The Pibo VS Code extension is a thin client for the [Pibo](https://github.com/Pascapone/pibo) chat runtime. It surfaces the same Terminal (Session) View, Composer, and slash-command catalog as the Chat Web App, but renders only the Session View inside a VS Code WebView. The room-resolver maps a VS Code workspace folder to a `PiboRoom` in the same `~/.pibo/pibo.sqlite` database the Web App uses, so sessions you create in the extension appear in the Web App and vice versa.

## Installation

The extension is shipped as a single `.vsix`. To install it locally:

```bash
npm run vscode:package
code --install-extension dist/chat-vscode-0.1.0.vsix
```

The extension needs a running `pibo gateway:web` instance. By default it expects `http://127.0.0.1:4788`. Override the URL via the `pibo.chatWebUrl` setting (per workspace) or the `PIBO_CHAT_WEB_URL` environment variable.

## How rooms are resolved

When the extension activates it reads `vscode.workspace.workspaceFolders[0]` and canonicalizes the path (resolve symlinks, expand to absolute). It calls the gateway:

```
GET /api/chat/rooms?workspace=<canonical-path>
```

The gateway returns rooms whose `workspace` column matches. Three outcomes are possible:

- **0 rooms** — the extension posts `POST /api/chat/rooms` to create a new room tagged with the workspace. The WebView enters the Session View directly.
- **1 room** — the WebView enters the Session View directly. The room id is cached in `workspaceState` so reloads skip the resolver.
- **2+ rooms** — the WebView shows a **Room Picker** (a new component, not the native `vscode.window.showQuickPick`) listing each candidate. The user clicks one; the host writes the choice to `workspaceState` and pushes the roomId back to the WebView, which re-renders into the Session View.

The watch on `onDidChangeWorkspaceFolders` re-runs the resolver when the user opens a different folder. Multi-root workspaces are out of scope for the first version; the extension always picks `workspaceFolders[0]`.

## Why my session shows up in the Web App

The extension and the Web App share the same data store. The extension writes to `~/.pibo/pibo.sqlite` through the existing `pibo gateway:web` REST API. The Web App reads from the same database. There is no separate per-workspace directory, no separate channel, and no separate auth flow. Sessions you create in the extension:

- appear in the Web App's room tree under the workspace's room,
- can be opened in the Web App at `/apps/chat/rooms/<id>/sessions/<sessionId>`,
- can be sent slash commands from either surface.

`pibo.openInChatWeb` (in the Command Palette) jumps from the extension to the same room in the Web App in one click.

## Slash commands

The Composer is the same `Composer.tsx` from `src/apps/chat-ui/src/composer/`. The slash command catalog is built from `bootstrap.capabilities.actions` using `buildSlashCommands` from `src/apps/chat-ui/src/app-command-catalog.ts` — the same call the Web App uses. Every slash command the Web App supports (`/help`, `/compact`, `/thinking`, `/model`, `/session.clone`, etc.) works in the extension with **zero new code**. The host just forwards `POST /api/chat/action` for each command.

`$skill` mentions and upload attachments are also wired through the same paths.

## Architecture summary

```
VS Code  ────  WebView (chat-vscode-main.tsx)
                  │
                  │ HTTP same-origin (served by the gateway)
                  ▼
              pibo gateway:web  ── /apps/chat-vscode/  (Vite bundle)
                                  ── /api/chat/...     (REST + SSE)
                                  │
                                  ▼
                              ~/.pibo/pibo.sqlite  (shared with Web App)
```

The extension host (Node) is a thin bridge. Its only responsibilities are:

- resolve the workspace folder to a `PiboRoom` (with the picker),
- open the WebView at `http://<gateway>/apps/chat-vscode/?workspace=…&roomId=…`,
- push `pibo/set-selector-mode` postMessages when the active room changes,
- open external URLs on behalf of the WebView (`pibo/open-external`),
- register the commands listed in the Command Palette.

The WebView does the actual session work — it fetches `bootstrap`, subscribes to `/api/chat/events` via SSE, and renders the Composer and Terminal View.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| The sidebar shows "Pibo gateway is not running" | The user has not started `pibo gateway:web` | Run `pibo gateway:web` in a terminal, or set `pibo.chatWebUrl` to the right URL |
| Multiple rooms show up in the picker after a workspace rename | A previous folder rename left two rooms with the same `workspace` | Pick one room to keep; archive the other from the Web App |
| Slash commands return `Unknown command` | The action catalog changed; the WebView's `bootstrap` is stale | Reload the VS Code window (`Developer: Reload Window`) |
| The WebView shows raw CSS for a second at startup | The Tailwind CSS bundle loads after the HTML | This is a brief flash; the bundle is included in the same `index.html` so the flash resolves within ~50 ms |

## Build

```bash
npm run vscode:webview:build   # Vite build for the WebView
npm run vscode:extension:build # esbuild bundle for extension.cjs
npm run vscode:package         # produce a .vsix
```

The build artifacts land in `src/apps/chat-vscode/dist/`. The Vite bundle at `src/apps/chat-vscode/dist/webview/` is served by the gateway at `/apps/chat-vscode/`. The esbuild bundle at `src/apps/chat-vscode/dist/extension/extension.cjs` is the extension entry point referenced from `package.json#main`.

## Validation

```bash
node --test test/chat-vscode/*.test.mjs
```

The tests cover the room resolver's 0/1/N-match behavior and the `SessionSelector` component's two modes. An optional live-gateway test (skipped by default) covers the integration; set `PIBO_LIVE_GATEWAY_TEST=1` to run it.
