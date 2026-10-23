// The internal color representation shared by parsing, conversion, contrast,
// and every surface built on top (CLI, MCP, web). It is deliberately small:
// an immutable value, a closed set of spaces, and metadata describing each
// space's components. It knows nothing about CSS text, CLIs, or UIs.
//
// Coordinate conventions (CSS Color 4 "canonical" numbers, never clamped by the
// model itself; parsers apply whatever clamping the syntax they parse requires):
//
//   srgb, srgb-linear, display-p3   r, g, b        nominally 0..1, may exceed
//   hsl                             h deg, s %, l  h in [0, 360), s/l 0..100
//   hwb                             h deg, w %, b  h in [0, 360), w/b 0..100
//   xyz-d65, xyz-d50                x, y, z        nominally 0..1
//   lab                             L, a, b        L 0..100, a/b about +-125 (D50)
//   lch                             L, C, h        C >= 0, h deg (D50)
//   oklab                           L, a, b        L 0..1, a/b about +-0.4
//   oklch                           L, C, h        C >= 0, h deg
//
// Alpha is a number in [0, 1]. A CSS `none` component is stored as 0: this
// engine never interpolates, and CSS treats missing components as 0 whenever a
// color is converted or rendered.

export const COLOR_SPACES = [
  "srgb",
  "srgb-linear",
  "display-p3",
  "hsl",
  "hwb",
  "xyz-d65",
  "xyz-d50",
  "lab",
  "lch",
  "oklab",
  "oklch",
] as const;

export type ColorSpace = (typeof COLOR_SPACES)[number];

export type Coords = readonly [number, number, number];

/** An immutable color. Construct with `createColor`. */
export interface Color<S extends ColorSpace = ColorSpace> {
  readonly space: S;
  readonly coords: Coords;
  /** Opacity in [0, 1]. */
  readonly alpha: number;
}

export interface ComponentInfo {
  readonly name: string;
  /** Hue angles are stored in degrees and wrap instead of clamping. */
  readonly kind: "number" | "hue";
  /** The value 100% stands for in CSS functional notation. */
  readonly percentReference: number;
  /** Nominal range, for documentation and gamut tests; not enforced. */
  readonly range: readonly [number, number] | null;
}

export interface SpaceInfo<S extends ColorSpace = ColorSpace> {
  readonly id: S;
  readonly components: readonly [ComponentInfo, ComponentInfo, ComponentInfo];
}

const unit = (name: string): ComponentInfo => ({
  name,
  kind: "number",
  percentReference: 1,
  range: [0, 1],
});
const percent = (name: string): ComponentInfo => ({
  name,
  kind: "number",
  percentReference: 100,
  range: [0, 100],
});
const hue = (name: string): ComponentInfo => ({
  name,
  kind: "hue",
  percentReference: 360,
  range: [0, 360],
});
const open = (name: string, reference: number): ComponentInfo => ({
  name,
  kind: "number",
  percentReference: reference,
  range: null,
});

/**
 * Per-space component metadata. The mapped type makes this exhaustive: adding
 * a space to COLOR_SPACES without describing it here is a compile error.
 */
export const SPACES: { readonly [S in ColorSpace]: SpaceInfo<S> } = {
  srgb: { id: "srgb", components: [unit("r"), unit("g"), unit("b")] },
  "srgb-linear": { id: "srgb-linear", components: [unit("r"), unit("g"), unit("b")] },
  "display-p3": { id: "display-p3", components: [unit("r"), unit("g"), unit("b")] },
  hsl: { id: "hsl", components: [hue("h"), percent("s"), percent("l")] },
  hwb: { id: "hwb", components: [hue("h"), percent("w"), percent("b")] },
  "xyz-d65": { id: "xyz-d65", components: [open("x", 1), open("y", 1), open("z", 1)] },
  "xyz-d50": { id: "xyz-d50", components: [open("x", 1), open("y", 1), open("z", 1)] },
  lab: {
    id: "lab",
    components: [
      { name: "l", kind: "number", percentReference: 100, range: [0, 100] },
      open("a", 125),
      open("b", 125),
    ],
  },
  lch: {
    id: "lch",
    components: [
      { name: "l", kind: "number", percentReference: 100, range: [0, 100] },
      { name: "c", kind: "number", percentReference: 150, range: [0, 150] },
      hue("h"),
    ],
  },
  oklab: {
    id: "oklab",
    components: [
      { name: "l", kind: "number", percentReference: 1, range: [0, 1] },
      open("a", 0.4),
      open("b", 0.4),
    ],
  },
  oklch: {
    id: "oklch",
    components: [
      { name: "l", kind: "number", percentReference: 1, range: [0, 1] },
      { name: "c", kind: "number", percentReference: 0.4, range: [0, 0.4] },
      hue("h"),
    ],
  },
};

export function isColorSpace(value: unknown): value is ColorSpace {
  return typeof value === "string" && (COLOR_SPACES as readonly string[]).includes(value);
}

/**
 * Creates a frozen color. Coordinates must be finite; hue components are
 * wrapped into [0, 360); alpha is clamped to [0, 1]. Throws a `RangeError` for
 * non-finite input, because a Color that exists is always well-formed. Parsers
 * validate before constructing and report failures as values instead.
 */
export function createColor<S extends ColorSpace>(
  space: S,
  coords: Coords,
  alpha = 1
): Color<S> {
  const info = SPACES[space];
  if (!info) throw new RangeError(`unknown color space: ${String(space)}`);
  if (coords.length !== 3 || !coords.every(Number.isFinite) || !Number.isFinite(alpha)) {
    throw new RangeError(`${space} color needs 3 finite coordinates and a finite alpha`);
  }
  const normalized = coords.map((value, i) =>
    info.components[i].kind === "hue" ? normalizeHue(value) : value
  ) as unknown as Coords;
  return Object.freeze({
    space,
    coords: Object.freeze(normalized) as Coords,
    alpha: clampAlpha(alpha),
  });
}

export function isColor(value: unknown): value is Color {
  const c = value as Color | null;
  return (
    typeof c === "object" &&
    c !== null &&
    isColorSpace(c.space) &&
    Array.isArray(c.coords) &&
    c.coords.length === 3 &&
    c.coords.every(Number.isFinite) &&
    Number.isFinite(c.alpha) &&
    c.alpha >= 0 &&
    c.alpha <= 1
  );
}

/** A copy of `color` with a different alpha. */
export function withAlpha<S extends ColorSpace>(color: Color<S>, alpha: number): Color<S> {
  return createColor(color.space, color.coords, alpha);
}

// -- Normalization rules ---------------------------------------------------

/** Wraps an angle in degrees into [0, 360). */
export function normalizeHue(degrees: number): number {
  const wrapped = degrees % 360;
  // `+ 0` folds -0 into 0.
  return (wrapped < 0 ? wrapped + 360 : wrapped) + 0;
}

/** Clamps alpha into [0, 1]. */
export function clampAlpha(alpha: number): number {
  return Math.min(1, Math.max(0, alpha));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type AngleUnit = "deg" | "grad" | "rad" | "turn";

/** Converts an angle with a CSS unit to degrees (not wrapped). */
export function angleToDegrees(value: number, unit: AngleUnit = "deg"): number {
  switch (unit) {
    case "deg":
      return value;
    case "grad":
      return (value * 360) / 400;
    case "rad":
      return (value * 180) / Math.PI;
    case "turn":
      return value * 360;
  }
}

/**
 * Resolves a CSS percentage (given as 0..100, so `50` means `50%`) for the
 * given component: 100% maps to that component's `percentReference`.
 */
export function percentageToNumber(
  percentage: number,
  space: ColorSpace,
  componentIndex: 0 | 1 | 2
): number {
  return (percentage / 100) * SPACES[space].components[componentIndex].percentReference;
}
