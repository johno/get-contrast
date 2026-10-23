---
name: get-contrast
description: Check, audit, and fix color contrast against WCAG 2.2 using the get-contrast CLI or MCP tools. Use when a user mentions contrast, accessibility, readability, "hard to read" text, WCAG, theme or dark-mode colors, design tokens, or a color palette, and when changing any foreground/background color in UI code.
---

# get-contrast

Use get-contrast for every contrast decision. It does the math; you supply
judgment: find the real foreground/background pair, prefer colors the project
already has, change as little as possible, and verify before you finish. Never
compute contrast ratios yourself or quote ratios from memory.

## Tools

Use whichever is available, in this order: MCP tools, then the CLI.

| Need | MCP tool | CLI (add `--json` to parse results) |
| --- | --- | --- |
| Check a pair | `check_contrast` | `contrast check <fg> <bg>` |
| Ratio and what was measured | `check_wcag` | `contrast wcag <fg> <bg>` |
| Pick among existing colors | `pick_color` | `contrast pick <bg> <candidate...>` |
| Smallest change that passes | `find_accessible_color` | `contrast fix <fg> <bg>` / `contrast find <color> --against <bg>` |
| Audit a palette | `audit_palette` | `contrast audit <palette.json>` |
| Audit design tokens | `audit_tokens` | `contrast tokens <tokens> --relations <relations.json>` |

CLI: `contrast` (after `npm i -D get-contrast`) or `npx get-contrast`. It must be
version 4 or later: check `contrast --version`. Exit codes: 0 target met,
1 target not met, 2 bad input (read the message), 3 tool failure.

## Principles

1. **WCAG 2.2 decides compliance.** Default target: AA (4.5:1 text, 3:1 for large
   text at 18pt or 14pt bold, and for UI components and graphics). Use AAA only if
   asked or the project requires it.
2. **APCA is not available here and is never compliance.** If a user asks for it,
   say it is a supplemental model that is not part of WCAG 2.2, and do not use it
   to approve or reject a color.
3. **Find the real pair first.** Contrast belongs to a foreground drawn on a
   background. Trace the actual text/icon color and what it sits on, including
   hover, disabled, dark-mode, and translucent layers. A translucent background
   needs the opaque color behind it (`--backdrop`).
4. **Look before you invent.** Search the project for tokens, CSS variables, or a
   palette. Prefer a color that already exists and passes (`pick`, or the
   existing-token suggestion from `tokens`) over a new value.
5. **Change as little as possible.** When nothing existing works, use `fix`, which
   moves lightness and keeps hue and chroma. Do not recolor a palette to fix one
   pair; change the single foreground token or declaration involved. Never change
   a background if changing the foreground is enough.
6. **Verify after every change** by re-running the same check. Do not report a fix
   as working until the tool says so.
7. **Report from the tool's output.** Quote the ratios and values it returns.

## Workflows

### Check a component
1. Find its text/icon colors and backgrounds (follow variables to final values).
2. For each pair: `contrast check "<fg>" "<bg>" --use text|large-text|ui --json`.
3. Report each pair's ratio and whether it meets the target. Exit 1 means a miss.

### Fix one failed pair
1. `contrast check <fg> <bg> --json` to confirm the failure and the target.
2. If the project has tokens or a palette for this role, run
   `contrast pick <bg> <candidates...>` with those values, or `contrast tokens`
   (below). Use a passing existing color if one is close in intent.
3. Otherwise `contrast fix <fg> <bg> --json`. Use `result.suggested.css`. If
   `reached` is false, say why (`limitedBy`) and what the best option was; do not
   claim success. Try `--change background` only if the foreground must not move.
4. Apply the change to the one place the color is defined.
5. Re-run step 1 on the new value and confirm it passes.

### Audit a palette
`contrast audit palette.json --json` (or `matrix` for the grid). Report which
backgrounds have no passing foreground and which pairs the design relies on that
fail. Pairs that are never used together are not defects.

### Audit design tokens
1. Write `relations.json` listing the pairs that really occur, as
   `"text.muted -> surface.default"` strings (do not test every token pair).
2. `contrast tokens <tokens.json|theme.css> --relations relations.json --json`
   (CSS dark themes: `--scope '[data-theme=dark]'`, one run per theme).
3. For failures, prefer `suggestion.existing` (an existing token), else
   `suggestion.synthesized`. The tool does not edit files: apply `result.edits`
   (JSON files also get `patch`) yourself, only for the failing tokens.
4. If `result.verification.ok` is false, an edit would break another relation;
   resolve that before finishing. Re-run the audit; it must exit 0.

### Review color changes for regressions
1. Run the relevant audit on the base version (`git stash`, `git show BASE:file`)
   and on the changed version, with the same relations.
2. Report relations that passed before and fail now, and new unresolved tokens.
   Compare results, not eyeballed values.

## Finishing

Summarize: each pair, before and after ratio (from the tool), what changed and
why that option over alternatives, and anything left failing with the reason.
Keep the diff small. If you could not run the tool, say so instead of estimating.

## Examples

- "The muted text on our cards is too faint." Find the muted-text token and the card
  surface; `contrast tokens ... --json` or `contrast check`; apply the suggested
  existing token if present, else `contrast fix`; re-check; report ratios.
- "Does our dark theme meet AA?" Write relations, run `contrast tokens ... --scope
  '[data-theme=dark]'`, report failures with suggested fixes.
- "I changed the brand color; anything break?" Review workflow above.
