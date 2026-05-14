import { createHash } from "node:crypto";

import type { WorkflowDefinition } from "./types/index.js";

export function hashWorkflowDefinition(definition: WorkflowDefinition): string {
  return `sha256:${createHash("sha256").update(canonicalWorkflowDefinitionJson(definition)).digest("hex")}`;
}

export function canonicalWorkflowDefinitionJson(definition: WorkflowDefinition): string {
  return JSON.stringify(normalizeForCanonicalJson(definition));
}

function normalizeForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : normalizeForCanonicalJson(item)));
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const normalized = normalizeForCanonicalJson(input[key]);
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  }

  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  return value;
}
