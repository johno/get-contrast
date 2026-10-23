// Modern, standards-oriented CSS color parser (CSS Color 4 subset). See
// docs/color-engine.md for how it differs from the legacy v3 adapter.
//
// Supported: named colors, `transparent`, hex (3/4/6/8 digits), rgb()/rgba(),
// hsl()/hsla(), hwb(), lab(), lch(), oklab(), oklch() and color() for srgb,
// srgb-linear, display-p3, xyz, xyz-d50, xyz-d65. Both the legacy comma syntax
// and the modern space/slash syntax are accepted where CSS allows them.
//
// Not supported (reported as `unsupported-function` /
// `unsupported-color-space`, never silently misparsed): relative colors
// (`from`), calc()/var()/env() and any nested function, color-mix(),
// light-dark(), device-cmyk(), color() spaces other than the ones above,
// system colors and `currentcolor`.
//
// Clamping follows browsers: rgb()/hsl()/hex clamp to their gamut at
// parse time, hwb() clamps whiteness/blackness below zero only (a sum of 100%
// or more is normalized when converting), lab/lch/oklab/oklch clamp lightness
// and chroma, and color() values are kept as written so wide-gamut colors
// survive. `none` parses as 0. Keywords are matched ASCII case-insensitively.
//
// The scanner is linear: it splits on whitespace, commas and `/` and matches
// each token against one small anchored pattern, so adversarial input cannot
// cause super-linear work.
import { NAMED_COLORS } from "../named-colors.js";
import {
  angleToDegrees,
  clamp,
  createColor,
  percentageToNumber,
  type AngleUnit,
  type ColorSpace,
} from "./model.js";
import { fail, succeed, type ParseResult } from "./parse-result.js";

// -- Tokens ----------------------------------------------------------------

type Token =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "percent"; readonly value: number }
  | { readonly kind: "angle"; readonly value: number } // degrees
  | { readonly kind: "none" };

interface Allowed {
  readonly number?: boolean;
  readonly percent?: boolean;
  readonly angle?: boolean;
}

const NUMERIC = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)(%|deg|grad|rad|turn)?$/i;
const WHITESPACE = /[ \t\r\n\f]+/;

/**
 * Lowercases ASCII letters only. CSS keywords are ASCII case-insensitive;
 * String#toLowerCase would also fold characters like U+212A (Kelvin sign) to
 * "k", making `blacK` parse as `black`.
 */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}

function isCssSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

/** Trims CSS whitespace. (A `/^ws+|ws+$/` regex is quadratic on long runs.) */
function trim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isCssSpace(text.charCodeAt(start))) start++;
  while (end > start && isCssSpace(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}

function readToken(raw: string, allowed: Allowed, allowNone: boolean): Token | null {
  if (asciiLower(raw) === "none") return allowNone ? { kind: "none" } : null;
  const match = NUMERIC.exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2] && asciiLower(match[2]);
  if (!unit) return allowed.number ? { kind: "number", value } : null;
  if (unit === "%") return allowed.percent ? { kind: "percent", value } : null;
  return allowed.angle
    ? { kind: "angle", value: angleToDegrees(value, unit as AngleUnit) }
    : null;
}

/** Resolves a token to a number: percentages use the component's CSS reference. */
function scaled(token: Token, space: ColorSpace, index: 0 | 1 | 2): number {
  switch (token.kind) {
    case "none":
      return 0;
    case "percent":
      return percentageToNumber(token.value, space, index);
    case "number":
      return token.value;
    case "angle":
      return token.value;
  }
}

// -- Function body splitting -----------------------------------------------

interface Body {
  /** Component tokens (strings) before `/` or the last comma-separated alpha. */
  readonly components: readonly string[];
  readonly alpha: string | null;
  readonly legacy: boolean;
}

/** Splits a function body. Returns an error message instead of throwing. */
function splitBody(inner: string, allowLegacy: boolean): Body | string {
  const text = trim(inner);
  if (text === "") return "no components";
  if (text.includes(",")) {
    if (!allowLegacy) return "commas are not valid in this color function";
    if (text.includes("/")) return "cannot mix commas and '/'";
    const parts = text.split(",").map((p) => trim(p));
    if (parts.some((p) => p === "" || WHITESPACE.test(p))) return "malformed comma-separated list";
    if (parts.length !== 3 && parts.length !== 4) {
      return `expected 3 or 4 comma-separated values, got ${parts.length}`;
    }
    return {
      components: parts.slice(0, 3),
      alpha: parts.length === 4 ? parts[3] : null,
      legacy: true,
    };
  }
  const slash = text.split("/");
  if (slash.length > 2) return "more than one '/'";
  const left = trim(slash[0]);
  if (left === "") return "no components before '/'";
  const components = left.split(WHITESPACE);
  let alpha: string | null = null;
  if (slash.length === 2) {
    alpha = trim(slash[1]);
    if (alpha === "" || WHITESPACE.test(alpha)) return "alpha must be a single value after '/'";
  }
  return { components, alpha, legacy: false };
}

// -- Helpers ---------------------------------------------------------------

function parseAlpha(raw: string | null, input: string, allowNone: boolean): number | ParseResult {
  if (raw === null) return 1;
  const token = readToken(raw, { number: true, percent: true }, allowNone);
  if (!token) return fail("invalid-component", `invalid alpha value '${raw}'`, input);
  if (token.kind === "none") return 0;
  return token.kind === "percent" ? token.value / 100 : token.value;
}

function isResult(value: number | ParseResult): value is ParseResult {
  return typeof value !== "number";
}

function bad(what: string, raw: string, input: string): ParseResult {
  return fail("invalid-component", `invalid ${what} '${raw}'`, input);
}

// -- Individual syntaxes ---------------------------------------------------

function parseHex(text: string, input: string): ParseResult {
  const digits = text.slice(1);
  if (!/^[0-9a-fA-F]+$/.test(digits)) return fail("invalid-syntax", "invalid hex digits", input);
  let expanded: string;
  switch (digits.length) {
    case 3:
    case 4:
      expanded = digits.replace(/./g, "$&$&");
      break;
    case 6:
    case 8:
      expanded = digits;
      break;
    default:
      return fail("invalid-syntax", "hex colors have 3, 4, 6 or 8 digits", input);
  }
  const byte = (i: number) => parseInt(expanded.slice(i, i + 2), 16);
  const alpha = expanded.length === 8 ? byte(6) / 255 : 1;
  return succeed(createColor("srgb", [byte(0) / 255, byte(2) / 255, byte(4) / 255], alpha));
}

function parseRgb(body: Body, input: string): ParseResult {
  const channels: number[] = [];
  const kinds = new Set<string>();
  for (const raw of body.components) {
    const token = readToken(raw, { number: true, percent: true }, !body.legacy);
    if (!token) return bad("rgb channel", raw, input);
    kinds.add(token.kind);
    channels.push(token.kind === "none" ? 0 : token.kind === "percent" ? token.value / 100 : token.value / 255);
  }
  // Legacy syntax needs all numbers or all percentages.
  if (body.legacy && kinds.size > 1) {
    return fail("invalid-component", "legacy rgb() cannot mix numbers and percentages", input);
  }
  const alpha = parseAlpha(body.alpha, input, !body.legacy);
  if (isResult(alpha)) return alpha;
  const [r, g, b] = channels.map((c) => clamp(c, 0, 1));
  return succeed(createColor("srgb", [r, g, b], alpha));
}

function parseHsl(body: Body, input: string): ParseResult {
  const hueToken = readToken(body.components[0], { number: true, angle: true }, !body.legacy);
  if (!hueToken) return bad("hue", body.components[0], input);
  // Legacy syntax requires percentages for saturation and lightness.
  const allowed: Allowed = body.legacy ? { percent: true } : { number: true, percent: true };
  const s = readToken(body.components[1], allowed, !body.legacy);
  if (!s) return bad("saturation", body.components[1], input);
  const l = readToken(body.components[2], allowed, !body.legacy);
  if (!l) return bad("lightness", body.components[2], input);
  const alpha = parseAlpha(body.alpha, input, !body.legacy);
  if (isResult(alpha)) return alpha;
  return succeed(
    createColor(
      "hsl",
      [scaled(hueToken, "hsl", 0), clamp(scaled(s, "hsl", 1), 0, 100), clamp(scaled(l, "hsl", 2), 0, 100)],
      alpha
    )
  );
}

function parseHwb(body: Body, input: string): ParseResult {
  const h = readToken(body.components[0], { number: true, angle: true }, true);
  if (!h) return bad("hue", body.components[0], input);
  const w = readToken(body.components[1], { number: true, percent: true }, true);
  if (!w) return bad("whiteness", body.components[1], input);
  const b = readToken(body.components[2], { number: true, percent: true }, true);
  if (!b) return bad("blackness", body.components[2], input);
  const alpha = parseAlpha(body.alpha, input, !body.legacy);
  if (isResult(alpha)) return alpha;
  return succeed(
    createColor(
      "hwb",
      [scaled(h, "hwb", 0), Math.max(0, scaled(w, "hwb", 1)), Math.max(0, scaled(b, "hwb", 2))],
      alpha
    )
  );
}

/** lab() and oklab(): lightness, then two open-ended axes. */
function parseRectangular(space: "lab" | "oklab", body: Body, input: string): ParseResult {
  const lightnessMax = space === "lab" ? 100 : 1;
  const l = readToken(body.components[0], { number: true, percent: true }, true);
  if (!l) return bad("lightness", body.components[0], input);
  const a = readToken(body.components[1], { number: true, percent: true }, true);
  if (!a) return bad("a axis", body.components[1], input);
  const b = readToken(body.components[2], { number: true, percent: true }, true);
  if (!b) return bad("b axis", body.components[2], input);
  const alpha = parseAlpha(body.alpha, input, !body.legacy);
  if (isResult(alpha)) return alpha;
  return succeed(
    createColor(
      space,
      [clamp(scaled(l, space, 0), 0, lightnessMax), scaled(a, space, 1), scaled(b, space, 2)],
      alpha
    )
  );
}

/** lch() and oklch(): lightness, chroma, hue. */
function parsePolar(space: "lch" | "oklch", body: Body, input: string): ParseResult {
  const lightnessMax = space === "lch" ? 100 : 1;
  const l = readToken(body.components[0], { number: true, percent: true }, true);
  if (!l) return bad("lightness", body.components[0], input);
  const c = readToken(body.components[1], { number: true, percent: true }, true);
  if (!c) return bad("chroma", body.components[1], input);
  const h = readToken(body.components[2], { number: true, angle: true }, true);
  if (!h) return bad("hue", body.components[2], input);
  const alpha = parseAlpha(body.alpha, input, !body.legacy);
  if (isResult(alpha)) return alpha;
  return succeed(
    createColor(
      space,
      [
        clamp(scaled(l, space, 0), 0, lightnessMax),
        Math.max(0, scaled(c, space, 1)),
        scaled(h, space, 2),
      ],
      alpha
    )
  );
}

const COLOR_FUNCTION_SPACES: Readonly<Record<string, ColorSpace>> = {
  srgb: "srgb",
  "srgb-linear": "srgb-linear",
  "display-p3": "display-p3",
  xyz: "xyz-d65",
  "xyz-d65": "xyz-d65",
  "xyz-d50": "xyz-d50",
};

function parseColorFunction(body: Body, input: string): ParseResult {
  const [name, ...rest] = body.components;
  const spaceName = asciiLower(name);
  const space = Object.prototype.hasOwnProperty.call(COLOR_FUNCTION_SPACES, spaceName)
    ? COLOR_FUNCTION_SPACES[spaceName]
    : undefined;
  if (!space) {
    return fail("unsupported-color-space", `unsupported color space '${name}'`, input);
  }
  if (rest.length !== 3) {
    return fail("invalid-component", `color(${spaceName}) needs 3 components, got ${rest.length}`, input);
  }
  const values: number[] = [];
  for (const raw of rest) {
    const token = readToken(raw, { number: true, percent: true }, true);
    if (!token) return bad("component", raw, input);
    values.push(token.kind === "percent" ? token.value / 100 : token.kind === "none" ? 0 : token.value);
  }
  const alpha = parseAlpha(body.alpha, input, !body.legacy);
  if (isResult(alpha)) return alpha;
  return succeed(createColor(space, [values[0], values[1], values[2]], alpha));
}

// -- Entry point -----------------------------------------------------------

const UNSUPPORTED_FUNCTIONS = new Set([
  "color-mix",
  "light-dark",
  "device-cmyk",
  "contrast-color",
  "color-contrast",
  "calc",
  "var",
  "env",
  "attr",
  "min",
  "max",
  "clamp",
]);

const CONTEXT_KEYWORDS = new Set([
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

/**
 * Parses a CSS color string. Total: never throws, for any input.
 */
export function parseColor(input: unknown): ParseResult {
  if (typeof input !== "string") {
    return fail("not-a-string", "colors must be strings", input);
  }
  const text = trim(input);
  if (text === "") return fail("empty", "empty color", input);

  if (text.charCodeAt(0) === 35 /* # */) return parseHex(text, input);

  const open = text.indexOf("(");
  if (open === -1) return parseKeyword(text, input);

  if (text.charCodeAt(text.length - 1) !== 41 /* ) */) {
    return fail("invalid-syntax", "missing closing ')'", input);
  }
  const name = asciiLower(text.slice(0, open));
  const inner = text.slice(open + 1, -1);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) return fail("invalid-syntax", "not a color function", input);

  if (UNSUPPORTED_FUNCTIONS.has(name)) {
    return fail("unsupported-function", `${name}() is not supported`, input);
  }
  if (inner.includes("(") || inner.includes(")")) {
    return fail("unsupported-function", "nested functions such as calc() or var() are not supported", input);
  }

  const legacyCapable = name === "rgb" || name === "rgba" || name === "hsl" || name === "hsla";
  const known = legacyCapable || ["hwb", "lab", "lch", "oklab", "oklch", "color"].includes(name);
  if (!known) return fail("invalid-syntax", `unknown color function '${name}'`, input);

  const body = splitBody(inner, legacyCapable);
  if (typeof body === "string") return fail("invalid-component", `${name}(): ${body}`, input);
  if (asciiLower(body.components[0]) === "from") {
    return fail("unsupported-function", "relative color syntax is not supported", input);
  }

  const expected = name === "color" ? 4 : 3;
  if (body.components.length !== expected) {
    return fail(
      "invalid-component",
      `${name}() needs ${expected} components, got ${body.components.length}`,
      input
    );
  }

  switch (name) {
    case "rgb":
    case "rgba":
      return parseRgb(body, input);
    case "hsl":
    case "hsla":
      return parseHsl(body, input);
    case "hwb":
      return parseHwb(body, input);
    case "lab":
      return parseRectangular("lab", body, input);
    case "oklab":
      return parseRectangular("oklab", body, input);
    case "lch":
      return parsePolar("lch", body, input);
    case "oklch":
      return parsePolar("oklch", body, input);
    default:
      return parseColorFunction(body, input);
  }
}

function parseKeyword(text: string, input: string): ParseResult {
  const keyword = asciiLower(text);
  if (keyword === "transparent") return succeed(createColor("srgb", [0, 0, 0], 0));
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, keyword)) {
    const color = parseHex(NAMED_COLORS[keyword as keyof typeof NAMED_COLORS], input);
    return color;
  }
  if (CONTEXT_KEYWORDS.has(keyword)) {
    return fail("invalid-syntax", `'${keyword}' depends on context and has no fixed color`, input);
  }
  return fail("invalid-syntax", "not a recognized color", input);
}

