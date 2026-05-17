import { existsSync, readFileSync } from "node:fs";
import { createDefaultPiboPlugins } from "../plugins/builtin.js";
import type { BetterAuthServiceOptions } from "../auth/better-auth.js";
import { createPiboBetterAuthPlugin } from "../plugins/better-auth.js";
import { createPiboChatWebPlugin, type ChatWebAppOptions } from "../plugins/chat-web.js";
import { createPiboContextFilesPlugin, type ContextFilesPluginOptions } from "../plugins/context-files.js";
import { createPiboCronPlugin } from "../cron/plugin.js";
import { createPiboRalphPlugin } from "../ralph/plugin.js";
import { createPiboDevAuthPlugin } from "../plugins/dev-auth.js";
import { PiboPluginRegistry } from "../plugins/registry.js";
import { createPiboWebHostPlugin } from "../plugins/web.js";
import { DEFAULT_WEB_CHANNEL_HOST, DEFAULT_WEB_CHANNEL_PORT, type WebHostChannelOptions } from "../web/channel.js";
import { loadPiboConfig } from "../config/config.js";
import { PiboGatewayServer, type GatewayServerOptions } from "./server.js";
import { clearFallbackPidFile, clearPidFile, writeFallbackGatewayPid, writeGatewayPid } from "./pidfile.js";

export type WebGatewayServerOptions = GatewayServerOptions & {
	auth?: BetterAuthServiceOptions;
	devAuth?: boolean;
	web?: WebHostChannelOptions;
	chat?: ChatWebAppOptions;
	contextFiles?: ContextFilesPluginOptions;
};

const PUBLIC_WEB_CHANNEL_HOST = "0.0.0.0";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isDockerRuntime(): boolean {
	if (existsSync("/.dockerenv")) return true;
	try {
		const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
		return /docker|kubepods|containerd/.test(cgroup);
	} catch {
		return false;
	}
}

export function resolveWebGatewayAuthMode(options: WebGatewayServerOptions = {}): "better-auth" | "dev-auth" {
	if (!options.devAuth) {
		if (process.env.PIBO_DEV_AUTH === "1") {
			throw new Error("PIBO_DEV_AUTH no longer activates dev auth for gateway:web; use the Docker worker entrypoint instead.");
		}
		return "better-auth";
	}
	if (!isDockerRuntime()) {
		throw new Error("Pibo dev auth can only be enabled inside a Docker worker runtime.");
	}
	return "dev-auth";
}

function authBaseURL(options: WebGatewayServerOptions): string | undefined {
	return options.auth?.baseURL ?? loadPiboConfig().auth?.baseURL;
}

function defaultWebHost(baseURL: string | undefined): string {
	if (!baseURL) return DEFAULT_WEB_CHANNEL_HOST;
	try {
		const hostname = new URL(baseURL).hostname;
		return LOOPBACK_HOSTS.has(hostname) ? DEFAULT_WEB_CHANNEL_HOST : PUBLIC_WEB_CHANNEL_HOST;
	} catch {
		return DEFAULT_WEB_CHANNEL_HOST;
	}
}

export function resolveWebGatewayServerOptions(options: WebGatewayServerOptions = {}): WebGatewayServerOptions {
	const baseURL = authBaseURL(options);
	return {
		...options,
		web: {
			...options.web,
			host: options.web?.host ?? defaultWebHost(baseURL),
		},
	};
}


function webGatewayMode(options: WebGatewayServerOptions, useDevAuth: boolean): "dev" | "prod" {
	if (useDevAuth) return "dev";
	if (options.web?.port === 4808) return "dev";
	const baseURL = authBaseURL(options);
	if (baseURL) {
		try {
			if (new URL(baseURL).hostname.startsWith("dev.")) return "dev";
		} catch {
			// Fall through to production mode.
		}
	}
	return "prod";
}

export function createWebPiboPluginRegistry(options: WebGatewayServerOptions = {}): PiboPluginRegistry {
	const resolvedOptions = resolveWebGatewayServerOptions(options);
	const useDevAuth = resolveWebGatewayAuthMode(resolvedOptions) === "dev-auth";
	return PiboPluginRegistry.create({
		plugins: [
			...createDefaultPiboPlugins(),
			useDevAuth ? createPiboDevAuthPlugin() : createPiboBetterAuthPlugin(resolvedOptions.auth),
			createPiboWebHostPlugin({ announce: false, canonicalBaseURL: useDevAuth ? undefined : authBaseURL(resolvedOptions), gatewayMode: webGatewayMode(resolvedOptions, useDevAuth), ...resolvedOptions.web }),
			createPiboCronPlugin({ cronStorePath: resolvedOptions.chat?.cronStorePath, dataStorePath: resolvedOptions.chat?.dataStorePath, dataPayloadRootDir: resolvedOptions.chat?.dataPayloadRootDir }),
			createPiboRalphPlugin({ ralphStorePath: resolvedOptions.chat?.ralphStorePath, dataStorePath: resolvedOptions.chat?.dataStorePath, dataPayloadRootDir: resolvedOptions.chat?.dataPayloadRootDir }),
			createPiboContextFilesPlugin(resolvedOptions.contextFiles),
			createPiboChatWebPlugin(resolvedOptions.chat),
		],
	});
}

function createChatAppURL(options: WebGatewayServerOptions, host: string, port: number): string {
	if (options.devAuth) {
		return `http://${host}:${port}/apps/chat`;
	}
	const baseURL = options.auth?.baseURL ?? loadPiboConfig().auth?.baseURL;
	if (baseURL) {
		try {
			return new URL("/apps/chat", baseURL).toString();
		} catch {
			// Fall through to the bound address below.
		}
	}
	return `http://${host}:${port}/apps/chat`;
}

export async function runWebGatewayServer(options: WebGatewayServerOptions = {}): Promise<void> {
	const resolvedOptions = resolveWebGatewayServerOptions(options);
	const pluginRegistry = resolvedOptions.pluginRegistry ?? createWebPiboPluginRegistry(resolvedOptions);
	const server = new PiboGatewayServer({
		...resolvedOptions,
		pluginRegistry,
	});
	await server.start();
	try {
		if (process.env.PIBO_FALLBACK_MODE === "1") {
			writeFallbackGatewayPid();
		} else {
			writeGatewayPid();
		}
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		await server.stop();
		process.exit(1);
	}

	const host = resolvedOptions.web?.host ?? DEFAULT_WEB_CHANNEL_HOST;
	const port = resolvedOptions.web?.port ?? DEFAULT_WEB_CHANNEL_PORT;
	console.error(`pibo chat app available at ${createChatAppURL(resolvedOptions, host, port)}`);

	const stop = async () => {
		await server.stop();
		if (process.env.PIBO_FALLBACK_MODE === "1") {
			clearFallbackPidFile();
		} else {
			clearPidFile();
		}
	};
	process.once("SIGINT", () => {
		void stop().finally(() => process.exit(0));
	});
	process.once("SIGTERM", () => {
		void stop().finally(() => process.exit(0));
	});
}
