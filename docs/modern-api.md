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

## `pick(background, candidates, options?)`

Chooses among colors you already have, so a design system or agent can prefer a
palette value over inventing one.

```js
const { pick } = require("get-contrast");

const r = pick("#ffffff", [
  { name: "text/secondary", color: "#767676" },
  { name: "text/primary", color: "#111111" },
  "#dddddd",
]);
r.winner.name;   // "text/primary"
r.reason;        // "text/primary (#111111) has the highest contrast (18.88:1) of the 2 candidates that meet AA text 4.5:1 target."
r.reasonCode;    // "highest-contrast"
r.ranked;        // every candidate, best first, each with its full check() result
```

- `options` are `check()`'s: `level`, `use`, `minRatio`, `backdrop`.
- **Ranking:** candidates that meet the target come first, then higher contrast
  ratio, then input order. Equal contrast never reorders candidates, so results
  are deterministic; the reason says when a tie was broken by order.
- **When nothing passes** `winner` is `null`, `reasonCode` is `"none-pass"`, and
  `ranked[0]` is the closest candidate, so callers can show the near miss
  without it being mistaken for success.
- Candidates are CSS strings, `Color` objects, or `{ name, color }`. Bad input
  throws `ColorInputError` whose `role` is `background` or `candidates[i]`.
- Arguments are never mutated. Alpha, wide-gamut and every modern syntax use the
  same engine as `check()`.
- APCA metadata (listed as optional in the roadmap) is not included yet; the
  APCA model is waiting on a licensing decision (see issue #43). Adding it later
  only adds fields.

## `find(color, against, options?)` and `fix(foreground, background, options?)`

"This pair fails; what is the smallest sensible change that makes it pass?"
`fix` is a convenience wrapper over `find`: one solver, two spellings.

```js
const { fix } = require("get-contrast");

const r = fix("#ffcc00", "#ffffff");           // adjust the foreground (default)
r.reached;                 // true: the suggestion meets the target
r.suggested.css;           // "#917300", ready to paste
r.suggested.check.ratioText; // "4.51:1": a full check() of the suggested pair
r.original.check;          // the check() of the pair as given
r.change.deltaE;           // 0.30: perceptual distance (OKLab; black to white = 1)
r.change.dimensions;       // ["lightness", "chroma"]
r.notes;                   // "chroma-reduced-for-gamut": the original chroma does not fit sRGB that dark
```

`fix(fg, bg, { change: "background" })` adjusts the background instead.
`find(color, against, { role })` adjusts `color`, treated as the foreground
(default) or the background.

### How it searches

- The search runs in **OKLCH**, so equal steps look equal. By default only
  **lightness** moves: chroma and hue stay. Hue is never rotated; moving
  lightness toward 0 or 1 always reaches black or white, so no hue can do better
  than lightness alone, and rotating hue only adds change.
- If the wanted chroma does not fit the target gamut at some lightness, chroma is
  reduced just enough to fit (hue and lightness kept) and a `chroma-reduced-for-gamut`
  note says so. Nothing is clamped silently.
- `preserveChroma: false` lets the solver also lower chroma when that reaches
  the target with less overall change (`chroma-reduced-to-reach-target`).
- The boundary is found with a scan plus bisection and the answer is the
  **passing** side, so the target is met conservatively. The result is then
  serialized (8-bit hex for sRGB), parsed back, and re-checked: `suggested.css`
  is exactly what you will deploy, and it passes. Translucent colors keep their alpha.
- `direction: "auto"` (default) takes whichever of darker or lighter changes the
  color less (ties go darker); `"darker"` / `"lighter"` restrict it.

### Options

`level`, `use`, `minRatio`, `backdrop` (as in `check()`), plus:

| Option | Meaning |
| --- | --- |
| `direction` | `"auto"` (default), `"darker"`, `"lighter"` |
| `preserveChroma` | Keep chroma where the gamut allows (default `true`) |
| `gamut` | `"srgb"` (default) or `"display-p3"`: the gamut the result must be in |
| `maxChange` | Largest allowed OKLab distance. Beyond it the target is reported as not reached |
| `change` (`fix`) / `role` (`find`) | Which color may change |

### Never a fake success

`reached` is only `true` when the serialized suggestion passes a fresh
`check()`. Otherwise `limitedBy` says why: `"unreachable"` (no color of this
hue can meet the target against the other color, or alpha caps the contrast) or
`"max-change"` (the target is reachable but needs more than `maxChange`). In
both cases `suggested` is the best contrast the constraints allow, or `null` if
nothing improves, and a note explains. If the pair already passes, nothing
changes (`changed: false`, `already-passes`).

APCA before/after (listed as optional in the roadmap) is not included yet; see
issue #43.

## `audit(palette, options?)`

The contrast relationships inside a palette, for any renderer (the CLI's
`audit` and `matrix` commands are thin views over it).

```js
const { audit } = require("get-contrast");

const r = audit({ ink: "#111", paper: "#fff", brand: "#3b82f6" }, { level: "AA", only: "failing" });
r.summary;          // { colors: 3, unique: 3, duplicates: 0, pairs: 6, passing: 4, failing: 2 }
r.matrix;           // r.matrix[a][b]: ratio of r.unique[a] on r.unique[b] (diagonal is 1)
r.pairs;            // ordered { foreground, background, ratio, ratioText, results, passes, notes? }
r.recommendations;  // per background: { candidates (best first), best, closest }
```

- **Input:** an array of colors or `{ name, color }` entries, or a `{ name:
  color }` map. Order is preserved; object keys follow JavaScript property order.
- **Duplicates:** colors equal after conversion to sRGB (same alpha) are
  aliases. The first is canonical (`aliases` lists the rest), repeats get
  `duplicateOf` and take no part in pairs, so nothing is double-counted. The same
  *name* on two different colors adds a `duplicate-name` note.
- **Pairs** are ordered and row-major over the unique colors. For opaque colors
  the ratio is symmetric; translucent colors are composited with their role
  (`backdrop` option), so both orders are reported and carry the usual notes.
  Opaque pairs equal what `check()` returns, to the bit.
- **Recommendations** use the same ordering as `pick()` (meets the target, then
  ratio, then input order); tests assert the equivalence.
- **Options:** `level`, `use`, `minRatio`, `backdrop` (as `check()`), `only`
  (`"passing"`/`"failing"`: filters `pairs` only), `maxColors` (default 200; the
  matrix has n(n-1) pairs, and an oversized palette throws a `RangeError` that
  says how to raise the limit).
- APCA metadata is not included yet; see issue #43.

## Design tokens: `parseTokens`, `parseRelations`, `auditTokens`

The library side of `contrast tokens`, for other surfaces (an MCP server, a CI
action). Reading files stays with the caller; these take text and data.

```js
const { parseTokens, parseRelations, auditTokens, toJsonPatch } = require("get-contrast");

const set = parseTokens(jsonText);                 // or parseTokens(cssText, { scope: "[data-theme=dark]" })
const relations = parseRelations(["text.muted -> surface.default"]);
const r = auditTokens(set, relations, { level: "AA" });

r.summary;       // { relations, pass, fail, error }
r.relations[0];  // { name, status, foreground, background, ratio, check, issues, suggestion? }
r.edits;         // [{ token, from, to, kind: "existing-token" | "synthesized", source }]
r.verification;  // { ok, regressions }: the edits applied in memory and every relation re-checked
toJsonPatch(r.edits); // RFC 6902 operations for JSON token files
```

- `parseTokens(text, { format?, scope? })` sniffs JSON vs CSS when `format` is
  omitted and throws `TokenSourceError` (`code`: `invalid-json`, `invalid-css`,
  `empty`, `unknown-format`) for unusable files.
- `parseRelations` accepts strings, pairs and objects (see the CLI docs) and
  throws `RelationError` with the index of the bad entry. `auditTokens` accepts
  the same inputs.
- Problems with the *data* never throw: a relation whose tokens cannot be
  resolved has `status: "error"` and `issues` (`unknown-token` with suggestions,
  `circular-reference`, `not-a-color`, `unsupported-value`), and the other
  relations still run.
- `suggestion.recommended` is `"existing"`, `"synthesized"`, or `null` (nothing
  can reach the target). `existing` is the nearest qualifying token by OKLab
  distance, `alternatives` the next few, `synthesized` the `fix()` result for
  comparison, and `edit`/`after` what changes and how it re-checks.
- Edits are de-duplicated by token. If two failing relations want different
  values for one token, a `conflicting-edits` note says so, and `verification`
  reports the relation left unmet.
- Options: `check()`'s `level`/`use`/`minRatio`/`backdrop` (a relation can
  override the first three), `candidates` (globs with `*`), `maxAlternatives`.
