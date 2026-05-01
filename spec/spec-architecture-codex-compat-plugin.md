---
title: Pibo Codex Compatibility Plugin Specification
version: 1.0
date_created: 2026-05-02
last_updated: 2026-05-02
owner: Pibo maintainers
tags: [architecture, design, plugins, profiles, tools, prompt, subagents, auth]
---

# Introduction

This specification defines a narrow Codex-compatibility layer for Pibo. The goal is not to clone the full Codex product. The goal is to make a Codex-tuned model experience a Pibo runtime that feels close to Codex in the model-visible environment: prompt structure, tool surface, subagent semantics, skill system, project instructions, and runtime context.

## 1. Purpose & Scope

This specification covers:

- A new `codex-compat` plugin and profile set for Pibo.
- Codex-like model-visible tools, tool names, and tool descriptions.
- Provider-delegated `web_search` using the same authentication path already used by Pibo and Pi.
- Codex-like subagent roles and subagent tool semantics.
- Codex-like prompt assembly, including project docs and environment context.
- A phased implementation plan and acceptance criteria.

This specification does not cover:

- Codex marketplace or plugin-install UX.
- Codex plan mode.
- Codex approval popups or TUI parity.
- Codex app-server parity.
- A full clone of Codex internal runtime behavior that is not visible to the model.

Assumptions:

- Pibo continues to embed Pi Coding Agent as the inner engine.
- Pibo remains the owner of plugin registration, profile building, prompt ownership, routing, auth, and transport boundaries.
- The existing Pibo auth stack for model providers remains the single source of truth for provider authentication.

## 2. Definitions

- **Codex compatibility plugin**: A Pibo plugin that exposes a Codex-like agent-facing environment without recreating the full Codex product.
- **Agent-visible parity**: Parity focused only on what the model can see: instructions, tools, skills, subagents, context files, and runtime metadata.
- **Codex-compatible profile**: A Pibo profile that selects the Codex-like tool surface, skills, subagents, and prompt contract.
- **Provider-delegated web search**: A `web_search` tool exposed to the model but executed by the model provider through the Responses API rather than by a local browser stack.
- **Compatibility alias**: A tool or profile name chosen to match Codex naming even when the underlying implementation is different.
- **Root agent**: The main routed Pibo session for the user-facing conversation.
- **Child agent**: A delegated agent session created through the Codex-compatible multi-agent tool surface.
- **Base prompt**: The static system or developer instruction layer that defines model behavior before project-specific context is injected.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: Pibo MUST implement Codex compatibility as a narrow plugin and profile layer, not as a fork of Pi Coding Agent.
- **REQ-002**: The Codex-compatible environment MUST prioritize model-visible parity over human UI parity.
- **REQ-003**: The Codex compatibility layer MUST reuse Pibo's existing provider authentication path and MUST NOT introduce a second independent auth flow for model-backed tools.
- **REQ-004**: `web_search` MUST be implemented as a provider-delegated tool using the same model provider request path as normal model turns.
- **REQ-005**: The Codex-compatible `web_search` tool MUST support the same visible control concepts as Codex:
  - cached vs live external web access
  - optional allowed domains
  - optional user location
  - optional search context size
- **REQ-006**: The Codex compatibility layer MUST expose a Codex-like core tool surface with these names unless a technical blocker is documented:
  - `exec_command`
  - `write_stdin`
  - `apply_patch`
  - `web_search`
  - `view_image`
  - `spawn_agent`
  - `send_input`
  - `resume_agent`
  - `wait_agent`
  - `close_agent`
- **REQ-007**: The Codex compatibility layer SHOULD expose `update_plan` and `request_user_input` only if the behavior can be made coherent inside Pibo. If omitted, the prompt contract MUST explicitly steer the model toward direct execution and normal chat questions.
- **REQ-008**: Codex-compatible subagents MUST expose roles `default`, `explorer`, and `worker`.
- **REQ-009**: Child-agent prompt framing MUST state that the child agent is part of a team, may continue delegated work, and returns its final result to the parent.
- **REQ-010**: The compatibility profile MUST continue to use the existing `SKILL.md` skill system.
- **REQ-011**: The compatibility prompt builder MUST include project instructions from `AGENTS.md`, `RULES.md`, and `GLOSSARY.md`.
- **REQ-012**: The compatibility prompt builder MUST inject an explicit environment context block with at least `cwd`, `shell`, `current_date`, `timezone`, and visible subagent role information.
- **REQ-013**: The compatibility layer MUST allow selective reuse of the extracted static Codex base prompt, but MUST remove instructions that depend on product features Pibo does not implement.
- **REQ-014**: The implementation MUST preserve the current Pibo product boundary: tools, routing, prompt ownership, auth, and policy remain Pibo responsibilities.
- **REQ-015**: The compatibility tool descriptions MUST be close enough to Codex that a Codex-tuned model can infer expected behavior without additional translation.
- **REQ-016**: The first implementation MUST prefer a single `codex-compat` profile over many variants.
- **REQ-017**: The first implementation MUST avoid introducing marketplace, connector, or plugin-install semantics into the model prompt.
- **REQ-018**: Compatibility work MUST remain surgical. Existing non-Codex profiles and unrelated plugin behavior MUST remain unchanged unless directly required for shared infrastructure.
- **CON-001**: Pibo MUST NOT implement a local browser runtime purely to satisfy `web_search` parity.
- **CON-002**: Codex compatibility MUST NOT require Plan mode, Codex-specific TUI state, or approval popups.
- **CON-003**: Compatibility naming MAY use Codex names even when the underlying implementation is a Pibo adapter, but visible semantics MUST remain truthful.
- **GUD-001**: Prefer thin adapters over new abstractions when existing Pibo plugin/profile/runtime extension points are sufficient.
- **GUD-002**: Prefer one shared prompt builder path with a Codex-compat mode over a second unrelated prompt stack.
- **PAT-001**: Treat the compatibility layer as a translation surface:
  - Codex-like names and instructions outside
  - Pibo and Pi implementation details inside
- **PAT-002**: Reuse existing routed child-session machinery for subagents instead of building a second delegation system.

## 4. Interfaces & Data Contracts

### 4.1 Plugin and Profile Shape

The implementation should add a new plugin registration unit and one primary profile.

```ts
type PiboPlugin = {
  id: string;
  name?: string;
  register(api: PiboPluginApi): void;
};

type PiboProfileDefinition = {
  name: string;
  aliases?: readonly string[];
  description?: string;
  create(context: PiboProfileBuildContext): InitialSessionContext;
};
```

Recommended initial identifiers:

| Kind | Recommended name |
| --- | --- |
| Plugin id | `pibo.codex-compat` |
| Main profile | `codex-compat` |
| Optional alias | `codex` |

### 4.2 Tool Surface Contract

The compatibility profile should expose this initial tool surface:

| Visible tool name | Implementation strategy | Notes |
| --- | --- | --- |
| `exec_command` | New Pibo tool adapter | Should support PTY-like long-running command sessions. |
| `write_stdin` | New Pibo tool adapter | Continues an active exec session. |
| `apply_patch` | New Pibo freeform patch tool | Match Codex patch flow closely. |
| `web_search` | Provider-delegated built-in/provider tool | No local browser. |
| `view_image` | Pibo local image view tool | Follow current local-file image viewing semantics. |
| `spawn_agent` | Adapter over routed child sessions | Codex-compatible role and metadata fields. |
| `send_input` | Adapter over existing child-session messaging | Reuse delegated context where possible. |
| `resume_agent` | Adapter | Only if child-agent lifecycle supports closed-state reuse. |
| `wait_agent` | Adapter | Must expose Codex-like waiting semantics. |
| `close_agent` | Adapter | Closes child session handles. |

Optional V1 tools:

| Visible tool name | Condition |
| --- | --- |
| `update_plan` | Only if the resulting UX and persistence are coherent inside Pibo. |
| `request_user_input` | Only if a structured question flow exists for the active channel. |

### 4.3 Web Search Contract

The visible `web_search` contract should map to the provider request shape used by Codex:

```ts
type CodexCompatibleWebSearchConfig = {
  external_web_access: boolean;
  filters?: {
    allowed_domains?: string[];
  };
  user_location?: {
    type: "approximate";
    country?: string;
    region?: string;
    city?: string;
    timezone?: string;
  };
  search_context_size?: "low" | "medium" | "high";
};
```

The runtime MUST convert this visible contract into the provider's Responses API request format and MUST continue using Pibo's provider auth token resolution path.

### 4.4 Prompt Assembly Contract

The compatibility prompt builder should assemble:

1. static Codex-compatible base instructions
2. tool-use instructions for the visible Codex-like tool set
3. child-agent instructions when the session is a delegated child
4. project instructions from `AGENTS.md`, `RULES.md`, `GLOSSARY.md`
5. explicit environment context
6. visible skills section
7. optional visible plugin section only if needed for model guidance

Recommended environment context shape:

```xml
<environment_context>
  <cwd>/absolute/path</cwd>
  <shell>bash</shell>
  <current_date>2026-05-02</current_date>
  <timezone>Europe/Berlin</timezone>
  <subagents>default, explorer, worker</subagents>
</environment_context>
```

### 4.5 Initial File-Level Integration Targets

| File | Planned responsibility |
| --- | --- |
| `src/plugins/builtin.ts` | Register the new compatibility plugin or include it in default plugin creation. |
| `src/plugins/types.ts` | Reuse existing plugin/profile contracts; extend only if compatibility metadata is required. |
| `src/core/profiles.ts` | Reuse existing profile selection model. |
| `src/core/runtime.ts` | Inject compatibility prompt resources and compatibility tools into runtime creation. |
| `src/subagents/tool.ts` | Reuse or wrap for Codex-compatible subagent tool names and descriptions. |
| New prompt-builder file under `src/core/` | Assemble Codex-compatible system/developer prompt sections. |
| New compatibility tool files under `src/plugins/` or `src/tools/` | Implement `exec_command`, `write_stdin`, `apply_patch`, `view_image`, `web_search`, and collab adapters as needed. |

## 5. Acceptance Criteria

- **AC-001**: Given the `codex-compat` profile is created, When it is inspected, Then the visible tool names include the Codex-compatible core tool surface defined by this specification.
- **AC-002**: Given a normal model turn under `codex-compat`, When the prompt is assembled, Then it includes project instructions from `AGENTS.md`, `RULES.md`, and `GLOSSARY.md` when present.
- **AC-003**: Given a normal model turn under `codex-compat`, When the prompt is assembled, Then it includes an explicit environment context block with cwd, shell, date, timezone, and subagent role visibility.
- **AC-004**: Given `web_search` is available, When a turn is sent to the provider, Then `web_search` is represented in the provider tool request instead of being executed by a local browser stack.
- **AC-005**: Given provider-backed web search is used, When auth is required, Then the same provider authentication path used by Pibo and Pi model requests is reused.
- **AC-006**: Given the session runs in a constrained mode that prefers cached web access, When the `web_search` tool spec is generated, Then it sets the cached/live equivalent consistently.
- **AC-007**: Given a delegated child agent is spawned, When the child session prompt is built, Then it includes team-oriented child-agent instructions distinct from the root session.
- **AC-008**: Given the compatibility profile uses subagents, When the model sees available roles, Then `default`, `explorer`, and `worker` are visible and documented.
- **AC-009**: Given the compatibility profile is enabled, When unrelated existing profiles are created, Then their existing capabilities remain unchanged.
- **AC-010**: Given static Codex prompt content is imported, When the compatibility prompt is rendered, Then instructions that depend on unsupported Codex-only product features are absent.
- **AC-011**: Given `update_plan` and `request_user_input` are not implemented in V1, When the compatibility prompt is assembled, Then the instructions do not imply those tools are available.
- **AC-012**: Given the compatibility tool surface includes `apply_patch`, When the model edits files manually, Then the visible editing contract matches the patch-based flow expected by Codex-tuned behavior.

## 6. Test Automation Strategy

- **Test Levels**: Unit and integration tests.
- **Frameworks**: Existing Node.js and TypeScript test/tooling already used by Pibo.
- **Primary Commands**: `npm test`, `npm run typecheck`.
- **Focused Test Areas**:
  - compatibility profile inspection
  - prompt assembly snapshots
  - provider request serialization for `web_search`
  - child-agent prompt framing
  - tool registration and name visibility
  - auth reuse for provider-backed web search
- **Snapshot Scope**:
  - visible tool inventory for `codex-compat`
  - rendered prompt sections
  - generated web-search provider request body
- **Regression Scope**:
  - existing default profile creation
  - existing subagent execution
  - existing run-control package behavior

## 7. Rationale & Context

Codex-tuned models are sensitive to the visible runtime contract. Tool names alone are not enough. The model also relies on tool descriptions, prompt sections, subagent framing, explicit runtime context, and a familiar skill system.

Pibo already has the correct architectural boundary for this work:

- profiles already select tools, skills, subagents, and context files
- runtime creation already injects custom tools and skills
- subagents already map to routed child sessions
- provider-backed model calls already exist and already own authentication

The compatibility layer therefore does not require a new agent runtime. It requires a new compatibility translation surface.

Provider-delegated `web_search` is the correct first choice because it is closer to Codex behavior than building a local browser search stack. Codex itself exposes `web_search` as a provider tool contract and processes the resulting provider events. Reusing Pibo and Pi provider auth is mandatory because a second auth path would create operational drift and inconsistent model access.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Pi Coding Agent - inner runtime for turns, tools, sessions, and streaming.
- **EXT-002**: Model provider Responses API - required for provider-backed `web_search` and normal model turns.

### Third-Party Services

- **SVC-001**: Existing configured model provider - must support the Responses-style tool contract used by the compatibility layer.

### Infrastructure Dependencies

- **INF-001**: Existing Pibo provider auth and request pipeline - required for all provider-backed compatibility features.

### Data Dependencies

- **DAT-001**: Local project instruction files such as `AGENTS.md`, `RULES.md`, and `GLOSSARY.md`.
- **DAT-002**: Existing `SKILL.md` skill directories and paths.

### Technology Platform Dependencies

- **PLT-001**: Existing Pibo plugin/profile/runtime architecture.
- **PLT-002**: Existing Pibo routed subagent session infrastructure.

### Compliance Dependencies

- **COM-001**: The compatibility prompt and tool surface must remain truthful about implemented capabilities and must not claim Codex-only behaviors that do not exist in Pibo.

## 9. Examples & Edge Cases

### 9.1 Recommended Rollout Sequence

1. Add `pibo.codex-compat` plugin registration and a single `codex-compat` profile.
2. Implement prompt builder support for Codex-compatible base instructions and environment context.
3. Add `web_search` provider delegation using existing provider auth.
4. Add Codex-compatible shell and patch tools.
5. Add Codex-compatible subagent role exposure and collab tool adapters.
6. Evaluate whether `update_plan` and `request_user_input` belong in V1 or V2.

### 9.2 Edge Case: Missing Optional Tools

If `request_user_input` is not implemented in V1, the compatibility prompt must not reference a structured question tool and must instead instruct the agent to ask concise direct questions in the normal conversation.

### 9.3 Edge Case: Provider Without Web Search Support

If the active provider or model cannot accept provider-backed `web_search`, the `codex-compat` profile must either:

- hide `web_search` completely, or
- fail profile activation with an explicit configuration error.

Silent fallback to an unrelated local browser search path is not acceptable for V1.

### 9.4 Edge Case: Child Agent Prompt Drift

If child agents reuse the root prompt unchanged, Codex-tuned delegation behavior will drift. The child prompt must explicitly mark the session as delegated child work.

## 10. Validation Criteria

- The repository contains a saved `codex-compat` architecture spec in `spec/`.
- A compatibility plugin id and primary profile name are defined and documented.
- Prompt snapshots show Codex-compatible environment and project-doc sections.
- Provider request snapshots show `web_search` serialized as a provider tool request rather than a local tool execution.
- Tests confirm provider auth reuse rather than a second auth path.
- Profile inspection confirms the expected compatibility tool names and role visibility.
- Existing non-compat profiles continue to pass their current tests.

## 11. Related Specifications / Further Reading

- [spec-architecture-runtime-boundary.md](/home/pibo/code/pibo/spec/spec-architecture-runtime-boundary.md)
- [spec-architecture-pibo-session-model.md](/home/pibo/code/pibo/spec/spec-architecture-pibo-session-model.md)
- [docs/architecture.md](/home/pibo/code/pibo/docs/architecture.md)
- [docs/codex-harness-analysis.md](/home/pibo/code/pibo/docs/codex-harness-analysis.md)
