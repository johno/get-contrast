# Color engine

The color engine is the shared, dependency-free core that parsing, conversion,
contrast, the CLI, MCP, and web surfaces build on. It lives in
`packages/get-contrast/src/color/` and is internal until the modern APIs that
expose it ship; the package's public exports are unchanged.

## Model (`color/model.ts`)

A `Color` is an immutable `{ space, coords, alpha }`:

- `space` is one of `COLOR_SPACES`: `srgb`, `srgb-linear`, `display-p3`, `hsl`,
  `hwb`, `xyz-d65`, `xyz-d50`, `lab`, `lch`, `oklab`, `oklch`. XYZ comes in both
  D65 and D50 because CSS `lab()`/`lch()` are D50-relative and sRGB, Display P3
  and OKLab are D65-relative; XYZ is a conversion intermediate.
- `coords` is three finite numbers in CSS canonical units (see the table in
  `model.ts`). Hue is in degrees and wraps into `[0, 360)`; `hsl`/`hwb`
  saturation, lightness, whiteness and blackness are `0..100`.
- `alpha` is `0..1`, clamped.
- The model never clamps coordinates, so wide-gamut and out-of-gamut colors are
  representable. Whether a color fits a gamut is a question for conversion
  (#40), and nothing is changed silently to make it fit.
- CSS `none` becomes `0`. The engine does not interpolate, and CSS treats
  missing components as zero on conversion.
- `SPACES` describes each space's components (name, whether it is a hue, what
  100% means in functional notation). It is typed so that adding a space
  without describing it fails to compile.

`createColor` validates (finite numbers, known space) and throws `RangeError`
for programmer errors; it is not how untrusted text enters the engine.

## Parser contract (`color/parse-result.ts`)

Parsers are pure, total functions of type `(input: unknown) => ParseResult`.
They never throw, whatever the input is:

```ts
type ParseResult =
  | { ok: true; color: Color }
  | { ok: false; error: { code: ParseErrorCode; message: string; input: string } };
```

`code` is a closed set (`not-a-string`, `empty`, `invalid-syntax`,
`unsupported-function`, `unsupported-color-space`, `invalid-component`).
`message` is for humans and may change; consumers branch on `code`.

### Modern parser vs. legacy adapter

| | Modern parser | Legacy adapter |
| --- | --- | --- |
| Where | `color/parse.ts` (`parseColor`) | `src/legacy-parse.ts` |
| Standard | CSS Color 4 | whatever `rgb@0.1.0` did |
| Output | `ParseResult` with a `Color` | normalized string or `null` |
| Strictness | strict, reports why | accepts quirks (5-digit hex, `xx#fffxx`, ...) |
| Used by | all new APIs | `ratio`, `score`, `isAccessible`, `isNotTransparent` only |

The legacy adapter is frozen by the golden compatibility suite and must not be
used by new code. The modern parser must not be bent to reproduce v3 quirks;
when a legacy entry point needs both, the compatibility adapter decides which
path serves it (see `legacy-warnings.md`).

## Boundaries

Nothing in `color/` knows about CSS serialization beyond what parsing needs,
the CLI, JSON output, or UI. Formatting for display belongs to the surface that
needs it.

## Modern parser coverage (`parseColor`)

Supported: named colors (the vendored table, case-insensitive), `transparent`,
hex with 3/4/6/8 digits, `rgb()`/`rgba()`, `hsl()`/`hsla()` (legacy comma and
modern space/slash syntax), `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, and
`color()` for `srgb`, `srgb-linear`, `display-p3`, `xyz`, `xyz-d65`, `xyz-d50`.
Percentages and angle units (`deg`, `grad`, `rad`, `turn`) are accepted where
CSS allows them, and `none` parses as `0`.

Clamping matches browsers: `rgb()`, `hsl()`, `hwb()` and hex clamp to their
gamut when parsed; `lab`/`lch`/`oklab`/`oklch` clamp lightness and chroma only;
`color()` values are kept as written so wide-gamut colors survive.

Reported as errors rather than guessed at: relative colors (`from`), nested
functions (`calc()`, `var()`, `env()`), `color-mix()`, `light-dark()`,
`device-cmyk()`, other `color()` spaces, `currentcolor` and the CSS-wide
keywords. The scanner is linear in the input length; hostile inputs
(deep nesting, very long numbers or whitespace runs) are covered by tests.

## Conversion, gamut and compositing (`color/convert.ts`)

`convert(color, space)` converts between every supported space, keeping alpha.
XYZ with a D65 white point is the hub; `lab`/`lch` pass through a Bradford
adaptation to D50, as CSS defines them. The sRGB family (`srgb`, `srgb-linear`,
`hsl`, `hwb`) converts among itself without going through XYZ, so `#ff0000` is
exactly `hsl(0 100% 50%)`. Matrices and constants follow the CSS Color 4
reference code; the P3 inverse matrix is computed from the forward matrix, and
tests re-derive the forward matrices from the primaries' chromaticities.

Conversion never clamps or gamut-maps. A result outside the target gamut simply
has out-of-range coordinates, e.g. `color(display-p3 1 0 0)` in sRGB is
`[1.093, -0.227, -0.150]`. `isInGamut(color, "srgb" | "display-p3")` reports
membership (with a small epsilon for float noise) and `clampToGamut` is the
explicit, per-channel clamp. It is not perceptual gamut mapping.

`composite(foreground, background, { space })` is source-over compositing that
returns sRGB. By default it blends gamma-encoded channels, which is what
browsers do when painting translucent colors and therefore what users see;
`space: "srgb-linear"` blends physical light instead. The result alpha is
`af + ab * (1 - af)`. Compositing is associative within one blending space.

Round-trip tolerances (absolute, in-gamut sRGB through the named space and
back): srgb-linear 1e-12; display-p3, xyz-d65, xyz-d50, oklab, oklch 1e-9; hsl,
hwb, lab, lch 1e-7.
