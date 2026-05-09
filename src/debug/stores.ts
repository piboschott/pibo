import { existsSync } from "node:fs";
import { piboHomePath } from "../core/pibo-home.js";

export type PiboDebugStoreName = "pibo-data" | "sessions" | "chat" | "agents" | "auth" | "bindings" | "reliability";

export type PiboDebugStore = {
	name: PiboDebugStoreName;
	description: string;
	defaultPath: string;
};

export type ResolvedPiboDebugStore = PiboDebugStore & {
	path: string;
	exists: boolean;
};

export const PIBO_DEBUG_STORES: readonly PiboDebugStore[] = [
	{
		name: "pibo-data",
		description: "current unified Chat Web and Pibo Session data",
		defaultPath: "pibo.sqlite",
	},
	{
		name: "sessions",
		description: "V2 alias for Pibo Session metadata in pibo.sqlite",
		defaultPath: "pibo.sqlite",
	},
	{
		name: "chat",
		description: "V2 alias for Chat Web rooms, messages, events, observations, and stats in pibo.sqlite",
		defaultPath: "pibo.sqlite",
	},
	{
		name: "agents",
		description: "custom Agent Designer profiles",
		defaultPath: "chat-agents.sqlite",
	},
	{
		name: "auth",
		description: "Better Auth local auth data",
		defaultPath: "auth.sqlite",
	},
	{
		name: "bindings",
		description: "local session binding data",
		defaultPath: "session-bindings.sqlite",
	},
	{
		name: "reliability",
		description: "Pibo event stream, durable jobs, and yielded runs",
		defaultPath: "pibo-events.sqlite",
	},
];

export function resolveDebugStores(): ResolvedPiboDebugStore[] {
	return PIBO_DEBUG_STORES.map((store) => resolveDebugStore(store.name));
}

export function resolveDebugStore(name: string): ResolvedPiboDebugStore {
	const store = PIBO_DEBUG_STORES.find((item) => item.name === name);
	if (!store) {
		throw new Error(`Unknown debug store "${name}". Use one of: ${PIBO_DEBUG_STORES.map((item) => item.name).join(", ")}`);
	}
	const path = piboHomePath(store.defaultPath);
	return {
		...store,
		path,
		exists: existsSync(path),
	};
}
