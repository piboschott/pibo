import { createDefaultPiboPlugins } from "../plugins/builtin.js";
import type { BetterAuthServiceOptions } from "../auth/better-auth.js";
import { createPiboBetterAuthPlugin } from "../plugins/better-auth.js";
import { createPiboChatWebPlugin, type ChatWebAppOptions } from "../plugins/chat-web.js";
import { PiboPluginRegistry } from "../plugins/registry.js";
import { createPiboWebHostPlugin } from "../plugins/web.js";
import { DEFAULT_WEB_CHANNEL_HOST, DEFAULT_WEB_CHANNEL_PORT, type WebHostChannelOptions } from "../web/channel.js";
import { PiboGatewayServer, type GatewayServerOptions } from "./server.js";

export type WebGatewayServerOptions = GatewayServerOptions & {
	auth?: BetterAuthServiceOptions;
	web?: WebHostChannelOptions;
	chat?: ChatWebAppOptions;
};

export function createWebPiboPluginRegistry(options: WebGatewayServerOptions = {}): PiboPluginRegistry {
	return PiboPluginRegistry.create({
		plugins: [
			...createDefaultPiboPlugins(),
			createPiboBetterAuthPlugin(options.auth),
			createPiboWebHostPlugin(options.web),
			createPiboChatWebPlugin(options.chat),
		],
	});
}

export async function runWebGatewayServer(options: WebGatewayServerOptions = {}): Promise<void> {
	const pluginRegistry = options.pluginRegistry ?? createWebPiboPluginRegistry(options);
	const server = new PiboGatewayServer({
		...options,
		pluginRegistry,
	});
	await server.start();

	const host = options.web?.host ?? DEFAULT_WEB_CHANNEL_HOST;
	const port = options.web?.port ?? DEFAULT_WEB_CHANNEL_PORT;
	console.error(`pibo chat app available at http://${host}:${port}/apps/chat`);

	const stop = async () => {
		await server.stop();
	};
	process.once("SIGINT", () => {
		void stop().finally(() => process.exit(0));
	});
	process.once("SIGTERM", () => {
		void stop().finally(() => process.exit(0));
	});
}
