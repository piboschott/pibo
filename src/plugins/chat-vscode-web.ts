import { definePiboPlugin } from "./registry.js";
import { isVscodeAppPath, responseBuiltVscodeAsset, responseVscodeAppShell } from "../apps/chat/static-assets.js";
import { responseJson } from "../web/http.js";

const CHAT_VSCODE_WEB_APP_NAME = "pibo.chat-vscode-web";

export const CHAT_VSCODE_MOUNT_PATH = "/apps/chat-vscode";

export function createPiboChatVscodeWebPlugin(): ReturnType<typeof definePiboPlugin> {
	return definePiboPlugin({
		id: "pibo.chat-vscode-web",
		name: "Pibo Chat VS Code Web",
		register(api) {
			api.registerWebApp({
				name: CHAT_VSCODE_WEB_APP_NAME,
				mountPath: CHAT_VSCODE_MOUNT_PATH,
				apiPrefix: CHAT_VSCODE_MOUNT_PATH,
				async handleRequest(request) {
					const url = new URL(request.url);
					const builtAsset = responseBuiltVscodeAsset(request, url.pathname);
					if (builtAsset) return builtAsset;
					if (isVscodeAppPath(url.pathname) && request.method === "GET") {
						return responseVscodeAppShell();
					}
					return responseJson({ error: "Not found" }, { status: 404 });
				},
			});
		},
	});
}
