import { PREFIX_SETTINGS_KEY, readPrefixRuntimeSettings, type PrefixRuntimeSettings } from "./prefix-settings.js";
import { PREFIX_NATIVE_CHILDREN_KEY, readNativePrefixChildren, withNativePrefixChild, type NativePrefixChild } from "./prefix-children.js";
import { withPrefixPublication } from "./prefix-maintenance.js";
import { readPrefixRebaseline, SESSION_PREFIX_REBASELINE_KEY, type PrefixRebaseline, type PrefixModelSelection } from "./prefix-rebaseline.js";
import { readPrefixArtifactDependencies, PREFIX_ARTIFACT_DEPENDENCIES_KEY, readPrefixResourceDependencies, PREFIX_RESOURCE_DEPENDENCIES_KEY } from "./prefix-dependencies.js";
import type { AgentRuntimeBindingPersistence } from "../agent-runtime/types.js";
import { randomUUID } from "node:crypto";
import type { CacheInferenceEvidence } from "../shared/cache-diagnostics.js";
import type { PiboJsonObject } from "../core/events.js";
import type { RuntimeSessionBinding } from "./runtime-binding.js";
import { readPrefixTransition, SESSION_PREFIX_TRANSITION_KEY, type PrefixTransition } from "./prefix-transition.js";
import { PrefixSessionOwnership } from "./prefix-ownership.js";
import { isAgentRuntimeBindingPersistence } from "./runtime-binding-persistence.js";
import {
	PrefixCapsuleStore, PrefixRecoveryRequiredError, readSessionPrefixBinding,
	SESSION_PREFIX_METADATA_KEY, type SessionPrefixBinding,
	validatePrefixReference,
} from "./prefix-capsule.js";
import {
	PrefixResourceBundleStore, PREFIX_RESOURCES_CODEC, SESSION_PREFIX_RESOURCES_KEY,
	type PrefixResources, type RestoredPrefixResources,
} from "./prefix-resources.js";

export type SessionPrefixControllerOptions = {
	store?: PrefixCapsuleStore;
	getBinding: () => RuntimeSessionBinding;
	/** Cold transition reads reconcile ordinary router binding publications. */
	readCurrentBinding?: () => RuntimeSessionBinding;
	persistence: AgentRuntimeBindingPersistence;
	onPersisted?: (binding: RuntimeSessionBinding) => void;
	runtimeGeneration?: string;
};

/** Owns artifact publication plus the existing audited binding CAS. */
export class SessionPrefixController {
	private readonly store: PrefixCapsuleStore;
	private sealedPayload?: { digest: string; payload: string };
	private preparing?: Promise<SessionPrefixBinding>;
	private resources?: { digest: string; value: RestoredPrefixResources };
	private preparingResources?: Promise<RestoredPrefixResources>;
	private historicalResourcesRestored = false;
	private readonly runtimeGeneration: string;
	private inferenceSequence = 0;
	private inferenceEvidence?: CacheInferenceEvidence;
	private inferenceEvidenceFailed = false;
	private ownership?: PrefixSessionOwnership;
	private readonly transitionWaiters = new Set<() => void>();
	private transitionFailureId?: string;
	private readerUpgrade?: Promise<void>;

	async acquireOwnership(): Promise<() => void> {
		if (!this.ownership) {
			const binding = this.options.getBinding();
			if (!binding.nativeSessionId) throw new PrefixRecoveryRequiredError("native identity is required before protected ownership");
			this.ownership = await PrefixSessionOwnership.acquire(this.store.root, [
				JSON.stringify(["pibo", binding.piboSessionId]),
				JSON.stringify(["native", binding.adapterId, binding.nativeSessionId]),
			]);
		}
		const owned = this.ownership;
		return () => {
			owned.release();
			if (this.ownership === owned) this.ownership = undefined;
		};
	}

	constructor(private readonly options: SessionPrefixControllerOptions) {
		if (!isAgentRuntimeBindingPersistence(options.persistence)) {
			throw new PrefixRecoveryRequiredError("durable audited binding persistence is unavailable");
		}
		const metadata = options.getBinding().metadata;
		readPrefixResourceDependencies(metadata);
		readPrefixArtifactDependencies(metadata);
		readNativePrefixChildren(metadata);
		const rebaseline = readPrefixRebaseline(metadata);
		if (rebaseline && (rebaseline.sourceBinding.piboSessionId !== options.getBinding().piboSessionId || rebaseline.targetAdapterId !== options.getBinding().adapterId)) {
			throw new PrefixRecoveryRequiredError("explicit transition belongs to another session or adapter");
		}
		if (readPrefixTransition(metadata) && !readSessionPrefixBinding(metadata)) {
			throw new PrefixRecoveryRequiredError("native transition has lost its sealed prefix");
		}
		this.store = options.store ?? new PrefixCapsuleStore();
		this.runtimeGeneration = options.runtimeGeneration ?? randomUUID();
	}

	get binding(): SessionPrefixBinding | undefined {
		return readSessionPrefixBinding(this.options.getBinding().metadata);
	}

	getRuntimeBinding(): RuntimeSessionBinding {
		return structuredClone(this.options.getBinding());
	}

	get ownershipRoot(): string { return this.store.root; }

	/** Preserve native settings while incorporating prefix-only CAS updates. */
	mergeRuntimeBinding(binding: RuntimeSessionBinding): RuntimeSessionBinding {
		const persisted = this.options.getBinding();
		const metadata = { ...binding.metadata };
		for (const key of [SESSION_PREFIX_METADATA_KEY, SESSION_PREFIX_RESOURCES_KEY, SESSION_PREFIX_TRANSITION_KEY, SESSION_PREFIX_REBASELINE_KEY, PREFIX_RESOURCE_DEPENDENCIES_KEY, PREFIX_ARTIFACT_DEPENDENCIES_KEY, PREFIX_NATIVE_CHILDREN_KEY, PREFIX_SETTINGS_KEY]) {
			if (persisted.metadata?.[key] !== undefined) metadata[key] = structuredClone(persisted.metadata[key]);
			else delete metadata[key];
		}
		return { ...structuredClone(binding), revision: persisted.revision, metadata };
	}

	get transition(): PrefixTransition | undefined { return readPrefixTransition(this.options.getBinding().metadata); }

	private transitionBinding(): RuntimeSessionBinding {
		const expected = this.options.getBinding();
		const current = this.options.readCurrentBinding?.() ?? expected;
		if (current.piboSessionId !== expected.piboSessionId || current.nativeSessionId !== expected.nativeSessionId
			|| current.adapterId !== expected.adapterId || current.runtimeInstanceId !== expected.runtimeInstanceId
			|| [SESSION_PREFIX_METADATA_KEY, SESSION_PREFIX_RESOURCES_KEY, SESSION_PREFIX_TRANSITION_KEY, SESSION_PREFIX_REBASELINE_KEY, PREFIX_RESOURCE_DEPENDENCIES_KEY, PREFIX_ARTIFACT_DEPENDENCIES_KEY, PREFIX_NATIVE_CHILDREN_KEY, PREFIX_SETTINGS_KEY].some(key =>
				JSON.stringify(current.metadata?.[key]) !== JSON.stringify(expected.metadata?.[key]))) {
			throw new PrefixRecoveryRequiredError("protected transition binding changed concurrently");
		}
		return structuredClone(current);
	}

	/** Native completion events may precede the durable IPC acknowledgement. */
	async waitForCompactionCompletion(timeoutMs = 30000): Promise<void> {
		const pending = this.transition;
		if (pending?.state !== "pending") return;
		if (this.transitionFailureId === pending.id) throw new PrefixRecoveryRequiredError("native compaction completion could not be persisted");
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => { clearTimeout(timer); this.transitionWaiters.delete(check); };
			const check = () => {
				try {
					if (this.transitionFailureId === pending.id) throw new PrefixRecoveryRequiredError("native compaction completion could not be persisted");
					const current = this.transition;
					if (current?.id !== pending.id) throw new PrefixRecoveryRequiredError("native compaction receipt changed while awaiting completion");
					if (current.state === "pending") return;
					cleanup(); resolve();
				} catch (error) { cleanup(); reject(error); }
			};
			const timer = setTimeout(() => { cleanup(); reject(new PrefixRecoveryRequiredError("native compaction completion was not persisted")); }, timeoutMs);
			this.transitionWaiters.add(check);
			check();
		});
	}

	get rebaseline(): PrefixRebaseline | undefined { return readPrefixRebaseline(this.options.getBinding().metadata); }

	get hasPendingRebaseline(): boolean { return this.options.getBinding().metadata?.[SESSION_PREFIX_REBASELINE_KEY] !== undefined; }

	get configuredSettings(): PrefixRuntimeSettings | undefined {
		const pending = this.rebaseline;
		if (pending?.reason === "settings-change") return pending.targetSettings;
		if (pending?.reason === "model-change") return pending.targetSettings;
		return readPrefixRuntimeSettings(this.options.getBinding().metadata?.[PREFIX_SETTINGS_KEY]);
	}

	async changeSettings<T>(model: PrefixModelSelection, previous: PrefixRuntimeSettings, target: PrefixRuntimeSettings,
		apply: (settings: PrefixRuntimeSettings) => Promise<T>): Promise<T> {
		previous = readPrefixRuntimeSettings(previous)!;
		target = readPrefixRuntimeSettings(target)!;
		const same = (a: PrefixRuntimeSettings | undefined, b: PrefixRuntimeSettings) => a?.reasoning === b.reasoning && a.fastMode === b.fastMode;
		const existing = this.rebaseline;
		if (existing) {
			if (existing.reason !== "settings-change") throw new PrefixRecoveryRequiredError("another explicit prefix transition is pending");
			if (same(existing.previousSettings, target)) {
				const result = await apply(target); await this.abortConfigurationChange(existing.id, "settings-change"); return result;
			}
			if (same(existing.targetSettings, target)) return apply(target);
			throw new PrefixRecoveryRequiredError("complete the pending settings change or restore the original controls");
		}
		if (same(previous, target)) return apply(target);
		await this.ensureCurrentReader();
		if (!this.binding) return apply(target);
		if (this.transition?.state === "pending") throw new PrefixRecoveryRequiredError("a native prefix transition is pending");
		const runtime = this.transitionBinding();
		const pending: PrefixRebaseline = {format:1,id:randomUUID(),reason:"settings-change",targetAdapterId:runtime.adapterId,
			sourceBinding:runtime,previousModel:model,targetModel:model,previousSettings:previous,targetSettings:target};
		const metadata = {...runtime.metadata,[SESSION_PREFIX_REBASELINE_KEY]:pending as unknown as PiboJsonObject};
		readPrefixRebaseline(metadata);
		const persisted = await this.options.persistence.compareAndSet({...runtime,metadata},runtime.revision!);
		this.options.onPersisted?.(structuredClone(persisted));
		try { return await apply(target); }
		catch (error) {
			try {await apply(previous);await this.abortConfigurationChange(pending.id,"settings-change");}
			catch (rollback) {throw new AggregateError([error,rollback],"Runtime settings change failed and requires recovery");}
			throw error;
		}
	}

	async changeModel<T>(previous: PrefixModelSelection, target: PrefixModelSelection, apply: (model: PrefixModelSelection) => Promise<T>,
		controls?: {previous:PrefixRuntimeSettings; current?:()=>PrefixRuntimeSettings; restore:(settings:PrefixRuntimeSettings)=>Promise<void>}): Promise<T> {
		const same = (a: PrefixModelSelection | undefined, b: PrefixModelSelection) => a?.provider === b.provider && a.id === b.id;
		const applyTarget = async () => {
			const result=await apply(target);
			const pending=this.rebaseline;
			if(pending?.reason === "model-change" && controls?.current) await this.confirmModelSettings(pending.id,controls.current());
			return result;
		};
		const existing = this.rebaseline;
		if (existing) {
			if (existing.reason !== "model-change") throw new PrefixRecoveryRequiredError("another explicit prefix transition is pending");
			if (same(existing.previousModel, target)) {
				const result = await apply(target);
				if(existing.previousSettings) {
					if(!controls) throw new PrefixRecoveryRequiredError("model rollback requires its original controls");
					await controls.restore(existing.previousSettings);
				}
				await this.abortModelChange(existing.id);
				return result;
			}
			if (same(existing.targetModel, target)) return await applyTarget();
			throw new PrefixRecoveryRequiredError("complete the pending model change or select the original model to cancel it");
		}
		const pending = await this.beginModelChange(previous, target, controls?.previous);
		try { return await applyTarget(); }
		catch (error) {
			if (pending) {
				try { await apply(previous); if(pending.previousSettings) await controls!.restore(pending.previousSettings); await this.abortModelChange(pending.id); }
				catch (rollback) { throw new AggregateError([error, rollback], "Model change failed and requires recovery"); }
			}
			throw error;
		}
	}

	private async confirmModelSettings(id:string, target:PrefixRuntimeSettings): Promise<void> {
		target=readPrefixRuntimeSettings(target)!;
		const runtime=this.transitionBinding(),pending=readPrefixRebaseline(runtime.metadata);
		if(!pending || pending.id!==id || pending.reason!=="model-change" || !pending.previousSettings) throw new PrefixRecoveryRequiredError("model control checkpoint lost its authorization");
		if(pending.targetSettings) {
			if(pending.targetSettings.reasoning!==target.reasoning || pending.targetSettings.fastMode!==target.fastMode) throw new PrefixRecoveryRequiredError("model controls changed after their checkpoint");
			return;
		}
		const metadata={...runtime.metadata,[SESSION_PREFIX_REBASELINE_KEY]:{...pending,targetSettings:target} as unknown as PiboJsonObject};
		const persisted=await this.options.persistence.compareAndSet({...runtime,metadata},runtime.revision!);
		this.options.onPersisted?.(structuredClone(persisted));
	}

	/** Durable authorization precedes any explicit native configuration mutation. */
	async beginModelChange(previousModel: PrefixModelSelection, targetModel: PrefixModelSelection, previousSettings?: PrefixRuntimeSettings): Promise<PrefixRebaseline | undefined> {
		await this.ensureCurrentReader();
		const runtime = this.transitionBinding();
		if (previousModel.provider === targetModel.provider && previousModel.id === targetModel.id) return undefined;
		if (!readSessionPrefixBinding(runtime.metadata)) return undefined;
		if (this.rebaseline || this.transition?.state === "pending") throw new PrefixRecoveryRequiredError("another prefix transition is pending");
		const transition: PrefixRebaseline = { format: 1, id: randomUUID(), reason: "model-change",
			targetAdapterId: runtime.adapterId, sourceBinding: runtime, previousModel, targetModel, ...(previousSettings?{previousSettings:readPrefixRuntimeSettings(previousSettings)}:{}) };
		const metadata = { ...runtime.metadata, [SESSION_PREFIX_REBASELINE_KEY]: transition as unknown as PiboJsonObject };
		readPrefixRebaseline(metadata);
		const persisted = await this.options.persistence.compareAndSet({ ...runtime, metadata }, runtime.revision!);
		this.options.onPersisted?.(structuredClone(persisted));
		return transition;
	}

	/** Caller has restored the original native configuration; no new dispatch occurred. */
	async abortModelChange(id: string): Promise<void> {
		return this.abortConfigurationChange(id,"model-change");
	}

	private async abortConfigurationChange(id: string, reason: "model-change" | "settings-change"): Promise<void> {
		const runtime = this.transitionBinding(), pending = readPrefixRebaseline(runtime.metadata);
		if (!pending || pending.id !== id || pending.reason !== reason) throw new PrefixRecoveryRequiredError("configuration transition is no longer pending");
		if (JSON.stringify({...readSessionPrefixBinding(runtime.metadata),format:2}) !== JSON.stringify({...readSessionPrefixBinding(pending.sourceBinding.metadata),format:2})) throw new PrefixRecoveryRequiredError("model transition already changed its prefix");
		const metadata = { ...runtime.metadata }; delete metadata[SESSION_PREFIX_REBASELINE_KEY];
		const persisted = await this.options.persistence.compareAndSet({ ...runtime, metadata }, runtime.revision!);
		this.options.onPersisted?.(structuredClone(persisted));
	}

	async beginCompaction(sourceHead: string | null): Promise<PrefixTransition | undefined> {
		const runtime = this.transitionBinding();
		if (this.rebaseline) throw new PrefixRecoveryRequiredError("an explicit prefix transition is pending");
		const prefix = readSessionPrefixBinding(runtime.metadata);
		readPrefixRuntimeSettings(runtime.metadata?.[PREFIX_SETTINGS_KEY]);
		if (!prefix) return undefined;
		if (this.transition?.state === "pending") throw new PrefixRecoveryRequiredError("a native prefix transition is already pending");
		const transition: PrefixTransition = { format: 1, id: randomUUID(), reason: "compaction",
			fromEpoch: prefix.epoch, nativeSessionId: prefix.nativeSessionId, sourceHead, state: "pending" };
		const persisted = await this.options.persistence.compareAndSet({ ...runtime,
			metadata: { ...runtime.metadata, [SESSION_PREFIX_TRANSITION_KEY]: transition as unknown as PiboJsonObject },
		}, runtime.revision!);
		this.options.onPersisted?.(structuredClone(persisted));
		return transition;
	}

	/** Native state must be synced and inspected before completing this audited CAS. */
	async finishCompaction(id: string, changed: boolean): Promise<void> {
		try {
			const runtime = this.transitionBinding();
			const transition = readPrefixTransition(runtime.metadata);
			const prefix = readSessionPrefixBinding(runtime.metadata);
			if (!transition || transition.id !== id) throw new PrefixRecoveryRequiredError("native prefix transition receipt changed concurrently");
			if (transition.state !== "pending") throw new PrefixRecoveryRequiredError("native prefix transition is already resolved");
			if (!prefix || prefix.epoch !== transition.fromEpoch) throw new PrefixRecoveryRequiredError("native prefix transition epoch changed concurrently");
			if (prefix.nativeSessionId !== transition.nativeSessionId) throw new PrefixRecoveryRequiredError("native prefix transition identity changed concurrently");
			const persisted = await this.options.persistence.compareAndSet({ ...runtime, metadata: {
				...runtime.metadata,
				[SESSION_PREFIX_TRANSITION_KEY]: { ...transition, state: changed ? "completed" : "aborted" },
				[SESSION_PREFIX_METADATA_KEY]: { ...prefix, epoch: prefix.epoch + Number(changed), reason: changed ? "compaction" : prefix.reason } as unknown as PiboJsonObject,
			} }, runtime.revision!);
			this.options.onPersisted?.(structuredClone(persisted));
			this.transitionFailureId = undefined;
			for (const notify of this.transitionWaiters) notify();
		} catch (error) {
			this.transitionFailureId = id;
			for (const notify of this.transitionWaiters) notify();
			throw error;
		}
	}

	/** Only compact, already computed facts. No prompt serialization on the telemetry path. */
	recordInference(facts: { cacheKeyDigest?: string; configurationDigest?: string }): void {
		// Operational checks have already completed at the dispatch boundary.
		// Diagnostics must neither block it nor reuse the preceding request's facts.
		this.inferenceEvidence = undefined;
		try {
			const prefix = this.binding;
			this.inferenceEvidence = {
				id: `${this.runtimeGeneration}:${++this.inferenceSequence}`, atMs: Date.now(),
				runtimeGeneration: this.runtimeGeneration, prefixDigest: prefix?.capsule.digest,
				...(prefix ? { epoch: String(prefix.epoch) } : {}),
				...facts, historyContinuity: "unknown",
			};
			this.inferenceEvidenceFailed = false;
		} catch { this.inferenceEvidenceFailed = true; }
	}

	getCacheEvidence(): CacheInferenceEvidence | undefined {
		// The routed best-effort collector counts this as a dropped observation.
		if (this.inferenceEvidenceFailed) throw new Error("Cache inference evidence unavailable");
		return this.inferenceEvidence ? { ...this.inferenceEvidence } : undefined;
	}


 /** Audited reader migration changes no model bytes or cache epoch. */
 private async ensureCurrentReader(): Promise<void> {
  const prefix = this.binding, pending = this.rebaseline;
  const needsFence = !prefix && pending && pending.reason !== "model-change" && this.options.getBinding().metadata?.piboSessionPrefix === undefined;
  if (prefix?.format !== 1 && !needsFence) return;
  if (this.readerUpgrade) return this.readerUpgrade;
  this.readerUpgrade = withPrefixPublication(this.store.root,async()=>{
   const runtime = this.transitionBinding();
   const currentPrefix = readSessionPrefixBinding(runtime.metadata), currentPending = readPrefixRebaseline(runtime.metadata);
   if (currentPrefix?.format === 2 || !currentPrefix && runtime.metadata?.piboSessionPrefix !== undefined) return;
   if (!currentPrefix && !currentPending) throw new PrefixRecoveryRequiredError("reader migration lost its protected source");
   const metadata = {...runtime.metadata,piboSessionPrefix:currentPrefix ? {...currentPrefix,format:2} as unknown as PiboJsonObject : {format:2,status:"pending",transitionId:currentPending!.id}};
   const persisted = await this.options.persistence.compareAndSet({...runtime,metadata},runtime.revision!);
   this.options.onPersisted?.(structuredClone(persisted));
  });
  try {await this.readerUpgrade;} finally {this.readerUpgrade=undefined;}
 }

	async restoreResources(): Promise<RestoredPrefixResources | undefined> {
		await this.ensureCurrentReader();
		const runtime = this.options.getBinding();
		if (!this.historicalResourcesRestored) {
			for (const reference of readPrefixResourceDependencies(runtime.metadata)) await new PrefixResourceBundleStore(this.store).restore(reference);
			this.historicalResourcesRestored = true;
		}
		const reference = runtime.metadata?.[SESSION_PREFIX_RESOURCES_KEY];
		if (reference === undefined) return undefined;
		validatePrefixReference(reference);
		if (reference.adapterId !== runtime.adapterId || reference.codec !== PREFIX_RESOURCES_CODEC) throw new PrefixRecoveryRequiredError("resource adapter or codec changed");
		if (this.resources?.digest === reference.digest) return this.resources.value;
		const value = await new PrefixResourceBundleStore(this.store).restore(reference);
		this.resources = { digest: reference.digest, value };
		return value;
	}

	/** Publish resource state before any native prompt can contain its stable paths. */
	async sealResources(capture: () => Promise<PrefixResources>): Promise<RestoredPrefixResources> {
		if (this.preparingResources) return this.preparingResources;
		this.preparingResources = withPrefixPublication(this.store.root, async () => {
			const restored = await this.restoreResources();
			if (restored) return restored;
			const runtime = structuredClone(this.options.getBinding());
			if (this.binding) throw new PrefixRecoveryRequiredError("sealed prefix is missing its original resources");
			if (runtime.revision === undefined) throw new PrefixRecoveryRequiredError("resource sealing requires a durable binding");
			const result = await new PrefixResourceBundleStore(this.store).put(runtime.adapterId, await capture());
			const persisted = await this.options.persistence.compareAndSet({
				...runtime,
				metadata: { ...runtime.metadata, [SESSION_PREFIX_RESOURCES_KEY]: result.reference as unknown as PiboJsonObject },
			}, runtime.revision);
			this.options.onPersisted?.(structuredClone(persisted));
			this.resources = { digest: result.reference.digest, value: result.resources };
			return result.resources;
		});
		try { return await this.preparingResources; } finally { this.preparingResources = undefined; }
	}

	async restore(codec: string): Promise<string | undefined> {
		await this.ensureCurrentReader();
		const runtime = this.options.getBinding();
		const prefix = readSessionPrefixBinding(runtime.metadata);
		readPrefixRuntimeSettings(runtime.metadata?.[PREFIX_SETTINGS_KEY]);
		if (!prefix) return undefined;
		if (prefix.nativeSessionId !== runtime.nativeSessionId) throw new PrefixRecoveryRequiredError("native session identity changed");
		if (prefix.capsule.adapterId !== runtime.adapterId || prefix.capsule.codec !== codec) throw new PrefixRecoveryRequiredError("unsupported runtime or codec");
		if (this.sealedPayload?.digest === prefix.capsule.digest) return this.sealedPayload.payload;
		const payload = await this.store.read(prefix.capsule, { adapterId: runtime.adapterId, codec });
		this.sealedPayload = { digest: prefix.capsule.digest, payload };
		return payload;
	}

	async seal(input: { codec: string; payload: string; nativeSessionId: string; evidence: SessionPrefixBinding["evidence"]; hasHistoricalModelInput: boolean; rebaselineId?: string }): Promise<SessionPrefixBinding> {
		if (this.preparing) {
			await this.preparing;
			return this.seal(input);
		}
		const pending = this.rebaseline;
		if (pending) {
			if (input.rebaselineId !== pending.id) throw new PrefixRecoveryRequiredError("explicit prefix transition requires its dispatch authorization");
			const runtime = this.transitionBinding();
			if (!runtime.nativeSessionId || runtime.nativeSessionId !== input.nativeSessionId || runtime.revision === undefined) throw new PrefixRecoveryRequiredError("explicit transition requires a durably bound native session");
			if (["runtime-change", "explicit-refresh"].includes(pending.reason) && runtime.adapterId === pending.sourceBinding.adapterId
				&& runtime.nativeSessionId === pending.sourceBinding.nativeSessionId) throw new PrefixRecoveryRequiredError("runtime replacement must use a new native session");
			const source = readSessionPrefixBinding(pending.sourceBinding.metadata)!;
			this.preparing = withPrefixPublication(this.store.root, async () => {
				const capsule = await this.store.put(runtime.adapterId, input.codec, input.payload);
				const prefix: SessionPrefixBinding = { format: 2, epoch: source.epoch + 1, status: "sealed", capsule,
					reason: pending.reason, nativeSessionId: input.nativeSessionId, evidence: input.evidence };
				const metadata: PiboJsonObject = { ...runtime.metadata, [SESSION_PREFIX_METADATA_KEY]: prefix as unknown as PiboJsonObject };
				delete metadata[SESSION_PREFIX_REBASELINE_KEY];
				if (pending.reason === "settings-change") metadata[PREFIX_SETTINGS_KEY] = pending.targetSettings!;
				if (pending.reason === "model-change") {
					if(pending.targetSettings) metadata[PREFIX_SETTINGS_KEY]=pending.targetSettings;
					else delete metadata[PREFIX_SETTINGS_KEY];
				}
				const persisted = await this.options.persistence.compareAndSet({ ...runtime, metadata }, runtime.revision!);
				this.options.onPersisted?.(structuredClone(persisted));
				this.sealedPayload = { digest: capsule.digest, payload: input.payload };
				return prefix;
			});
			try { return await this.preparing; } finally { this.preparing = undefined; }
		}
		if (input.rebaselineId) throw new PrefixRecoveryRequiredError("explicit prefix transition is no longer pending");
		const previous = this.binding;
		if (previous) {
			if (previous.nativeSessionId !== input.nativeSessionId || await this.restore(input.codec) !== input.payload) {
				throw new PrefixRecoveryRequiredError("attempted to replace an already sealed prefix");
			}
			return this.binding!;
		}
		if (input.hasHistoricalModelInput) throw new PrefixRecoveryRequiredError("legacy history has no proven original prefix; explicit rebaseline is required");
		const runtime = structuredClone(this.options.getBinding());
		if (!runtime.nativeSessionId || runtime.nativeSessionId !== input.nativeSessionId || runtime.revision === undefined) {
			throw new PrefixRecoveryRequiredError("native session must be durably bound before sealing");
		}
		this.preparing = withPrefixPublication(this.store.root, async () => {
			const capsule = await this.store.put(runtime.adapterId, input.codec, input.payload);
			const prefix: SessionPrefixBinding = {
				format: 2, epoch: 1, status: "sealed", capsule, reason: "initial",
				nativeSessionId: input.nativeSessionId, evidence: input.evidence,
			};
			const persisted = await this.options.persistence.compareAndSet({
				...runtime,
				metadata: { ...runtime.metadata, [SESSION_PREFIX_METADATA_KEY]: prefix as unknown as PiboJsonObject },
			}, runtime.revision!);
			this.options.onPersisted?.(structuredClone(persisted));
			this.sealedPayload = { digest: capsule.digest, payload: input.payload };
			return prefix;
		});
		try { return await this.preparing; } finally { this.preparing = undefined; }
	}


 /** Cold native-child open, before its native history is interpreted. */
 async restoreNativeChild(nativeSessionId: string, codec: string): Promise<{child: NativePrefixChild; payload: string} | undefined> {
  const runtime = this.options.getBinding();
  const child = readNativePrefixChildren(runtime.metadata).find(item => item.nativeSessionId === nativeSessionId);
  if (!child) return undefined;
  if (child.prefix.capsule.adapterId !== runtime.adapterId || child.prefix.capsule.codec !== codec) throw new PrefixRecoveryRequiredError("native child codec changed");
  return {child,payload:await this.store.read(child.prefix.capsule,{adapterId:runtime.adapterId,codec})};
 }

 async sealNativeChild(input: { nativeSessionId: string; nativeSessionFile: string; codec: string; payload: string; hasHistoricalModelInput: boolean; sourceNativeSessionId?: string }): Promise<NativePrefixChild> {
  return withPrefixPublication(this.store.root, async () => {
   const runtime = this.transitionBinding();
   if (!this.binding || runtime.nativeSessionId === input.nativeSessionId) throw new PrefixRecoveryRequiredError("native child requires a stable sealed parent");
   const existing = await this.restoreNativeChild(input.nativeSessionId,input.codec);
   if (existing) {
    if (existing.child.nativeSessionFile !== input.nativeSessionFile || existing.payload !== input.payload) throw new PrefixRecoveryRequiredError("native child prefix cannot be replaced implicitly");
    return existing.child;
   }
   if (input.sourceNativeSessionId !== undefined && input.sourceNativeSessionId !== runtime.nativeSessionId
    && !readNativePrefixChildren(runtime.metadata).some(child=>child.nativeSessionId===input.sourceNativeSessionId)) throw new PrefixRecoveryRequiredError("native child source has no sealed prefix");
   if (input.hasHistoricalModelInput && !input.sourceNativeSessionId) throw new PrefixRecoveryRequiredError("native child history has no original prefix");
   const capsule = await this.store.put(runtime.adapterId,input.codec,input.payload);
   const child: NativePrefixChild = {nativeSessionId:input.nativeSessionId,nativeSessionFile:input.nativeSessionFile,
    ...(input.sourceNativeSessionId ? {sourceNativeSessionId:input.sourceNativeSessionId} : {}),
    prefix:{format:1,epoch:1,status:"sealed",capsule,reason:"initial",nativeSessionId:input.nativeSessionId,evidence:"provider-request"}};
   const metadata = withNativePrefixChild({...runtime.metadata,piboSessionPrefix:{...this.binding!,format:2} as unknown as PiboJsonObject},child);
   const persisted = await this.options.persistence.compareAndSet({...runtime,metadata},runtime.revision!);
   this.options.onPersisted?.(structuredClone(persisted));
   return child;
  });
 }


 async mutateNativeChildCompaction(nativeSessionId: string, operation: {sourceHead: string | null} | {id: string; changed: boolean}): Promise<NativePrefixChild> {
  return withPrefixPublication(this.store.root, async () => {
   const runtime = this.transitionBinding();
   const child = readNativePrefixChildren(runtime.metadata).find(item => item.nativeSessionId === nativeSessionId);
   if (!this.binding || !child) throw new PrefixRecoveryRequiredError("native child compaction has no sealed state");
   let next: NativePrefixChild;
   if ("sourceHead" in operation) {
    if (child.transition?.state === "pending") throw new PrefixRecoveryRequiredError("native child compaction is already pending");
    next = {...child,transition:{format:1,id:randomUUID(),reason:"compaction",fromEpoch:child.prefix.epoch,nativeSessionId,sourceHead:operation.sourceHead,state:"pending"}};
   } else {
    if (child.transition?.state !== "pending" || child.transition.id !== operation.id) throw new PrefixRecoveryRequiredError("native child compaction receipt changed");
    next = {...child,prefix:operation.changed ? {...child.prefix,epoch:child.prefix.epoch+1,reason:"compaction"} : child.prefix,
     transition:{...child.transition,state:operation.changed?"completed":"aborted"}};
   }
   const persisted = await this.options.persistence.compareAndSet({...runtime,metadata:withNativePrefixChild(runtime.metadata,next)},runtime.revision!);
   this.options.onPersisted?.(structuredClone(persisted));return next;
  });
 }

	/** Call after a proven native transition. The immutable base artifact is reused. */
	async advanceEpoch(reason: "compaction" | "model-change"): Promise<SessionPrefixBinding | undefined> {
		const runtime = structuredClone(this.options.getBinding());
		const previous = readSessionPrefixBinding(runtime.metadata);
		if (!previous) return undefined;
		const next: SessionPrefixBinding = { ...previous, epoch: previous.epoch + 1, reason };
		const persisted = await this.options.persistence.compareAndSet({
			...runtime, metadata: { ...runtime.metadata, [SESSION_PREFIX_METADATA_KEY]: next as unknown as PiboJsonObject },
		}, runtime.revision ?? 1);
		this.options.onPersisted?.(structuredClone(persisted));
		return next;
	}
}
