# Pibo Rules

This file captures fundamental project truths. These rules should guide design decisions, reviews, and future implementation work.

## 1. The CLI Must Be Iteratively Discoverable

Pibo is primarily operated by agents, not humans. The CLI is therefore an agent-facing discovery interface, not a traditional all-in-one help page.

This rule primarily applies to CLI help and information output: `--help`, default discovery output, `list`, `show`, `schema`, `paths`, `doctor`, and `guide`. These texts are how an agent learns an unknown CLI. The agent should be able to ask for help, see the immediate command surface, choose one branch, ask for help there, and continue exploring without receiving the full project context at once.

Every CLI level must provide only the context needed at that exact step and point to the next useful command. A top-level command should expose available areas. A nested command should expose only its immediate actions. Detailed schemas, guides, environment setup, examples, and long-form operational instructions must live behind explicit deeper commands such as `show`, `schema`, `paths`, `doctor`, or `guide`.

Avoid repeating the same information across levels. Repeated help text wastes context and makes agent behavior worse. Prefer compact, line-based outputs for discovery commands and reserve verbose output for commands that explicitly request detail.

The intended flow is progressive:

```text
pibo
  -> pibo tools
    -> pibo tools show browser-use
      -> pibo tools guides browser-use
        -> pibo tools guide browser-use browser-use
```

Each step should answer one question and make the next possible questions obvious.
