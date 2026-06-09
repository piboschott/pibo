import * as vscode from "vscode";
import type { AuthBridge } from "./auth-bridge";
import type { WebviewProvider } from "./webview-host";

export type CommandContext = {
	baseUrl: string;
	webviewProvider: WebviewProvider;
	authBridge: AuthBridge;
};

export function registerCommands(context: vscode.ExtensionContext, ctx: CommandContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("pibo.newSession", async () => {
			ctx.webviewProvider.pushSelectorMode({
				kind: "sessions",
				roomId: ctx.webviewProvider.getCurrentRoomId() ?? "",
			});
		}),
		vscode.commands.registerCommand("pibo.deleteCurrentSession", () => {
			vscode.window.showInformationMessage("Pibo: delete the current session from the session menu in the sidebar.");
		}),
		vscode.commands.registerCommand("pibo.renameCurrentSession", () => {
			vscode.window.showInformationMessage("Pibo: rename the current session from the session menu in the sidebar.");
		}),
		vscode.commands.registerCommand("pibo.openInChatWeb", async () => {
			const roomId = ctx.webviewProvider.getCurrentRoomId();
			if (!roomId) {
				vscode.window.showWarningMessage("Pibo: no room is active in this workspace.");
				return;
			}
			const url = `${ctx.baseUrl}/apps/chat/rooms/${encodeURIComponent(roomId)}`;
			await vscode.env.openExternal(vscode.Uri.parse(url));
		}),
		vscode.commands.registerCommand("pibo.signIn", () => ctx.authBridge.signIn()),
	);
}
