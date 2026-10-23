# Modern API (v4)

The v3 functions (`ratio`, `score`, `isAccessible`, `isNotTransparent`) are
unchanged and keep their documented quirks (see
[v3-compatibility.md](./v3-compatibility.md)). The modern API is additive and
lives in the same package entry. It parses every CSS color syntax the color
engine supports, treats alpha correctly, and returns structured results.

## `check(foreground, background, options?)`

```js
const { check } = require("get-contrast");

const r = check("rgba(0, 0, 0, 0.75)", "#fafafa", { level: "AA", use: "text" });
r.ratio;       // 10.1... (unrounded)
r.ratioText;   // "10.11:1" (truncated to two decimals, never rounded up)
r.results;     // { aa: { text, largeText }, aaa: { text, largeText }, ui }
r.target;      // { level: "AA", use: "text", threshold: 4.5, custom: false, passes: true }
r.foreground;  // { original, color, hex, luminance }: what was actually measured
r.notes;       // [{ code: "foreground-alpha", message }]: explains alpha / gamut handling
```

`wcag(foreground, background, options?)` returns the same without the pass/fail
table (`ratio`, `foreground`, `background`, `notes`).

Colors are CSS strings or `Color` objects (from `parseColor`). Unusable colors
throw `ColorInputError` (a `TypeError`) with a stable `code`, the argument's
`role` (`"foreground"`, `"background"`, `"backdrop"`), and a bounded `input`.

### Options

| Option | Meaning |
| --- | --- |
| `level` | `"AA"` (default) or `"AAA"` for `target` |
| `use` | `"text"` (default), `"large-text"` (18pt, or 14pt bold), or `"ui"` (non-text contrast, 1.4.11) |
| `minRatio` | A custom minimum (1 to 21) replacing the level/use threshold, for policies WCAG does not name |
| `backdrop` | The opaque color behind a translucent background. Default white, with a `backdrop-assumed` note |

`results` always reports every WCAG threshold at once; `target` evaluates the
one you asked about. Thresholds: AA 4.5 / 3 (large) / 3 (ui), AAA 7 / 4.5 / 3
(`WCAG_THRESHOLDS`, `thresholdFor`). Comparisons are `>=` on the unrounded
ratio.

## Where it differs from the v3 functions

| Behavior | v3 `ratio`/`score`/`isAccessible` | `check`/`wcag` |
| --- | --- | --- |
| Alpha | ignored, except alpha 0 throws | composited like a browser paints it, with a note |
| Syntaxes | hex, comma `rgb()`/`hsl()`, names (+ quirks) | all of CSS Color 4 the engine supports (`lab()`, `oklch()`, `color(display-p3 ...)`, space syntax, ...) |
| Invalid input | engine-dependent `TypeError` message | `ColorInputError` with `code` and `role` |
| sRGB threshold | 0.03928 (WCAG 2.0) | 0.04045 (WCAG 2.2). Identical results for 8-bit colors; tests assert it |
| AA decision | `isAccessible` is strictly `> 4.5` | `>=` against an explicit threshold |
| Wide-gamut colors | not representable | measured unclipped and flagged with a note |

For opaque 8-bit colors the two agree exactly on the ratio, so migrating a
call like `ratio(a, b)` to `wcag(a, b).ratio` only changes results where v3 was
wrong (translucent colors) or threw.
