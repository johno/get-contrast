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

### Solver flags (find, fix)

`--direction auto|darker|lighter`, `--no-preserve-chroma`, `--gamut
srgb|display-p3`, `--max-change N`; `fix` takes `--change
foreground|background`, `find` takes `--against <color>` and `--role
foreground|background`. See the solver section of [modern-api.md](./modern-api.md).

## Exit codes (modern commands)

| Code | Meaning |
| --- | --- |
| 0 | Success; for `check`/`pick`/`find`/`fix`, the target is met (or already was) |
| 1 | The target is not met (`check` fails, `pick` has no winner, `find`/`fix` cannot reach it) |
| 2 | Usage error or an unusable color (message on stderr, nothing on stdout) |
| 3 | Unexpected failure (a bug); message on stderr |

The legacy invocation keeps its own historical codes (0, or 1 when not accessible).

## Output rules

- Results go to stdout, errors to stderr. User mistakes print one
  `error: ...` line (never a stack trace).
- ANSI colors only when stdout/stderr is a terminal. Piped output is plain.
  `NO_COLOR` and `TERM=dumb` disable colors, `FORCE_COLOR` enables them for
  pipes, and `--color` / `--no-color` override everything.
- `--no-warnings` (or `GET_CONTRAST_NO_WARNINGS=1`) suppresses library
  warnings, per [legacy-warnings.md](./legacy-warnings.md). The commands
  currently emit none.
