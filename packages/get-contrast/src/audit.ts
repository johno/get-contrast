// audit(): the contrast relationships inside a palette. Everything a terminal,
// a web page, or an agent needs lives here; renderers only format it.
//
// Rules (also in docs/modern-api.md):
//  - Input order is preserved everywhere. Object keys follow JavaScript's own
//    property order (integer-like keys first); use an array to be explicit.
//  - Duplicate colors (equal after conversion to sRGB, within 1e-9, and equal
//    alpha) are "aliases": the first occurrence is canonical, later ones point
//    to it with `duplicateOf` and take no part in pairs, so aliases never
//    double-count.
//  - Pairs are ordered (foreground on background), row-major over the unique
//    colors. For opaque colors the ratio is symmetric; for translucent ones it
//    is not, which is why both orders are reported.
//  - Recommendations rank, for each background, the other colors by: meets the
//    target, then contrast ratio, then input order: the same rules as pick().
import { convert, isInGamut } from "./color/convert.js";
import { toHex } from "./color/format.js";
import type { Color } from "./color/model.js";
import { resolveColor, type ColorInput } from "./input.js";
import { check, contrastFromLuminance, relativeLuminance, resolveTarget, WCAG_THRESHOLDS } from "./wcag.js";
import type { CheckOptions, CheckResult, Note } from "./wcag.js";

export type PaletteEntry = ColorInput | { readonly name?: string; readonly color: ColorInput };
/** An array of entries, or a { name: color } map. */
export type PaletteInput = readonly PaletteEntry[] | Readonly<Record<string, ColorInput>>;

export interface AuditOptions extends CheckOptions {
  /** Only list passing or failing pairs in `pairs` (the matrix and summary always cover all). */
  readonly only?: "passing" | "failing";
  /**
   * Safety limit on unique colors, since the matrix has n * (n - 1) pairs.
   * Default 200.
   */
  readonly maxColors?: number;
}

export interface AuditColor {
  /** Position in the input. */
  readonly index: number;
  readonly name?: string;
  /** The entry as given (the color part). */
  readonly input: ColorInput;
  /** The parsed color, in the space it was written in. */
  readonly color: Color;
  /** `#rrggbb` of the color as measured on its own (alpha ignored; display only). */
  readonly hex: string;
  /** Set on a repeat of an earlier color: the index of the first one. */
  readonly duplicateOf?: number;
  /** Set on a canonical color that has repeats: their indices. */
  readonly aliases?: readonly number[];
  readonly notes?: readonly Note[];
}

export interface AuditPair {
  /** Indices into `colors` (always canonical, non-duplicate colors). */
  readonly foreground: number;
  readonly background: number;
  readonly ratio: number;
  readonly ratioText: string;
  readonly results: CheckResult["results"];
  /** Whether the pair meets the audit's target. */
  readonly passes: boolean;
  readonly notes?: readonly Note[];
}

export interface Recommendation {
  /** The background being served (a canonical color index). */
  readonly background: number;
  /** Colors that meet the target on this background, best first. */
  readonly candidates: readonly number[];
  /** `candidates[0]`, or `null` if nothing meets the target. */
  readonly best: number | null;
  /** When nothing meets the target: the highest-contrast color (else `null`). */
  readonly closest: number | null;
}

export interface AuditNote {
  readonly code: "duplicate-name";
  readonly message: string;
}

export interface AuditResult {
  /** The threshold pairs were held to (`passes` is per pair, in `pairs`). */
  readonly target: Omit<CheckResult["target"], "passes">;
  readonly colors: readonly AuditColor[];
  /** Indices of the canonical colors, in input order; the axes of `matrix`. */
  readonly unique: readonly number[];
  /** `matrix[a][b]` is the ratio of `unique[a]` on `unique[b]`. The diagonal is 1. */
  readonly matrix: readonly (readonly number[])[];
  readonly pairs: readonly AuditPair[];
  readonly recommendations: readonly Recommendation[];
  readonly summary: {
    readonly colors: number;
    readonly unique: number;
    readonly duplicates: number;
    readonly pairs: number;
    readonly passing: number;
    readonly failing: number;
  };
  readonly notes: readonly AuditNote[];
}

const DEFAULT_MAX_COLORS = 200;
const SAME = 1e-9;

function entries(palette: PaletteInput): { name?: string; input: unknown }[] {
  if (Array.isArray(palette)) {
    return (palette as readonly PaletteEntry[]).map((entry) =>
      typeof entry === "object" && entry !== null && "color" in entry && !("space" in entry)
        ? { name: entry.name, input: entry.color }
        : { input: entry }
    );
  }
  if (typeof palette === "object" && palette !== null) {
    return Object.entries(palette as Record<string, ColorInput>).map(([name, input]) => ({ name, input }));
  }
  throw new TypeError("a palette is an array of colors or a { name: color } object");
}

function sameColor(a: Color, b: Color): boolean {
  if (Math.abs(a.alpha - b.alpha) > SAME) return false;
  const x = convert(a, "srgb").coords;
  const y = convert(b, "srgb").coords;
  return x.every((v, i) => Math.abs(v - y[i]) <= SAME);
}

function ratioText(ratio: number): string {
  return `${(Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2)}:1`;
}

/**
 * Audits every foreground/background relationship in a palette against a WCAG
 * target (default AA text). See the rules at the top of this file.
 * Throws `ColorInputError` (role `palette[i]` or `palette.<name>`) for colors
 * that cannot be used, and `RangeError` if the palette is larger than
 * `maxColors` unique colors.
 */
export function audit(palette: PaletteInput, options: AuditOptions = {}): AuditResult {
  const maxColors = options.maxColors ?? DEFAULT_MAX_COLORS;
  if (!(Number.isInteger(maxColors) && maxColors >= 1)) throw new RangeError("maxColors must be a positive integer");
  if (options.only !== undefined && options.only !== "passing" && options.only !== "failing") {
    throw new RangeError(`unknown filter: ${String(options.only)}`);
  }

  const parsed = entries(palette).map((entry, index) => {
    const role = entry.name !== undefined ? `palette.${entry.name}` : `palette[${index}]`;
    return { index, name: entry.name, input: entry.input as ColorInput, color: resolveColor(entry.input, role) };
  });

  // Aliases: later repeats point at the first occurrence.
  const canonical: number[] = [];
  const duplicateOf = new Map<number, number>();
  const aliases = new Map<number, number[]>();
  for (const item of parsed) {
    const first = canonical.find((c) => sameColor(parsed[c].color, item.color));
    if (first === undefined) {
      canonical.push(item.index);
    } else {
      duplicateOf.set(item.index, first);
      aliases.set(first, [...(aliases.get(first) || []), item.index]);
    }
  }

  if (canonical.length > maxColors) {
    throw new RangeError(
      `the palette has ${canonical.length} unique colors, which makes ${canonical.length * (canonical.length - 1)} pairs; raise maxColors (currently ${maxColors}) to audit it`
    );
  }

  // Names that mean two different colors are legal but worth saying.
  const notes: AuditNote[] = [];
  const byName = new Map<string, number[]>();
  for (const item of parsed) if (item.name !== undefined) byName.set(item.name, [...(byName.get(item.name) || []), item.index]);
  for (const [name, indices] of byName) {
    const distinct = new Set(indices.map((i) => duplicateOf.get(i) ?? i));
    if (distinct.size > 1) notes.push({ code: "duplicate-name", message: `The name "${name}" is used for ${distinct.size} different colors (entries ${indices.join(", ")}).` });
  }

  const colors: AuditColor[] = parsed.map((item) => {
    const entry: { -readonly [K in keyof AuditColor]: AuditColor[K] } = {
      index: item.index,
      input: item.input,
      color: item.color,
      hex: toHex(item.color),
    };
    if (item.name !== undefined) entry.name = item.name;
    if (duplicateOf.has(item.index)) entry.duplicateOf = duplicateOf.get(item.index);
    if (aliases.has(item.index)) entry.aliases = aliases.get(item.index);
    if (!isInGamut(item.color, "srgb")) {
      entry.notes = [{ code: "foreground-out-of-gamut", message: "This color is outside the sRGB gamut; luminance is computed without clipping." }];
    }
    return entry;
  });

  const checkOptions: CheckOptions = { level: options.level, use: options.use, minRatio: options.minRatio, backdrop: options.backdrop };
  const unique = canonical;
  const resolved = resolveTarget(options);
  const threshold = resolved.threshold;
  const target = resolved;

  // Fast path for opaque colors: luminance once per color, measured the way
  // check() measures it (via sRGB) so both paths give identical ratios.
  const luminance = unique.map((i) => (parsed[i].color.alpha === 1 ? relativeLuminance(convert(parsed[i].color, "srgb")) : null));

  const matrix: number[][] = unique.map(() => unique.map(() => 1));
  const allPairs: AuditPair[] = [];
  unique.forEach((fgIndex, a) => {
    unique.forEach((bgIndex, b) => {
      if (a === b) return;
      const la = luminance[a];
      const lb = luminance[b];
      let pair: AuditPair;
      if (la !== null && lb !== null) {
        const ratio = contrastFromLuminance(la, lb);
        pair = {
          foreground: fgIndex,
          background: bgIndex,
          ratio,
          ratioText: ratioText(ratio),
          results: {
            aa: { text: ratio >= WCAG_THRESHOLDS.AA.text, largeText: ratio >= WCAG_THRESHOLDS.AA["large-text"] },
            aaa: { text: ratio >= WCAG_THRESHOLDS.AAA.text, largeText: ratio >= WCAG_THRESHOLDS.AAA["large-text"] },
            ui: ratio >= WCAG_THRESHOLDS.AA.ui,
          },
          passes: ratio >= threshold,
        };
      } else {
        // Translucent colors need real compositing, with the role of each color.
        const full = check(parsed[fgIndex].color, parsed[bgIndex].color, checkOptions);
        pair = {
          foreground: fgIndex,
          background: bgIndex,
          ratio: full.ratio,
          ratioText: full.ratioText,
          results: full.results,
          passes: full.target.passes,
          ...(full.notes.length ? { notes: full.notes } : {}),
        };
      }
      matrix[a][b] = pair.ratio;
      allPairs.push(pair);
    });
  });

  // Recommendations use the same ordering rules as pick().
  const recommendations: Recommendation[] = unique.map((bgIndex, b) => {
    const others = allPairs.filter((p) => p.background === bgIndex);
    const ordered = [...others].sort((x, y) => Number(y.passes) - Number(x.passes) || y.ratio - x.ratio || x.foreground - y.foreground);
    const candidates = ordered.filter((p) => p.passes).map((p) => p.foreground);
    return {
      background: bgIndex,
      candidates,
      best: candidates.length ? candidates[0] : null,
      closest: candidates.length === 0 && ordered.length ? ordered[0].foreground : null,
    };
  });

  const passing = allPairs.filter((p) => p.passes).length;
  const pairs = options.only === "passing" ? allPairs.filter((p) => p.passes) : options.only === "failing" ? allPairs.filter((p) => !p.passes) : allPairs;

  return {
    target,
    colors,
    unique,
    matrix,
    pairs,
    recommendations,
    summary: {
      colors: parsed.length,
      unique: unique.length,
      duplicates: parsed.length - unique.length,
      pairs: allPairs.length,
      passing,
      failing: allPairs.length - passing,
    },
    notes,
  };
}

