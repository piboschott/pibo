export const OMP_PREFIX_CODEC = "omp-18.1.10/responses/v2";
export const OMP_LEGACY_PREFIX_CODEC = "omp-18.1.10/openai-responses/v1";

/**
 * Native Bun extension for the pinned protected adapter and conformance fixtures.
 * The owning bootstrap must acquire child-lifetime ownership before activation.
 * Connection credentials arrive only through the private child environment.
 */
export function createOmpPrefixGuardSource(dateReminderModuleUrl: string, codec = OMP_PREFIX_CODEC): string {
	return String.raw`
import { open, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

export default async function(pi) {
  let phase = "bootstrap";
  const fatal = () => { process.stderr.write("Pibo native prefix recovery required: " + phase + "\n"); process.exit(78); };
  const freeze = value => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  try {
    const endpoint = process.env.PIBO_PREFIX_ENDPOINT;
    const token = process.env.PIBO_PREFIX_TOKEN;
    const ready = process.env.PIBO_PREFIX_READY_FILE;
    const nonce = process.env.PIBO_PREFIX_READY_NONCE;
    if (!endpoint || new URL(endpoint).hostname !== "127.0.0.1" || !token || !ready || !nonce) return fatal();
    const claimNativeIdentity = globalThis[Symbol.for("pibo.omp.prefix.claimNative")];
    if (typeof claimNativeIdentity !== "function") return fatal();
    delete globalThis[Symbol.for("pibo.omp.prefix.claimNative")];
    for (const key of ["PIBO_PREFIX_ENDPOINT", "PIBO_PREFIX_TOKEN", "PIBO_PREFIX_READY_FILE", "PIBO_PREFIX_READY_NONCE"]) delete process.env[key];
    const auth = { authorization: "Bearer " + token };
    phase = "restore";
    const response = await fetch(endpoint + "/snapshot", { headers: auth, signal: AbortSignal.timeout(5000) });
    let snapshot;
    if (response.status === 200) snapshot = JSON.parse(await response.text());
    else if (response.status !== 404) return fatal();
    if (snapshot && (![1, 2].includes(snapshot.format) || !snapshot.providerStatic || !snapshot.calendar
      || typeof snapshot.calendar.date !== "string" || typeof snapshot.calendar.cwd !== "string"
      || typeof snapshot.nativeSessionId !== "string")) return fatal();
    if (snapshot) freeze(snapshot);

    const transitionResponse = await fetch(endpoint + "/transition", { headers: auth, signal: AbortSignal.timeout(4500) });
    if (transitionResponse.status !== 200) return fatal();
    let transition = await transitionResponse.json();
    let resolving;
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
    const transform = DateCwdReminderInjector.prototype.transform;
    DateCwdReminderInjector.prototype.transform = function(context, date, cwd) {
      calendar ??= Object.freeze({ date, cwd });
      return transform.call(this, context, calendar.date, calendar.cwd);
    };

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
        if (snapshot && (snapshot.api ?? "openai-responses") !== api) return fatal();
        if (Object.entries(event.payload).some(([key, value]) => value !== undefined && key !== "input"
          && !providerFields.has(key) && !(codex && transportFields.has(key)))) return fatal();
        if (event.payload.type !== undefined && event.payload.type !== "response.create") return fatal();
        const chained = event.payload.previous_response_id !== undefined;
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
        if (snapshot && !chained && Boolean(snapshot.inputPrefix) !== Boolean(inputPrefix)) return fatal();
        if (snapshot && !chained && codex && snapshot.responsesLite !== responsesLite) return fatal();
        validateTools(event.payload.tools);
        const manager = ctx.sessionManager;
        const nativeSessionId = manager.getSessionId();
        if (snapshot && snapshot.nativeSessionId !== nativeSessionId) return fatal();
        await resolveTransition(manager);
        if (!snapshot) {
          phase = "native-persistence";
          const historical = manager.getEntries().some(entry => entry.type === "message" && entry.message.role === "assistant");
          if (historical || typeof manager.ensureOnDisk !== "function") return fatal();
          await manager.ensureOnDisk();
          await syncNative(manager);
          // Clone once at capture. Native providers reuse mutable Tool-schema
          // objects internally; freezing those would break the next inference.
          const providerStatic = structuredClone(Object.fromEntries(Object.entries(event.payload).filter(([key, value]) => providerFields.has(key) && value !== undefined)));
          snapshot = { format: 2, api, nativeSessionId, calendar, providerStatic,
            ...(inputPrefix ? { inputPrefix: structuredClone(inputPrefix), responsesLite } : {}) };
          const payload = JSON.stringify(snapshot);
          phase = "durable-seal";
          const ack = await fetch(endpoint + "/seal", { method: "POST", headers: {
            ...auth, "x-native-session-id": nativeSessionId, "x-native-has-history": "false",
          }, body: payload, signal: AbortSignal.timeout(4500) });
          if (ack.status !== 200) return fatal();
          const receipt = await ack.json();
          if (receipt.digest !== createHash("sha256").update(payload).digest("hex")
            || !Number.isSafeInteger(receipt.epoch) || receipt.epoch < 1) return fatal();
          freeze(snapshot);
        }
        phase = "configuration";
        for (const field of configFields) {
          if (JSON.stringify(event.payload[field]) !== JSON.stringify(snapshot.providerStatic[field])) return fatal();
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
    const emitBeforeProviderRequest = ExtensionRunner.prototype.emitBeforeProviderRequest;
    if (typeof emitBeforeProviderRequest !== "function") return fatal();
    const protectedRunners = new WeakSet();
    ExtensionRunner.prototype.emitBeforeProviderRequest = async function(...args) {
      let seen = false;
      let count = 0;
      if (!Array.isArray(this.extensions) || this.extensions.length > 256) { phase = "hook-order"; return fatal(); }
      for (const extension of this.extensions) {
        for (const handler of extension.handlers.get("before_provider_request") ?? []) {
          if (seen || ++count > 2048) { phase = "hook-order"; return fatal(); }
          if (handler === providerGuard) seen = true;
        }
      }
      if (seen) protectedRunners.add(this);
      else if (protectedRunners.has(this)) { phase = "hook-order"; return fatal(); }
      return emitBeforeProviderRequest.apply(this, args);
    };
    // Native summarization uses the side stream, separate from the main agent's
    // before_provider_request hook. Do not replace its summarization envelope.
    const recoverBeforeInput = lifecycle(async (_event, ctx) => {
      phase = "ownership";
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
    await writeFile(ready, JSON.stringify({ nonce, codec: ${JSON.stringify(codec)} }), { mode: 0o600 });
  } catch { return fatal(); }
}
`;
}
