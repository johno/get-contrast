// WCAG 2.2 contrast over the modern color engine. Unlike the legacy v3 API
// (ratio/score/isAccessible), this:
//   - uses the WCAG 2.2 sRGB threshold 0.04045 (v3 used 0.03928),
//   - composites translucent colors the way browsers paint them instead of
//     ignoring alpha,
//   - accepts every color syntax the modern parser supports,
//   - reports pass/fail per WCAG level and use against explicit thresholds.
// See docs/modern-api.md.
import { composite, convert, isInGamut } from "./color/convert.js";
import { toHex } from "./color/format.js";
import { createColor, type Color } from "./color/model.js";
import { ColorInputError } from "./errors.js";
import { resolveColor, type ColorInput } from "./input.js";

// -- Relative luminance and contrast ratio ---------------------------------

/** WCAG 2.2 relative luminance of any color (alpha ignored). 0 = black, 1 = white. */
export function relativeLuminance(color: Color): number {
  // linear-light sRGB channels; the sRGB transfer function in convert() uses
  // WCAG 2.2's 0.04045 threshold. Out-of-gamut colors keep out-of-range
  // channels, which extends the formula naturally to wide-gamut input.
  const [r, g, b] = convert(color, "srgb-linear").coords;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two relative luminances: (L1 + 0.05) / (L2 + 0.05)
 * with L1 the lighter. Not rounded (WCAG forbids rounding a failing ratio up).
 */
export function contrastFromLuminance(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

// -- Thresholds ------------------------------------------------------------

export type WcagLevel = "AA" | "AAA";

/**
 * What the contrast is for:
 *  - `text`: body text (WCAG 1.4.3 / 1.4.6)
 *  - `large-text`: at least 18pt (24px), or 14pt (about 18.66px) and bold
 *  - `ui`: non-text contrast for UI components and graphics (1.4.11)
 */
export type WcagUse = "text" | "large-text" | "ui";

export const WCAG_THRESHOLDS: Readonly<Record<WcagLevel, Readonly<Record<WcagUse, number>>>> = {
  // 1.4.11 has no AAA variant; the ui threshold is 3 at both levels.
  AA: { text: 4.5, "large-text": 3, ui: 3 },
  AAA: { text: 7, "large-text": 4.5, ui: 3 },
};

/** The minimum ratio for a level and use. */
export function thresholdFor(level: WcagLevel, use: WcagUse): number {
  const byLevel = WCAG_THRESHOLDS[level];
  const threshold = byLevel && byLevel[use];
  if (threshold === undefined) {
    throw new RangeError(`unknown WCAG target: level ${String(level)}, use ${String(use)}`);
  }
  return threshold;
}

// -- Results ---------------------------------------------------------------

export type NoteCode =
  | "foreground-alpha"
  | "background-alpha"
  | "backdrop-assumed"
  | "foreground-out-of-gamut"
  | "background-out-of-gamut";

/** An explanation of something the numbers do not show on their face. */
export interface Note {
  readonly code: NoteCode;
  readonly message: string;
}

/** A color as it was measured. */
export interface MeasuredColor {
  /** The color exactly as parsed, before any compositing (any space, any alpha). */
  readonly original: Color;
  /** The opaque sRGB color that was actually measured. */
  readonly color: Color<"srgb">;
  /** `#rrggbb` of the measured color, clamped to sRGB for display only. */
  readonly hex: string;
  /** Relative luminance of the measured color. */
  readonly luminance: number;
}

export interface WcagOptions {
  /**
   * The opaque color painted behind a translucent background (the page
   * canvas). Default: white `#ffffff`, which is what browsers use.
   */
  readonly backdrop?: ColorInput;
}

export interface WcagResult {
  /** WCAG 2.2 contrast ratio, from 1 to 21, unrounded. */
  readonly ratio: number;
  readonly foreground: MeasuredColor;
  readonly background: MeasuredColor;
  readonly notes: readonly Note[];
}

const WHITE = createColor("srgb", [1, 1, 1]);

function describe(color: Color<"srgb">): string {
  return toHex(color);
}

/**
 * Computes the WCAG 2.2 contrast ratio between two colors.
 *
 * A translucent background is composited over `options.backdrop` (default
 * white), then a translucent foreground over the resulting background, in
 * gamma-encoded sRGB like a browser. Throws `ColorInputError` for colors that
 * cannot be parsed.
 */
export function wcag(
  foreground: ColorInput,
  background: ColorInput,
  options: WcagOptions = {}
): WcagResult {
  const fg = resolveColor(foreground, "foreground");
  const bg = resolveColor(background, "background");
  const notes: Note[] = [];

  let backdrop = WHITE;
  if (options.backdrop !== undefined) {
    const resolved = resolveColor(options.backdrop, "backdrop");
    if (resolved.alpha < 1) {
      throw new ColorInputError("backdrop", "invalid-component", "the backdrop must be opaque", "alpha < 1");
    }
    backdrop = convert(resolved, "srgb") as typeof WHITE;
  }

  let effectiveBackground: Color<"srgb"> = convert(bg, "srgb");
  if (bg.alpha < 1) {
    effectiveBackground = composite(bg, backdrop);
    if (options.backdrop === undefined) {
      notes.push({
        code: "backdrop-assumed",
        message: "The background is translucent and no backdrop was given, so it was composited over white.",
      });
    }
    notes.push({
      code: "background-alpha",
      message: `The background has alpha ${bg.alpha}; contrast was measured against ${describe(effectiveBackground)} (composited over ${describe(backdrop)}).`,
    });
  }

  let effectiveForeground: Color<"srgb"> = convert(fg, "srgb");
  if (fg.alpha < 1) {
    effectiveForeground = composite(fg, effectiveBackground);
    notes.push({
      code: "foreground-alpha",
      message: `The foreground has alpha ${fg.alpha}; contrast was measured with its composited color ${describe(effectiveForeground)} over ${describe(effectiveBackground)}.`,
    });
  }

  if (!isInGamut(fg, "srgb")) {
    notes.push({
      code: "foreground-out-of-gamut",
      message: "The foreground is outside the sRGB gamut. Its luminance was computed without clipping; an sRGB display will show a clipped color.",
    });
  }
  if (!isInGamut(bg, "srgb")) {
    notes.push({
      code: "background-out-of-gamut",
      message: "The background is outside the sRGB gamut. Its luminance was computed without clipping; an sRGB display will show a clipped color.",
    });
  }

  const measured = (original: Color, color: Color<"srgb">): MeasuredColor => ({
    original,
    color,
    hex: toHex(color),
    luminance: relativeLuminance(color),
  });
  const measuredForeground = measured(fg, effectiveForeground);
  const measuredBackground = measured(bg, effectiveBackground);

  return {
    ratio: contrastFromLuminance(measuredForeground.luminance, measuredBackground.luminance),
    foreground: measuredForeground,
    background: measuredBackground,
    notes,
  };
}

// -- check() ---------------------------------------------------------------

export interface CheckOptions extends WcagOptions {
  /** Level of the primary `target`. Default `"AA"`. */
  readonly level?: WcagLevel;
  /** Use of the primary `target`. Default `"text"`. */
  readonly use?: WcagUse;
  /**
   * An explicit minimum ratio, replacing the level/use threshold for `target`.
   * Use for policies WCAG does not name (for example a design system's 5:1).
   */
  readonly minRatio?: number;
}

export interface CheckResult extends WcagResult {
  /** The ratio as text, truncated (not rounded) to two decimals: "4.54:1". */
  readonly ratioText: string;
  /** Every WCAG 2.2 threshold at once. */
  readonly results: {
    readonly aa: { readonly text: boolean; readonly largeText: boolean };
    readonly aaa: { readonly text: boolean; readonly largeText: boolean };
    /** Non-text contrast (1.4.11), 3:1. */
    readonly ui: boolean;
  };
  /** The requested target, evaluated. */
  readonly target: {
    readonly level: WcagLevel;
    readonly use: WcagUse;
    /** The minimum ratio that was applied (custom if `minRatio` was given). */
    readonly threshold: number;
    readonly custom: boolean;
    readonly passes: boolean;
  };
}

/** Floors to two decimals so the text never overstates the ratio. */
function ratioText(ratio: number): string {
  return `${(Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2)}:1`;
}

/**
 * Evaluates a foreground/background pair against WCAG 2.2: the ratio, every
 * level and use, the requested target, and notes explaining alpha and gamut
 * handling. Throws `ColorInputError` for colors that cannot be parsed.
 */
export function check(
  foreground: ColorInput,
  background: ColorInput,
  options: CheckOptions = {}
): CheckResult {
  const result = wcag(foreground, background, options);
  const { ratio } = result;

  const level = options.level ?? "AA";
  const use = options.use ?? "text";
  const custom = options.minRatio !== undefined;
  if (custom && !(typeof options.minRatio === "number" && options.minRatio >= 1 && options.minRatio <= 21)) {
    throw new RangeError("minRatio must be a number from 1 to 21");
  }
  const threshold = custom ? (options.minRatio as number) : thresholdFor(level, use);

  return {
    ...result,
    ratioText: ratioText(ratio),
    results: {
      aa: { text: ratio >= WCAG_THRESHOLDS.AA.text, largeText: ratio >= WCAG_THRESHOLDS.AA["large-text"] },
      aaa: { text: ratio >= WCAG_THRESHOLDS.AAA.text, largeText: ratio >= WCAG_THRESHOLDS.AAA["large-text"] },
      ui: ratio >= WCAG_THRESHOLDS.AA.ui,
    },
    target: { level, use, threshold, custom, passes: ratio >= threshold },
  };
}
