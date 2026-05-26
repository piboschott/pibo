import type {
  AgentNodeDefinition,
  NestedWorkflowNodeDefinition,
  NodeAttempt,
  NodeAttemptId,
  NodeId,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowEventEmitter,
  WorkflowRegistry,
  WorkflowRun,
  WorkflowRunId,
  WorkflowRuntimeEvent,
  WorkflowValue,
} from "../types/index.js";
import type { WorkflowRunStore } from "../store/index.js";
import { resolveWorkflowDefinition } from "../registry/index.js";
import {
  validateNodeOutput,
  validateWorkflowInput,
  validateWorkflowOutput,
  validateWorkflowPortValue,
} from "../validation/index.js";
import {
  agentNodeDispatchFailure,
  failAgentNodeDispatch,
  failNestedWorkflowNodeDispatch,
  nestedWorkflowNodeDispatchFailure,
} from "./dispatch-failures.js";
import {
  agentExecutorErrorSummaryFromCaught,
  createAgentRuntimeSelectionMetadata,
  linkWorkflowRunToAgentSession,
  resolveAgentProfileForRuntime,
} from "./agent-runtime.js";
import { createWorkflowRuntimeId as createId } from "./ids.js";
import type {
  AgentProfileResolver,
  OneNodeAgentExecutor,
  OneNodeAgentExecutorResult,
} from "./pibo-routing.js";
import {
  createCurrentNodeStateView,
  createInitialWorkflowRunState,
  createNodeScopedWorkflowRun,
  localStateSnapshotForNode,
} from "./state.js";
import { buildAgentNodePrompt, recordFinalAgentPrompt } from "./prompts.js";
import {
  emitWorkflowRuntimeEvent,
  persistWorkflowNodeAttempt,
  persistWorkflowRun,
} from "./persistence.js";
import { createTimestampFactory } from "./time.js";

export {
  createRetryScheduledNodeAttempt,
  decideWorkflowNodeRetry,
  resolveWorkflowRetryPolicy,
} from "./retry.js";
export type { WorkflowNodeRetryDecision, WorkflowNodeRetryDecisionOptions } from "./retry.js";
export { runOneNodeAgentWorkflow, validateOneNodeAgentWorkflowPath } from "./one-node-agent.js";
export type {
  OneNodeAgentWorkflowFailure,
  OneNodeAgentWorkflowOptions,
  OneNodeAgentWorkflowResult,
  OneNodeAgentWorkflowSuccess,
} from "./one-node-agent.js";
export {
  createPiboSessionRoutingAgentExecutor,
  PIBO_WORKFLOW_SESSION_KIND_METADATA_KEY,
  PIBO_WORKFLOW_SESSION_KINDS,
} from "./pibo-routing.js";
export type {
  AgentProfileResolver,
  AgentProfileResolverContext,
  OneNodeAgentExecutor,
  OneNodeAgentExecutorContext,
  OneNodeAgentExecutorResult,
  PiboRoutingJsonObject,
  PiboRoutingJsonValue,
  PiboSessionRoutingAgentExecutorOptions,
  PiboWorkflowAssistantMessageEvent,
  PiboWorkflowMessageEvent,
  PiboWorkflowOutputEvent,
  PiboWorkflowProjectSessionLinker,
  PiboWorkflowProjectSessionLinkInput,
  PiboWorkflowSession,
  PiboWorkflowSessionCreateInput,
  PiboWorkflowSessionErrorEvent,
  PiboWorkflowSessionKind,
  PiboWorkflowSessionRouting,
  PiboWorkflowSessionStatus,
  ResolvedAgentProfile,
} from "./pibo-routing.js";

export {
  recordWorkflowEdgeTransfer,
  transferWorkflowEdgeAdapterData,
  transferWorkflowEdgeData,
} from "./edge-transfer.js";
export type {
  RecordedWorkflowEdgeTransferFailure,
  RecordedWorkflowEdgeTransferOptions,
  RecordedWorkflowEdgeTransferResult,
  RecordedWorkflowEdgeTransferSuccess,
  WorkflowEdgeAdapterTransferOptions,
  WorkflowEdgeTransferFailure,
  WorkflowEdgeTransferOptions,
  WorkflowEdgeTransferResult,
  WorkflowEdgeTransferSuccess,
} from "./edge-transfer.js";

export { applyWorkflowHumanAction } from "./human-action.js";
export type {
  WorkflowHumanActionApplyFailure,
  WorkflowHumanActionApplyOptions,
  WorkflowHumanActionApplyRequest,
  WorkflowHumanActionApplyResult,
  WorkflowHumanActionApplySuccess,
  WorkflowHumanActionDecisionKind,
} from "./human-action.js";
export { dispatchWorkflowHumanNode } from "./human-node.js";
export type {
  WorkflowHumanNodeDispatchFailure,
  WorkflowHumanNodeDispatchOptions,
  WorkflowHumanNodeDispatchResult,
  WorkflowHumanNodeDispatchWaiting,
} from "./human-node.js";
export { dispatchWorkflowAdapterNode } from "./adapter-node.js";
export type {
  WorkflowAdapterNodeDispatchFailure,
  WorkflowAdapterNodeDispatchOptions,
  WorkflowAdapterNodeDispatchResult,
  WorkflowAdapterNodeDispatchSuccess,
} from "./adapter-node.js";
export { dispatchWorkflowCodeNode } from "./code-node.js";
export type {
  WorkflowCodeNodeDispatchFailure,
  WorkflowCodeNodeDispatchOptions,
  WorkflowCodeNodeDispatchResult,
  WorkflowCodeNodeDispatchSuccess,
} from "./code-node.js";

export type WorkflowAgentNodeDispatchOptions = {
  registry?: Pick<WorkflowRegistry, "promptBuilders">;
  now?: () => Date | string;
  createNodeAttemptId?: () => NodeAttemptId;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  profileResolver?: AgentProfileResolver;
  agentExecutor: OneNodeAgentExecutor;
  edgePayloads?: Record<string, WorkflowValue>;
};

export type WorkflowAgentNodeDispatchSuccess = {
  ok: true;
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  output: WorkflowValue;
  result: OneNodeAgentExecutorResult;
};

export type WorkflowAgentNodeDispatchFailure = {
  ok: false;
  run: WorkflowRun;
  nodeAttempt?: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

export type WorkflowAgentNodeDispatchResult =
  | WorkflowAgentNodeDispatchSuccess
  | WorkflowAgentNodeDispatchFailure;

export type NestedWorkflowExecutorContext = {
  workflow: WorkflowDefinition;
  run: WorkflowRun;
  nodeAttemptId: NodeAttemptId;
  nodeId: string;
  node: NestedWorkflowNodeDefinition;
  childWorkflow: WorkflowDefinition;
  childRunId: WorkflowRunId;
  input: WorkflowValue;
  namespace?: string;
};

export type NestedWorkflowExecutorResult = {
  output: WorkflowValue;
  childRun: WorkflowRun;
  events?: WorkflowRuntimeEvent[];
};

export type NestedWorkflowExecutor = (
  context: NestedWorkflowExecutorContext,
) => Promise<NestedWorkflowExecutorResult> | NestedWorkflowExecutorResult;

export type WorkflowNestedWorkflowNodeDispatchOptions = {
  registry: Pick<WorkflowRegistry, "workflows">;
  now?: () => Date | string;
  createNodeAttemptId?: () => NodeAttemptId;
  createChildRunId?: () => WorkflowRunId;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  nestedWorkflowExecutor: NestedWorkflowExecutor;
};

export type WorkflowNestedWorkflowNodeDispatchSuccess = {
  ok: true;
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  output: WorkflowValue;
  childRun: WorkflowRun;
};

export type WorkflowNestedWorkflowNodeDispatchFailure = {
  ok: false;
  run: WorkflowRun;
  nodeAttempt?: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
  childRun?: WorkflowRun;
};

export type WorkflowNestedWorkflowNodeDispatchResult =
  | WorkflowNestedWorkflowNodeDispatchSuccess
  | WorkflowNestedWorkflowNodeDispatchFailure;

export async function dispatchWorkflowAgentNode(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  nodeId: string,
  input: WorkflowValue,
  options: WorkflowAgentNodeDispatchOptions,
): Promise<WorkflowAgentNodeDispatchResult> {
  const events: WorkflowRuntimeEvent[] = [];
  const timestamp = createTimestampFactory(options.now);
  const node = definition.nodes[nodeId];

  if (!node) {
    return agentNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.unknownNode",
          message: `Workflow node '${nodeId}' does not exist, so it cannot be dispatched as an agent node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.unknownNode",
        message: "Agent node dispatch failed because the node is not declared.",
      },
    });
  }

  if (node.kind !== "agent") {
    return agentNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.agentNodeRequired",
          message: `Workflow node '${nodeId}' is '${node.kind}', but agent node dispatch requires an agent node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}.kind`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.agentNodeRequired",
        message: "Agent node dispatch failed because the selected node is not an agent node.",
      },
    });
  }

  const agentNode = node as AgentNodeDefinition;
  if (agentNode.runtime !== "pibo") {
    return agentNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.piboRuntimeRequired",
          message: `Workflow agent node '${nodeId}' uses runtime '${agentNode.runtime}', but V1 agent dispatch requires the Pibo runtime.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}.runtime`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.piboRuntimeRequired",
        message: "Agent node dispatch failed because the selected node does not use the Pibo runtime.",
      },
    });
  }

  const startedAt = timestamp();
  const nodeAttempt: NodeAttempt = {
    id: options.createNodeAttemptId?.() ?? createId("wna"),
    workflowRunId: run.id,
    nodeId,
    attempt: 1,
    kind: "agent",
    status: "running",
    input,
    startedAt,
    ...localStateSnapshotForNode(run, nodeId),
  };
  run.current = { nodeId, status: "running" };
  run.updatedAt = startedAt;

  await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
    type: "node.started",
    runId: run.id,
    nodeAttemptId: nodeAttempt.id,
    nodeId,
  });
  await persistWorkflowNodeAttempt(options.store, nodeAttempt);
  await persistWorkflowRun(options.store, run);

  const diagnostics: WorkflowDiagnostic[] = [];
  if (agentNode.input) {
    diagnostics.push(
      ...validateWorkflowPortValue(agentNode.input, input, { path: `$.nodes.${nodeId}.input` }).diagnostics.map(
        (diagnostic) => ({ ...diagnostic, nodeId }),
      ),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return failAgentNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics,
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: {
        code: "WorkflowRuntimeError.agentNodeDispatchFailed",
        message: "Agent node dispatch failed before Pibo Runtime execution.",
      },
    });
  }

  try {
    const profileResolution = await resolveAgentProfileForRuntime({
      workflow: definition,
      run,
      nodeId,
      node: agentNode,
      resolver: options.profileResolver,
    });
    if (!profileResolution.ok) {
      return failAgentNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: profileResolution.diagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: profileResolution.error,
      });
    }

    const promptResult = await buildAgentNodePrompt(agentNode, input, {
      workflow: definition,
      run,
      nodeId,
      registry: options.registry,
      edgePayloads: options.edgePayloads,
    });
    if (!promptResult.ok) {
      return failAgentNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: promptResult.diagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: promptResult.error,
      });
    }

    recordFinalAgentPrompt(nodeAttempt, promptResult.recordedPrompt);
    await persistWorkflowNodeAttempt(options.store, nodeAttempt);

    const executorResult = await options.agentExecutor({
      workflow: definition,
      run: createNodeScopedWorkflowRun(run, nodeId),
      nodeAttemptId: nodeAttempt.id,
      nodeId,
      node: agentNode,
      input,
      prompt: promptResult.prompt,
      profileId: profileResolution.profile.id,
      resolvedProfile: profileResolution.profile,
      routing: agentNode.routing,
    });

    const nodeOutputResult = validateNodeOutput(definition, nodeId, executorResult.output);
    if (!nodeOutputResult.ok) {
      return failAgentNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: nodeOutputResult.diagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: "WorkflowRuntimeError.invalidNodeOutput",
          message: "Agent node output failed validation before downstream use.",
        },
      });
    }

    const runtimeMetadata = createAgentRuntimeSelectionMetadata({
      run,
      node: agentNode,
      profile: profileResolution.profile,
      executorResult,
    });

    const completedAt = timestamp();
    nodeAttempt.status = "completed";
    nodeAttempt.output = executorResult.output;
    nodeAttempt.completedAt = completedAt;
    Object.assign(nodeAttempt, localStateSnapshotForNode(run, nodeId));
    nodeAttempt.metadata = {
      ...nodeAttempt.metadata,
      runtime: runtimeMetadata,
      ...(executorResult.piboSessionId ? { piboSessionId: executorResult.piboSessionId } : {}),
      ...(executorResult.piSessionId ? { piSessionId: executorResult.piSessionId } : {}),
    };
    linkWorkflowRunToAgentSession(run, agentNode, executorResult);
    run.current = { nodeId, status: run.status };
    run.updatedAt = completedAt;

    await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
      type: "node.completed",
      runId: run.id,
      nodeAttemptId: nodeAttempt.id,
      output: executorResult.output,
    });
    await persistWorkflowNodeAttempt(options.store, nodeAttempt);
    await persistWorkflowRun(options.store, run);

    return {
      ok: true,
      run,
      nodeAttempt,
      events,
      output: executorResult.output,
      result: executorResult,
    };
  } catch (caught) {
    return failAgentNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics: [],
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: agentExecutorErrorSummaryFromCaught(caught),
    });
  }
}

export async function dispatchWorkflowNestedWorkflowNode(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  nodeId: string,
  input: WorkflowValue,
  options: WorkflowNestedWorkflowNodeDispatchOptions,
): Promise<WorkflowNestedWorkflowNodeDispatchResult> {
  const events: WorkflowRuntimeEvent[] = [];
  const timestamp = createTimestampFactory(options.now);
  const node = definition.nodes[nodeId];

  if (!node) {
    return nestedWorkflowNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.unknownNode",
          message: `Workflow node '${nodeId}' does not exist, so it cannot be dispatched as a nested workflow node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.unknownNode",
        message: "Nested workflow node dispatch failed because the node is not declared.",
      },
    });
  }

  if (node.kind !== "workflow") {
    return nestedWorkflowNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.workflowNodeRequired",
          message: `Workflow node '${nodeId}' is '${node.kind}', but nested workflow dispatch requires a workflow node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}.kind`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.workflowNodeRequired",
        message: "Nested workflow node dispatch failed because the selected node is not a workflow node.",
      },
    });
  }

  const workflowNode = node as NestedWorkflowNodeDefinition;
  const startedAt = timestamp();
  const nodeAttempt: NodeAttempt = {
    id: options.createNodeAttemptId?.() ?? createId("wna"),
    workflowRunId: run.id,
    nodeId,
    attempt: 1,
    kind: "workflow",
    status: "running",
    input,
    startedAt,
    ...localStateSnapshotForNode(run, nodeId),
    metadata: {
      workflowId: workflowNode.workflowId,
      ...(workflowNode.workflowVersion ? { workflowVersion: workflowNode.workflowVersion } : {}),
      ...(workflowNode.namespace ? { namespace: workflowNode.namespace } : {}),
    },
  };
  run.current = { nodeId, status: "running" };
  run.updatedAt = startedAt;

  await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
    type: "node.started",
    runId: run.id,
    nodeAttemptId: nodeAttempt.id,
    nodeId,
  });
  await persistWorkflowNodeAttempt(options.store, nodeAttempt);
  await persistWorkflowRun(options.store, run);

  const diagnostics: WorkflowDiagnostic[] = [];
  const childWorkflow = resolveWorkflowDefinition(options.registry, workflowNode.workflowId, workflowNode.workflowVersion);

  if (!childWorkflow) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownWorkflowRef",
      message: `Workflow node '${nodeId}' references child workflow '${workflowNode.workflowId}${workflowNode.workflowVersion ? `@${workflowNode.workflowVersion}` : ""}', but it is not registered in the Workflow Registry.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.workflowId`,
      registryRef: workflowNode.workflowId,
      hint: "Register the child workflow definition before dispatching the nested workflow node.",
    });
  }

  if (workflowNode.input) {
    diagnostics.push(
      ...validateWorkflowPortValue(workflowNode.input, input, { path: `$.nodes.${nodeId}.input` }).diagnostics.map(
        (diagnostic) => ({ ...diagnostic, nodeId }),
      ),
    );
  }

  if (childWorkflow) {
    diagnostics.push(
      ...validateWorkflowInput(childWorkflow, input, { path: `$.nodes.${nodeId}.childInput` }).diagnostics.map(
        (diagnostic) => ({ ...diagnostic, nodeId }),
      ),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return failNestedWorkflowNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics,
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: {
        code: "WorkflowRuntimeError.workflowNodeDispatchFailed",
        message: "Nested workflow node dispatch failed before child workflow execution.",
      },
    });
  }

  const childRunId = options.createChildRunId?.() ?? createId("wfr");

  try {
    const executorResult = await options.nestedWorkflowExecutor({
      workflow: definition,
      run: createNodeScopedWorkflowRun(run, nodeId),
      nodeAttemptId: nodeAttempt.id,
      nodeId,
      node: workflowNode,
      childWorkflow: childWorkflow!,
      childRunId,
      input,
      namespace: workflowNode.namespace,
    });

    if (executorResult.events?.length) {
      events.push(...executorResult.events);
    }

    nodeAttempt.metadata = {
      ...nodeAttempt.metadata,
      childRunId: executorResult.childRun.id,
      childWorkflowId: executorResult.childRun.workflowId,
      childWorkflowVersion: executorResult.childRun.workflowVersion,
    };

    if (executorResult.childRun.status !== "completed") {
      return failNestedWorkflowNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: [
          {
            code: "WorkflowRuntimeError.childWorkflowIncomplete",
            message: `Child workflow run '${executorResult.childRun.id}' ended with status '${executorResult.childRun.status}' instead of 'completed'.`,
            severity: "error",
            nodeId,
            path: `$.nodes.${nodeId}.workflowId`,
            hint: "Nested workflow nodes must wait for the child workflow to complete successfully before producing output.",
          },
        ],
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: executorResult.childRun.status === "failed"
            ? "WorkflowRuntimeError.childWorkflowFailed"
            : "WorkflowRuntimeError.childWorkflowIncomplete",
          message: "Nested workflow node dispatch failed because the child workflow did not complete successfully.",
        },
        childRun: executorResult.childRun,
      });
    }

    const childOutputResult = validateWorkflowOutput(childWorkflow!, executorResult.output, {
      path: `$.nodes.${nodeId}.childOutput`,
    });
    if (!childOutputResult.ok) {
      return failNestedWorkflowNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: childOutputResult.diagnostics.map((diagnostic) => ({ ...diagnostic, nodeId })),
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: "WorkflowRuntimeError.invalidChildWorkflowOutput",
          message: "Child workflow output failed validation before parent node completion.",
        },
        childRun: executorResult.childRun,
      });
    }

    const nodeOutputResult = validateNodeOutput(definition, nodeId, executorResult.output);
    if (!nodeOutputResult.ok) {
      return failNestedWorkflowNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: nodeOutputResult.diagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: "WorkflowRuntimeError.invalidNodeOutput",
          message: "Nested workflow node output failed validation before downstream use.",
        },
        childRun: executorResult.childRun,
      });
    }

    const completedAt = timestamp();
    nodeAttempt.status = "completed";
    nodeAttempt.output = executorResult.output;
    nodeAttempt.completedAt = completedAt;
    Object.assign(nodeAttempt, localStateSnapshotForNode(run, nodeId));
    run.current = { nodeId, status: run.status };
    run.updatedAt = completedAt;

    await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
      type: "node.completed",
      runId: run.id,
      nodeAttemptId: nodeAttempt.id,
      output: executorResult.output,
    });
    await persistWorkflowNodeAttempt(options.store, nodeAttempt);
    await persistWorkflowRun(options.store, run);

    return {
      ok: true,
      run,
      nodeAttempt,
      events,
      output: executorResult.output,
      childRun: executorResult.childRun,
    };
  } catch (caught) {
    return failNestedWorkflowNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics: [],
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: nestedWorkflowErrorSummaryFromCaught(caught),
    });
  }
}

function nestedWorkflowErrorSummaryFromCaught(caught: unknown): WorkflowErrorSummary {
  if (caught instanceof Error) {
    return {
      code: "WorkflowRuntimeError.nestedWorkflowExecutorFailed",
      message: caught.message,
    };
  }

  return {
    code: "WorkflowRuntimeError.nestedWorkflowExecutorFailed",
    message: "Nested workflow executor failed with a non-Error value.",
  };
}
