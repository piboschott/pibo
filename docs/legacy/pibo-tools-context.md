# Installed Pibo Tool Context

Installed curated CLI tools can publish a short runtime-context snippet through the `pibo tools` registry.

## Runtime Injection

At runtime, Pibo reads the currently installed curated tools and collects their `agentContextSnippet` entries. The snippets are combined into one synthetic context document:

- label: `Installed Pibo Tools`
- path: `.pibo/context/installed-pibo-tools.md`
- lifecycle: generated from the current installed-tool state on each runtime build

This keeps agent profiles small while still giving the agent a minimal hint that a curated tool exists and how to begin discovery. Full operational detail stays in the CLI surface such as `pibo tools show <tool>` and `pibo tools guide <tool>`.

If a curated tool is removed, its snippet disappears automatically because the synthetic document is rebuilt from the current installation state.

## Chat Web Visibility

The Chat Web Context area at `/apps/chat/context` exposes the same injected tool hints in a dedicated `Pibo Tools` sidebar panel. That panel is read-only and mirrors the high-level context the agent receives, while the CLI remains the primary discovery and usage interface.
