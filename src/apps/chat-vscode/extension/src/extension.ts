import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { createAuthBridge } from "./auth-bridge";
import { createWebviewHost } from "./webview-host";
import { createWorkspaceFolderWatcher } from "./workspace-folder-watcher";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const config = vscode.workspace.getConfiguration("pibo");
	const baseUrl = (config.get<string>("chatWebUrl") ?? "http://127.0.0.1:4788").replace(/\/$/, "");

	const webviewProvider = createWebviewHost(context, { baseUrl });
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("pibo.sessionPanel", webviewProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	);

	const workspaceWatcher = createWorkspaceFolderWatcher(context, { baseUrl, webviewProvider });
	context.subscriptions.push(workspaceWatcher);

	const authBridge = createAuthBridge({ baseUrl });
	context.subscriptions.push(authBridge);

	registerCommands(context, { baseUrl, webviewProvider, authBridge });
}

export function deactivate(): void {
	// Subscriptions are disposed automatically by VS Code.
}
