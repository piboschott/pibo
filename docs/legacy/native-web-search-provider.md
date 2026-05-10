# Native Web Search Provider

`web_search` is a Pibo native tool. Profiles select the stable tool name `web_search`; the selected native tool carries provider metadata that tells the runtime how to make the provider capability available.

## Runtime Shape

The core plugin registers `web_search` in the capability catalog with an OpenAI provider adapter. The runtime does not expose a local DuckDuckGo function implementation for this tool. Instead, selected provider-backed tools create provider extensions before the Pi agent run starts.

For the OpenAI adapter, the extension injects the Responses hosted `web_search` tool into the provider request during `before_provider_request`. If source inclusion is enabled, it also asks for `web_search_call.action.sources`.

## Trace Visibility

Provider-backed search calls are currently not emitted as normal Pibo local tool execution events. That is expected for the runtime path, but it also means Chat Web traces and `pibo debug trace` need explicit provider-tool normalization before they can show hosted `web_search_call` activity.

Current validation showed a successful provider-backed search answer with external sources and no local DuckDuckGo tool result details, but no separate `web_search_call` trace node. The follow-up work is documented in `docs/provider-web-search-trace-visibility.md` and planned in `plans/implement-provider-web-search-trace-visibility.md`.

## Profile Contract

Profiles keep using the same native tool name:

```ts
context.getTool("web_search")
```

The provider is configured on the tool profile, not in Codex-specific tool packages. This keeps Codex compatibility as a profile concern and keeps web search as a product-level tool capability.

The `codex` profile currently selects:

- `apply_patch`
- `web_search`
- `view_image`

`apply_patch` and `view_image` are Codex compatibility tools. `web_search` is registered by the core plugin and backed by the OpenAI adapter.

## Adding Another Provider

Add another adapter behind the same tool interface:

1. Add the provider name to `WebSearchProviderToolProfile`.
2. Implement a `WebSearchProviderAdapter`.
3. Register it in the adapter map.
4. Configure the `web_search` tool profile to use that provider.

The model-facing tool name stays `web_search`.
