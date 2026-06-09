import * as vscode from "vscode";

export type AuthBridge = vscode.Disposable & {
	signIn(): Promise<void>;
	isAvailable(): Promise<boolean>;
};

export type AuthBridgeOptions = {
	baseUrl: string;
};

export function createAuthBridge(_options: AuthBridgeOptions): AuthBridge {
	const terminalDisposables: vscode.Disposable[] = [];

	const signIn = async (): Promise<void> => {
		const providers = ["openai", "anthropic", "google"];
		const choice = await vscode.window.showQuickPick(providers, {
			title: "Pibo: pick a provider to sign in with",
		});
		if (!choice) return;
		const terminal = vscode.window.createTerminal({ name: `pibo login ${choice}` });
		terminal.show();
		terminal.sendText(`pibo login ${choice}`);
		terminalDisposables.push(terminal);
	};

	const isAvailable = async (): Promise<boolean> => {
		try {
			const url = `${_options.baseUrl}/api/chat/bootstrap?roomId=__vscode_health__`;
			const res = await fetch(url, { method: "GET" });
			return res.ok || res.status === 401 || res.status === 403;
		} catch {
			return false;
		}
	};

	return {
		signIn,
		isAvailable,
		dispose: () => {
			for (const d of terminalDisposables) d.dispose();
		},
	};
}
