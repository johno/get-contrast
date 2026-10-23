// The v3 color parser, kept bug-for-bug. Everything here exists only so the
// legacy API (ratio/score/isAccessible/isNotTransparent) behaves exactly as
// v3 did; it is replaced, not extended, by the modern parser. Do not reuse it
// for new APIs and do not "fix" it: the golden suite in compat/ pins its
// quirks (unanchored matching, 5/7-digit hex, ignored percent signs, ...).
//
// The `parseLegacyColor` algorithm is ported from rgb@0.1.0, MIT licensed,
// (c) Valerio Proietti and the MooTools contributors. `isLegacyNamedColor`
// reproduces the detection used by is-named-css-color@1.0.0 (MIT).
import { NAMED_COLORS } from "./named-colors.js";

// Colors rgb@0.1.0 knows natively. `transparent` is what makes the string
// "transparent" parse; the rest shadow nothing, because named colors are
// resolved to hex before they reach this parser in legacy.ts.
const NATIVE_COLORS: Readonly<Record<string, string>> = {
  maroon: "#800000",
  red: "#ff0000",
  orange: "#ffA500",
  yellow: "#ffff00",
  olive: "#808000",
  purple: "#800080",
  fuchsia: "#ff00ff",
  white: "#ffffff",
  lime: "#00ff00",
  green: "#008000",
  navy: "#000080",
  blue: "#0000ff",
  aqua: "#00ffff",
  teal: "#008080",
  black: "#000000",
  silver: "#c0c0c0",
  gray: "#808080",
  transparent: "#0000",
};

type Rgba = [number, number, number, number];

// Channel strings are parsed with parseFloat, so "%" and trailing junk are
// silently ignored. Alpha defaults to 1.
function rgbToRgba(r: unknown, g: unknown, b: unknown, a?: unknown): Rgba | null {
  if (a == null || a === "") a = 1;
  const red = parseFloat(r as string);
  const green = parseFloat(g as string);
  const blue = parseFloat(b as string);
  const alpha = parseFloat(a as string);
  if (
    !(
      red <= 255 &&
      red >= 0 &&
      green <= 255 &&
      green >= 0 &&
      blue <= 255 &&
      blue >= 0 &&
      alpha <= 1 &&
      alpha >= 0
    )
  ) {
    return null;
  }

  return [Math.round(red), Math.round(green), Math.round(blue), alpha];
}

function hexToChannels(hex: string): number[] {
  if (hex.length === 3) hex += "f";
  if (hex.length === 4) {
    const h0 = hex.charAt(0);
    const h1 = hex.charAt(1);
    const h2 = hex.charAt(2);
    const h3 = hex.charAt(3);

    hex = h0 + h0 + h1 + h1 + h2 + h2 + h3 + h3;
  }
  if (hex.length === 6) hex += "ff";
  // Lengths 5 and 7 are not rejected: a trailing lone digit becomes its own
  // (single-digit) channel.
  const channels: number[] = [];
  for (let i = 0, l = hex.length; i < l; i += 2) {
    channels.push(parseInt(hex.slice(i, i + 2), 16) / (i === 6 ? 255 : 1));
  }
  return channels;
}

function hueToChannel(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToChannels(h: unknown, s: unknown, l: unknown, a?: unknown): number[] | null {
  let r: number;
  let g: number;
  let b: number;
  if (a == null || a === "") a = 1;
  const hue = parseFloat(h as string) / 360;
  const sat = parseFloat(s as string) / 100;
  const light = parseFloat(l as string) / 100;
  const alpha = parseFloat(a as string) / 1;
  if (hue > 1 || hue < 0 || sat > 1 || sat < 0 || light > 1 || light < 0 || alpha > 1 || alpha < 0) {
    return null;
  }
  if (sat === 0) {
    r = g = b = light;
  } else {
    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
    const p = 2 * light - q;
    r = hueToChannel(p, q, hue + 1 / 3);
    g = hueToChannel(p, q, hue);
    b = hueToChannel(p, q, hue - 1 / 3);
  }
  return [r * 255, g * 255, b * 255, alpha];
}

// Deliberately unanchored: "xx#fffxx" and "foo rgb(1,2,3) bar" parse.
const SVAL = "\\s*([.\\d%]+)\\s*";
const SLIST = "\\(" + [SVAL, SVAL, SVAL] + "(?:,\\s*([.\\d]+)\\s*)?" + "\\)";
const HEX = /(?:#([a-f0-9]{3,8}))/i;
const RGB = new RegExp("(?:rgb)a?" + SLIST, "i");
const HSL = new RegExp("(?:hsl)a?" + SLIST, "i");

/**
 * Returns the normalized `rgb(r,g,b)` / `rgba(r,g,b,a)` string for `input`, or
 * `null` when v3 could not parse it. `input` is coerced with `input + ""`, so
 * arrays and boxed strings parse as their string form (a v3 quirk).
 */
export function parseLegacyColor(input: unknown): string | null {
  if (input == null) return null;
  // Only the FIRST whitespace run is removed.
  let text = (input as string) + "";
  text = text.replace(/\s+/, "");

  let channels: unknown[] | null;
  let match: RegExpMatchArray | null;
  if (Object.prototype.hasOwnProperty.call(NATIVE_COLORS, text)) {
    return parseLegacyColor(NATIVE_COLORS[text]);
  } else if ((match = text.match(HEX))) {
    channels = hexToChannels(match[1]);
  } else if ((match = text.match(RGB))) {
    channels = match.slice(1);
  } else if ((match = text.match(HSL))) {
    channels = hslToChannels(match[1], match[2], match[3], match[4]);
  } else {
    return null;
  }

  const rgba = channels && rgbToRgba(channels[0], channels[1], channels[2], channels[3]);
  if (!rgba) return null;
  if (rgba[3] === 1) rgba.splice(3, 1);
  return "rgb" + (rgba.length === 4 ? "a" : "") + "(" + rgba + ")";
}

// v3 decided "is this a named color?" with a RegExp built as
// `^a|b|...|z$`. Alternation binds loosest, so only the FIRST name was
// anchored to the start and only the LAST to the end, while every other name
// matched anywhere in the string ("my-red-thing", " red" and "tomatoxyz" all
// counted as named). Such strings then failed the exact-name lookup and ended
// up as unparseable input. "First" and "last" refer to v3's name list, which
// started with aqua and ended with rebeccapurple.
const ANCHORED_START = "aqua";
const ANCHORED_END = "rebeccapurple";
const UNANCHORED_NAMES = Object.keys(NAMED_COLORS).filter(
  (name) => name !== ANCHORED_START && name !== ANCHORED_END
);

/** v3's (loose) named-color detection. Expects an already-lowercased string. */
export function isLegacyNamedColor(color: string): boolean {
  return (
    color.startsWith(ANCHORED_START) ||
    color.endsWith(ANCHORED_END) ||
    UNANCHORED_NAMES.some((name) => color.includes(name))
  );
}

/** Exact lookup of a lowercased named color; `undefined` when there is none. */
export function lookupNamedColor(color: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(NAMED_COLORS, color)
    ? NAMED_COLORS[color as keyof typeof NAMED_COLORS]
    : undefined;
}
