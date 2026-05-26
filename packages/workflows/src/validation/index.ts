export * from "./diagnostics.js";
export { validateJsonSchemaSubset, validateJsonValueAgainstSchema } from "./json-schema.js";
export type { JsonSchemaSubsetValidationOptions, WorkflowValueValidationOptions } from "./json-schema.js";

import { semanticJsonSchemasEqual, validateJsonSchemaSubset, validateJsonValueAgainstSchema } from "./json-schema.js";
import type { WorkflowValueValidationOptions } from "./json-schema.js";

import type {
  AdapterRef,
  GuardRef,
  PromptBuilderRef,
  RetryBackoffPolicy,
  RetryPolicy,
  ValidationResult,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowEdgeDefinition,
  WorkflowHumanActionRef,
  WorkflowNodeDefinition,
  WorkflowPort,
  WorkflowRegistry,
} from "../types/index.js";

export type WorkflowValidationOptions = {
  registry?: Partial<Pick<WorkflowRegistry, "adapters" | "guards" | "handlers" | "profiles" | "promptBuilders" | "humanActions">>;
};

export function validateWorkflow(definition: WorkflowDefinition, options: WorkflowValidationOptions = {}): ValidationResult {
  return validateWorkflowDefinitionSchemas(definition, options);
}

export function areWorkflowPortsDirectlyCompatible(source: WorkflowPort, target: WorkflowPort): boolean {
  if (source.kind !== target.kind) {
    return false;
  }

  if (source.kind === "text" && target.kind === "text") {
    return true;
  }

  if (source.kind === "json" && target.kind === "json") {
    return semanticJsonSchemasEqual(source.schema, target.schema);
  }

  return false;
}

export function validateWorkflowDefinitionSchemas(
  definition: WorkflowDefinition,
  options: WorkflowValidationOptions = {},
): ValidationResult {
  const diagnostics: WorkflowDiagnostic[] = [];

  validateWorkflowPort(definition.input, "$.input", diagnostics);
  validateWorkflowPort(definition.output, "$.output", diagnostics);

  validateWorkflowRetryPolicy(definition.retry, "$.retry", diagnostics);

  for (const [nodeId, node] of Object.entries(definition.nodes)) {
    validateNodeSchemas(nodeId, node, diagnostics);
    validateWorkflowRetryPolicy(node.retry, `$.nodes.${nodeId}.retry`, diagnostics, { nodeId });
    validateWorkflowAgentNodeRuntimeSelection(nodeId, node, diagnostics, options);
    validateWorkflowAgentNodePromptBuilderRef(nodeId, node, diagnostics, options);
    validateWorkflowCodeNodeRef(nodeId, node, diagnostics, options);
    validateWorkflowAdapterNodeRef(nodeId, node, diagnostics, options);
    validateWorkflowHumanActionRefs(nodeId, node, diagnostics, options);
    validateWorkflowNodeStateAccess(definition, nodeId, node, diagnostics);
  }

  validateWorkflowGlobalStateWriteConflicts(definition, diagnostics);
  validateWorkflowLoopPolicies(definition, diagnostics, options);
  validateWorkflowCycles(definition, diagnostics);

  for (const [edgeId, edge] of Object.entries(definition.edges)) {
    validateWorkflowEdgeNodeRefs(definition, edgeId, edge, diagnostics);
    validateWorkflowEdgeGuardRef(edgeId, edge, diagnostics, options);
    validateWorkflowEdgeAdapterRef(definition, edgeId, edge, diagnostics, options);
    validateWorkflowEdgePortCompatibility(definition, edgeId, edge, diagnostics);

    if (edge.adapter) {
      validateWorkflowPort(edge.adapter.output, `$.edges.${edgeId}.adapter.output`, diagnostics, { edgeId });
    }
  }

  if (definition.state?.global) {
    for (const [path, field] of Object.entries(definition.state.global)) {
      diagnostics.push(
        ...validateJsonSchemaSubset(field.schema, {
          path: `$.state.global.${path}.schema`,
          requireObjectRoot: false,
        }),
      );
    }
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}

export function validateWorkflowPort(
  port: WorkflowPort,
  path: string,
  diagnostics: WorkflowDiagnostic[],
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId"> = {},
): void {
  if (port.kind !== "json") {
    return;
  }

  diagnostics.push(
    ...validateJsonSchemaSubset(port.schema, {
      path: `${path}.schema`,
      requireObjectRoot: true,
    }).map((diagnostic) => ({ ...diagnostic, ...target })),
  );
}

export function validateWorkflowInput(
  definition: Pick<WorkflowDefinition, "input">,
  input: unknown,
  options: WorkflowValueValidationOptions = {},
): ValidationResult {
  return validateWorkflowPortValue(definition.input, input, {
    path: options.path ?? "$.input",
  });
}

export function validateWorkflowOutput(
  definition: Pick<WorkflowDefinition, "output">,
  output: unknown,
  options: WorkflowValueValidationOptions = {},
): ValidationResult {
  return validateWorkflowPortValue(definition.output, output, {
    path: options.path ?? "$.output",
  });
}

export function validateWorkflowGlobalState(
  definition: Pick<WorkflowDefinition, "state">,
  globalState: Record<string, unknown>,
  options: WorkflowValueValidationOptions = {},
): ValidationResult {
  const diagnostics: WorkflowDiagnostic[] = [];
  const pathPrefix = options.path ?? "$.state.global";

  for (const [path, field] of Object.entries(definition.state?.global ?? {})) {
    if (!(path in globalState)) {
      continue;
    }

    diagnostics.push(
      ...validateJsonValueAgainstSchema(field.schema, globalState[path], {
        path: `${pathPrefix}.${path}`,
      }),
    );
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}

export function validateNodeOutput(
  definition: Pick<WorkflowDefinition, "nodes">,
  nodeId: string,
  output: unknown,
  options: WorkflowValueValidationOptions = {},
): ValidationResult {
  const node = definition.nodes[nodeId];
  if (!node) {
    const diagnostics: WorkflowDiagnostic[] = [
      {
        code: "WorkflowInterfaceError.unknownNode",
        message: `Workflow node '${nodeId}' does not exist, so its output cannot be validated.`,
        severity: "error",
        nodeId,
        path: `$.nodes.${nodeId}`,
        hint: "Validate outputs only for node ids declared in the workflow definition.",
      },
    ];
    return { ok: false, diagnostics };
  }

  if (!node.output) {
    return { ok: true, diagnostics: [] };
  }

  return withDiagnosticTarget(
    validateWorkflowPortValue(node.output, output, {
      path: options.path ?? `$.nodes.${nodeId}.output`,
    }),
    { nodeId },
  );
}

export function validateWorkflowEdgeAdapterOutput(
  definition: Pick<WorkflowDefinition, "nodes" | "edges">,
  edgeId: string,
  output: unknown,
  options: WorkflowValueValidationOptions = {},
): ValidationResult {
  const diagnostics: WorkflowDiagnostic[] = [];
  const edge = definition.edges[edgeId];

  if (!edge) {
    diagnostics.push({
      code: "WorkflowInterfaceError.unknownEdge",
      message: `Workflow edge '${edgeId}' does not exist, so its adapter output cannot be validated.`,
      severity: "error",
      edgeId,
      path: `$.edges.${edgeId}`,
      hint: "Validate adapter outputs only for edge ids declared in the workflow definition.",
    });
    return { ok: false, diagnostics };
  }

  if (!edge.adapter) {
    diagnostics.push({
      code: "WorkflowInterfaceError.edgeAdapterExpected",
      message: `Workflow edge '${edgeId}' does not declare an adapter output port.`,
      severity: "error",
      edgeId,
      path: `$.edges.${edgeId}.adapter`,
      hint: "Call validateWorkflowEdgeAdapterOutput only for edges that declare edgeAdapter(...).",
    });
    return { ok: false, diagnostics };
  }

  const adapterOutputPath = options.path ?? `$.edges.${edgeId}.adapter.outputValue`;
  diagnostics.push(
    ...validateWorkflowPortValue(edge.adapter.output, output, {
      path: adapterOutputPath,
    }).diagnostics.map((diagnostic) => ({ ...diagnostic, edgeId })),
  );

  const targetNode = definition.nodes[edge.to.nodeId];
  if (!targetNode) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownTargetNode",
      message: `Workflow edge '${edgeId}' references missing target node '${edge.to.nodeId}'.`,
      severity: "error",
      edgeId,
      nodeId: edge.to.nodeId,
      path: `$.edges.${edgeId}.to.nodeId`,
      hint: "Validate adapter outputs only after graph validation has accepted target node references.",
    });
  } else if (targetNode.input) {
    diagnostics.push(
      ...validateWorkflowPortValue(targetNode.input, output, {
        path: `$.edges.${edgeId}.targetInput`,
      }).diagnostics.map((diagnostic) => ({ ...diagnostic, edgeId, nodeId: edge.to.nodeId })),
    );
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}

export function validateWorkflowPortValue(
  port: WorkflowPort,
  value: unknown,
  options: WorkflowValueValidationOptions = {},
): ValidationResult {
  const path = options.path ?? "$.value";
  const diagnostics: WorkflowDiagnostic[] = [];

  if (port.kind === "text") {
    if (typeof value !== "string") {
      diagnostics.push({
        code: "WorkflowInterfaceError.textValueExpected",
        message: "Text workflow ports require a string value.",
        severity: "error",
        path,
        hint: "Pass a string for text ports, or change the port to json(...) with an explicit schema.",
      });
    }
  } else {
    validateWorkflowPort(port, path, diagnostics);
    diagnostics.push(
      ...validateJsonValueAgainstSchema(port.schema, value, {
        path,
      }),
    );
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}

function validateWorkflowRetryPolicy(
  policy: RetryPolicy | undefined,
  path: string,
  diagnostics: WorkflowDiagnostic[],
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId"> = {},
): void {
  if (policy === undefined) {
    return;
  }

  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    diagnostics.push({
      code: "WorkflowRetryError.invalidMaxAttempts",
      message: "Workflow retry policies must declare maxAttempts as a positive integer.",
      severity: "error",
      ...target,
      path: `${path}.maxAttempts`,
      hint: "Set maxAttempts to the total number of attempts allowed, for example maxAttempts: 3.",
    });
  }

  if (policy.backoff !== undefined) {
    validateWorkflowRetryBackoffPolicy(policy.backoff, `${path}.backoff`, diagnostics, target);
  }

  if (policy.retryOn !== undefined) {
    if (!Array.isArray(policy.retryOn)) {
      diagnostics.push({
        code: "WorkflowRetryError.invalidRetryOn",
        message: "Workflow retry policy retryOn must be an array of non-empty error code strings.",
        severity: "error",
        ...target,
        path: `${path}.retryOn`,
        hint: "Use retryOn: ['WorkflowRuntimeError.transient'] or omit retryOn to retry all retryable errors until maxAttempts.",
      });
      return;
    }

    policy.retryOn.forEach((code, index) => {
      if (typeof code !== "string" || code.length === 0) {
        diagnostics.push({
          code: "WorkflowRetryError.invalidRetryOn",
          message: "Workflow retry policy retryOn entries must be non-empty error code strings.",
          severity: "error",
          ...target,
          path: `${path}.retryOn.${index}`,
          hint: "Use stable error codes such as 'WorkflowRuntimeError.timeout'.",
        });
      }
    });
  }
}

function validateWorkflowRetryBackoffPolicy(
  backoff: RetryBackoffPolicy,
  path: string,
  diagnostics: WorkflowDiagnostic[],
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId">,
): void {
  if (!isRecord(backoff)) {
    diagnostics.push({
      code: "WorkflowRetryError.invalidBackoffPolicy",
      message: "Workflow retry backoff policy must be an object.",
      severity: "error",
      ...target,
      path,
      hint: "Use { kind: 'none' }, { kind: 'fixed', delayMs }, { kind: 'linear', initialMs, stepMs }, or { kind: 'exponential', initialMs }.",
    });
    return;
  }

  switch (backoff.kind) {
    case "none":
      return;
    case "fixed":
      validateNonNegativeNumber(backoff.delayMs, `${path}.delayMs`, "delayMs", diagnostics, target);
      return;
    case "linear":
      validateNonNegativeNumber(backoff.initialMs, `${path}.initialMs`, "initialMs", diagnostics, target);
      validateNonNegativeNumber(backoff.stepMs, `${path}.stepMs`, "stepMs", diagnostics, target);
      validateOptionalNonNegativeNumber(backoff.maxMs, `${path}.maxMs`, "maxMs", diagnostics, target);
      return;
    case "exponential":
      validateNonNegativeNumber(backoff.initialMs, `${path}.initialMs`, "initialMs", diagnostics, target);
      if (backoff.factor !== undefined && (typeof backoff.factor !== "number" || backoff.factor <= 1)) {
        diagnostics.push({
          code: "WorkflowRetryError.invalidBackoffPolicy",
          message: "Workflow exponential retry backoff factor must be greater than 1 when declared.",
          severity: "error",
          ...target,
          path: `${path}.factor`,
          hint: "Omit factor to use the runtime default, or set factor to a number greater than 1.",
        });
      }
      validateOptionalNonNegativeNumber(backoff.maxMs, `${path}.maxMs`, "maxMs", diagnostics, target);
      return;
    default:
      diagnostics.push({
        code: "WorkflowRetryError.invalidBackoffPolicy",
        message: "Workflow retry backoff policy kind is not supported.",
        severity: "error",
        ...target,
        path: `${path}.kind`,
        hint: "Use backoff kind 'none', 'fixed', 'linear', or 'exponential'.",
      });
  }
}

function validateNonNegativeNumber(
  value: unknown,
  path: string,
  field: string,
  diagnostics: WorkflowDiagnostic[],
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId">,
): void {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return;
  }

  diagnostics.push({
    code: "WorkflowRetryError.invalidBackoffPolicy",
    message: `Workflow retry backoff ${field} must be a non-negative number.`,
    severity: "error",
    ...target,
    path,
    hint: "Use millisecond delays greater than or equal to 0.",
  });
}

function validateOptionalNonNegativeNumber(
  value: unknown,
  path: string,
  field: string,
  diagnostics: WorkflowDiagnostic[],
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId">,
): void {
  if (value === undefined) {
    return;
  }

  validateNonNegativeNumber(value, path, field, diagnostics, target);
}

function validateWorkflowLoopPolicies(
  definition: Pick<WorkflowDefinition, "edges" | "loops">,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  for (const [index, loop] of definition.loops?.entries() ?? []) {
    const path = `$.loops.${index}`;
    const edgeId = loop.edgeId;
    const edge = edgeId ? definition.edges[edgeId] : undefined;

    if (typeof edgeId !== "string" || edgeId.length === 0) {
      diagnostics.push({
        code: "WorkflowGraphError.invalidLoopPolicy",
        message: "Workflow loop policies must reference the explicit back-edge by edgeId.",
        severity: "error",
        path: `${path}.edgeId`,
        hint: "Set loops[n].edgeId to the id of the guarded back-edge this policy bounds.",
      });
    } else if (!edge) {
      diagnostics.push({
        code: "WorkflowGraphError.unknownLoopEdge",
        message: `Workflow loop policy references missing edge '${edgeId}'.`,
        severity: "error",
        edgeId,
        path: `${path}.edgeId`,
        hint: "Point the loop policy at an existing back-edge in workflow.edges.",
      });
    }

    if (!Number.isInteger(loop.maxAttempts) || loop.maxAttempts < 1) {
      diagnostics.push({
        code: "WorkflowRetryError.invalidMaxAttempts",
        message: "Workflow loop policies must declare maxAttempts as a positive integer.",
        severity: "error",
        edgeId: typeof edgeId === "string" ? edgeId : undefined,
        path: `${path}.maxAttempts`,
        hint: "Set maxAttempts to the maximum number of times this back-edge may be traversed.",
      });
    }

    const guard = loop.guard ?? edge?.guard;
    if (!guard) {
      diagnostics.push({
        code: "WorkflowGraphError.unboundedBackEdge",
        message: `Workflow loop policy${edgeId ? ` for edge '${edgeId}'` : ""} must declare a guard on the loop policy or edge.`,
        severity: "error",
        edgeId: typeof edgeId === "string" ? edgeId : undefined,
        path,
        hint: "Back-edges must be explicit, guarded, and bounded with maxAttempts so review/fix loops cannot run freely.",
      });
    } else {
      validateWorkflowGuardRef(guard, diagnostics, options, {
        edgeId: typeof edgeId === "string" ? edgeId : undefined,
        path: loop.guard ? `${path}.guard.handler` : `$.edges.${edgeId}.guard.handler`,
        ownerLabel: `Workflow loop policy${edgeId ? ` for edge '${edgeId}'` : ""}`,
      });
    }
  }
}

function validateWorkflowCycles(
  definition: Pick<WorkflowDefinition, "nodes" | "edges" | "loops">,
  diagnostics: WorkflowDiagnostic[],
): void {
  const boundedLoopEdgeIds = collectBoundedLoopEdgeIds(definition);
  const adjacency = new Map<string, Array<{ edgeId: string; targetNodeId: string }>>();

  for (const nodeId of Object.keys(definition.nodes)) {
    adjacency.set(nodeId, []);
  }

  for (const [edgeId, edge] of Object.entries(definition.edges)) {
    if (boundedLoopEdgeIds.has(edgeId)) {
      continue;
    }

    if (!Object.hasOwn(definition.nodes, edge.from.nodeId) || !Object.hasOwn(definition.nodes, edge.to.nodeId)) {
      continue;
    }

    adjacency.get(edge.from.nodeId)?.push({ edgeId, targetNodeId: edge.to.nodeId });
  }

  const visitState = new Map<string, "visiting" | "visited">();
  const pathNodes: string[] = [];
  const pathEdges: string[] = [];
  const reportedCycles = new Set<string>();

  const visit = (nodeId: string): void => {
    visitState.set(nodeId, "visiting");
    pathNodes.push(nodeId);

    for (const { edgeId, targetNodeId } of adjacency.get(nodeId) ?? []) {
      const targetState = visitState.get(targetNodeId);
      if (targetState === "visiting") {
        const cycleStartIndex = pathNodes.indexOf(targetNodeId);
        const cycleEdgeIds = cycleStartIndex >= 0 ? [...pathEdges.slice(cycleStartIndex), edgeId] : [edgeId];
        const cycleKey = [...cycleEdgeIds].sort().join("\u0000");
        if (reportedCycles.has(cycleKey)) {
          continue;
        }

        reportedCycles.add(cycleKey);
        const cycleNodeIds = cycleStartIndex >= 0 ? [...pathNodes.slice(cycleStartIndex), targetNodeId] : [nodeId, targetNodeId];
        diagnostics.push({
          code: "WorkflowGraphError.unboundedCycle",
          message: `Workflow contains an unbounded cycle through nodes '${cycleNodeIds.join(" -> ")}'.`,
          severity: "error",
          edgeId,
          path: `$.edges.${edgeId}`,
          hint: `Declare one cycle edge as a guarded loop policy with maxAttempts, for example loops: [{ edgeId: '${edgeId}', maxAttempts: 3, guard: ... }].`,
        });
        continue;
      }

      if (targetState === "visited") {
        continue;
      }

      pathEdges.push(edgeId);
      visit(targetNodeId);
      pathEdges.pop();
    }

    pathNodes.pop();
    visitState.set(nodeId, "visited");
  };

  for (const nodeId of Object.keys(definition.nodes)) {
    if (!visitState.has(nodeId)) {
      visit(nodeId);
    }
  }
}

function collectBoundedLoopEdgeIds(definition: Pick<WorkflowDefinition, "edges" | "loops">): Set<string> {
  const edgeIds = new Set<string>();

  for (const loop of definition.loops ?? []) {
    const edge = definition.edges[loop.edgeId];
    const guard = loop.guard ?? edge?.guard;
    if (edge && Number.isInteger(loop.maxAttempts) && loop.maxAttempts > 0 && isValidGuardRef(guard)) {
      edgeIds.add(loop.edgeId);
    }
  }

  return edgeIds;
}

function isValidGuardRef(guard: GuardRef | undefined): guard is GuardRef {
  return isRecord(guard) && typeof guard.handler === "string" && guard.handler.length > 0;
}

function validateWorkflowEdgeGuardRef(
  edgeId: string,
  edge: WorkflowEdgeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (!edge.guard) {
    return;
  }

  validateWorkflowGuardRef(edge.guard, diagnostics, options, {
    edgeId,
    path: `$.edges.${edgeId}.guard.handler`,
    ownerLabel: `Workflow edge '${edgeId}'`,
  });
}

function validateWorkflowGuardRef(
  guard: GuardRef,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
  target: Pick<WorkflowDiagnostic, "edgeId"> & { path: string; ownerLabel: string },
): void {
  if (!isRecord(guard) || typeof guard.handler !== "string" || guard.handler.length === 0) {
    diagnostics.push({
      code: "WorkflowGraphError.invalidGuardRef",
      message: `${target.ownerLabel} must use a registered guard handler ref.`,
      severity: "error",
      edgeId: target.edgeId,
      path: target.path,
      hint: "Use guard: { handler: 'guard.id' } with a non-empty registered guard id.",
    });
    return;
  }

  if (guard.priority !== undefined && (!Number.isInteger(guard.priority) || guard.priority < 0)) {
    diagnostics.push({
      code: "WorkflowGraphError.invalidGuardPriority",
      message: `${target.ownerLabel} guard priority must be a non-negative integer when declared.`,
      severity: "error",
      edgeId: target.edgeId,
      path: target.path.replace(/\.handler$/, ".priority"),
      hint: "Use priority to make multiple guarded outgoing edges deterministic.",
    });
  }

  if (!options.registry?.guards || options.registry.guards.has(guard.handler)) {
    return;
  }

  diagnostics.push({
    code: "WorkflowGraphError.unknownGuardRef",
    message: `${target.ownerLabel} references guard '${guard.handler}', but it is not registered in the Workflow Registry.`,
    severity: "error",
    edgeId: target.edgeId,
    path: target.path,
    registryRef: guard.handler,
    hint: "Register the guard with registerWorkflowGuard/createWorkflowRegistry before validating or executing this workflow, or update the workflow to use a registered guard id.",
  });
}

function validateWorkflowEdgeNodeRefs(
  definition: Pick<WorkflowDefinition, "nodes">,
  edgeId: string,
  edge: WorkflowEdgeDefinition,
  diagnostics: WorkflowDiagnostic[],
): void {
  if (!Object.hasOwn(definition.nodes, edge.from.nodeId)) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownSourceNode",
      message: `Workflow edge '${edgeId}' references missing source node '${edge.from.nodeId}'.`,
      severity: "error",
      edgeId,
      nodeId: edge.from.nodeId,
      path: `$.edges.${edgeId}.from.nodeId`,
      hint: "Update the edge source to reference a declared workflow node id, or add the missing node to the workflow definition.",
    });
  }

  if (!Object.hasOwn(definition.nodes, edge.to.nodeId)) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownTargetNode",
      message: `Workflow edge '${edgeId}' references missing target node '${edge.to.nodeId}'.`,
      severity: "error",
      edgeId,
      nodeId: edge.to.nodeId,
      path: `$.edges.${edgeId}.to.nodeId`,
      hint: "Update the edge target to reference a declared workflow node id, or add the missing node to the workflow definition.",
    });
  }
}

function validateWorkflowEdgeAdapterRef(
  definition: Pick<WorkflowDefinition, "nodes">,
  edgeId: string,
  edge: WorkflowEdgeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (!edge.adapter) {
    return;
  }

  if (!isRegisteredAdapterRef(edge.adapter.transform)) {
    diagnostics.push({
      code: "WorkflowGraphError.invalidAdapterRef",
      message: `Workflow edge '${edgeId}' must use a registered TypeScript adapter ref for its edge adapter transform.`,
      severity: "error",
      edgeId,
      path: `$.edges.${edgeId}.adapter.transform`,
      hint: "Create edge adapters with edgeAdapter(adapterRef('adapter.id'), outputPort) so persisted workflow IR stores an explicit adapter ref instead of an inline or raw handler value.",
    });
  } else {
    validateRegisteredAdapterExists(edge.adapter.transform, diagnostics, options, {
      edgeId,
      path: `$.edges.${edgeId}.adapter.transform.id`,
      ownerLabel: `Workflow edge '${edgeId}'`,
    });
  }

  const targetNode = definition.nodes[edge.to.nodeId];
  if (!targetNode?.input) {
    return;
  }

  if (areWorkflowPortsDirectlyCompatible(edge.adapter.output, targetNode.input)) {
    return;
  }

  diagnostics.push({
    code: "WorkflowGraphError.incompatibleEdgeAdapterOutput",
    message: `Workflow edge '${edgeId}' declares an adapter output that is incompatible with the target input port.`,
    severity: "error",
    edgeId,
    path: `$.edges.${edgeId}.adapter.output`,
    hint: "Set the edgeAdapter output port to the exact target input contract, or insert a visible adapter node whose output matches the downstream node.",
  });
}

function validateWorkflowAgentNodeRuntimeSelection(
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (node.kind !== "agent") {
    return;
  }

  const rawNode = node as unknown as Record<string, unknown>;
  if (rawNode.runtime !== "pibo") {
    diagnostics.push({
      code: "WorkflowGraphError.invalidAgentRuntimeSelection",
      message: `Workflow agent node '${nodeId}' must select the Pibo Runtime in V1.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.runtime`,
      hint: "Set runtime: 'pibo'. V1 workflow agent nodes cannot select alternate runtimes.",
    });
  }

  const profile = rawNode.profile;
  const profileId =
    isRecord(profile) && profile.kind === "fixed" && typeof profile.id === "string" && profile.id.length > 0
      ? profile.id
      : undefined;

  if (!profileId) {
    diagnostics.push({
      code: "WorkflowGraphError.invalidAgentProfileSelection",
      message: `Workflow agent node '${nodeId}' must select a fixed Agent Designer profile in V1.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.profile`,
      hint: "Use fixedProfile('pibo-agent') or { kind: 'fixed', id: 'profile-id' }. Dynamic profile selection is not supported in V1.",
    });
    return;
  }

  if (!options.registry?.profiles) {
    return;
  }

  const registeredProfile = options.registry.profiles.get(profileId);
  if (!registeredProfile) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownAgentProfileRef",
      message: `Workflow agent node '${nodeId}' references Agent Designer profile '${profileId}', but it is not registered in the Workflow Registry.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.profile.id`,
      registryRef: profileId,
      hint: "Register the Agent Designer profile with registerWorkflowAgentProfile/createWorkflowRegistry before validating or executing this workflow, or update the node to use a registered fixed profile id.",
    });
    return;
  }

  if (isArchivedAgentProfileDefinition(registeredProfile.value)) {
    diagnostics.push({
      code: "WorkflowGraphError.archivedAgentProfileRef",
      message: `Workflow agent node '${nodeId}' references archived Agent Designer profile '${profileId}'.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.profile.id`,
      registryRef: profileId,
      hint: "Restore the Agent Designer profile or update the node to select a non-archived fixed profile id before publishing or running this workflow.",
    });
  }
}

function isArchivedAgentProfileDefinition(profile: { status?: string; archivedAt?: string; metadata?: unknown }): boolean {
  if (profile.status === "archived" || typeof profile.archivedAt === "string") {
    return true;
  }

  if (!isRecord(profile.metadata)) {
    return false;
  }

  return profile.metadata.archived === true || typeof profile.metadata.archivedAt === "string";
}

function validateWorkflowAgentNodePromptBuilderRef(
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (node.kind !== "agent") {
    return;
  }

  if (node.promptTemplate !== undefined && node.promptBuilder !== undefined) {
    diagnostics.push({
      code: "WorkflowGraphError.ambiguousAgentPromptSource",
      message: `Workflow agent node '${nodeId}' declares both promptTemplate and promptBuilder.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}`,
      hint: "Declare exactly one prompt source for variable prompts: use promptTemplate for fixed templates or promptBuilder for a registered TypeScript prompt builder.",
    });
  }

  if (node.promptBuilder === undefined) {
    return;
  }

  const builderId = getPromptBuilderRefId(node.promptBuilder);
  if (!builderId) {
    diagnostics.push({
      code: "WorkflowGraphError.invalidPromptBuilderRef",
      message: `Workflow agent node '${nodeId}' must use a registered TypeScript prompt builder ref when promptBuilder is declared.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.promptBuilder`,
      hint: "Use promptBuilderRef('prompt.builder.id') or a non-empty registered prompt builder id.",
    });
    return;
  }

  if (!options.registry?.promptBuilders || options.registry.promptBuilders.has(builderId)) {
    return;
  }

  diagnostics.push({
    code: "WorkflowGraphError.unknownPromptBuilderRef",
    message: `Workflow agent node '${nodeId}' references prompt builder '${builderId}', but it is not registered in the Workflow Registry.`,
    severity: "error",
    nodeId,
    path: getPromptBuilderRefPath(node.promptBuilder, nodeId),
    registryRef: builderId,
    hint: "Register the prompt builder with registerWorkflowPromptBuilder/createWorkflowRegistry before validating or executing this workflow, or update the node to use a registered prompt builder id.",
  });
}

function getPromptBuilderRefId(ref: PromptBuilderRef): string | undefined {
  if (typeof ref === "string") {
    return ref.length > 0 ? ref : undefined;
  }

  if (!isRecord(ref)) {
    return undefined;
  }

  const id = ref.id;
  return ref.kind === "promptBuilder" && ref.language === "typescript" && typeof id === "string" && id.length > 0
    ? id
    : undefined;
}

function getPromptBuilderRefPath(ref: PromptBuilderRef, nodeId: string): string {
  return typeof ref === "string" ? `$.nodes.${nodeId}.promptBuilder` : `$.nodes.${nodeId}.promptBuilder.id`;
}

function validateWorkflowCodeNodeRef(
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (node.kind !== "code") {
    return;
  }

  if (!options.registry?.handlers || options.registry.handlers.has(node.handler)) {
    return;
  }

  diagnostics.push({
    code: "WorkflowGraphError.unknownHandlerRef",
    message: `Workflow code node '${nodeId}' references handler '${node.handler}', but it is not registered in the Workflow Registry.`,
    severity: "error",
    nodeId,
    path: `$.nodes.${nodeId}.handler`,
    registryRef: node.handler,
    hint: "Register the handler with registerWorkflowHandler/createWorkflowRegistry before validating or executing this workflow, or update the workflow to use a registered handler id.",
  });
}

function validateWorkflowAdapterNodeRef(
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (node.kind !== "adapter") {
    return;
  }

  if (!isRegisteredAdapterRef(node.handler)) {
    diagnostics.push({
      code: "WorkflowGraphError.invalidAdapterRef",
      message: `Workflow adapter node '${nodeId}' must use a registered TypeScript adapter ref for its handler.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.handler`,
      hint: "Create adapter nodes with handler: adapterRef('adapter.id') so persisted workflow IR stores an explicit adapter ref instead of an inline or raw handler value.",
    });
    return;
  }

  validateRegisteredAdapterExists(node.handler, diagnostics, options, {
    nodeId,
    path: `$.nodes.${nodeId}.handler.id`,
    ownerLabel: `Workflow adapter node '${nodeId}'`,
  });
}

function validateWorkflowHumanActionRefs(
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (node.kind !== "human" || !node.actions) {
    return;
  }

  node.actions.forEach((action, index) => {
    const path = `$.nodes.${nodeId}.actions.${index}`;
    const actionId = getHumanActionRefId(action);
    if (!actionId) {
      diagnostics.push({
        code: "WorkflowGraphError.invalidHumanActionRef",
        message: `Workflow human node '${nodeId}' declares an invalid human action ref at index ${index}.`,
        severity: "error",
        nodeId,
        path,
        hint: "Human action refs must contain a non-empty registry action id.",
      });
      return;
    }

    const registered = options.registry?.humanActions?.get(actionId);
    if (options.registry?.humanActions && !registered) {
      diagnostics.push({
        code: "WorkflowGraphError.unknownHumanActionRef",
        message: `Workflow human node '${nodeId}' references human action '${actionId}', but it is not registered in the Workflow Registry.`,
        severity: "error",
        nodeId,
        path: `${path}.id`,
        registryRef: actionId,
        hint: "Register approve/reject/resume/cancel or custom actions with registerWorkflowHumanAction/createWorkflowRegistry before validating the workflow.",
      });
      return;
    }

    if (registered && action.kind && registered.kind !== action.kind) {
      diagnostics.push({
        code: "WorkflowGraphError.humanActionKindMismatch",
        message: `Workflow human node '${nodeId}' action '${actionId}' declares kind '${action.kind}', but the registry defines kind '${registered.kind}'.`,
        severity: "error",
        nodeId,
        path: `${path}.kind`,
        registryRef: actionId,
        hint: "Keep wait-token action refs aligned with their registered action definitions.",
      });
    }
  });
}

function getHumanActionRefId(ref: WorkflowHumanActionRef): string | undefined {
  return ref && typeof ref.id === "string" && ref.id.length > 0 ? ref.id : undefined;
}

function validateRegisteredAdapterExists(
  ref: AdapterRef,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId"> & { path: string; ownerLabel: string },
): void {
  if (!options.registry?.adapters || options.registry.adapters.has(ref.id)) {
    return;
  }

  diagnostics.push({
    code: "WorkflowGraphError.unknownAdapterRef",
    message: `${target.ownerLabel} references adapter '${ref.id}', but it is not registered in the Workflow Registry.`,
    severity: "error",
    nodeId: target.nodeId,
    edgeId: target.edgeId,
    path: target.path,
    registryRef: ref.id,
    hint: "Register the adapter with registerWorkflowAdapter/createWorkflowRegistry before validating or executing this workflow, or update the workflow to use a registered adapter id.",
  });
}

function validateWorkflowEdgePortCompatibility(
  definition: Pick<WorkflowDefinition, "nodes">,
  edgeId: string,
  edge: WorkflowEdgeDefinition,
  diagnostics: WorkflowDiagnostic[],
): void {
  if (edge.adapter) {
    return;
  }

  const sourceNode = definition.nodes[edge.from.nodeId];
  const targetNode = definition.nodes[edge.to.nodeId];
  if (!sourceNode || !targetNode || !sourceNode.output || !targetNode.input) {
    return;
  }

  if (areWorkflowPortsDirectlyCompatible(sourceNode.output, targetNode.input)) {
    return;
  }

  diagnostics.push({
    code: "WorkflowGraphError.incompatibleEdgePorts",
    message: `Workflow edge '${edgeId}' connects incompatible source output and target input ports.`,
    severity: "error",
    edgeId,
    path: `$.edges.${edgeId}`,
    hint: "Use matching text ports, use JSON ports with the same schema contract, or add an explicit edgeAdapter/adapter node to transform the payload.",
  });
}

function validateWorkflowNodeStateAccess(
  definition: Pick<WorkflowDefinition, "state">,
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
): void {
  if (node.state === undefined) {
    return;
  }

  validateNodeStateAccessList(definition, nodeId, node.state.reads, "reads", diagnostics);
  validateNodeStateAccessList(definition, nodeId, node.state.writes, "writes", diagnostics);
}

function validateWorkflowGlobalStateWriteConflicts(
  definition: Pick<WorkflowDefinition, "nodes" | "state">,
  diagnostics: WorkflowDiagnostic[],
): void {
  const writersByPath = new Map<string, Set<string>>();

  for (const [nodeId, node] of Object.entries(definition.nodes)) {
    for (const writePath of node.state?.writes ?? []) {
      if (typeof writePath !== "string") {
        continue;
      }

      const scopedPath = parseScopedStatePath(writePath);
      if (scopedPath?.scope !== "global" || !definition.state?.global?.[scopedPath.path]) {
        continue;
      }

      const writers = writersByPath.get(scopedPath.path) ?? new Set<string>();
      writers.add(nodeId);
      writersByPath.set(scopedPath.path, writers);
    }
  }

  for (const [statePath, writers] of writersByPath) {
    const field = definition.state?.global?.[statePath];
    if (!field || field.merge || writers.size <= 1) {
      continue;
    }

    diagnostics.push({
      code: "WorkflowStateError.ambiguousConcurrentGlobalStateWrite",
      message: `Workflow global state path '${statePath}' is written by multiple nodes without an explicit merge policy.`,
      severity: "error",
      path: `$.state.global.${statePath}`,
      statePath,
      hint: `Declare state.global['${statePath}'].merge, or ensure only one node writes '${statePath}'. Writers: ${[
        ...writers,
      ].join(", ")}.`,
    });
  }
}

function validateNodeStateAccessList(
  definition: Pick<WorkflowDefinition, "state">,
  nodeId: string,
  values: unknown,
  direction: "reads" | "writes",
  diagnostics: WorkflowDiagnostic[],
): void {
  if (values === undefined) {
    return;
  }

  if (!Array.isArray(values)) {
    diagnostics.push({
      code: "WorkflowStateError.invalidStateAccessDeclaration",
      message: `Workflow node '${nodeId}' state.${direction} must be an array of scoped state paths.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.state.${direction}`,
      hint: "Declare state access as strings such as 'global.projectGoal', 'local.draft', or 'edge.previous'.",
    });
    return;
  }

  values.forEach((value, index) => {
    const path = `$.nodes.${nodeId}.state.${direction}.${index}`;
    if (typeof value !== "string") {
      diagnostics.push({
        code: "WorkflowStateError.invalidStateAccessDeclaration",
        message: `Workflow node '${nodeId}' state.${direction} entry must be a scoped state path string.`,
        severity: "error",
        nodeId,
        path,
        hint: "Use scoped paths like 'global.projectGoal', 'local.draft', or 'edge.previous'.",
      });
      return;
    }

    const scopedPath = parseScopedStatePath(value);
    if (!scopedPath) {
      diagnostics.push({
        code: "WorkflowStateError.invalidStatePath",
        message: `Workflow node '${nodeId}' declares invalid ${direction} state path '${value}'.`,
        severity: "error",
        nodeId,
        path,
        statePath: value,
        hint: "State paths must be scoped as 'global.<path>', 'local.<path>', or 'edge.<path>' with a non-empty path.",
      });
      return;
    }

    if (direction === "writes" && scopedPath.scope === "edge") {
      diagnostics.push({
        code: "WorkflowStateError.edgeStateWriteNotAllowed",
        message: `Workflow node '${nodeId}' declares a write to immutable edge payload path '${value}'.`,
        severity: "error",
        nodeId,
        path,
        statePath: value,
        hint: "Edge payloads are immutable after transfer; write to 'global.<path>' or current-node 'local.<path>' instead.",
      });
    }

    if (scopedPath.scope === "global" && !definition.state?.global?.[scopedPath.path]) {
      diagnostics.push({
        code: "WorkflowStateError.unknownGlobalStatePath",
        message: `Workflow node '${nodeId}' declares ${direction} access to unknown global state path '${scopedPath.path}'.`,
        severity: "error",
        nodeId,
        path,
        statePath: value,
        hint: `Declare state.global['${scopedPath.path}'] with a schema before a node can read or write it.`,
      });
    }
  });
}

function parseScopedStatePath(value: string): { scope: "global" | "local" | "edge"; path: string } | undefined {
  const separatorIndex = value.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return undefined;
  }

  const scope = value.slice(0, separatorIndex);
  const path = value.slice(separatorIndex + 1);
  if (scope !== "global" && scope !== "local" && scope !== "edge") {
    return undefined;
  }

  if (path.split(".").some((segment) => segment.length === 0)) {
    return undefined;
  }

  return { scope, path };
}

function validateNodeSchemas(
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
): void {
  if (node.input) {
    validateWorkflowPort(node.input, `$.nodes.${nodeId}.input`, diagnostics, { nodeId });
  }

  if (node.output) {
    validateWorkflowPort(node.output, `$.nodes.${nodeId}.output`, diagnostics, { nodeId });
  }

  if (node.kind === "human" && node.schema) {
    diagnostics.push(
      ...validateJsonSchemaSubset(node.schema, {
        path: `$.nodes.${nodeId}.schema`,
        requireObjectRoot: true,
      }).map((diagnostic) => ({ ...diagnostic, nodeId })),
    );
  }
}

function isRegisteredAdapterRef(value: unknown): value is AdapterRef {
  return (
    isRecord(value) &&
    value.kind === "adapter" &&
    value.language === "typescript" &&
    typeof value.id === "string" &&
    value.id.length > 0
  );
}

function withDiagnosticTarget(
  result: ValidationResult,
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId">,
): ValidationResult {
  const diagnostics = result.diagnostics.map((diagnostic) => ({ ...diagnostic, ...target }));
  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
