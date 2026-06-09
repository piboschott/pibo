// Type-safe wrapper around vscode.Webview's postMessage.
// The schema is shared with the WebView bundle in extension/webview/ChatTerminalApp.tsx.

import type { WebViewToHostMessage, HostToWebViewMessage } from "./webview-host";

export type { WebViewToHostMessage, HostToWebViewMessage };

export function isWebViewToHostMessage(value: unknown): value is WebViewToHostMessage {
	if (!value || typeof value !== "object") return false;
	const type = (value as { type?: unknown }).type;
	return (
		type === "pibo/select-room" ||
		type === "pibo/open-external" ||
		type === "pibo/refresh-bootstrap-request"
	);
}
