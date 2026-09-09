export const OMP_PREFIX_CODEC = "omp-18.1.10/responses/v2";
export const OMP_LEGACY_PREFIX_CODEC = "omp-18.1.10/openai-responses/v1";

/**
 * Native Bun extension for the pinned protected adapter and conformance fixtures.
 * The owning bootstrap must acquire child-lifetime ownership before activation.
 * Connection credentials arrive only through the private child environment.
 */
export function createOmpPrefixGuardSource(dateReminderModuleUrl: string, codec = OMP_PREFIX_CODEC): string {
	return String.raw`
import { open, writeFile, lstat } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

export default async function installPrefixGuard(pi, childConfig) {
  if (!childConfig && globalThis[Symbol.for("pibo.omp.prefix.installed")]) return;
  let phase = "bootstrap";
  const fatal = () => { globalThis[Symbol.for("pibo.omp.prefix.failed")]=true; process.stderr.write("Pibo native prefix recovery required: " + phase + "\n"); process.exit(78); };
  const freeze = value => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  try {
    const endpoint = childConfig?.endpoint ?? process.env.PIBO_PREFIX_ENDPOINT;
    const token = childConfig?.token ?? process.env.PIBO_PREFIX_TOKEN;
    const ready = process.env.PIBO_PREFIX_READY_FILE;
    const nonce = process.env.PIBO_PREFIX_READY_NONCE;
    if (!endpoint || new URL(endpoint).hostname !== "127.0.0.1" || !token || !childConfig && (!ready || !nonce)) return fatal();
    const claimNativeIdentity = childConfig?.claim ?? globalThis[Symbol.for("pibo.omp.prefix.claimNative")];
    if (typeof claimNativeIdentity !== "function") return fatal();
    if (!childConfig) delete globalThis[Symbol.for("pibo.omp.prefix.claimNative")];
    for (const key of ["PIBO_PREFIX_ENDPOINT", "PIBO_PREFIX_TOKEN", "PIBO_PREFIX_READY_FILE", "PIBO_PREFIX_READY_NONCE"]) delete process.env[key];
    const auth = { authorization: "Bearer " + token };
    const {resolveOpenAICompatPolicy} = await import(${JSON.stringify(new URL("../../../pi-ai/src/providers/openai-shared.ts", dateReminderModuleUrl).href)});
    phase = "restore";
    const response = await fetch(endpoint + "/snapshot", { headers: auth, signal: AbortSignal.timeout(5000) });
    let snapshot;
    if (response.status === 200) snapshot = JSON.parse(await response.text());
    else if (response.status !== 404) return fatal();
    if (snapshot && (![1, 2].includes(snapshot.format) || !snapshot.providerStatic || !snapshot.calendar
      || typeof snapshot.calendar.date !== "string" || typeof snapshot.calendar.cwd !== "string"
      || typeof snapshot.nativeSessionId !== "string")) return fatal();
    if (snapshot) freeze(snapshot);
    let configurationAuthorizationDirty = Boolean(snapshot);
    let initialRebaseline;
    if (!snapshot) {
      const response = await fetch(endpoint + "/rebaseline", { headers: auth, signal: AbortSignal.timeout(4500) });
      if (response.status === 200) {
        initialRebaseline = await response.json();
        if (!["runtime-change", "explicit-refresh"].includes(initialRebaseline.reason) || typeof initialRebaseline.id !== "string") return fatal();
      } else if (response.status !== 404) return fatal();
    }
    // Bounded model capabilities affect native history conversion too. Do not
    // persist transport headers, credentials, pricing or conversation state.
    const modelCodecFields = ["id", "provider", "api", "identity", "requestModelId", "reasoningMode",
      "requiresGlyphTokenization", "requiresCursorToolSchemaProjection", "reasoning", "input",
      "imageInputDecoder", "supportsTools", "supportsComputerUse", "contextWindow", "maxTokens",
      "omitMaxOutputTokens", "useResponsesLite", "toolMode", "thinking", "compat"];
    const modelCodec = model => {
      const value = Object.fromEntries(modelCodecFields.filter(key => model[key] !== undefined).map(key => [key, model[key]]));
      if (JSON.stringify(value).length > 65536) return fatal();
      return value;
    };

    const transitionResponse = await fetch(endpoint + "/transition", { headers: auth, signal: AbortSignal.timeout(4500) });
    if (transitionResponse.status !== 200) return fatal();
    let transition = await transitionResponse.json();
    let resolving;
    const hashNativeFile=async path=>{
      const hash=createHash("sha256");
      const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      try{
        const stat=await handle.stat();if(!stat.isFile()||stat.size>512*1024*1024)return fatal();
        for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk);
        return hash.digest("hex");
      }finally{await handle.close();}
    };
    const syncNativeFile=async path=>{
      const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
      try{if(!(await file.stat()).isFile())return fatal();await file.sync();}finally{await file.close();}
      const directory=await open(dirname(path),"r");try{await directory.sync();}finally{await directory.close();}
    };
    const syncNative = async manager => {
      const nativePath = manager.getSessionFile();
      if (!nativePath) return fatal();
      await manager.flush();
      const file = await open(nativePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { if (!(await file.stat()).isFile()) return fatal(); await file.sync(); }
      finally { await file.close(); }
      let directory = dirname(nativePath);
      while (true) {
        const handle = await open(directory, "r");
        try { await handle.sync(); } finally { await handle.close(); }
        const parent = dirname(directory); if (parent === directory) break; directory = parent;
      }
    };
    const mutateTransition = async (operation, payload) => {
      const response = await fetch(endpoint + "/compaction/" + operation, { method: "POST", headers: auth,
        body: JSON.stringify(payload), signal: AbortSignal.timeout(4500) });
      if (response.status !== 200) return fatal();
      transition = await response.json();
      return transition;
    };
    const resolveTransition = async manager => {
      if (resolving) return resolving;
      if (transition?.state !== "pending") return;
      resolving = (async () => {
        phase = "compaction-recovery";
        if (transition.nativeSessionId !== manager.getSessionId()) return fatal();
        const rewrite = /^rewrite-v1:([a-f0-9]{64}):([a-f0-9]{64})$/.exec(transition.sourceHead ?? "");
        if(rewrite){
          const digest=await hashNativeFile(manager.getSessionFile());
          if(digest!==rewrite[1] && digest!==rewrite[2])return fatal();
          await syncNativeFile(manager.getSessionFile());
          await mutateTransition("finish",{id:transition.id,changed:digest===rewrite[2]});
          return;
        }
        const head = manager.getLeafId();
        let cursor = head;
        let changed = false;
        const visited = new Set();
        while (cursor !== transition.sourceHead) {
          if (cursor === null || visited.has(cursor) || visited.size >= 10000) return fatal();
          visited.add(cursor);
          const entry = manager.getEntry(cursor);
          if (!entry) return fatal();
          if (entry.type === "compaction") changed = true;
          cursor = entry.parentId;
        }
        if (head !== transition.sourceHead && !changed) return fatal();
        await syncNative(manager);
        await mutateTransition("finish", { id: transition.id, changed });
      })();
      try { await resolving; } finally { resolving = undefined; }
    };
    const lifecycle = handler => async (...args) => {
      const timeout = setTimeout(fatal, 5000);
      try { return await handler(...args); } catch { return fatal(); }
      finally { clearTimeout(timeout); }
    };

    let calendar = snapshot?.calendar;
    phase = "calendar-codec";
    const { DateCwdReminderInjector } = await import(${JSON.stringify(dateReminderModuleUrl)});
    const { EXTENSION_HANDLER_TIMEOUT_MS, ExtensionRunner } = await import(${JSON.stringify(new URL('../extensibility/extensions/runner.ts', dateReminderModuleUrl).href)});
    if (EXTENSION_HANDLER_TIMEOUT_MS !== 30000) return fatal();
    const scope = { rewrite:async(manager,content,write)=>{
      if(!snapshot || transition?.state==="pending")return write();
      const path=manager.getSessionFile();
      if(snapshot.nativeSessionId!==manager.getSessionId()||typeof content!=="string"||Buffer.byteLength(content)>512*1024*1024)return fatal();
      phase="history-rewrite";
      const before=await hashNativeFile(path), after=createHash("sha256").update(content).digest("hex");
      if(before===after)return write();
      await mutateTransition("begin",{sourceHead:"rewrite-v1:"+before+":"+after});
      await write();
      await syncNativeFile(path);
      const actual=await hashNativeFile(path);
      if(actual!==before&&actual!==after)return fatal();
      await mutateTransition("finish",{id:transition.id,changed:actual===after});
    }, calendar: (date,cwd) => { calendar ??= Object.freeze({date,cwd}); return calendar; } };
    const execution = childConfig?.execution ?? new AsyncLocalStorage();
    if (!childConfig) {
      const transform = DateCwdReminderInjector.prototype.transform;
      DateCwdReminderInjector.prototype.transform = function(context,date,cwd) {
        const selected = (execution.getStore() ?? scope).calendar(date,cwd);
        return transform.call(this,context,selected.date,selected.cwd);
      };
    }

    const providerFields = new Set(["model", "instructions", "tools", "tool_choice", "parallel_tool_calls",
      "max_output_tokens", "temperature", "top_p", "reasoning", "text", "include", "prompt_cache_key",
      "prompt_cache_retention", "store", "stream", "stream_options", "service_tier", "truncation"]);
    const configFields = [...providerFields].filter(key => key !== "instructions" && key !== "tools");
    const transportFields = new Set(["type", "client_metadata", "previous_response_id"]);
    const validateTools = tools => {
      if (tools === undefined) return;
      if (!Array.isArray(tools)) return fatal();
      for (const tool of tools) {
        if (!tool || !["function", "custom"].includes(tool.type)) return fatal();
        const fields = tool.type === "function"
          ? ["type", "name", "description", "parameters", "strict", "defer_loading"]
          : ["type", "name", "description", "format"];
        // Provider-managed remote tools can contain execution credentials and
        // implicit schemas. They require a separate proven codec.
        if (Object.entries(tool).some(([key, value]) => value !== undefined && !fields.includes(key))) return fatal();
      }
    };
    if (snapshot && Object.keys(snapshot.providerStatic).some(key => !providerFields.has(key))) return fatal();
    if (snapshot) validateTools(snapshot.providerStatic.tools);
    const validateInputPrefix = prefix => {
      if (!Array.isArray(prefix) || prefix.length > 257) return fatal();
      for (let index = 0; index < prefix.length; index++) {
        const item = prefix[index];
        if (item?.type === "additional_tools" && index === 0) {
          if (item.role !== "developer" || Object.keys(item).some(key => !["type", "role", "tools"].includes(key))) return fatal();
          validateTools(item.tools);
        } else if (item?.type !== "message" || item?.role !== "developer"
          || Object.keys(item).some(key => !["type", "role", "content"].includes(key))
          || !Array.isArray(item.content) || item.content.length !== 1
          || item.content[0]?.type !== "input_text" || typeof item.content[0]?.text !== "string") return fatal();
      }
    };
    if (snapshot?.inputPrefix !== undefined) validateInputPrefix(snapshot.inputPrefix);
    if (snapshot?.format === 2 && !["openai-responses", "openai-codex-responses"].includes(snapshot.api)) return fatal();
    if (snapshot?.api === "openai-codex-responses" && (!Array.isArray(snapshot.inputPrefix)
      || typeof snapshot.responsesLite !== "boolean")) return fatal();
    let frozenPrompts;
    pi.on("before_agent_start", () => {
      if (snapshot?.api !== "openai-codex-responses") return;
      // Restore before the native append builder compares its previous request.
      // These are already provider-normalized strings, never raw credential state.
      frozenPrompts ??= [
        ...(typeof snapshot.providerStatic.instructions === "string" && snapshot.providerStatic.instructions.length > 0
          ? [snapshot.providerStatic.instructions] : []),
        ...snapshot.inputPrefix.filter(item => item.type === "message").map(item => item.content[0].text),
      ];
      return { systemPrompt: frozenPrompts.slice() };
    });
    const providerGuard = async (event, ctx) => {
      // The pinned runner swallows errors and has a 30s handler deadline. Its
      // scoped context does not expose that deadline's signal, so our shorter
      // 5s deadline must terminate the child before native fallthrough.
      const signal = ctx.signal;
      signal?.addEventListener("abort", fatal, { once: true });
      const timeout = setTimeout(fatal, 5000);
      try {
        phase = "request-codec";
        const api = ctx.model?.api;
        const codex = api === "openai-codex-responses";
        if (signal?.aborted || !["openai-responses", "openai-codex-responses"].includes(api) || !calendar
          || !event.payload || !Array.isArray(event.payload.input)) return fatal();
        let rebaseline = initialRebaseline;
        const modelChanged = snapshot && (snapshot.providerStatic.model !== event.payload.model
          || snapshot.modelSelection && (snapshot.modelSelection.provider !== ctx.model?.provider
            || snapshot.modelSelection.id !== ctx.model?.id));
        const configurationChanged = snapshot && configFields.some(field => JSON.stringify(snapshot.providerStatic[field]) !== JSON.stringify(event.payload[field]));
        if (modelChanged || configurationChanged || configurationAuthorizationDirty) {
          phase = "explicit-configuration-change";
          const authorization = await fetch(endpoint + "/rebaseline", { headers: auth, signal: AbortSignal.timeout(4500) });
          if (authorization.status === 404 && !modelChanged && !configurationChanged) rebaseline = undefined;
          else if (authorization.status === 200) rebaseline = await authorization.json();
          else return fatal();
          configurationAuthorizationDirty = false;
          if (rebaseline && (!["model-change", "settings-change"].includes(rebaseline.reason) || rebaseline.nativeSessionId !== snapshot.nativeSessionId
            || rebaseline.targetModel?.provider !== ctx.model?.provider || rebaseline.targetModel?.id !== ctx.model?.id
            || typeof rebaseline.id !== "string")) return fatal();
        }
        if (snapshot && !rebaseline && (snapshot.api ?? "openai-responses") !== api) return fatal();
        const currentModelCodec = modelCodec(ctx.model);
        if (snapshot?.modelCodec && !rebaseline
          && JSON.stringify(snapshot.modelCodec) !== JSON.stringify(currentModelCodec)) {phase="model-codec:"+(childConfig?"child":"root");return fatal();}
        if (Object.entries(event.payload).some(([key, value]) => value !== undefined && key !== "input"
          && !providerFields.has(key) && !(codex && transportFields.has(key)))) return fatal();
        if (event.payload.type !== undefined && event.payload.type !== "response.create") return fatal();
        const chained = event.payload.previous_response_id !== undefined;
        if (chained && rebaseline) return fatal();
        if (chained && (!snapshot || event.payload.type !== "response.create"
          || typeof event.payload.previous_response_id !== "string" || event.payload.previous_response_id.length > 1024)) return fatal();
        let inputPrefix;
        const responsesLite = !chained && event.payload.input[0]?.type === "additional_tools";
        if (!chained && codex) {
          const prompts = ctx.getSystemPrompt();
          if (!Array.isArray(prompts) || prompts.length > 256 || prompts.some(value => typeof value !== "string")) return fatal();
          // The pinned transformer prepends systemPrompt[1..] as developer
          // messages. Lite also prepends additional_tools and systemPrompt[0].
          // Count native inputs explicitly; never search conversation history.
          const promptCount = prompts.reduce((count, value) => count + Number(/\S/.test(value)), 0);
          const length = responsesLite ? 1 + promptCount : Math.max(0, promptCount - 1);
          inputPrefix = event.payload.input.slice(0, length);
          if (inputPrefix.length !== length) return fatal();
          validateInputPrefix(inputPrefix);
        }
        if (snapshot && !rebaseline && !chained && Boolean(snapshot.inputPrefix) !== Boolean(inputPrefix)) return fatal();
        if (snapshot && !rebaseline && !chained && codex && snapshot.responsesLite !== responsesLite) return fatal();
        validateTools(event.payload.tools);
        const manager = ctx.sessionManager;
        const nativeSessionId = manager.getSessionId();
        if (snapshot && snapshot.nativeSessionId !== nativeSessionId) return fatal();
        await resolveTransition(manager);
        if (snapshot && rebaseline?.reason === "settings-change") {
          phase = "settings-authorization";
          const target = rebaseline.targetSettings;
          const togglesReasoning = target?.reasoning === "off" || rebaseline.previousSettings?.reasoning === "off";
          const withoutSettings = value => {
            const copy = structuredClone(value);
            delete copy.service_tier;
            if (copy.reasoning) {
              delete copy.reasoning.effort;
              if(togglesReasoning && copy.reasoning.summary === "auto") delete copy.reasoning.summary;
              if (!Object.keys(copy.reasoning).length) delete copy.reasoning;
            }
            if(togglesReasoning && Array.isArray(copy.include)) {
              copy.include=copy.include.filter(item=>item!=="reasoning.encrypted_content");
              if(!copy.include.length) delete copy.include;
            }
            return copy;
          };
          const currentStatic = Object.fromEntries(Object.entries(event.payload).filter(([key, value]) => providerFields.has(key) && value !== undefined));
          const effort = event.payload.reasoning?.effort ?? null;
          const policy = resolveOpenAICompatPolicy(ctx.model,{endpoint:"responses",reasoning:target?.reasoning === "off" ? undefined : target?.reasoning ?? undefined,disableReasoning:target?.reasoning === "off",toolChoice:event.payload.tool_choice});
          const expectedEffort = policy.reasoning.omitReasoningEffort ? null : policy.reasoning.wireEffort ?? null;
          const effortMatches = codex && target?.reasoning === "off" ? effort === null || effort === "none" : effort === expectedEffort;
          phase = "settings-authorization:" + (!effortMatches ? "reasoning-effort" : (event.payload.service_tier === "priority") !== target?.fastMode ? "service-tier" : Object.keys({...snapshot.providerStatic,...currentStatic}).filter(key => JSON.stringify(withoutSettings(snapshot.providerStatic)[key]) !== JSON.stringify(withoutSettings(currentStatic)[key])).join(","));
          if (!target || typeof target.fastMode !== "boolean" || !effortMatches
            || (event.payload.service_tier === "priority") !== target.fastMode
            || modelChanged || (snapshot.api ?? "openai-responses") !== api
            || JSON.stringify(snapshot.modelCodec) !== JSON.stringify(currentModelCodec)
            || JSON.stringify(withoutSettings(snapshot.providerStatic)) !== JSON.stringify(withoutSettings(currentStatic))
            || JSON.stringify(snapshot.inputPrefix) !== JSON.stringify(inputPrefix)) return fatal();
        }
        if (!snapshot || rebaseline) {
          phase = "native-persistence";
          const historical = !rebaseline && manager.getEntries().some(entry => entry.type === "message" && entry.message.role === "assistant");
          if (historical || typeof manager.ensureOnDisk !== "function") return fatal();
          await manager.ensureOnDisk();
          await syncNative(manager);
          // Clone once at capture. Native providers reuse mutable Tool-schema
          // objects internally; freezing those would break the next inference.
          const providerStatic = structuredClone(Object.fromEntries(Object.entries(event.payload).filter(([key, value]) => providerFields.has(key) && value !== undefined)));
          snapshot = { format: 2, api, nativeSessionId, calendar, providerStatic,
            modelSelection: { provider: ctx.model.provider, id: ctx.model.id },
            modelCodec: structuredClone(currentModelCodec),
            ...(inputPrefix ? { inputPrefix: structuredClone(inputPrefix), responsesLite } : {}) };
          const payload = JSON.stringify(snapshot);
          phase = "durable-seal";
          const ack = await fetch(endpoint + "/seal", { method: "POST", headers: {
            ...auth, "x-native-session-id": nativeSessionId, "x-native-has-history": "false",
            ...(rebaseline ? { "x-prefix-rebaseline-id": rebaseline.id } : {}),
            ...(childConfig ? {"x-native-session-file":Buffer.from(manager.getSessionFile()).toString("base64url")} : {}),
          }, body: payload, signal: AbortSignal.timeout(4500) });
          if (ack.status !== 200) return fatal();
          const receipt = await ack.json();
          if (receipt.digest !== createHash("sha256").update(payload).digest("hex")
            || !Number.isSafeInteger(receipt.epoch) || receipt.epoch < 1) return fatal();
          freeze(snapshot);
          initialRebaseline = undefined;
        }
        phase = "configuration";
        for (const field of configFields) {
          if (JSON.stringify(event.payload[field]) !== JSON.stringify(snapshot.providerStatic[field])) {phase="configuration:"+field+(childConfig?":child":":root");return fatal();}
        }
        phase = "tool-compatibility";
        // Check every dispatch, including native tool-loop iterations.
        if (JSON.stringify(event.payload.tools) !== JSON.stringify(snapshot.providerStatic.tools)) return fatal();
        if (inputPrefix) {
          if (inputPrefix.length !== snapshot.inputPrefix.length
            || JSON.stringify(inputPrefix[0]?.tools) !== JSON.stringify(snapshot.inputPrefix[0]?.tools)) return fatal();
          // Replace only the reserved native prefix items, never copy history.
          for (let index = 0; index < inputPrefix.length; index++) event.payload.input[index] = snapshot.inputPrefix[index];
        }
        // The pinned native append builder checks the complete prior prefix
        // before emitting delta-only input. Transport metadata is never sealed.
        const transport = codex ? Object.fromEntries(Object.entries(event.payload).filter(([key]) => transportFields.has(key))) : {};
        return { ...snapshot.providerStatic, ...transport, input: event.payload.input };
      } catch { return fatal(); }
      finally { clearTimeout(timeout); signal?.removeEventListener("abort", fatal); }
    };
    pi.on("before_provider_request", providerGuard);
    // Configured extensions can follow CLI extensions. Verify the pinned
    // runner's effective handler order before any capture or HTTP request.
    // This bounded extension inventory check never touches native history.
    // Native summarization uses the side stream, separate from the main agent's
    // before_provider_request hook. Do not replace its summarization envelope.
    const recoverBeforeInput = lifecycle(async (_event, ctx) => {
      phase = "ownership";
      if (initialRebaseline?.sourceAdapterId === "orp"
        && initialRebaseline.sourceNativeSessionId === ctx.sessionManager.getSessionId()) return fatal();
      await claimNativeIdentity(ctx.sessionManager.getSessionId());
      if (!snapshot) return;
      phase = "compaction-recovery";
      if (ctx.sessionManager.getSessionId() !== snapshot.nativeSessionId) return fatal();
      await resolveTransition(ctx.sessionManager);
    });
    // Resolve an unchanged head before the next user message is appended.
    // Doing this only at provider dispatch would make an aborted compaction
    // indistinguishable from an unrelated native history mutation.
    pi.on("session_start", recoverBeforeInput);
    pi.on("input", recoverBeforeInput);
    pi.on("session_before_compact", lifecycle(async (_event, ctx) => {
      phase = "compaction-prepare";
      if (!snapshot) return { cancel: true };
      await resolveTransition(ctx.sessionManager);
      await syncNative(ctx.sessionManager);
      await mutateTransition("begin", { sourceHead: ctx.sessionManager.getLeafId() });
    }));
    pi.on("session_compact", lifecycle(async (_event, ctx) => {
      if (!transition || transition.state !== "pending") return fatal();
      await resolveTransition(ctx.sessionManager);
    }));
    const prepareDerivation = lifecycle(async (_event, ctx) => {
      if (!snapshot) return { cancel: true };
      await resolveTransition(ctx.sessionManager);
      await syncNative(ctx.sessionManager);
    });
    pi.on("session_before_switch", (event, ctx) => event.reason === "fork" ? prepareDerivation(event, ctx) : ({ cancel: true }));
    pi.on("session_before_branch", prepareDerivation);
    const finishDerivation = lifecycle(async (_event, ctx) => {
      phase = "derivation-ownership";
      await claimNativeIdentity(ctx.sessionManager.getSessionId(), snapshot.nativeSessionId);
      await syncNative(ctx.sessionManager);
    });
    pi.on("session_branch", finishDerivation);
    pi.on("session_switch", (event, ctx) => event.reason === "fork" ? finishDerivation(event, ctx) : undefined);
    // Private native lifecycle control; never a visible slash command or model
    // tool. The pinned AgentSession owns transcript and artifact copying.
    const restoreAgent = agent=>{
      if(snapshot?.api==="openai-codex-responses")agent.setSystemPrompt([
        ...(typeof snapshot.providerStatic.instructions==="string" && snapshot.providerStatic.instructions.length ? [snapshot.providerStatic.instructions]:[]),
        ...snapshot.inputPrefix.filter(item=>item.type==="message").map(item=>item.content[0].text),
      ]);
      const model=agent.state.model;
      if(snapshot?.modelCodec && model?.id===snapshot.modelSelection?.id && model?.provider===snapshot.modelSelection?.provider){
        const restored={...model};
        for(const key of modelCodecFields)delete restored[key];
        Object.assign(restored,structuredClone(snapshot.modelCodec));
        agent.setModel(restored);
      }
      const tools=childConfig && (snapshot?.providerStatic.tools ?? snapshot?.inputPrefix?.[0]?.tools);
      if(tools){
        const selected=tools.map(tool=>agent.state.tools.find(native=>native.name===tool.name));
        if(selected.some(tool=>!tool))return fatal();
        agent.setTools(selected);
      }
    };
    if (childConfig) return {scope,providerGuard,restoreAgent};
    const { AgentSession } = await import(${JSON.stringify(new URL('./agent-session.ts', dateReminderModuleUrl).href)});
    const { SessionManager } = await import(${JSON.stringify(new URL('./session-manager.ts', dateReminderModuleUrl).href)});
    const children = new Map(), preparations = new Map(), rootRunners = new WeakSet();
    const rootHandlers = new Set();
    let rootExtension;
    const inventory = async () => {
      const response = await fetch(endpoint + "/inventory",{headers:auth,signal:AbortSignal.timeout(4500)});
      if (response.status !== 200) return fatal();
      return response.json();
    };
    const childState = async (id, file, existing = false) => {
      if (children.has(id)) return children.get(id);
      if (preparations.has(id)) return preparations.get(id);
      if (children.size + preparations.size >= 64 || typeof file !== "string") return fatal();
      const pending = (async()=>{
        await claimNativeIdentity(id,undefined,true);
        const handlers = new Map();
        const child = await installPrefixGuard({on(name,handler){const list=handlers.get(name)??[];list.push(handler);handlers.set(name,list);}},
          {endpoint:endpoint+"/children/"+encodeURIComponent(id),token,execution,claim:(native)=>{
            if(native!==id) return fatal(); return claimNativeIdentity(id,undefined,true);
          }});
        if (existing) {
          const response=await fetch(endpoint+"/children/"+encodeURIComponent(id)+"/snapshot",{headers:auth,signal:AbortSignal.timeout(4500)});
          if(response.status!==200)return fatal();
        }
        const value={...child,handlers}; children.set(id,value);return value;
      })();
      preparations.set(id,pending);
      try{return await pending;}finally{preparations.delete(id);}
    };
    const beforeRead = async file => {
      const path=resolve(file), known=await inventory();
      if(path===known.root?.nativeSessionFile) return;
      const child=known.children.find(value=>resolve(value.nativeSessionFile)===path);
      if(child){await childState(child.nativeSessionId,path,true);return;}
      try {await lstat(path);return fatal();} catch(error){if(error.code!=="ENOENT")return fatal();}
    };
    const { FileSessionStorage } = await import(${JSON.stringify(new URL('./session-storage.ts', dateReminderModuleUrl).href)});
    const rewriteContext=new AsyncLocalStorage();
    const nativeRewrite=SessionManager.prototype.rewriteEntries;
    const nativeAtomicWrite=FileSessionStorage.prototype.writeTextAtomic;
    const nativeSyncWrite=FileSessionStorage.prototype.writeTextSync;
    // A rejected durable begin must not be followed by native exit flushing the
    // already-mutated in-memory branch over the original on-disk history.
    FileSessionStorage.prototype.writeTextSync=function(...args){
      if(globalThis[Symbol.for("pibo.omp.prefix.failed")])return;
      return nativeSyncWrite.apply(this,args);
    };
    if(typeof nativeRewrite!=="function"||typeof nativeAtomicWrite!=="function")return fatal();
    SessionManager.prototype.rewriteEntries=async function(...args){
      const selected=this.getSessionId()===snapshot?.nativeSessionId?{scope}:children.get(this.getSessionId());
      if(!selected || deriving)return nativeRewrite.apply(this,args);
      return rewriteContext.run({manager:this,scope:selected.scope},()=>nativeRewrite.apply(this,args));
    };
    FileSessionStorage.prototype.writeTextAtomic=async function(path,content,...args){
      const current=rewriteContext.getStore();
      if(!current||resolve(path)!==resolve(current.manager.getSessionFile()))return nativeAtomicWrite.call(this,path,content,...args);
      return current.scope.rewrite(current.manager,content,()=>nativeAtomicWrite.call(this,path,content,...args));
    };
    const nativeOpen=SessionManager.open;
    SessionManager.open=async function(file,...args){
      await beforeRead(file);
      const manager=await nativeOpen.call(this,file,...args);
      if(manager.getSessionId()!==snapshot?.nativeSessionId) await childState(manager.getSessionId(),manager.getSessionFile());
      return manager;
    };
    const peek=SessionManager.peekSessionInit;
    if(typeof peek!=="function")return fatal();
    SessionManager.peekSessionInit=async function(file,...args){await beforeRead(file);return peek.call(this,file,...args);};
    const prepareRunner=async runner=>{
      const manager=runner.sessionManager,id=manager.getSessionId();
      if(!rootExtension){
        rootExtension=runner.extensions.find(extension=>(extension.handlers.get("before_provider_request")??[]).includes(providerGuard));
        if(!rootExtension)return fatal();
        for(const list of rootExtension.handlers.values())for(const handler of list)rootHandlers.add(handler);
      }
      if(rootRunners.has(runner) || !snapshot || id===snapshot.nativeSessionId){rootRunners.add(runner);return {scope,providerGuard};}
      const child=await childState(id,manager.getSessionFile());
      if(!runner.extensions.some(extension=>extension.handlers===child.handlers)) {
        runner.extensions=runner.extensions.map(extension=>({...extension,handlers:new Map([...extension.handlers].map(([key,list])=>[key,list.filter(handler=>!rootHandlers.has(handler))]))}));
        runner.extensions.push({...rootExtension,handlers:child.handlers});
      }
      return child;
    };
    for(const method of ["emit","emitInput","emitBeforeAgentStart","emitBeforeProviderRequest"]){
      const native=ExtensionRunner.prototype[method];if(typeof native!=="function")return fatal();
      ExtensionRunner.prototype[method]=async function(...args){
        const selected=await prepareRunner(this);
        if(method==="emitBeforeProviderRequest"){
          let seen=false,count=0;
          if(!Array.isArray(this.extensions)||this.extensions.length>256)return fatal();
          for(const extension of this.extensions)for(const handler of extension.handlers.get("before_provider_request")??[]){
            if(seen||++count>2048)return fatal();if(handler===selected.providerGuard)seen=true;
          }
          if(!seen)return fatal();
        }
        return execution.run(selected.scope,()=>native.apply(this,args));
      };
    }
    const { Agent } = await import(${JSON.stringify(new URL('../../../pi-agent-core/src/agent.ts', dateReminderModuleUrl).href)});
    const nativePrompt=Agent.prototype.prompt, restoredAgents=new WeakSet();
    Agent.prototype.prompt=async function(...args){
      const selected=!snapshot||this.sessionId===snapshot.nativeSessionId?{scope,restoreAgent}:children.get(this.sessionId);
      if(!selected)return fatal();
      if(!restoredAgents.has(this)){selected.restoreAgent?.(this);restoredAgents.add(this);}
      return execution.run(selected.scope,()=>nativePrompt.apply(this,args));
    };
    let activeSession, deriving = false;
    const nativeIdentity = Object.getOwnPropertyDescriptor(AgentSession.prototype, "sessionId");
    if (!nativeIdentity?.get) return fatal();
    Object.defineProperty(AgentSession.prototype, "sessionId", { ...nativeIdentity, get() {
      const id = nativeIdentity.get.call(this);
      if (!snapshot || snapshot.nativeSessionId === id) activeSession = this;
      return id;
    } });
    const control = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 1024, idleTimeout: 30,
      async fetch(request) {
        if (request.method === "POST" && new URL(request.url).pathname === "/settings"
          && request.headers.get("authorization") === auth.authorization && !deriving && !activeSession?.isStreaming) {
          configurationAuthorizationDirty = true;
          return new Response(null,{status:200});
        }
        if (request.method !== "POST" || new URL(request.url).pathname !== "/derive"
          || request.headers.get("authorization") !== auth.authorization || deriving) return new Response(null, { status: 403 });
        deriving = true;
        try {
          const { nonce } = await request.json();
          const response = await fetch(endpoint + "/derive", { headers: auth, signal: AbortSignal.timeout(4500) });
          if (response.status !== 200) return new Response(null, { status: 409 });
          const authorization = await response.json(), native = activeSession;
          if (nonce !== authorization.nonce || !snapshot || !native
            || native.sessionId !== snapshot.nativeSessionId || native.sessionId !== authorization.sourceNativeSessionId
            || native.isStreaming) return new Response(null, { status: 409 });
          if (!await native.fork()) return new Response(null, { status: 409 });
          await syncNative(native.sessionManager);
          const receipt = await fetch(endpoint + "/derive", { method: "POST", headers: auth,
            body: JSON.stringify({ nonce, sourceNativeSessionId: authorization.sourceNativeSessionId,
              nativeSessionId: native.sessionId, nativeSessionFile: native.sessionFile }), signal: AbortSignal.timeout(4500) });
          if (receipt.status !== 200) return fatal();
          return new Response(null, { status: 200 });
        } catch { return new Response(null, { status: 409 }); }
        finally { deriving = false; }
      },
    });
    const registered = await fetch(endpoint + "/control", { method: "POST", headers: auth,
      body: JSON.stringify({ endpoint: "http://127.0.0.1:" + control.port + "/derive" }), signal: AbortSignal.timeout(4500) });
    if (registered.status !== 200) return fatal();
    globalThis[Symbol.for("pibo.omp.prefix.installed")] = true;
    await writeFile(ready, JSON.stringify({ nonce, codec: ${JSON.stringify(codec)} }), { mode: 0o600 });
  } catch { return fatal(); }
}
`;
}
