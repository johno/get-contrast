// Color-space conversion, gamut checks, and alpha compositing.
//
// Everything converts through XYZ with a D65 white point, the hub. Lab/LCH are
// defined against D50 by CSS, so those go through a Bradford adaptation, as in
// the CSS Color 4 sample code (https://www.w3.org/TR/css-color-4/#color-conversion-code).
// Matrices and constants follow that reference.
//
// Conversion never clamps and never gamut-maps: a color that does not fit the
// target space simply has out-of-range coordinates, and `isInGamut` reports
// that. Clamping is a separate, explicit operation (`clampToGamut`).
//
// Documented round-trip tolerances (absolute error after A -> B -> A for
// in-gamut sRGB inputs; see test/convert.test.js):
//   srgb <-> srgb-linear                  1e-12
//   srgb <-> display-p3, xyz-*            1e-9
//   srgb <-> hsl/hwb (0..100 scale)       1e-7
//   srgb <-> lab/lch (L 0..100)           1e-7
//   srgb <-> oklab/oklch (L 0..1)         1e-9
import {
  clamp,
  createColor,
  type Color,
  type ColorSpace,
  type Coords,
} from "./model.js";

type Vec3 = readonly [number, number, number];
type Matrix3 = readonly [Vec3, Vec3, Vec3];

function multiply(m: Matrix3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function invert(m: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

// -- Matrices (CSS Color 4 reference) -------------------------------------
// The linear-sRGB and linear-P3 -> XYZ matrices are the CSS reference values
// (tests re-derive them from the primaries' chromaticities). The XYZ ->
// linear-P3 matrix is computed as the exact inverse rather than transcribed.

export const LINEAR_SRGB_TO_XYZ_D65: Matrix3 = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];

export const XYZ_D65_TO_LINEAR_SRGB: Matrix3 = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];

export const LINEAR_P3_TO_XYZ_D65: Matrix3 = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
];

export const XYZ_D65_TO_LINEAR_P3: Matrix3 = invert(LINEAR_P3_TO_XYZ_D65);

// Bradford chromatic adaptation between the D65 and D50 white points.
const D65_TO_D50: Matrix3 = [
  [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
  [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
  [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
];

const D50_TO_D65: Matrix3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];

// OKLab (Bjorn Ottosson), XYZ D65 <-> LMS <-> OKLab.
const XYZ_TO_LMS: Matrix3 = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];

const LMS_TO_XYZ: Matrix3 = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];

const LMS_TO_OKLAB: Matrix3 = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.42859224204858, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];

const OKLAB_TO_LMS: Matrix3 = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];

// D50 reference white used by CSS lab()/lch(): chromaticity (0.3457, 0.3585).
const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

const EPSILON = 216 / 24389; // 6^3 / 29^3
const KAPPA = 24389 / 27; // 29^3 / 3^3

// -- Transfer functions ----------------------------------------------------

// The CSS text rounds this to 0.0031308; the exact value 0.04045 / 12.92 makes
// the two directions exact inverses of each other at the segment boundary.
const LINEAR_THRESHOLD = 0.04045 / 12.92;

/** sRGB (and Display P3) encoded value -> linear light. Odd extension for out-of-range input. */
export function srgbToLinear(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return abs <= 0.04045 ? value / 12.92 : sign * Math.pow((abs + 0.055) / 1.055, 2.4);
}

/** Linear light -> sRGB (and Display P3) encoded value. */
export function linearToSrgb(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return abs > LINEAR_THRESHOLD ? sign * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055) : 12.92 * value;
}

// -- Cylindrical RGB models ------------------------------------------------

function hslToSrgb(h: number, sPercent: number, lPercent: number): Vec3 {
  const s = sPercent / 100;
  const l = lPercent / 100;
  const hue = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function srgbToHsl(r: number, g: number, b: number): Vec3 {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (min + max) / 2;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    s = l === 0 || l === 1 ? 0 : (max - l) / Math.min(l, 1 - l);
  }
  return [h, s * 100, l * 100];
}

function hwbToSrgb(h: number, wPercent: number, bPercent: number): Vec3 {
  const w = wPercent / 100;
  const bl = bPercent / 100;
  if (w + bl >= 1) {
    const gray = w / (w + bl);
    return [gray, gray, gray];
  }
  const rgb = hslToSrgb(h, 100, 50);
  return [rgb[0] * (1 - w - bl) + w, rgb[1] * (1 - w - bl) + w, rgb[2] * (1 - w - bl) + w];
}

function srgbToHwb(r: number, g: number, b: number): Vec3 {
  const [h] = srgbToHsl(r, g, b);
  const white = Math.min(r, g, b);
  const black = 1 - Math.max(r, g, b);
  return [h, white * 100, black * 100];
}

// -- Lab / LCH / OKLab / OKLCH ---------------------------------------------

function xyzD50ToLab(xyz: Vec3): Vec3 {
  const f = xyz.map((value, i) => {
    const t = value / D50_WHITE[i];
    return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

function labToXyzD50(lab: Vec3): Vec3 {
  const fy = (lab[0] + 16) / 116;
  const fx = lab[1] / 500 + fy;
  const fz = fy - lab[2] / 200;
  const x = fx ** 3 > EPSILON ? fx ** 3 : (116 * fx - 16) / KAPPA;
  const y = lab[0] > KAPPA * EPSILON ? fy ** 3 : lab[0] / KAPPA;
  const z = fz ** 3 > EPSILON ? fz ** 3 : (116 * fz - 16) / KAPPA;
  return [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]];
}

function xyzD65ToOklab(xyz: Vec3): Vec3 {
  const lms = multiply(XYZ_TO_LMS, xyz);
  return multiply(LMS_TO_OKLAB, [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])]);
}

function oklabToXyzD65(lab: Vec3): Vec3 {
  const lms = multiply(OKLAB_TO_LMS, lab);
  return multiply(LMS_TO_XYZ, [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3]);
}

function rectangularToPolar(l: number, a: number, b: number): Vec3 {
  const chroma = Math.hypot(a, b);
  // Hue is meaningless without chroma; report 0 rather than numeric noise.
  const hue = chroma < 1e-9 ? 0 : (Math.atan2(b, a) * 180) / Math.PI;
  return [l, chroma, hue];
}

function polarToRectangular(l: number, c: number, h: number): Vec3 {
  const radians = (h * Math.PI) / 180;
  return [l, c * Math.cos(radians), c * Math.sin(radians)];
}

// -- The hub ---------------------------------------------------------------

function toXyzD65(color: Color): Vec3 {
  const c = color.coords;
  switch (color.space) {
    case "xyz-d65":
      return c;
    case "xyz-d50":
      return multiply(D50_TO_D65, c);
    case "srgb-linear":
      return multiply(LINEAR_SRGB_TO_XYZ_D65, c);
    case "srgb":
      return multiply(LINEAR_SRGB_TO_XYZ_D65, [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])]);
    case "display-p3":
      return multiply(LINEAR_P3_TO_XYZ_D65, [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])]);
    case "hsl":
      return toXyzD65({ ...color, space: "srgb", coords: hslToSrgb(c[0], c[1], c[2]) });
    case "hwb":
      return toXyzD65({ ...color, space: "srgb", coords: hwbToSrgb(c[0], c[1], c[2]) });
    case "lab":
      return multiply(D50_TO_D65, labToXyzD50(c));
    case "lch":
      return multiply(D50_TO_D65, labToXyzD50(polarToRectangular(c[0], c[1], c[2])));
    case "oklab":
      return oklabToXyzD65(c);
    case "oklch":
      return oklabToXyzD65(polarToRectangular(c[0], c[1], c[2]));
  }
}

function fromXyzD65(xyz: Vec3, space: ColorSpace): Coords {
  switch (space) {
    case "xyz-d65":
      return xyz;
    case "xyz-d50":
      return multiply(D65_TO_D50, xyz);
    case "srgb-linear":
      return multiply(XYZ_D65_TO_LINEAR_SRGB, xyz);
    case "srgb": {
      const lin = multiply(XYZ_D65_TO_LINEAR_SRGB, xyz);
      return [linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])];
    }
    case "display-p3": {
      const lin = multiply(XYZ_D65_TO_LINEAR_P3, xyz);
      return [linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])];
    }
    case "hsl": {
      const rgb = fromXyzD65(xyz, "srgb");
      return srgbToHsl(rgb[0], rgb[1], rgb[2]);
    }
    case "hwb": {
      const rgb = fromXyzD65(xyz, "srgb");
      return srgbToHwb(rgb[0], rgb[1], rgb[2]);
    }
    case "lab":
      return xyzD50ToLab(multiply(D65_TO_D50, xyz));
    case "lch": {
      const lab = xyzD50ToLab(multiply(D65_TO_D50, xyz));
      return rectangularToPolar(lab[0], lab[1], lab[2]);
    }
    case "oklab":
      return xyzD65ToOklab(xyz);
    case "oklch": {
      const lab = xyzD65ToOklab(xyz);
      return rectangularToPolar(lab[0], lab[1], lab[2]);
    }
  }
}

/**
 * Converts `color` to `space`, keeping alpha. Never clamps: out-of-gamut
 * results have out-of-range coordinates. Converting to the color's own space
 * returns the color itself.
 */
export function convert<S extends ColorSpace>(color: Color, space: S): Color<S> {
  if (color.space === (space as ColorSpace)) return color as Color<S>;
  // The sRGB family (srgb, srgb-linear, hsl, hwb) converts exactly among
  // itself without a detour through XYZ, so e.g. #ff0000 is exactly hsl(0 100% 50%).
  const srgb = toSrgbFamily(color);
  if (srgb && isSrgbFamily(space)) {
    return createColor(space, fromSrgbFamily(srgb, space), color.alpha);
  }
  return createColor(space, fromXyzD65(toXyzD65(color), space), color.alpha);
}

type SrgbFamily = "srgb" | "srgb-linear" | "hsl" | "hwb";

function isSrgbFamily(space: ColorSpace): space is SrgbFamily {
  return space === "srgb" || space === "srgb-linear" || space === "hsl" || space === "hwb";
}

/** Encoded sRGB coordinates of a color in the sRGB family, else null. */
function toSrgbFamily(color: Color): Vec3 | null {
  const c = color.coords;
  switch (color.space) {
    case "srgb":
      return c;
    case "srgb-linear":
      return [linearToSrgb(c[0]), linearToSrgb(c[1]), linearToSrgb(c[2])];
    case "hsl":
      return hslToSrgb(c[0], c[1], c[2]);
    case "hwb":
      return hwbToSrgb(c[0], c[1], c[2]);
    default:
      return null;
  }
}

function fromSrgbFamily(rgb: Vec3, space: SrgbFamily): Coords {
  switch (space) {
    case "srgb":
      return rgb;
    case "srgb-linear":
      return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
    case "hsl":
      return srgbToHsl(rgb[0], rgb[1], rgb[2]);
    case "hwb":
      return srgbToHwb(rgb[0], rgb[1], rgb[2]);
  }
}

// -- Gamut -----------------------------------------------------------------

export type Gamut = "srgb" | "display-p3";

/** Default slack for floating-point noise when testing gamut membership. */
export const GAMUT_EPSILON = 1e-6;

/** Whether `color`, expressed in `gamut`, has every channel within [0, 1]. */
export function isInGamut(color: Color, gamut: Gamut = "srgb", epsilon = GAMUT_EPSILON): boolean {
  return convert(color, gamut).coords.every((v) => v >= -epsilon && v <= 1 + epsilon);
}

/**
 * Explicit, per-channel clamp into `gamut`. This is NOT perceptual gamut
 * mapping; it exists so callers who want clamping can ask for it by name.
 */
export function clampToGamut<G extends Gamut>(color: Color, gamut: G): Color<G> {
  const c = convert(color, gamut).coords;
  return createColor(gamut, [clamp(c[0], 0, 1), clamp(c[1], 0, 1), clamp(c[2], 0, 1)], color.alpha);
}

// -- Alpha compositing -----------------------------------------------------

export interface CompositeOptions {
  /**
   * Where the weighted average happens. `"srgb"` (default) blends gamma-encoded
   * channels, which is what browsers do when they paint translucent colors, and
   * therefore matches the colors people actually see. `"srgb-linear"` blends
   * physical light instead.
   */
  readonly space?: "srgb" | "srgb-linear";
}

/**
 * Source-over compositing of `foreground` onto `background`, returned as an
 * sRGB color. Both inputs are converted to sRGB first (unclamped, so wide-gamut
 * inputs keep their out-of-range channels). The result alpha is
 * `af + ab * (1 - af)`; a fully transparent result is transparent black.
 */
export function composite(
  foreground: Color,
  background: Color,
  options: CompositeOptions = {}
): Color<"srgb"> {
  const space = options.space ?? "srgb";
  const fg = convert(foreground, space).coords;
  const bg = convert(background, space).coords;
  const af = foreground.alpha;
  const ab = background.alpha;
  const alpha = af + ab * (1 - af);
  if (alpha === 0) return createColor("srgb", [0, 0, 0], 0);

  const mix = (i: 0 | 1 | 2) => (fg[i] * af + bg[i] * ab * (1 - af)) / alpha;
  const blended = createColor(space, [mix(0), mix(1), mix(2)], alpha);
  return convert(blended, "srgb");
}
