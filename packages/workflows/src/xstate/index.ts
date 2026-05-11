import type {
  EdgeId,
  EdgeStateMapping,
  NodeId,
  StateAccessPolicy,
  StatePath,
  WorkflowDefinition,
  WorkflowId,
  WorkflowMetadata,
  WorkflowNodeDefinition,
  WorkflowNodeUiMetadata,
  WorkflowSnapshotKind,
  WorkflowStateFieldDefinition,
  WorkflowUiMetadata,
  WorkflowVersion,
  XStateMachineProjection,
  XStateProjectionAction,
  XStateProjectionActor,
  XStateProjectionContextShape,
  XStateProjectionDelay,
  XStateProjectionGuard,
  XStateProjectionKind,
  XStateProjectionMachineConfig,
  XStateProjectionSchemaVersion,
  XStateProjectionState,
  XStateProjectionStateMeta,
  XStateProjectionTerminalKind,
  XStateProjectionTransition,
} from "../types/index.js";

export const WORKFLOW_XSTATE_PROJECTION_KIND: XStateProjectionKind = "pibo.workflow.xstateProjection";
export const WORKFLOW_XSTATE_PROJECTION_VERSION: XStateProjectionSchemaVersion = 1;

export const WORKFLOW_XSTATE_SNAPSHOT_KINDS = ["kernel", "xstate", "ui"] as const satisfies readonly WorkflowSnapshotKind[];

export const WORKFLOW_XSTATE_TERMINAL_STATE_IDS: Record<XStateProjectionTerminalKind, string> = {
  completed: "workflow.completed",
  failed: "workflow.failed",
  cancelled: "workflow.cancelled",
};

export const WORKFLOW_XSTATE_RESUME_EVENT = "WORKFLOW.RESUME";
export const WORKFLOW_XSTATE_CANCEL_EVENT = "WORKFLOW.CANCEL";
export const WORKFLOW_XSTATE_FAIL_EVENT = "WORKFLOW.FAIL";

export const WORKFLOW_XSTATE_ACTOR_SOURCES: Record<WorkflowNodeDefinition["kind"], string> = {
  adapter: "pibo.workflow.actor.adapter",
  agent: "pibo.workflow.actor.agent",
  code: "pibo.workflow.actor.code",
  human: "pibo.workflow.actor.human",
  workflow: "pibo.workflow.actor.workflow",
};

export type CreateXStateProjectionContextShapeOptions = {
  global?: Record<StatePath, WorkflowStateFieldDefinition>;
  local?: Record<NodeId, StateAccessPolicy | undefined>;
  edge?: Record<EdgeId, EdgeStateMapping | undefined>;
};

export function createXStateProjectionContextShape(
  options: CreateXStateProjectionContextShapeOptions = {},
): XStateProjectionContextShape {
  return {
    durableTruth: "kernel",
    global: options.global ?? {},
    local: options.local ?? {},
    edge: options.edge ?? {},
    exposesPrivatePayloads: false,
  };
}

export type CreateXStateMachineProjectionOptions = {
  id: WorkflowId;
  version: WorkflowVersion;
  initial: string;
  states?: Record<string, XStateProjectionState>;
  transitions?: XStateProjectionTransition[];
  actors?: Record<string, XStateProjectionActor>;
  guards?: Record<string, XStateProjectionGuard>;
  actions?: Record<string, XStateProjectionAction>;
  delays?: Record<string, XStateProjectionDelay>;
  contextShape?: XStateProjectionContextShape;
  metadata?: WorkflowMetadata;
  ui?: WorkflowUiMetadata;
};

export type WorkflowNodeXStateProjection = {
  initial: string;
  states: Record<string, XStateProjectionState>;
  actors: Record<string, XStateProjectionActor>;
  contextShape: XStateProjectionContextShape;
};

export function projectWorkflowNodesToXState(definition: WorkflowDefinition): WorkflowNodeXStateProjection {
  const states: Record<string, XStateProjectionState> = {};
  const actors: Record<string, XStateProjectionActor> = {};

  for (const [nodeId, node] of Object.entries(definition.nodes).sort(([left], [right]) => left.localeCompare(right))) {
    const actor = createXStateProjectionActorForNode(nodeId, node);
    const state = createXStateProjectionStateForNode(nodeId, node, actor);
    actors[actor.id] = actor;
    states[state.id] = state;
  }

  return {
    initial: xstateInitialStateIdForWorkflow(definition),
    states,
    actors,
    contextShape: createXStateProjectionContextShape({
      global: definition.state?.global,
      local: Object.fromEntries(
        Object.entries(definition.nodes)
          .filter(([, node]) => node.state !== undefined)
          .map(([nodeId, node]) => [nodeId, node.state]),
      ),
      edge: Object.fromEntries(
        Object.entries(definition.edges)
          .filter(([, edge]) => edge.state !== undefined)
          .map(([edgeId, edge]) => [edgeId, edge.state]),
      ),
    }),
  };
}

export function projectWorkflowToXStateProjection(definition: WorkflowDefinition): XStateMachineProjection {
  const nodeProjection = projectWorkflowNodesToXState(definition);

  return createXStateMachineProjection({
    id: definition.id,
    version: definition.version,
    initial: nodeProjection.initial,
    states: nodeProjection.states,
    actors: nodeProjection.actors,
    contextShape: nodeProjection.contextShape,
    metadata: definition.metadata,
    ui: definition.ui,
  });
}

export function createXStateMachineProjection(options: CreateXStateMachineProjectionOptions): XStateMachineProjection {
  const contextShape = options.contextShape ?? createXStateProjectionContextShape();
  const states = options.states ?? {};
  const transitions = options.transitions ?? [];
  const actors = options.actors ?? {};
  const guards = options.guards ?? {};
  const actions = options.actions ?? {};
  const delays = options.delays ?? {};

  const config = createXStateMachineConfig({
    id: options.id,
    version: options.version,
    initial: options.initial,
    states,
    transitions,
    actors,
    guards,
    actions,
    delays,
    contextShape,
    metadata: options.metadata,
    ui: options.ui,
  });

  return {
    kind: WORKFLOW_XSTATE_PROJECTION_KIND,
    schemaVersion: WORKFLOW_XSTATE_PROJECTION_VERSION,
    id: options.id,
    version: options.version,
    initial: options.initial,
    config,
    states,
    transitions,
    actors,
    guards,
    actions,
    delays,
    contextShape,
    finalStates: WORKFLOW_XSTATE_TERMINAL_STATE_IDS,
    metadata: options.metadata,
    ui: options.ui,
  };
}

type CreateXStateMachineConfigOptions = {
  id: WorkflowId;
  version: WorkflowVersion;
  initial: string;
  states: Record<string, XStateProjectionState>;
  transitions: XStateProjectionTransition[];
  actors: Record<string, XStateProjectionActor>;
  guards: Record<string, XStateProjectionGuard>;
  actions: Record<string, XStateProjectionAction>;
  delays: Record<string, XStateProjectionDelay>;
  contextShape: XStateProjectionContextShape;
  metadata?: WorkflowMetadata;
  ui?: WorkflowUiMetadata;
};

function createXStateMachineConfig(options: CreateXStateMachineConfigOptions): XStateProjectionMachineConfig {
  const configStates: XStateProjectionMachineConfig["states"] = {};

  for (const state of Object.values(options.states).sort((a, b) => a.id.localeCompare(b.id))) {
    configStates[state.id] = {
      id: state.id,
      type: state.type,
      tags: state.tags,
      entry: state.entry,
      exit: state.exit,
      invoke: state.invoke,
      meta: state.meta,
    };
  }

  for (const [terminalKind, terminalStateId] of Object.entries(WORKFLOW_XSTATE_TERMINAL_STATE_IDS) as Array<[
    XStateProjectionTerminalKind,
    string,
  ]>) {
    configStates[terminalStateId] ??= {
      id: terminalStateId,
      type: "final",
      meta: createTerminalStateMeta(terminalKind),
    };
  }

  for (const transition of options.transitions) {
    const sourceState = configStates[transition.source];
    if (!sourceState) {
      continue;
    }

    sourceState.on ??= {};
    const projectedTransition = {
      target: transition.target,
      guard: transition.guard,
      actions: transition.actions,
      meta: transition.meta,
    };
    const existingTransition = sourceState.on[transition.event];
    if (existingTransition === undefined) {
      sourceState.on[transition.event] = projectedTransition;
    } else if (Array.isArray(existingTransition)) {
      existingTransition.push(projectedTransition);
    } else {
      sourceState.on[transition.event] = [existingTransition, projectedTransition];
    }
  }

  return {
    id: options.id,
    initial: options.initial,
    states: configStates,
    meta: {
      pibo: {
        schemaVersion: WORKFLOW_XSTATE_PROJECTION_VERSION,
        workflowId: options.id,
        workflowVersion: options.version,
        snapshotKinds: [...WORKFLOW_XSTATE_SNAPSHOT_KINDS],
        contextShape: options.contextShape,
        actors: options.actors,
        guards: options.guards,
        actions: options.actions,
        delays: options.delays,
        finalStates: WORKFLOW_XSTATE_TERMINAL_STATE_IDS,
        metadata: options.metadata,
        ui: options.ui,
      },
    },
  };
}

function createTerminalStateMeta(kind: XStateProjectionTerminalKind): XStateProjectionStateMeta {
  return {
    pibo: {
      kind: "terminal",
      terminal: {
        status: kind,
      },
    },
  };
}

export function createXStateProjectionActorForNode(
  nodeId: NodeId,
  node: WorkflowNodeDefinition,
): XStateProjectionActor {
  return {
    id: xstateActorIdForNode(nodeId),
    src: xstateActorSourceForNodeKind(node.kind),
    nodeId,
    kind: node.kind,
    input: { kind: "nodeInput", nodeId },
    childWorkflowId: node.kind === "workflow" ? node.workflowId : undefined,
    childWorkflowVersion: node.kind === "workflow" ? node.workflowVersion : undefined,
    metadata: node.metadata,
  };
}

export function createXStateProjectionStateForNode(
  nodeId: NodeId,
  node: WorkflowNodeDefinition,
  actor: XStateProjectionActor = createXStateProjectionActorForNode(nodeId, node),
): XStateProjectionState {
  const tags = [node.kind, ...(node.metadata?.tags ?? [])];

  return {
    id: xstateStateIdForNode(nodeId),
    kind: "node",
    nodeId,
    type: "atomic",
    actorId: actor.id,
    invoke: {
      id: actor.id,
      src: actor.src,
      input: actor.input,
    },
    tags,
    meta: {
      pibo: {
        kind: "node",
        nodeId,
        nodeKind: node.kind,
        actorId: actor.id,
        description: node.description,
        tags,
        ui: node.ui,
      },
    },
  };
}

export function xstateActorIdForNode(nodeId: NodeId): string {
  return `workflow.node.${nodeId}`;
}

export function xstateActorSourceForNodeKind(kind: WorkflowNodeDefinition["kind"]): string {
  return WORKFLOW_XSTATE_ACTOR_SOURCES[kind];
}

export function xstateInitialStateIdForWorkflow(definition: WorkflowDefinition): string {
  const initialNodeId = Array.isArray(definition.initial) ? definition.initial[0] : definition.initial;
  return xstateStateIdForNode(initialNodeId);
}

export function xstateStateIdForNode(nodeId: NodeId): string {
  return `node.${nodeId}`;
}
