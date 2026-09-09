import { restoreDerivedOmpPrefix } from "../../sessions/prefix-derivation.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RuntimeSessionBinding } from "../../agent-runtime/types.js";
import { PrefixRecoveryRequiredError } from "../../sessions/prefix-capsule.js";
import { NativePrefixBridge } from "../../sessions/native-prefix-bridge.js";
import { NativePrefixStartupGate } from "../../sessions/native-prefix-startup.js";
import type { SessionPrefixController } from "../../sessions/prefix-session.js";
import { OmpRpcClient } from "./client.js";
import type { OmpRuntimeConfig } from "./config.js";
import { createOmpPrefixBootstrapSource } from "./prefix-bootstrap.js";
import { createOmpPrefixGuardSource, OMP_PREFIX_CODEC, OMP_LEGACY_PREFIX_CODEC } from "./prefix-guard.js";
import { buildOmpProcessEnvironment, disposeOmpSessionPaths, prepareOmpSessionPaths, type OmpSessionPaths } from "./process.js";

/** Starts only the ownership bootstrap; native discovery waits for activate(). */
export class OmpPrefixOpen {
	async deriveForRefresh() {
		try { return await this.bridge.derive(); }
		catch (error) { await this.dispose(); throw error; }
	}
	private readonly startup = new NativePrefixStartupGate();
	private readonly bridge: NativePrefixBridge;
	readonly client: OmpRpcClient;
	private connecting?: Promise<void>;
	private closed = false;
	private readonly nonce = randomUUID();
	private constructor(readonly paths: OmpSessionPaths, private readonly config: OmpRuntimeConfig,
		private readonly binding: RuntimeSessionBinding, controller: SessionPrefixController, private readonly codec: string) {
		this.bridge = new NativePrefixBridge(controller, codec, this.startup, payload => restoreDerivedOmpPrefix(payload, controller.binding));
		this.client = new OmpRpcClient({ startupTimeoutMs: config.startupTimeoutMs, requestTimeoutMs: config.requestTimeoutMs });
	}

	static async prepare(config: OmpRuntimeConfig, binding: RuntimeSessionBinding, workspace: string,
		controller: SessionPrefixController): Promise<OmpPrefixOpen> {
		if (!config.ompEntry) throw new PrefixRecoveryRequiredError("OMP native entry is unavailable");
		const nativePackage = JSON.parse(await readFile(join(dirname(config.ompEntry), "../package.json"), "utf8"));
		if (nativePackage.version !== "18.1.10") throw new PrefixRecoveryRequiredError("OMP prefix codec requires native version 18.1.10");
		// Verify before any native process can discover or modify old history.
		const codec = controller.binding?.capsule.codec ?? OMP_PREFIX_CODEC;
		if (![OMP_PREFIX_CODEC, OMP_LEGACY_PREFIX_CODEC].includes(codec)) throw new PrefixRecoveryRequiredError("OMP prefix codec is unsupported");
		await controller.restore(codec);
		const paths = await prepareOmpSessionPaths({ config, runtimeInstanceId: binding.runtimeInstanceId,
			piboSessionId: binding.piboSessionId, sessionGeneration: randomUUID() });
		const opened = new OmpPrefixOpen(paths, config, binding, controller, codec);
		try {
			await mkdir(paths.root, { recursive: true, mode: 0o700 });
			const connection = await opened.bridge.start();
			const bootstrap = join(paths.root, "prefix-bootstrap.mjs");
			await writeFile(bootstrap, createOmpPrefixBootstrapSource({ entryModuleUrl: pathToFileURL(config.ompEntry).href,
				prefixRoot: controller.ownershipRoot, waitForActivation: true, nativeSessionId: binding.nativeSessionId,
				identities: [JSON.stringify(["pibo", binding.piboSessionId]),
					...(binding.nativeSessionId ? [JSON.stringify(["native", binding.adapterId, binding.nativeSessionId])] : [])],
			}), { mode: 0o600 });
			opened.connecting = opened.client.connect([config.bunExecutable, bootstrap], { cwd: workspace,
				env: { ...buildOmpProcessEnvironment({ paths, config, baseEnvironment: process.env }),
					PIBO_PREFIX_ENDPOINT: connection.endpoint, PIBO_PREFIX_TOKEN: connection.token,
					PIBO_PREFIX_READY_FILE: join(paths.root, "prefix-ready.json"), PIBO_PREFIX_READY_NONCE: opened.nonce } });
			void opened.connecting.catch(() => {});
			await Promise.race([opened.startup.waitForOwnership(), opened.connecting.then(() => {
				throw new PrefixRecoveryRequiredError("OMP started before native ownership acknowledgement");
			})]);
			return opened;
		} catch (error) { await opened.dispose(); throw error; }
	}

	async activate(command: readonly string[]): Promise<void> {
		const guard = join(this.paths.root, "prefix-guard.mjs");
		await writeFile(guard, createOmpPrefixGuardSource(pathToFileURL(join(dirname(this.config.ompEntry!),
			"session/date-cwd-reminder.ts")).href, this.codec), { mode: 0o600 });
		const nativeFile = this.binding.metadata?.nativeSessionFile;
		if (this.binding.state === "bound" && (typeof nativeFile !== "string" || !nativeFile)) {
			throw new PrefixRecoveryRequiredError("OMP protected resume requires its native transcript path");
		}
		this.startup.activate([...command.slice(2), ...(typeof nativeFile === "string" ? ["--resume", nativeFile] : []),
			"--extension", guard]);
		await this.connecting;
		const ready = JSON.parse(await readFile(join(this.paths.root, "prefix-ready.json"), "utf8"));
		if (ready.nonce !== this.nonce || ready.codec !== this.codec) {
			throw new PrefixRecoveryRequiredError("OMP native prefix guard did not acknowledge activation");
		}
	}

	async dispose(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.startup.dispose();
		await this.client.close();
		await this.bridge.dispose();
		await disposeOmpSessionPaths(this.paths);
	}
}
