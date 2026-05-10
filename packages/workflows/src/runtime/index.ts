import type {
  AgentNodeDefinition,
  NodeAttempt,
  NodeAttemptId,
  RuntimeSelectionMetadata,
  ValidationResult,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowRun,
  WorkflowRunId,
  WorkflowRuntimeEvent,
  WorkflowValue,
} from "../types/index.js";
import { validateNodeOutput, validateWorkflow, validateWorkflowInput, validateWorkflowOutput } from "../validation/index.js";

export type OneNodeAgentExecutorContext = {
  workflow: WorkflowDefinition;
  run: WorkflowRun;
  nodeId: string;
  node: AgentNodeDefinition;
  input: WorkflowValue;
  prompt: string;
  profileId: string;
  routing?: AgentNodeDefinition["routing"];
};

export type OneNodeAgentExecutorResult = {
  output: WorkflowValue;
  piboSessionId?: string;
  piSessionId?: string;
  effectiveProfile?: string;
  effectiveTools?: string[];
  effectiveSkills?: string[];
  effectiveContextFiles?: string[];
};

export type OneNodeAgentExecutor = (
  context: OneNodeAgentExecutorContext,
) => Promise<OneNodeAgentExecutorResult> | OneNodeAgentExecutorResult;

export type OneNodeAgentWorkflowOptions = {
  ownerScope?: string;
  now?: () => Date | string;
  createRunId?: () => WorkflowRunId;
  createNodeAttemptId?: () => NodeAttemptId;
  agentExecutor: OneNodeAgentExecutor;
};

export type OneNodeAgentWorkflowSuccess = {
  ok: true;
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  output: WorkflowValue;
};

export type OneNodeAgentWorkflowFailure = {
  ok: false;
  run?: WorkflowRun;
  nodeAttempt?: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

export type OneNodeAgentWorkflowResult = OneNodeAgentWorkflowSuccess | OneNodeAgentWorkflowFailure;

export function validateOneNodeAgentWorkflowPath(definition: WorkflowDefinition): ValidationResult {
  const diagnostics: WorkflowDiagnostic[] = [...validateWorkflow(definition).diagnostics];
  const nodeEntries = Object.entries(definition.nodes);

  if (nodeEntries.length !== 1) {
    diagnostics.push({
      code: "WorkflowRuntimeError.oneNodeAgentRequired",
      message: "The one-node agent workflow path requires exactly one node.",
      severity: "error",
      path: "$.nodes",
      hint: "Use a workflow with one agent node, no edges, and matching initial/final ids.",
    });
  }

  const initialNodeIds = toNodeIdArray(definition.initial);
  if (initialNodeIds.length !== 1) {
    diagnostics.push({
      code: "WorkflowRuntimeError.singleInitialRequired",
      message: "The one-node agent workflow path requires exactly one initial node.",
      severity: "error",
      path: "$.initial",
    });
  }

  if (Object.keys(definition.edges).length > 0) {
    diagnostics.push({
      code: "WorkflowRuntimeError.edgesUnsupported",
      message: "The one-node agent workflow path does not execute edges.",
      severity: "error",
      path: "$.edges",
      hint: "Use the later graph runtime path for multi-node workflows with edges.",
    });
  }

  const [nodeId, node] = nodeEntries[0] ?? [];
  if (nodeId && node) {
    const finalNodeIds = definition.final ? toNodeIdArray(definition.final) : [nodeId];

    if (initialNodeIds.length === 1 && initialNodeIds[0] !== nodeId) {
      diagnostics.push({
        code: "WorkflowRuntimeError.initialNodeMismatch",
        message: "The initial node must be the only declared node for the one-node agent workflow path.",
        severity: "error",
        path: "$.initial",
        nodeId: initialNodeIds[0],
      });
    }

    if (finalNodeIds.length !== 1 || finalNodeIds[0] !== nodeId) {
      diagnostics.push({
        code: "WorkflowRuntimeError.finalNodeMismatch",
        message: "The final node must be the only declared node for the one-node agent workflow path.",
        severity: "error",
        path: "$.final",
        nodeId,
      });
    }

    if (node.kind !== "agent") {
      diagnostics.push({
        code: "WorkflowRuntimeError.agentNodeRequired",
        message: "The one-node workflow path only supports agent nodes.",
        severity: "error",
        path: `$.nodes.${nodeId}.kind`,
        nodeId,
      });
    } else if (node.runtime !== "pibo") {
      diagnostics.push({
        code: "WorkflowRuntimeError.piboRuntimeRequired",
        message: "Agent nodes must use the Pibo runtime in the one-node agent workflow path.",
        severity: "error",
        path: `$.nodes.${nodeId}.runtime`,
        nodeId,
      });
    }
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}

export async function runOneNodeAgentWorkflow(
  definition: WorkflowDefinition,
  input: WorkflowValue,
  options: OneNodeAgentWorkflowOptions,
): Promise<OneNodeAgentWorkflowResult> {
  const events: WorkflowRuntimeEvent[] = [];
  const shapeResult = validateOneNodeAgentWorkflowPath(definition);
  if (!shapeResult.ok) {
    return runtimeFailure(events, shapeResult.diagnostics, {
      code: "WorkflowRuntimeError.invalidDefinition",
      message: "Workflow definition cannot run on the one-node agent workflow path.",
    });
  }

  const inputResult = validateWorkflowInput(definition, input);
  if (!inputResult.ok) {
    return runtimeFailure(events, inputResult.diagnostics, {
      code: "WorkflowRuntimeError.invalidInput",
      message: "Workflow input failed validation before execution.",
    });
  }

  const nodeId = toNodeIdArray(definition.initial)[0];
  const node = definition.nodes[nodeId] as AgentNodeDefinition;
  const timestamp = createTimestampFactory(options.now);
  const createdAt = timestamp();
  const run: WorkflowRun = {
    id: options.createRunId?.() ?? createId("wfr"),
    workflowId: definition.id,
    workflowVersion: definition.version,
    ownerScope: options.ownerScope ?? "workflow:local",
    status: "running",
    current: { nodeId, status: "running" },
    input,
    state: { global: {} },
    createdAt,
    updatedAt: createdAt,
  };

  events.push({ type: "workflow.started", runId: run.id, workflowId: definition.id });

  const nodeAttempt: NodeAttempt = {
    id: options.createNodeAttemptId?.() ?? createId("wna"),
    workflowRunId: run.id,
    nodeId,
    attempt: 1,
    kind: "agent",
    status: "running",
    input,
    startedAt: timestamp(),
  };

  events.push({ type: "node.started", runId: run.id, nodeAttemptId: nodeAttempt.id, nodeId });

  try {
    const prompt = buildOneNodeAgentPrompt(node, input);
    const executorResult = await options.agentExecutor({
      workflow: definition,
      run,
      nodeId,
      node,
      input,
      prompt,
      profileId: node.profile.id,
      routing: node.routing,
    });

    const nodeOutputResult = validateNodeOutput(definition, nodeId, executorResult.output);
    if (!nodeOutputResult.ok) {
      return failRunningWorkflow({
        run,
        nodeAttempt,
        events,
        diagnostics: nodeOutputResult.diagnostics,
        timestamp,
        error: {
          code: "WorkflowRuntimeError.invalidNodeOutput",
          message: "Agent node output failed validation before workflow completion.",
        },
      });
    }

    const workflowOutputResult = validateWorkflowOutput(definition, executorResult.output);
    if (!workflowOutputResult.ok) {
      return failRunningWorkflow({
        run,
        nodeAttempt,
        events,
        diagnostics: workflowOutputResult.diagnostics,
        timestamp,
        error: {
          code: "WorkflowRuntimeError.invalidWorkflowOutput",
          message: "Workflow output failed validation before completion.",
        },
      });
    }

    const runtimeMetadata: RuntimeSelectionMetadata = {
      profileId: executorResult.effectiveProfile ?? node.profile.id,
      tools: executorResult.effectiveTools,
      skills: executorResult.effectiveSkills,
      contextFiles: executorResult.effectiveContextFiles,
      routing: node.routing,
    };

    const completedAt = timestamp();
    nodeAttempt.status = "completed";
    nodeAttempt.output = executorResult.output;
    nodeAttempt.completedAt = completedAt;
    nodeAttempt.metadata = {
      runtime: runtimeMetadata,
      piboSessionId: executorResult.piboSessionId,
      piSessionId: executorResult.piSessionId,
    };

    events.push({ type: "node.completed", runId: run.id, nodeAttemptId: nodeAttempt.id, output: executorResult.output });

    run.status = "completed";
    run.current = { nodeId, status: "completed" };
    run.output = executorResult.output;
    run.completedAt = completedAt;
    run.updatedAt = completedAt;

    events.push({ type: "workflow.completed", runId: run.id, output: executorResult.output });

    return { ok: true, run, nodeAttempt, events, output: executorResult.output };
  } catch (caught) {
    return failRunningWorkflow({
      run,
      nodeAttempt,
      events,
      diagnostics: [],
      timestamp,
      error: errorSummaryFromCaught(caught),
    });
  }
}

function failRunningWorkflow(options: {
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  timestamp: () => string;
  error: WorkflowErrorSummary;
}): OneNodeAgentWorkflowFailure {
  const failedAt = options.timestamp();
  options.nodeAttempt.status = "failed";
  options.nodeAttempt.error = options.error;
  options.nodeAttempt.failedAt = failedAt;
  options.run.status = "failed";
  options.run.current = { nodeId: options.nodeAttempt.nodeId, status: "failed" };
  options.run.failedAt = failedAt;
  options.run.updatedAt = failedAt;
  options.events.push({
    type: "node.failed",
    runId: options.run.id,
    nodeAttemptId: options.nodeAttempt.id,
    error: options.error,
  });
  options.events.push({ type: "workflow.failed", runId: options.run.id, error: options.error });

  return {
    ok: false,
    run: options.run,
    nodeAttempt: options.nodeAttempt,
    events: options.events,
    diagnostics: options.diagnostics,
    error: options.error,
  };
}

function runtimeFailure(
  events: WorkflowRuntimeEvent[],
  diagnostics: WorkflowDiagnostic[],
  error: WorkflowErrorSummary,
): OneNodeAgentWorkflowFailure {
  return { ok: false, events, diagnostics, error };
}

function buildOneNodeAgentPrompt(node: AgentNodeDefinition, input: WorkflowValue): string {
  const serializedInput = typeof input === "string" ? input : JSON.stringify(input);
  return node.promptTemplate?.replaceAll("{{input}}", serializedInput) ?? serializedInput;
}

function toNodeIdArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function createTimestampFactory(now: OneNodeAgentWorkflowOptions["now"]): () => string {
  return () => {
    const value = now?.() ?? new Date();
    return typeof value === "string" ? value : value.toISOString();
  };
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function errorSummaryFromCaught(caught: unknown): WorkflowErrorSummary {
  if (caught instanceof Error) {
    return {
      code: "WorkflowRuntimeError.executorFailed",
      message: caught.message,
    };
  }

  return {
    code: "WorkflowRuntimeError.executorFailed",
    message: "Agent executor failed with a non-Error value.",
  };
}
