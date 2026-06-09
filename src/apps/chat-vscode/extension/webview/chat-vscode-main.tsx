import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatTerminalApp } from "./ChatTerminalApp";
import "../../../chat-ui/src/styles.css";

const container = document.getElementById("root");
if (container) {
	createRoot(container).render(
		<StrictMode>
			<ChatTerminalApp />
		</StrictMode>,
	);
}
