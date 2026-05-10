import type {
  AdapterRef,
  EdgeAdapterDefinition,
  JsonSchema,
  JsonWorkflowPort,
  RegistryRefId,
  TextWorkflowPort,
  WorkflowPort,
} from "../types/index.js";

/**
 * Create a text workflow port.
 *
 * Text ports carry plain strings across workflow, node, and adapter boundaries.
 */
export function text(description?: string): TextWorkflowPort {
  return withOptionalDescription({ kind: "text" }, description);
}

/**
 * Create a JSON workflow port backed by a V1 JSON Schema subset contract.
 *
 * The schema is intentionally preserved as part of the workflow IR so validators,
 * compilers, runtime checks, and inspection surfaces all see the same contract.
 */
export function json(schema: JsonSchema, description?: string): JsonWorkflowPort {
  return withOptionalDescription({ kind: "json", schema }, description);
}

export function isTextPort(port: WorkflowPort): port is TextWorkflowPort {
  return port.kind === "text";
}

export function isJsonPort(port: WorkflowPort): port is JsonWorkflowPort {
  return port.kind === "json";
}

/**
 * Reference a registered deterministic TypeScript adapter by id.
 *
 * Adapter refs are stored in workflow IR for both edge adapters and visible adapter nodes;
 * the Workflow Registry owns the executable TypeScript handler behind the id.
 */
export function adapterRef(id: RegistryRefId): AdapterRef {
  return { kind: "adapter", language: "typescript", id };
}

export function isAdapterRef(value: unknown): value is AdapterRef {
  return (
    isRecord(value) &&
    value.kind === "adapter" &&
    value.language === "typescript" &&
    typeof value.id === "string" &&
    value.id.length > 0
  );
}

export function adapterRefId(ref: AdapterRef): RegistryRefId {
  return ref.id;
}

export function edgeAdapter(transform: AdapterRef, output: WorkflowPort): EdgeAdapterDefinition {
  return { kind: "edgeAdapter", transform, output };
}

function withOptionalDescription<TPort extends WorkflowPort>(port: TPort, description: string | undefined): TPort {
  if (description === undefined) {
    return port;
  }

  return { ...port, description };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
