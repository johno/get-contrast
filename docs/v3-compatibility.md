# get-contrast v3 compatibility contract

This document records what `get-contrast@3.0.1` does, so v4 can stay
backwards-compatible. It describes observed behavior, not ideal behavior.
Executable characterization tests live in `packages/get-contrast/compat/v3-contract.test.js`
(`bun run test:compat`). A fixture-driven golden suite
(`packages/get-contrast/compat/golden.test.js`, fixtures in `packages/get-contrast/compat/fixtures/`) replays a large
input matrix and the CLI; after an intentional change run
`bun run compat:update` and review the fixture diff.

Categories used below:

- **Guaranteed**: v4 must keep this behavior in the legacy entry points.
- **Quirk**: undesirable, but observable. Legacy entry points must keep it.
  Corrected behavior only ships in new v4 APIs.
- **May warn**: v4 may emit a targeted, suppressible warning (see #33).
- **Modern only**: corrected only by new v4 APIs.

## Package metadata (Guaranteed)

| Field   | Value                |
| ------- | -------------------- |
| name    | `get-contrast`       |
| main    | `index.js` (CommonJS) |
| types   | `dist/cjs/index.d.ts` (generated; no published version shipped declarations, and the hand-written `types/index.d.ts` was never in `files`) |
| bin     | `contrast` -> `cli.js` |

The module exports exactly `ratio`, `score`, `isAccessible`, and
`isNotTransparent`, as properties of `module.exports`.

## API

All functions take color strings. `options` is optional; only
`options.ignoreAlpha` is read. `null`/`undefined`/`{}` options behave
identically. Extra arguments are ignored.

### `ratio(colorOne, colorTwo, options?)` (Guaranteed)

Returns a `number` (WCAG 2.x contrast ratio, `>= 1`, `<= 21`), unrounded.
Symmetric: `ratio(a, b) === ratio(b, a)`. `ratio("#000", "#fff") === 21`;
identical colors give `1`.

### `score(colorOne, colorTwo, options?)` (Guaranteed)

Returns one of `"AAA"` (`ratio >= 7`), `"AA"` (`>= 4.5`), `"AA Large"`
(`>= 3`), `"Fail"`. The `"F"` fallback in the source is unreachable.

### `isAccessible(colorOne, colorTwo, options?)` (Guaranteed, Quirk)

Returns `ratio(...) > 4.5`. The comparison is **strict**, so a ratio of
exactly 4.5 is *not* accessible even though `score` reports `"AA"` for it.
Threshold is fixed (see #15). May warn: disagreement with `score` at 4.5.

### `isNotTransparent(color, options?)` (Guaranteed)

Parses the color with the legacy parser (a port of `rgb@0.1.0`, see `src/legacy-parse.ts`) and returns a **normalized string**
(`"rgb(r,g,b)"` or `"rgba(r,g,b,a)"`, no spaces). Throws `TypeError`
`get-contrast cannot contrast transparent colors` when alpha is `0`, unless
`options.ignoreAlpha` is truthy. Despite the name it returns a string, not a
boolean.

## Accepted input

- Strings only. Input is lowercased; the `rgb` package tolerates surrounding
  whitespace for hex and function forms.
- Hex: `#rgb`, `#rrggbb`, `#rgba`, `#rrggbbaa`, any case.
- `rgb()` / `rgba()` with **comma-separated** values; integers or percentages.
- `hsl()` / `hsla()` with comma-separated values.
- Named CSS colors (any case) **in `ratio`/`score`/`isAccessible` only**.
- `transparent` parses as `rgba(0,0,0,0)`.

Not accepted (throws): space-separated syntax (`rgb(0 0 0)`,
`rgb(0 0 0 / 50%)`), `hwb`, `lab`, `lch`, `oklab`, `oklch`, `color()`,
`inherit`, `currentColor`, empty/blank strings, out-of-range channels such as
`rgb(300,0,0)`. Modern parsing is **Modern only** (Phase 2).

## Errors (Guaranteed)

| Condition | Class | Message |
| --- | --- | --- |
| non-string color passed to `ratio`/`score`/`isAccessible` | `TypeError` | `get-contrast expects colors as strings` |
| transparent (alpha 0) without `ignoreAlpha` | `TypeError` | `get-contrast cannot contrast transparent colors` |
| unparseable string | `TypeError` | engine-dependent: `Cannot read properties of null (reading 'match')` on V8 |

The unparseable-string message is an accident of the current implementation
(a JS-engine null-dereference message; JavaScriptCore words it differently). Its **class** (`TypeError`) is guaranteed;
the exact text is a **Quirk** that v4 may improve only if tests and docs say
so. `inherit` (#5) falls in this bucket: it throws like any invalid value.

## Quirks that legacy entry points must preserve

1. **Alpha is ignored in contrast math.** `rgba(0,0,0,.5)` and `#000` have the
   same ratio. Only alpha `0` is special. Compositing is **Modern only**.
2. **`ignoreAlpha` only disables the transparency check.** The color's RGB
   channels are still used (`transparent` becomes black).
3. **`isNotTransparent` does not resolve named colors.** `isNotTransparent("tomato")`
   throws the unparseable-string `TypeError`, though `ratio("tomato", ...)` works.
   `transparent` is the one name that works there.
4. **Named colors need an exact (lowercased) match**, so `" tomato"` (leading
   space) throws, while `"  #fff "` works.
5. **Malformed hex is partly accepted.** `#12345` parses as `rgb(18,52,5)`.
6. **`isAccessible` is strict `> 4.5`** (above).
7. **Types drift.** `types/index.d.ts` declares `ratio` as returning `string`
   and `ignoreAlpha` as required in options. At runtime `ratio` returns a
   `number`. Fixing the declarations is a typing change, not a runtime change;
   see #12/#18.
8. `#ffffff80` style 8-digit hex alpha is kept as a fraction
   (`rgba(255,255,255,0.5019607843137255)`) by `isNotTransparent`.

## CLI: `contrast <color1> [color2]` (Guaranteed)

- No arguments: prints `usage: contrast <color1> [color2 (default: #fff)]` to
  **stderr** and exits `0`.
- `color2` defaults to `#fff`. Only `argv[2]` and `argv[3]` are read; further
  arguments are ignored (#6 concerns second-color handling and is unchanged
  here).
- stdout, two lines: `Ratio: <number>` then `Score: <score>`.
- If `isAccessible` is false, also prints `The contrast is not accessible.`
  to **stdout** and exits `1`. Otherwise exits `0`.
- Invalid colors are uncaught exceptions: stack trace on stderr, exit `1`,
  nothing on stdout. Stack-trace text includes file paths and is not
  part of the contract; the `TypeError: <message>` line is.

## Out of scope for the legacy API

APCA (#10), configurable thresholds (#15), and new color syntaxes are
**Modern only**.
