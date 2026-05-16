---
name: ralph-prd-json
description: Convert Markdown PRDs and feature specs into Ralph prd.json story batches. Use whenever the user asks to convert a PRD for Ralph, create Ralph JSON, split a PRD into executable stories, prepare PRD story files, or mentions prd.json for autonomous implementation.
---

# Ralph PRD JSON Converter

Convert existing PRDs, specs, or Markdown feature descriptions into the `prd.json` format Ralph can execute.

Use this skill for **PRD/story shaping**, not for creating or operating the Ralph job itself. For job creation, Docker worker reuse, worktrees, stop policies, and monitoring, use the `ralph-loop` skill.

## Output Format

```json
{
  "project": "[Project Name]",
  "branchName": "ralph/[feature-name-kebab-case]",
  "description": "[Feature description from PRD title/intro]",
  "userStories": [
    {
      "id": "US-001",
      "title": "[Story title]",
      "description": "As a [user], I want [feature] so that [benefit]",
      "acceptanceCriteria": [
        "Criterion 1",
        "Criterion 2",
        "Typecheck passes"
      ],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
```

## Story Size Rule

Each story should fit in one Ralph iteration and one context window. Split broad requirements until each story has a focused implementation and verification path.

Good story sizes:

- Add a database column and migration.
- Add one CLI subcommand and tests.
- Add one service method plus focused tests.
- Add one UI component to an existing page.

Too large:

- Build the whole dashboard.
- Add the entire telemetry system.
- Refactor the API.

Rule of thumb: if the change cannot be described in 2 to 3 sentences, split it.

## Story Ordering

Order by dependencies:

1. Schema and migrations.
2. Store/service layer.
3. Runtime instrumentation or backend logic.
4. CLI/API/UI surfaces.
5. Docs and validation.

Earlier stories must not depend on later stories.

## Acceptance Criteria

Use criteria Ralph can verify.

Good:

- `Add telemetry_turns table with session, turn, status, timestamps, and retention fields`.
- `pibo debug telemetry stats --json returns counts by retention class`.
- `Focused tests pass`.
- `Typecheck passes`.

Bad:

- `Works correctly`.
- `Good UX`.
- `Handles everything`.

Always include `Typecheck passes`. Add `Tests pass` for logic. Add browser verification only for UI stories.

## Conversion Rules

1. One user story per JSON entry.
2. IDs are sequential, e.g. `US-001`.
3. Priority follows dependency order, then document order.
4. New stories start with `passes: false` and empty `notes`.
5. `branchName` is kebab-case and prefixed with `ralph/`.
6. Keep stories independent enough that Ralph can commit after each story or coherent group.

## Checklist Before Saving

- [ ] Stories fit one iteration.
- [ ] Stories are ordered by dependency.
- [ ] Acceptance criteria are verifiable.
- [ ] Every story has `Typecheck passes`.
- [ ] Logic stories include `Tests pass`.
- [ ] UI stories include browser verification.
- [ ] No story depends on a later story.