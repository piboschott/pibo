import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { MAX_PREFIX_CAPSULE_BYTES } from "./prefix-capsule.js";
import type { SessionPrefixController } from "./prefix-session.js";
import type { NativePrefixStartupGate } from "./native-prefix-startup.js";
import { isAbsolute } from "node:path";

export type NativePrefixDerivation = { sourceNativeSessionId: string; nativeSessionId: string; nativeSessionFile: string };

/** Private startup/first-dispatch IPC. It never observes ordinary conversation input. */
export class NativePrefixBridge {
	private readonly token = randomBytes(32).toString("hex");
	private server?: Server;
	private endpoint?: string;
	private queued = 0;
	private operationTail = Promise.resolve();
	private nativeControl?: string;
	private derivation?: { nonce: string; source: string; resolve(value: NativePrefixDerivation): void; reject(error: Error): void };

	constructor(private readonly controller: SessionPrefixController, private readonly codec: string,
		private readonly startup?: NativePrefixStartupGate, private readonly restoreSnapshot?: (payload: string) => string) {}

	async derive(): Promise<NativePrefixDerivation> {
		const source = this.controller.binding?.nativeSessionId;
		if (!source || !this.nativeControl || this.derivation || this.controller.hasPendingRebaseline || this.controller.transition?.state === "pending") throw new Error("Native prefix derivation is unavailable");
		const nonce = randomBytes(32).toString("hex");
		const receipt = new Promise<NativePrefixDerivation>((resolve, reject) => { this.derivation = { nonce, source, resolve, reject }; });
		const timer = setTimeout(() => this.derivation?.reject(new Error("Native prefix derivation timed out")), 20000);
		const dispatch = async () => {
			const response = await fetch(this.nativeControl!, { method: "POST", headers: { authorization: `Bearer ${this.token}` },
				body: JSON.stringify({ nonce }), signal: AbortSignal.timeout(20000) });
			if (response.status !== 200) throw new Error("Native derivation failed");
		};
		try { return (await Promise.all([dispatch(), receipt]))[1]; }
		finally { clearTimeout(timer); this.derivation = undefined; }
	}

	async start(): Promise<{ endpoint: string; token: string }> {
		if (this.server) throw new Error("Native prefix bridge is already started");
		const server = createServer((request, response) => { void this.handle(request, response); });
		server.on("error", () => { server.closeAllConnections(); server.close(() => {}); });
		this.server = server;
		server.requestTimeout = 15000;
		server.headersTimeout = 5000;
		server.keepAliveTimeout = 1000;
		server.maxHeadersCount = 16;
		try {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
			});
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Native prefix bridge has no address");
			this.endpoint = `http://127.0.0.1:${address.port}`;
			return { endpoint: this.endpoint, token: this.token };
		} catch (error) { this.server = undefined; server.close(() => {}); throw error; }
	}

	private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		response.setHeader("cache-control", "no-store");
		const supplied = request.headers.authorization;
		const expected = `Bearer ${this.token}`;
		if (typeof supplied !== "string" || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
			|| !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
			response.writeHead(403).end(); request.resume(); return;
		}
		if (request.method === "GET" && request.url === "/activate" && this.startup) {
			await this.startup.accept(request, response);
			return;
		}
		if (this.queued >= 64) { response.writeHead(503).end(); request.resume(); return; }
		this.queued++;
		const previous = this.operationTail;
		let release!: () => void;
		this.operationTail = new Promise<void>(resolve => { release = resolve; });
		await previous;
		try {
			if (!this.server || response.destroyed) throw new Error("Native prefix bridge closed");
			if (request.method === "POST" && request.url === "/control" && !this.nativeControl) {
				const chunks: Buffer[] = []; let bytes = 0;
				for await (const chunk of request) { bytes += chunk.length; if (bytes > 1024) throw new Error("Native control address exceeds limit"); chunks.push(chunk); }
				const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				const url = new URL(value.endpoint);
				if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.pathname !== "/derive" || url.search || url.hash) throw new Error("Invalid native control address");
				this.nativeControl = url.href;
				response.writeHead(200).end(); return;
			}
			if (request.url === "/derive" && this.derivation) {
				const pending = this.derivation;
				if (request.method === "GET") {
					response.setHeader("content-type", "application/json");
					response.writeHead(200).end(JSON.stringify({ nonce: pending.nonce, sourceNativeSessionId: pending.source }));
					return;
				}
				if (request.method === "POST") {
					const chunks: Buffer[] = []; let bytes = 0;
					for await (const chunk of request) { bytes += chunk.length; if (bytes > 16384) throw new Error("Native derivation receipt exceeds limit"); chunks.push(chunk); }
					const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
					if (value.nonce !== pending.nonce || value.sourceNativeSessionId !== pending.source
						|| typeof value.nativeSessionId !== "string" || !value.nativeSessionId || value.nativeSessionId.length > 1024
						|| value.nativeSessionId === pending.source || typeof value.nativeSessionFile !== "string" || !isAbsolute(value.nativeSessionFile)) throw new Error("Invalid native derivation receipt");
					response.writeHead(200).end();
					pending.resolve({ sourceNativeSessionId: value.sourceNativeSessionId, nativeSessionId: value.nativeSessionId, nativeSessionFile: value.nativeSessionFile });
					return;
				}
			}
   const childRoute = /^\/children\/([^/]+)\/(snapshot|seal|compaction-begin|compaction-finish)$/.exec(request.url ?? "");
   if (childRoute) {
    const nativeSessionId = decodeURIComponent(childRoute[1]!);
    if (!nativeSessionId || nativeSessionId.length > 1024 || /[\r\n\0]/.test(nativeSessionId)) throw new Error("Invalid native child identity");
    if (request.method === "GET" && childRoute[2] === "snapshot") {
     const restored = await this.controller.restoreNativeChild(nativeSessionId,this.codec);
     if (restored) {
      response.setHeader("x-native-child-state",Buffer.from(JSON.stringify(restored.child)).toString("base64url"));
      response.setHeader("content-type","application/octet-stream");
     }
     response.writeHead(restored ? 200 : 404).end(restored?.payload);return;
    }
    if (request.method === "POST" && childRoute[2] === "seal") {
     const locator = request.headers["x-native-session-file"], historical = request.headers["x-native-has-history"];
     if (typeof locator !== "string" || locator.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(locator) || !["true","false"].includes(String(historical))) throw new Error("Invalid native child dispatch receipt");
     const nativeSessionFile = Buffer.from(locator,"base64url").toString("utf8");
     if (!isAbsolute(nativeSessionFile) || nativeSessionFile.length > 4096) throw new Error("Invalid native child file");
     const chunks: Buffer[] = [];let bytes = 0;
     for await (const chunk of request) {bytes += chunk.length;if (bytes > MAX_PREFIX_CAPSULE_BYTES) throw new Error("Native child capsule exceeds limit");chunks.push(chunk);}
     const child = await this.controller.sealNativeChild({nativeSessionId,nativeSessionFile,codec:this.codec,payload:new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)),hasHistoricalModelInput:historical === "true"});
     response.setHeader("content-type","application/json");response.writeHead(200).end(JSON.stringify({digest:child.prefix.capsule.digest,epoch:child.prefix.epoch}));return;
    }
    if (request.method === "POST" && childRoute[2]!.startsWith("compaction-")) {
     const chunks: Buffer[] = [];let bytes=0;
     for await (const chunk of request) {bytes+=chunk.length;if(bytes>4096) throw new Error("Native child transition exceeds limit");chunks.push(chunk);}
     const operation=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
     if (!operation || typeof operation!=="object" || Array.isArray(operation)) throw new Error("Invalid native child transition");
     if (childRoute[2] === "compaction-begin") {
      if (Object.keys(operation).some(key=>key!=="sourceHead") || operation.sourceHead!==null && (typeof operation.sourceHead!=="string" || !operation.sourceHead || operation.sourceHead.length>256 || /[\x00-\x1f\x7f]/.test(operation.sourceHead))) throw new Error("Invalid native child source head");
     } else if (Object.keys(operation).some(key=>!["id","changed"].includes(key)) || typeof operation.id!=="string" || operation.id.length>128 || typeof operation.changed!=="boolean") throw new Error("Invalid native child completion");
     const child=await this.controller.mutateNativeChildCompaction(nativeSessionId,operation);
     response.setHeader("content-type","application/json");response.writeHead(200).end(JSON.stringify(child.transition));return;
    }
    response.writeHead(405).end();request.resume();return;
   }
			if (request.method === "GET" && request.url === "/rebaseline") {
				const pending = this.controller.rebaseline;
				response.setHeader("content-type", "application/json");
				response.writeHead(pending ? 200 : 404).end(pending ? JSON.stringify({ id: pending.id, reason: pending.reason,
					sourceAdapterId: pending.sourceBinding.adapterId, sourceNativeSessionId: pending.sourceBinding.nativeSessionId,
					nativeSessionId: this.controller.getRuntimeBinding().nativeSessionId, targetModel: pending.targetModel }) : undefined);
				return;
			}
			if (request.method === "GET" && request.url === "/transition") {
				await this.controller.restore(this.codec);
				response.setHeader("content-type", "application/json");
				response.writeHead(200).end(JSON.stringify(this.controller.transition ?? null));
				return;
			}
			if (request.method === "GET" && request.url === "/snapshot") {
				const snapshot = await this.controller.restore(this.codec);
				response.setHeader("content-type", "application/octet-stream");
				response.writeHead(snapshot === undefined ? 404 : 200).end(snapshot === undefined ? undefined : this.restoreSnapshot?.(snapshot) ?? snapshot);
				return;
			}
			const transitionOperation = request.url === "/compaction/begin" || request.url === "/compaction/finish";
			if (request.method !== "POST" || request.url !== "/seal" && !transitionOperation) { response.writeHead(404).end(); request.resume(); return; }
			const maximum = transitionOperation ? 4096 : MAX_PREFIX_CAPSULE_BYTES;
			const declared = request.headers["content-length"];
			if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
				response.writeHead(413).end(); request.resume(); return;
			}
			const nativeSessionId = request.headers["x-native-session-id"];
			const historical = request.headers["x-native-has-history"];
			if (!transitionOperation && (typeof nativeSessionId !== "string" || nativeSessionId.length > 1024 || !["true", "false"].includes(String(historical)))) {
				response.writeHead(400).end(); request.resume(); return;
			}
			let bytes = 0;
			const chunks: Buffer[] = [];
			for await (const chunk of request) {
				bytes += chunk.length;
				if (bytes > maximum) { response.writeHead(413).end(); request.destroy(); return; }
				chunks.push(chunk);
			}
			const payload = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
			if (transitionOperation) {
				if (await this.controller.restore(this.codec) === undefined) throw new Error("No sealed prefix");
				const operation = JSON.parse(payload) as Record<string, unknown>;
				if (!operation || typeof operation !== "object" || Array.isArray(operation)) throw new Error("Invalid transition");
				if (request.url === "/compaction/begin") {
					if (Object.keys(operation).some(key => key !== "sourceHead") || operation.sourceHead !== null &&
						(typeof operation.sourceHead !== "string" || !operation.sourceHead || operation.sourceHead.length > 256 || /[\x00-\x1f\x7f]/.test(operation.sourceHead))) throw new Error("Invalid native head");
					await this.controller.beginCompaction(operation.sourceHead as string | null);
				} else {
					if (Object.keys(operation).some(key => key !== "id" && key !== "changed") || typeof operation.id !== "string"
						|| operation.id.length > 128 || typeof operation.changed !== "boolean") throw new Error("Invalid transition completion");
					await this.controller.finishCompaction(operation.id, operation.changed);
				}
				response.setHeader("content-type", "application/json");
				response.writeHead(200).end(JSON.stringify(this.controller.transition));
				return;
			}
			const prefix = await this.controller.seal({ codec: this.codec, payload, nativeSessionId: nativeSessionId as string,
				evidence: "adapter-inputs", hasHistoricalModelInput: historical === "true",
				...(typeof request.headers["x-prefix-rebaseline-id"] === "string" ? { rebaselineId: request.headers["x-prefix-rebaseline-id"] } : {}) });
			// Ack is deliberately after artifact publication AND the audited binding CAS.
			response.setHeader("content-type", "application/json");
			response.writeHead(200).end(JSON.stringify({ digest: prefix.capsule.digest, epoch: prefix.epoch }));
		} catch {
			// Errors and raw native snapshot text never enter standard diagnostics.
			if (!response.headersSent) response.writeHead(409).end("prefix-recovery-required");
			else response.destroy();
		} finally { this.queued--; release(); }
	}

	async dispose(): Promise<void> {
		this.derivation?.reject(new Error("Native prefix bridge closed during derivation"));
		this.startup?.dispose();
		const server = this.server;
		this.server = undefined;
		this.endpoint = undefined;
		this.nativeControl = undefined;
		if (!server) return;
		await new Promise<void>((resolve, reject) => {
			server.close(error => { if (error) reject(error); else resolve(); });
			server.closeAllConnections();
		});
		await this.operationTail;
	}
}
