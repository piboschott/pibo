---
title: Codex Compatibility Plugin Implementation Status
version: 1.0
date_created: 2026-05-02
last_updated: 2026-05-02
owner: Pibo maintainers
tags: [process, implementation-status, codex-compat, plugins, profiles, tools, prompt]
---

# Introduction

This document records the current implementation status of the Pibo Codex compatibility plugin after the first implementation pass. It is a companion status document for `spec/spec-architecture-codex-compat-plugin.md`.

The implemented scope is a narrow Codex-compatible model-visible environment. It does not attempt to clone the full Codex product.

## 1. Current Implementation Summary

The current implementation adds a default Pibo plugin and profile that expose a Codex-like runtime contract to the model.

| Area | Status | Notes |
| --- | --- | --- |
| Plugin registration | Implemented | Plugin id is `pibo.codex-compat`. |
| Profile registration | Implemented | Primary profile is `codex-compat`; alias is `codex`. |
| Built-in Pi tools suppression | Implemented | The profile disables Pi built-in tools so the Codex-like tool surface is dominant. |
| Project instruction files | Implemented | The profile includes `AGENTS.md`, `RULES.md`, and `GLOSSARY.md`. |
| Environment context | Implemented | Prompt hook injects `cwd`, `shell`, `current_date`, `timezone`, and visible subagent roles. |
| Child-agent framing | Implemented | Child sessions receive delegated-agent framing when a parent Pi session id is present. |
| Subagent roles | Implemented | Roles are `default`, `explorer`, and `worker`. |
| Provider-delegated web search | Implemented for Responses payloads | The prompt exposes `web_search`; the provider request hook injects a provider web-search tool. |
| Local browser web search | Not implemented | This is intentionally out of scope for V1. |
| Codex plan mode | Not implemented | Not required for V1. |
| Approval popups or TUI parity | Not implemented | Not required for V1. |

## 2. Implemented Tool Surface

The `codex-compat` profile exposes these model-visible tool names:

| Tool name | Status | Implementation notes |
| --- | --- | --- |
| `exec_command` | Implemented | Runs shell commands through a pipe-backed child process. Long-running commands can return a `session_id`. |
| `write_stdin` | Implemented | Writes to an existing `exec_command` process session and returns recent output. |
| `apply_patch` | Implemented | Invokes the local `apply_patch` command with a Codex-style patch body. |
| `web_search` | Provider-delegated | Not a local tool execution. Injected into supported provider Responses payloads as `web_search`. |
| `view_image` | Implemented | Reads a local image file and returns an inline image tool result. |
| `spawn_agent` | Implemented as adapter | Starts a Pibo routed child session using one of the Codex-compatible roles. |
| `send_input` | Implemented as adapter | Sends follow-up input to an existing delegated child-agent handle. |
| `resume_agent` | Implemented as handle inspection | Returns the current state of a delegated child-agent handle. |
| `wait_agent` | Implemented as handle wait | Waits for delegated child-agent handles to reach a terminal state or timeout. |
| `close_agent` | Implemented as handle closure | Closes the local delegated-agent handle. |

## 3. Prompt and Provider Behavior

The Codex compatibility runtime uses a Pi extension hook to wrap the normal Pibo/Pi system prompt.

Implemented prompt additions:

- A `# Codex-Compatible Runtime` section.
- A truthful statement that this is Pibo through the `codex-compat` profile.
- Guidance to use direct execution and normal chat questions when structured planning or input tools are absent.
- A provider-backed web-search note that explicitly says no local browser search stack is expected.
- An XML-style `<environment_context>` block.
- Delegated child-agent instructions when the session is a child session.

Implemented provider behavior:

- If provider web search is enabled for the profile, the runtime mutates Responses-style provider payloads before the request is sent.
- The injected provider tool has `type: "web_search"`.
- Supported visible web-search configuration fields include:
  - `external_web_access`
  - `filters.allowed_domains`
  - `user_location`
  - `search_context_size`

## 4. Known Gaps and Limitations

The following items are not implemented in V1:

- No Codex plan mode.
- No `update_plan` tool.
- No `request_user_input` tool.
- No Codex approval popup behavior.
- No Codex TUI parity.
- No Codex app-server parity.
- No marketplace, connector, or plugin-install semantics.
- No full imported Codex base prompt.
- No local browser runtime for `web_search`.
- No provider/model capability check that fails profile activation when provider-backed web search is unsupported.
- No explicit cached-versus-live web access mode beyond the current provider-tool injection and prompt guidance.
- `exec_command` is pipe-backed, not a true PTY implementation.
- `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, and `close_agent` are Pibo routed-session adapters, not Codex-internal agent orchestration.
- `resume_agent` currently inspects existing local handles; it does not resurrect disposed child sessions across process/runtime boundaries.
- `close_agent` closes the local handle; it does not currently dispose the underlying routed child session.

## 5. V2 Candidate Work

The following items are candidates for a second implementation pass. They should be prioritized based on actual model behavior under the `codex-compat` profile.

| Candidate | Priority signal | Notes |
| --- | --- | --- |
| Provider/model support detection for `web_search` | High if unsupported providers fail at request time | Profile activation should hide `web_search` or fail with a clear configuration error. |
| Cached/live web access configuration | High if product modes need distinct browsing policy | Add a profile or runtime option that maps explicitly to provider cache/search behavior. |
| True PTY-backed `exec_command` | Medium if interactive commands are common | Current pipe-backed implementation is enough for many commands but not full terminal behavior. |
| Durable delegated-agent handles | Medium if agents need resume after runtime restart | Store handle metadata in Pibo session metadata or a small registry. |
| `close_agent` child-session disposal | Medium | Align handle closure with underlying routed session lifecycle. |
| Better Codex tool descriptions | Medium | Tune descriptions based on observed Codex-tuned model behavior. |
| Full prompt snapshot tests | Medium | Current tests check key sections; snapshots could catch prompt drift. |
| `update_plan` equivalent | Low until product UX exists | Implement only if plan state has coherent persistence and channel display. |
| `request_user_input` equivalent | Low until structured channel UI exists | Implement only when active channels support structured questions. |
| Selective imported Codex base prompt | Low to medium | Only import stable instructions that do not imply unsupported Codex product features. |

## 6. Validation Performed

The implementation has been validated with:

- `npm run typecheck`
- `npm test`
- `node --test test/codex-compat.test.mjs`

Test coverage currently verifies:

- The default registry exposes the `codex-compat` profile and `codex` alias.
- The profile exposes the expected Codex-compatible tool names.
- The profile exposes subagent roles `default`, `explorer`, and `worker`.
- The profile includes `AGENTS.md`, `RULES.md`, and `GLOSSARY.md`.
- The Codex-compatible prompt includes environment context and child-agent framing.
- The prompt does not imply unavailable plan-mode tools.
- `web_search` is serialized as a provider Responses tool rather than a local tool.

## 7. Current File-Level Implementation Map

| File | Responsibility |
| --- | --- |
| `src/plugins/codex-compat.ts` | Registers plugin, profile, visible tool names, context files, and subagent roles. |
| `src/tools/codex-compat.ts` | Implements Codex-compatible shell, patch, image, and child-agent adapter tools. |
| `src/core/codex-compat.ts` | Implements prompt wrapping and provider web-search payload injection. |
| `src/core/runtime.ts` | Wires Codex-compatible generated tools and prompt/provider extension hooks into runtime creation. |
| `src/core/profiles.ts` | Adds profile package flags for `codexCompat` and `providerWebSearch`. |
| `src/plugins/builtin.ts` | Adds the Codex compatibility plugin to the default plugin registry. |
| `test/codex-compat.test.mjs` | Adds focused tests for profile shape, prompt behavior, and provider web-search serialization. |

## 8. Product Boundary Notes

The implementation preserves the Pibo product boundary:

- Pibo owns plugin registration and profile selection.
- Pibo owns the visible tool catalog and tool descriptions.
- Pibo owns prompt wrapping through Pi extension hooks.
- Pibo owns provider payload mutation before the model request is sent.
- Pi Coding Agent remains the inner runtime for sessions, tools, streaming, and provider auth.
- Provider authentication continues through the existing Pi/Pibo model request path.

## 9. Recommended Next Decision

Before starting V2 implementation, run real model sessions with the `codex-compat` profile and record where behavior diverges from expectations.

The highest-value V2 decision is whether `web_search` should be:

1. hidden when the active provider does not support provider-backed search, or
2. made a hard profile activation error with a clear diagnostic.

This decision should be made before adding more compatibility surface area.
