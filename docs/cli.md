# CLI

`contrast` ships inside the `get-contrast` package (`npx get-contrast` also
works through the `contrast` bin). Its implementation lives in `packages/cli`
and is copied into the package at build time, so installing `get-contrast`
gets the library and the command together.

## Legacy invocation (unchanged)

```sh
contrast <color1> [color2]     # color2 defaults to #fff
```

prints `Ratio:` and `Score:` and, if the pair is not accessible, a notice, with
the exit codes and output captured by the v3 compatibility suite
([v3-compatibility.md](./v3-compatibility.md)). Any first argument that is not
a command name is treated as a color, so existing scripts keep working. The
historical quirks (alpha ignored, `> 4.5` accessibility, uncaught `TypeError`
for invalid colors) are preserved; use the commands below for corrected
behavior.

## Commands

| Command | Does |
| --- | --- |
| `contrast check <fg> <bg>` | WCAG 2.2 report: ratio, every level and use, your target |
| `contrast wcag <fg> <bg>` | The ratio and what was measured; no judgment |
| `contrast pick <bg> <candidate...>` | Rank existing colors; pick the best that meets the target |
| `contrast find <color> --against <color>` | Smallest change that meets the target |
| `contrast fix <fg> <bg>` | Same, for a foreground/background pair |
| `contrast audit <palette.json \| ->` | Audit a palette: failing pairs and the best foreground for each background |
| `contrast matrix <palette.json \| ->` | The all-pairs contrast matrix |
| `contrast tokens <file \| -> --relations <file>` | Audit design tokens against explicit relationships; reviewable fixes |
| `contrast help [command]` | Help (`--help`, `-h`, `--version`, `-v` also work) |

Colors are anything the modern parser accepts: hex, `rgb()`, `hsl()`, `hwb()`,
`lab()`, `lch()`, `oklab()`, `oklch()`, `color(display-p3 ...)`, named colors,
with alpha. See [modern-api.md](./modern-api.md) for the semantics. (An `apca`
command is planned; it is waiting on a licensing decision, issue #43.)

### Target flags (check, pick, find, fix)

| Flag | Meaning |
| --- | --- |
| `--level AA\|AAA` | WCAG level (default AA) |
| `--use text\|large-text\|ui` | Use of the color (default text) |
| `--min-ratio N` | Custom minimum ratio (1 to 21); replaces level/use |
| `--backdrop COLOR` | Opaque color behind a translucent background (default `#ffffff`) |

Output always says which threshold applied (for example
`Target AAA text (7:1): FAIL`), so a result is never ambiguous about the rule.

### Palettes (audit, matrix)

```sh
contrast audit palette.json --level AAA
contrast matrix palette.json --only failing --json
cat colors.txt | contrast audit -
```

The palette is a JSON array of colors or `{ "name", "color" }` objects, a
`{ "name": "color" }` map, a `{ "colors": ... }` wrapper, or plain text with one
color per line; `-` reads stdin. Object keys follow JavaScript property order
(integer-like keys first), so use an array when order matters. Colors that are
the same after conversion to sRGB (`white`, `#fff`, `color(display-p3 1 1 1)`)
are noted and counted once. `audit` prints a summary, the pairs that miss the
target (each opaque combination once, `--limit N`, default 25), and the best
foreground for each background; `matrix` prints the grid (rows are foregrounds,
columns backgrounds; `(parenthesized)` ratios miss the target) and, above 16
colors, a summary unless you pass `--wide`. `--only passing|failing` filters the
JSON `pairs`, and `--max-colors N` (default 200) guards against huge matrices.
Both exit 0: they inform rather than judge. The result is the library's
`audit()` result ([modern-api.md](./modern-api.md)); the file reading is a thin
adapter (`packages/cli/src/palette-input.js`) kept separate from the audit logic.

### Design tokens (tokens)

```sh
contrast tokens tokens.json --relations relations.json
contrast tokens theme.css --scope '[data-theme=dark]' --relations relations.json --json
```

Audits **explicit** relationships, not every possible token pair: a pair like
`text.muted` on `surface.default` is only meaningful if someone says so. The
relations file is a JSON array (or `{ "relations": [...] }`) of
`"text.default -> surface.default"` strings, `["fg", "bg"]` pairs, or objects
`{ foreground, background, name?, level?, use?, minRatio?, candidates? }` (a
relation's own target overrides the command's `--level`/`--use`/`--min-ratio`).

Token files:

- **JSON**: nested objects whose leaves are colors, or objects with `$value`
  (W3C Design Tokens) / `value` (Style Dictionary); `$type` is read and groups
  inherit it. A whole-value alias `"{color.gray.500}"` references another token.
  Token names are dot paths.
- **CSS custom properties**: `--name: value` declarations with `var(--other)`
  / `var(--other, fallback)` references. Names include the leading `--` (it may
  be omitted in relations). `:root` applies first and `--scope` (a selector such
  as `[data-theme=dark]`, or an at-rule such as `@media (prefers-color-scheme:
  dark)`) overrides it, like the cascade. Nested at-rules are flattened.

For each **failing** relation the report shows both tokens and their resolved
values, the current ratio and the required one, and a fix, **existing tokens
first**: among tokens that meet the target (judged by `pick()`) the one
perceptually nearest to the current value is suggested, searched in the
foreground token's own namespace (`text.*` for `text.muted`; override with
`--candidates` or a relation's `candidates`). Only if none qualifies is a new
color synthesized with `fix()`. When a new color would change less than the
existing token, the report says so, so a person can choose. Tokens that are
themselves about to be edited are never offered as replacements.

Nothing is written. The suggested edits (`token`, `from`, `to`, where it lives)
are printed; `--json` adds them to `result.edits` and as `patch`, an RFC 6902
patch for JSON token files. The audit applies the edits in memory and re-checks
every relation (`result.verification`), so a suggestion that would break another
relation (for example an edited token that is also a background elsewhere) is
reported, not hidden. Exit codes: 0 all pass, 1 some fail, 2 a token cannot be
resolved (unknown, circular, not a color) or the input is invalid. Resolution
errors are per relation, with near-name suggestions, and do not stop the others.

### Solver flags (find, fix)

`--direction auto|darker|lighter`, `--no-preserve-chroma`, `--gamut
srgb|display-p3`, `--max-change N`; `fix` takes `--change
foreground|background`, `find` takes `--against <color>` and `--role
foreground|background`. See the solver section of [modern-api.md](./modern-api.md).

## Scripting: JSON, quiet, stdin

### `--json`

Prints exactly one JSON document on stdout, with nothing else on stdout
(no colors, logs, or warnings). The document is a small envelope around **the
library's own result object**, so the shapes in [modern-api.md](./modern-api.md)
(`CheckResult`, `WcagResult`, `PickResult`, `FixResult`) are the schema:

```json
{ "schema": 1, "command": "check", "exitCode": 1, "result": { "ratio": 4.478, "target": { "passes": false }, "...": "..." } }
```

| Field | Meaning |
| --- | --- |
| `schema` | Envelope version. Additive changes (new fields) keep the number; a breaking change bumps it |
| `command` | `check`, `wcag`, `pick`, `find` or `fix` |
| `exitCode` | The process exit code, repeated for consumers that only see stdout |
| `result` | The library result (success and "target not met" alike) |
| `error` | Instead of `result` when the exit code is 2 or 3: `{ code, message, role?, input? }` |

`error.code` is the library's `ParseErrorCode` for unusable colors
(`invalid-syntax`, `empty`, `unsupported-function`, ...) with the offending
argument in `role` (`foreground`, `background`, `candidates[2]`, ...), `usage`
for bad flags/arguments, `invalid-option` for out-of-range option values, or
`internal` for exit code 3. In JSON mode errors go to stdout as JSON and stderr
stays empty. The output shape is pinned by a snapshot test
(`packages/cli/test/fixtures/json-shapes.json`).

### `--quiet`

Prints nothing on stdout; the exit code is the answer, which suits `if` and CI
gates: `contrast check "$FG" "$BG" --quiet || exit 1`. Errors still go to
stderr. `--json --quiet` is a usage error.

### stdin

`contrast pick <background> -` reads candidates from stdin: a JSON array of
colors or `{ "name": "...", "color": "..." }` objects, or one color per line
(blank lines ignored). A terminal on stdin is refused with a message rather than
waiting forever. Other commands do not read stdin.

## Exit codes (modern commands)

| Code | Meaning |
| --- | --- |
| 0 | Success; for `check`/`pick`/`find`/`fix`, the target is met (or already was) |
| 1 | The target is not met (`check` fails, `pick` has no winner, `find`/`fix` cannot reach it) |
| 2 | Usage error or an unusable color (message on stderr, nothing on stdout; or JSON `error` with `--json`) |
| 3 | Unexpected failure (a bug); same reporting as 2 |

`wcag` never judges, so it only exits 0 or 2. The legacy invocation keeps its
own historical codes (0, or 1 when not accessible). The matrix is exercised by
`packages/cli/test/json.e2e.test.js`.

## Output rules

- Results go to stdout, errors to stderr (stdout in `--json` mode). User
  mistakes print one `error: ...` line (never a stack trace).
- ANSI colors only when stdout/stderr is a terminal. Piped output is plain.
  `NO_COLOR` and `TERM=dumb` disable colors, `FORCE_COLOR` enables them for
  pipes, and `--color` / `--no-color` override everything. `--json` is never
  colored.
- `--no-warnings` (or `GET_CONTRAST_NO_WARNINGS=1`) suppresses library
  warnings, per [legacy-warnings.md](./legacy-warnings.md). The commands
  currently emit none.
