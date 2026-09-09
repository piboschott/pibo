import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SessionPrefixController } from "../../sessions/prefix-session.js";
import { PrefixRecoveryRequiredError } from "../../sessions/prefix-capsule.js";
import { NativePrefixBridge } from "../../sessions/native-prefix-bridge.js";
import { NativePrefixStartupGate } from "../../sessions/native-prefix-startup.js";
import { recoverCodexPrefixCompaction } from "./prefix-recovery.js";
import type { CodexNativeRuntimeConfig } from "./config.js";
import { buildCodexNativeProcessEnvironment, startCodexNativeAppServer,
	type CodexNativeAppServerProcess, type CodexNativeSessionPaths } from "./process.js";

export const CODEX_PREFIX_CODEC = "codex-0.153.2/responses/pibo-v1";
export const CODEX_PREFIX_NATIVE_CONTRACT = CODEX_PREFIX_CODEC + "\nnative-children-v1\nnative-settings-v1";
const execute = promisify(execFile);
type Stage = {
	gate: NativePrefixStartupGate;
	bridge: NativePrefixBridge;
	abort: AbortController;
	connecting?: Promise<CodexNativeAppServerProcess>;
	process?: CodexNativeAppServerProcess;
	paths?: CodexNativeSessionPaths;
	args?: readonly string[];
	activated: boolean;
};

/** Owns the native child across initial open and credential-driven replacements. */
export class CodexPrefixOpen {
	private stage?: Stage;
	private closed = false;
	constructor(private readonly config: CodexNativeRuntimeConfig, private readonly controller: SessionPrefixController,
		private readonly workspace: string, private readonly experimentalApi: boolean) {}

	async prepare(): Promise<void> {
		if (this.closed || this.stage) throw new PrefixRecoveryRequiredError("Codex protected startup is already active");
		const reported = await execute(this.config.executable, ["--pibo-prefix-contract"], { timeout: 5000, maxBuffer: 4096,
			env: { PATH: process.env.PATH }, encoding: "utf8" }).catch(() => undefined);
		if (reported?.stdout.trim() !== CODEX_PREFIX_NATIVE_CONTRACT) throw new PrefixRecoveryRequiredError("Codex requires the pinned native prefix contract build");
		await this.controller.restore(CODEX_PREFIX_CODEC);
		const binding = this.controller.getRuntimeBinding();
		const gate = new NativePrefixStartupGate();
		const bridge = new NativePrefixBridge(this.controller, CODEX_PREFIX_CODEC, gate, undefined, async child => {
   await recoverCodexPrefixCompaction({transition:child.transition,
    getRuntimeBinding:()=>({...this.controller.getRuntimeBinding(),nativeSessionId:child.nativeSessionId,metadata:{nativeSessionFile:child.nativeSessionFile}}),
    finishCompaction:async(id,changed)=>{await this.controller.mutateNativeChildCompaction(child.nativeSessionId,{id,changed});},
   });
  });
		const stage: Stage = { gate, bridge, abort: new AbortController(), activated: false };
		this.stage = stage;
		try {
			const connection = await bridge.start();
			stage.connecting = startCodexNativeAppServer({ config: this.config, runtimeInstanceId: binding.runtimeInstanceId,
				piboSessionId: binding.piboSessionId, sessionGeneration: randomUUID(), workspace: this.workspace,
				clientVersion: "1.0.0", experimentalApi: this.experimentalApi, signal: stage.abort.signal,
				prefixBootstrap: { environment: { PIBO_PREFIX_ENDPOINT: connection.endpoint, PIBO_PREFIX_TOKEN: connection.token,
					PIBO_PREFIX_ROOT: this.controller.ownershipRoot, PIBO_PREFIX_SESSION: binding.piboSessionId,
					...(binding.nativeSessionId ? { PIBO_PREFIX_NATIVE_SESSION: binding.nativeSessionId } : {}),
					...(this.controller.binding?.capsuleNativeSessionId ? { PIBO_PREFIX_DERIVED_FROM: this.controller.binding.capsuleNativeSessionId } : {}) },
					onPrepared: (args, _environment, paths) => { stage.args = args; stage.paths = paths; } },
			});
			void stage.connecting.catch(() => {});
			await Promise.race([gate.waitForOwnership(), stage.connecting.then(() => {
				throw new PrefixRecoveryRequiredError("Codex started before native ownership acknowledgement");
			})]);
			await recoverCodexPrefixCompaction(this.controller);
		} catch (error) { await this.closeStage(); throw error; }
	}

	async activate(resourceEnvironment: Readonly<NodeJS.ProcessEnv>): Promise<CodexNativeAppServerProcess> {
		if (this.closed) throw new PrefixRecoveryRequiredError("Codex protected startup is closed");
		if (this.stage?.activated) { await this.closeStage(); await this.prepare(); }
		const stage = this.stage;
		if (!stage?.paths || !stage.args || !stage.connecting) throw new PrefixRecoveryRequiredError("Codex native ownership is unavailable");
		const args = [...stage.args];
		await this.controller.restore(CODEX_PREFIX_CODEC);
		const environment = buildCodexNativeProcessEnvironment({ config: this.config, paths: stage.paths, resourceEnvironment });
		const activationEnvironment = Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
		stage.activated = true;
		stage.gate.activate(args, activationEnvironment);
		stage.process = await stage.connecting;
		return stage.process;
	}

	private async closeStage(): Promise<void> {
		const stage = this.stage;
		if (!stage) return;
		this.stage = undefined;
		stage.gate.dispose();
		stage.abort.abort();
		const native = stage.process ?? await stage.connecting?.catch(() => undefined);
		await native?.close();
		await stage.bridge.dispose();
	}

	async dispose(): Promise<void> { this.closed = true; await this.closeStage(); }
}
