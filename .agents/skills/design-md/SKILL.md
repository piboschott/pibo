---
name: design-md
description: Analyze existing product screens, UI code, design artifacts, and visual references to synthesize a semantic design system into DESIGN.md files.
allowed-tools:
  - "Read"
  - "Write"
  - "web_fetch"
  - "stitch*:*"
---

# DESIGN.md Skill

You are an expert Design Systems Lead. Your goal is to analyze provided visual and technical assets and synthesize a semantic design system into a file named `DESIGN.md`.

## Overview

This skill helps create `DESIGN.md` files that serve as the source of truth for generating, implementing, and reviewing new screens that align with an existing design language.

The core output is a semantic design system: it translates code, screenshots, prototypes, or existing UI into clear visual descriptions supported by precise values such as hex colors, spacing patterns, typography rules, and component behavior.

Use this skill for any project with enough visual evidence to infer a design language. The source can be a running app, screenshots, HTML/CSS, React/Vue/Svelte components, Tailwind classes, Figma/Stitch output, design mockups, or a hand-written prototype.

## Goal

Create or update `DESIGN.md` so future work can reproduce the same visual language without re-analyzing the original UI.

The document must answer:

- What does the product feel like?
- Which colors exist and what are their roles?
- How does typography communicate hierarchy?
- How are components shaped, bordered, spaced, and elevated?
- How should layouts behave across screens?
- Which visual patterns must remain consistent across the app?

## Source Retrieval

Use the available source material. Prefer local project assets before external retrieval.

### Local Code And Assets

When working in a repository, inspect likely design sources:

- `DESIGN.md` if it already exists
- `README.md`, docs, specs, and design notes
- global CSS files
- Tailwind config or CSS theme tokens
- component directories
- route/page files
- static HTML prototypes
- screenshot or design folders
- storybook or examples
- test snapshots when visual components are covered there

Useful searches:

```bash
rg --files -g '*.{css,scss,less,html,tsx,jsx,ts,js,vue,svelte,md}'
rg -n "theme|color|background|border|rounded|shadow|font|spacing|className|tailwind"
```

### Screenshots And Images

If screenshots or local images are provided, inspect them as visual references. Extract atmosphere, density, layout, hierarchy, geometry, color relationships, and interaction affordances.

### Web Or Hosted Design Sources

If a hosted design reference is provided, fetch only the relevant page or asset. Use official or user-provided URLs. Extract visual and code patterns without copying unrelated content.

### Stitch Or Other Design Tools

If the source is a Stitch project, Figma export, or another design tool, use the available tool or exported assets to retrieve screen metadata, screenshots, and HTML/CSS. Stitch is one possible source, not a requirement.

For Stitch specifically, if MCP tools are available and a project id or URL is provided:

1. Discover the Stitch tool namespace if needed.
2. List or fetch the target project.
3. List or fetch the target screen.
4. Retrieve screenshot and HTML/CSS assets.
5. Extract project theme metadata if available.

Skip this section entirely when the project is not using Stitch.

## Analysis & Synthesis Instructions

### 1. Extract Project Identity

Identify:

- project or product name
- relevant screen or feature name
- source artifact paths or URLs
- project id only when one exists in the source system

If there is no external project id, use a clear local identifier such as `local-reference-[project-name]`.

### 2. Define The Atmosphere

Evaluate the visual source and describe the overall mood and product philosophy. Use precise adjectives such as:

- dense
- airy
- utilitarian
- editorial
- terminal-like
- industrial
- playful
- calm
- premium
- tactile
- data-heavy
- operational

Explain why the UI feels that way: density, colors, typography, borders, shadows, rhythm, imagery, iconography, and interaction style.

### 3. Map The Color Palette

Identify key colors and give each a semantic name.

For each color, include:

- descriptive name
- exact hex value
- functional role
- typical component usage

Do not describe colors only as "blue" or "gray." Prefer names like "Terminal Cyan (#11a4d4)" or "Deep Muted Teal-Navy (#294056)".

Group colors by function when possible:

- core backgrounds and surfaces
- primary actions and identity
- semantic status colors
- accent colors
- text and metadata colors
- borders and dividers
- code or data visualization colors

### 4. Translate Geometry & Shape

Convert technical shape values into visual language.

Examples:

- `rounded-full` means circular or pill-shaped.
- `rounded-sm` means tiny softened corners.
- `rounded-lg` means gently rounded corners.
- `rounded-none` means sharp, squared-off geometry.

Document:

- border radius strategy
- card shape
- button shape
- input shape
- icon container shape
- density of borders and dividers

### 5. Describe Depth & Elevation

Explain how the UI creates layers:

- flat borders
- tonal surfaces
- subtle shadows
- strong drop shadows
- glows
- overlays
- backdrops

State whether elevation should be quiet, dramatic, tactile, or mostly absent.

### 6. Document Typography

Capture:

- font families
- heading scale
- body scale
- label scale
- monospaced usage
- font weights
- letter spacing
- case style
- numeric/tabular treatment

Explain how type communicates hierarchy and how text should sound inside the UI.

### 7. Describe Component Patterns

Document reusable styling for the components that define the product.

Common categories:

- app shell
- headers
- navigation
- sidebars
- cards
- buttons
- inputs
- tabs
- badges
- tables or lists
- modals
- inspectors
- logs
- code blocks
- JSON/data renderers
- empty states
- error states

For each component type, describe shape, color, spacing, borders, typography, hover/focus states, and any distinctive behavior.

### 8. Capture Layout Principles

Document:

- page composition
- panel structure
- grid strategy
- sidebar widths
- content max widths
- spacing rhythm
- scroll behavior
- responsive behavior
- how hierarchy is shown spatially

This section should tell a future designer or agent how to build a new screen in the same visual language.

## Output Guidelines

- Write clear Markdown.
- Use descriptive design terminology and natural language.
- Include exact values when known: hex colors, pixel values, rem values, widths, spacing, radii, and font sizes.
- Explain the purpose behind each choice.
- Make the document useful for both human designers and coding agents.
- Prefer semantic names over implementation-only names.
- Preserve project-specific terminology when it matters.
- Do not include unrelated implementation plans.
- Do not invent a broad design system when the source only supports a narrow one; mark uncertain areas as recommendations.

## Output Format

Use this structure unless the user asks for a different one:

```markdown
# Design System: [Project Title]
**Project ID:** [Project ID or local reference identifier]

## 1. Visual Theme & Atmosphere
[Description of mood, density, aesthetic philosophy, and product feeling.]

## 2. Color Palette & Roles
[Colors by descriptive name, exact hex code, and functional role.]

## 3. Typography Rules
[Font family, size hierarchy, weight usage, letter spacing, case, and monospaced usage.]

## 4. Component Stylings
* **Buttons:** [Shape, colors, states, behavior.]
* **Cards/Containers:** [Roundness, background, borders, depth.]
* **Inputs/Forms:** [Stroke style, background, focus state.]

## 5. Layout Principles
[Whitespace, margins, grids, panels, responsive behavior, alignment.]
```

For richer products, add sections such as:

- `## 6. Motion And Interaction`
- `## 7. Applying This System Across The App`
- `## 8. Accessibility And Contrast`
- `## 9. Anti-Patterns`

## Best Practices

- **Start with the big picture:** Capture the atmosphere before listing tokens.
- **Be descriptive:** Avoid generic terms like "blue" or "rounded."
- **Be functional:** Explain where and why each element is used.
- **Be precise:** Include exact values after natural language descriptions.
- **Be consistent:** Use the same semantic names throughout the document.
- **Be visual:** Help readers imagine the screen without seeing it.
- **Look for repeated patterns:** Document what repeats, not one-off accidents.
- **Separate source facts from recommendations:** If a rule is inferred, say so.
- **Preserve hierarchy:** Explain how the UI guides attention.

## Common Pitfalls To Avoid

- Using only technical class names without translating them into design language.
- Omitting exact color codes.
- Listing tokens without explaining their roles.
- Treating a one-off screen as a universal rule without evidence.
- Ignoring spacing, borders, shadows, and density.
- Ignoring interaction states such as hover, focus, selected, active, running, disabled, and error.
- Overfitting the document to a design tool when the real source is the application code.
- Adding speculative redesign ideas instead of documenting the existing design language.
