import { createServer, type Server, type Socket } from "node:net";
import type { PiboOutputEvent } from "../events.js";
import { PiboSessionRouter } from "../session-router.js";
import {
	DEFAULT_GATEWAY_HOST,
	DEFAULT_GATEWAY_PORT,
	encodeFrame,
	errorResponse,
	isGatewayRequestFrame,
	type GatewayFrame,
	type GatewayResponseFrame,
} from "./protocol.js";

export type GatewayServerOptions = {
	host?: string;
	port?: number;
	persistSession?: boolean;
};

type GatewayConnection = {
	socket: Socket;
	send: (frame: GatewayFrame) => void;
};

function parseJsonLine(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		throw new Error("Invalid JSON frame");
	}
}

function createConnection(socket: Socket): GatewayConnection {
	return {
		socket,
		send(frame) {
			if (socket.destroyed) return;
			socket.write(encodeFrame(frame));
		},
	};
}

export class PiboGatewayServer {
	private readonly router: PiboSessionRouter;
	private readonly connections = new Set<GatewayConnection>();
	private server?: Server;
	private unsubscribe?: () => void;

	constructor(private readonly options: GatewayServerOptions = {}) {
		this.router = new PiboSessionRouter({
			persistSession: options.persistSession,
		});
	}

	async start(): Promise<void> {
		if (this.server) return;

		this.unsubscribe = this.router.subscribe((event) => this.broadcastRouterEvent(event));
		this.server = createServer((socket) => this.handleSocket(socket));

		await new Promise<void>((resolve, reject) => {
			this.server!.once("error", reject);
			this.server!.listen(this.options.port ?? DEFAULT_GATEWAY_PORT, this.options.host ?? DEFAULT_GATEWAY_HOST, () => {
				this.server!.off("error", reject);
				resolve();
			});
		});
	}

	async stop(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = undefined;

		for (const connection of this.connections) {
			connection.socket.destroy();
		}
		this.connections.clear();

		if (this.server) {
			await new Promise<void>((resolve, reject) => {
				this.server!.close((error) => (error ? reject(error) : resolve()));
			});
			this.server = undefined;
		}

		await this.router.disposeAll();
	}

	private handleSocket(socket: Socket): void {
		const connection = createConnection(socket);
		this.connections.add(connection);

		let buffer = "";
		socket.setEncoding("utf-8");

		socket.on("data", (chunk) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (line) {
					void this.handleLine(connection, line);
				}
				newlineIndex = buffer.indexOf("\n");
			}
		});

		socket.once("close", () => {
			this.connections.delete(connection);
		});
		socket.once("error", () => {
			this.connections.delete(connection);
		});
	}

	private async handleLine(connection: GatewayConnection, line: string): Promise<void> {
		let frame: unknown;
		try {
			frame = parseJsonLine(line);
			if (!isGatewayRequestFrame(frame)) {
				throw new Error("Invalid request frame");
			}
		} catch (error) {
			connection.send(errorResponse("invalid", error));
			return;
		}

		try {
			const output = await this.router.emit(frame.event);
			const response: GatewayResponseFrame = {
				type: "res",
				id: frame.id,
				ok: true,
				payload: output,
			};
			connection.send(response);
		} catch (error) {
			connection.send(errorResponse(frame.id, error));
		}
	}

	private broadcastRouterEvent(event: PiboOutputEvent): void {
		for (const connection of this.connections) {
			connection.send({ type: "event", event: "router", payload: event });
		}
	}
}

export async function runGatewayServer(options: GatewayServerOptions = {}): Promise<void> {
	const server = new PiboGatewayServer(options);
	await server.start();

	const host = options.host ?? DEFAULT_GATEWAY_HOST;
	const port = options.port ?? DEFAULT_GATEWAY_PORT;
	console.error(`pibo gateway listening on ${host}:${port}`);

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
