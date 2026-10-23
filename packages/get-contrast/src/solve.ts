// find()/fix(): given a failing pair, find the smallest sensible change to one
// color that makes it meet a WCAG target.
//
// Search strategy (documented in docs/modern-api.md):
//  - Work in OKLCH, so a step along L is a perceptually even change.
//  - Default ("lightness") mode keeps chroma and hue and moves only L, toward
//    darker, lighter, or whichever side is nearer. Hue is never rotated: moving
//    L toward 0 or 1 always reaches black or white, so lightness alone can reach
//    the best contrast any hue could, and rotating hue only adds change.
//  - If the wanted chroma does not fit the target gamut at some L, chroma is
//    reduced (hue and L kept) until it fits. This is reported, never silent.
//  - With `preserveChroma: false` the solver may also lower chroma (never raise
//    it) when that reaches the target with less perceptual change.
//  - The boundary is found by a coarse scan (robust against non-monotonic
//    regions) then bisection, and the answer is the side that PASSES. The final
//    color is serialized (8-bit hex for sRGB), parsed back, and re-checked, so
//    what the caller gets is what they will deploy, and it passes.
import { convert, isInGamut, type Gamut } from "./color/convert.js";
import { deltaEOk } from "./color/distance.js";
import { clamp, createColor, normalizeHue, type Color } from "./color/model.js";
import { parseColor } from "./color/parse.js";
import { resolveColor, type ColorInput } from "./input.js";
import { check, type CheckOptions, type CheckResult } from "./wcag.js";

export type SolveDirection = "auto" | "darker" | "lighter";
export type ChangedDimension = "lightness" | "chroma" | "hue";
export type LimitedBy = "max-change" | "unreachable";

export interface FindOptions extends CheckOptions {
  /**
   * Which color is being adjusted: the `foreground` (default; `against` is the
   * background) or the `background` (`against` is the foreground text).
   */
  readonly role?: "foreground" | "background";
  /** Search toward darker colors, lighter colors, or the nearer solution. Default `"auto"`. */
  readonly direction?: SolveDirection;
  /**
   * Keep the original chroma where the target gamut allows (default `true`):
   * lightness is the only thing that moves. With `false` the solver may also
   * lower chroma to reach the target with less overall change.
   */
  readonly preserveChroma?: boolean;
  /** Gamut the result must be in. Default `"srgb"`. */
  readonly gamut?: Gamut;
  /**
   * The largest perceptual change allowed, as a distance in OKLab
   * (black to white is 1; 0.05 is a small tweak). Beyond this the target is
   * reported as not reached.
   */
  readonly maxChange?: number;
}

export interface FixOptions extends Omit<FindOptions, "role"> {
  /** Which color may change. Default `"foreground"`. */
  readonly change?: "foreground" | "background";
}

export type FixNoteCode =
  | "already-passes"
  | "chroma-reduced-for-gamut"
  | "chroma-reduced-to-reach-target"
  | "alpha-preserved"
  | "target-unreachable"
  | "max-change-limit";

export interface FixNote {
  readonly code: FixNoteCode;
  readonly message: string;
}

export interface OklchValues {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

export interface FixResult {
  /** True if `suggested` meets the target (always true when it already passed). */
  readonly reached: boolean;
  /** False when nothing needed to change or nothing better could be found. */
  readonly changed: boolean;
  /** Why the target was not reached, or `null` if it was. */
  readonly limitedBy: LimitedBy | null;
  /** Which color was adjusted. */
  readonly adjusted: "foreground" | "background";
  readonly original: {
    readonly color: Color;
    readonly oklch: OklchValues;
    /** The pair as given. */
    readonly check: CheckResult;
  };
  /**
   * The suggestion, or `null` when no change could improve the contrast.
   * When `reached` is false this is the best the constraints allow, not a pass.
   */
  readonly suggested: {
    readonly color: Color;
    /** Ready to paste: `#rrggbb[aa]` for sRGB, `color(display-p3 ...)` otherwise. */
    readonly css: string;
    readonly oklch: OklchValues;
    /** The pair with the suggestion applied. */
    readonly check: CheckResult;
  } | null;
  /** How far the suggestion is from the original. */
  readonly change: {
    /** Euclidean distance in OKLab (0 = identical, black to white = 1). */
    readonly deltaE: number;
    /** Which OKLCH dimensions moved noticeably. */
    readonly dimensions: readonly ChangedDimension[];
  };
  readonly target: CheckResult["target"];
  readonly notes: readonly FixNote[];
}

// -- Helpers ---------------------------------------------------------------

const SCAN_STEPS = 48;
const BISECT_ITERATIONS = 48;
const NUDGE = 5e-5;
const MAX_NUDGES = 400;
const CHROMA_SCALES = [1, 0.875, 0.75, 0.625, 0.5, 0.375, 0.25, 0.125, 0];

function oklch(color: Color): OklchValues {
  const [l, c, h] = convert(color, "oklch").coords;
  return { l, c, h };
}

const deltaE = deltaEOk;

/** Largest chroma <= `chroma` that fits `gamut` at this lightness and hue. */
function fitChroma(l: number, chroma: number, hue: number, gamut: Gamut): number {
  if (isInGamut(createColor("oklch", [l, chroma, hue]), gamut, 1e-9)) return chroma;
  let low = 0;
  let high = chroma;
  for (let i = 0; i < BISECT_ITERATIONS; i++) {
    const mid = (low + high) / 2;
    if (isInGamut(createColor("oklch", [l, mid, hue]), gamut, 1e-9)) low = mid;
    else high = mid;
  }
  return low;
}

function trim(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)));
}

/** CSS for `color` in `gamut`: hex for sRGB, color(display-p3 ...) otherwise. */
function toCss(color: Color, gamut: Gamut): string {
  const [r, g, b] = convert(color, gamut).coords.map((v) => clamp(v, 0, 1));
  if (gamut === "srgb") {
    const byte = (v: number) => Math.round(v * 255);
    if (color.alpha === 1) {
      return "#" + [r, g, b].map((v) => byte(v).toString(16).padStart(2, "0")).join("");
    }
    return `rgb(${byte(r)} ${byte(g)} ${byte(b)} / ${trim(color.alpha, 4)})`;
  }
  const alpha = color.alpha === 1 ? "" : ` / ${trim(color.alpha, 4)}`;
  return `color(display-p3 ${trim(r, 5)} ${trim(g, 5)} ${trim(b, 5)}${alpha})`;
}

interface Attempt {
  readonly color: Color; // verified: parsed back from `css`
  readonly css: string;
  readonly result: CheckResult;
  readonly distance: number;
  readonly scale: number;
  readonly sign: -1 | 1;
}

// -- The solver ------------------------------------------------------------

interface SolveInput {
  readonly original: Color;
  readonly other: Color;
  readonly role: "foreground" | "background";
}

function validate(options: FindOptions): void {
  const direction = options.direction ?? "auto";
  const gamut = options.gamut ?? "srgb";
  if (!["auto", "darker", "lighter"].includes(direction)) throw new RangeError(`unknown direction: ${String(direction)}`);
  if (gamut !== "srgb" && gamut !== "display-p3") throw new RangeError(`unknown gamut: ${String(gamut)}`);
  if (options.maxChange !== undefined && !(typeof options.maxChange === "number" && options.maxChange >= 0)) {
    throw new RangeError("maxChange must be a non-negative number");
  }
}

/**
 * Finds the smallest change to `color` so that it meets the WCAG target against
 * `against`. `color` is the foreground unless `options.role` says otherwise.
 * Never claims success it did not verify: `reached` is computed by re-checking
 * the serialized suggestion. Throws `ColorInputError` for unusable colors and
 * `RangeError` for invalid options.
 */
export function find(color: ColorInput, against: ColorInput, options: FindOptions = {}): FixResult {
  const role = options.role ?? "foreground";
  if (role !== "foreground" && role !== "background") throw new RangeError(`unknown role: ${String(role)}`);
  validate(options);
  return solve({ original: resolveColor(color, "color"), other: resolveColor(against, "against"), role }, options);
}

function solve({ original, other, role }: SolveInput, options: FindOptions): FixResult {
  const direction = options.direction ?? "auto";
  const gamut = options.gamut ?? "srgb";
  const preserveChroma = options.preserveChroma ?? true;
  const maxChange = options.maxChange ?? Infinity;

  const checkOptions: CheckOptions = {
    level: options.level,
    use: options.use,
    minRatio: options.minRatio,
    backdrop: options.backdrop,
  };
  const evaluate = (candidate: Color): CheckResult =>
    role === "foreground" ? check(candidate, other, checkOptions) : check(other, candidate, checkOptions);

  const before = evaluate(original);
  const originalLch = oklch(original);
  const base = {
    adjusted: role,
    original: { color: original, oklch: originalLch, check: before },
    target: before.target,
  } as const;

  // "Already passes" must hold for the color that would actually be deployed:
  // what `toCss` writes in the target gamut (clamped to it, rounded to 8-bit).
  // An out-of-gamut original can pass as written and fail once clamped, and
  // one that is outside the gamut is never reported as "unchanged" because
  // deploying it would change it.
  const deployedCss = toCss(original, gamut);
  const deployedParse = parseColor(deployedCss);
  const deployed = deployedParse.ok ? deployedParse.color : original;
  const deployedCheck = evaluate(deployed);
  if (before.target.passes && deployedCheck.target.passes && isInGamut(original, gamut, 1e-6)) {
    return {
      ...base,
      reached: true,
      changed: false,
      limitedBy: null,
      suggested: { color: deployed, css: deployedCss, oklch: oklch(deployed), check: deployedCheck },
      change: { deltaE: 0, dimensions: [] },
      notes: [{ code: "already-passes", message: `The pair already meets the target (${before.ratioText}); nothing was changed.` }],
    };
  }

  const alpha = original.alpha;
  const hue = originalLch.h;
  const chroma0 = originalLch.c;
  const l0 = originalLch.l;

  const build = (l: number, scale: number): Color =>
    createColor("oklch", [l, fitChroma(l, chroma0 * scale, hue, gamut), hue], alpha);

  /** Serialize, parse back, and re-check: what the caller would actually deploy. */
  const verify = (l: number, scale: number, sign: -1 | 1): Attempt | null => {
    const css = toCss(build(l, scale), gamut);
    const parsed = parseColor(css);
    if (!parsed.ok) return null;
    const result = evaluate(parsed.color);
    return { color: parsed.color, css, result, distance: deltaE(original, parsed.color), scale, sign };
  };

  const passes = (l: number, scale: number) => evaluate(build(l, scale)).target.passes;

  /** Farthest lightness in a direction before the extreme or the change budget. */
  const limitLightness = (sign: -1 | 1, scale: number): number => {
    const extreme = sign === 1 ? 1 : 0;
    if (deltaE(original, build(extreme, scale)) <= maxChange) return extreme;
    let near = l0; // within budget
    let far = extreme; // beyond budget
    for (let i = 0; i < BISECT_ITERATIONS; i++) {
      const mid = (near + far) / 2;
      if (deltaE(original, build(mid, scale)) <= maxChange) near = mid;
      else far = mid;
    }
    return near;
  };

  const reachedAttempts: Attempt[] = [];
  const bestEffort: Attempt[] = [];

  const signs: (-1 | 1)[] = direction === "darker" ? [-1] : direction === "lighter" ? [1] : [-1, 1];
  const scales = preserveChroma ? [1] : CHROMA_SCALES;

  for (const scale of scales) {
    for (const sign of signs) {
      const limit = limitLightness(sign, scale);
      if (Math.abs(limit - l0) < 1e-12) continue;

      // Coarse scan outward for the first passing lightness.
      let failing = l0;
      let passing: number | null = null;
      for (let i = 1; i <= SCAN_STEPS; i++) {
        const l = l0 + ((limit - l0) * i) / SCAN_STEPS;
        if (passes(l, scale)) {
          passing = l;
          break;
        }
        failing = l;
      }

      if (passing === null) {
        const attempt = verify(limit, scale, sign);
        if (attempt) bestEffort.push(attempt);
        continue;
      }

      // Bisect between the last failing and first passing lightness; keep the passing side.
      let lo = failing;
      let hi = passing;
      for (let i = 0; i < BISECT_ITERATIONS; i++) {
        const mid = (lo + hi) / 2;
        if (passes(mid, scale)) hi = mid;
        else lo = mid;
      }

      // Quantizing to 8-bit (or 5 decimals) can land just under the threshold:
      // nudge away from the original until the serialized color passes.
      let attempt: Attempt | null = null;
      for (let k = 0; k <= MAX_NUDGES; k++) {
        const l = clamp(hi + sign * k * NUDGE, 0, 1);
        const candidate = verify(l, scale, sign);
        if (candidate && candidate.result.target.passes) {
          attempt = candidate;
          break;
        }
        if (l === 0 || l === 1) break;
      }
      if (attempt && attempt.distance <= maxChange + 1e-9) reachedAttempts.push(attempt);
      else {
        const fallback = verify(limit, scale, sign);
        if (fallback) bestEffort.push(fallback);
      }
    }
  }

  const byDistance = (a: Attempt, b: Attempt) =>
    a.distance - b.distance || b.scale - a.scale || a.sign - b.sign;
  const byRatio = (a: Attempt, b: Attempt) =>
    b.result.ratio - a.result.ratio || a.distance - b.distance || b.scale - a.scale || a.sign - b.sign;

  const notes: FixNote[] = [];
  if (alpha < 1) {
    notes.push({ code: "alpha-preserved", message: `The color's alpha (${alpha}) was kept; only lightness${preserveChroma ? "" : " and chroma"} changed.` });
  }

  const finish = (attempt: Attempt, reached: boolean, limitedBy: LimitedBy | null): FixResult => {
    const after = oklch(attempt.color);
    const dimensions: ChangedDimension[] = [];
    if (Math.abs(after.l - l0) > 5e-4) dimensions.push("lightness");
    if (Math.abs(after.c - chroma0) > 2e-3) dimensions.push("chroma");
    const hueDelta = Math.abs(after.h - hue);
    if (after.c > 0.01 && chroma0 > 0.01 && Math.min(hueDelta, 360 - hueDelta) > 1) dimensions.push("hue");

    if (dimensions.includes("chroma")) {
      notes.push(
        preserveChroma
          ? { code: "chroma-reduced-for-gamut", message: `The original chroma does not fit ${gamut} at this lightness, so it was reduced from ${trim(chroma0, 3)} to ${trim(after.c, 3)} (hue kept).` }
          : { code: "chroma-reduced-to-reach-target", message: `Chroma was lowered from ${trim(chroma0, 3)} to ${trim(after.c, 3)} to reach the target with less overall change.` }
      );
    }
    if (!reached && limitedBy === "max-change") {
      notes.push({ code: "max-change-limit", message: `Reaching the target needs a larger change than maxChange (${options.maxChange}). The suggestion is the best contrast within that limit (${attempt.result.ratioText}); it does not meet the target.` });
    }
    if (!reached && limitedBy === "unreachable") {
      const alphaHint = alpha < 1 ? ` The color's alpha (${alpha}) caps the contrast it can reach; a higher alpha may allow it.` : "";
      notes.push({ code: "target-unreachable", message: `No ${gamut} color of this hue can meet ${before.target.threshold}:1 against the other color. The suggestion is the best available (${attempt.result.ratioText}); it does not meet the target.${alphaHint}` });
    }
    return {
      ...base,
      reached,
      changed: true,
      limitedBy,
      suggested: { color: attempt.color, css: attempt.css, oklch: after, check: attempt.result },
      change: { deltaE: attempt.distance, dimensions },
      notes,
    };
  };

  if (reachedAttempts.length > 0) {
    return finish([...reachedAttempts].sort(byDistance)[0], true, null);
  }

  // Not reached. Is it the change budget, or the colors themselves?
  const limitedBy: LimitedBy =
    Number.isFinite(maxChange) && solve({ original, other, role }, { ...options, maxChange: undefined }).reached
      ? "max-change"
      : "unreachable";

  // A best-effort suggestion is still a suggestion, so it must respect maxChange
  // too (gamut fitting and 8-bit rounding can push the verified color past the
  // budget even when the unrounded search stayed inside it).
  const improving = bestEffort
    .filter((a) => a.result.ratio > before.ratio && a.distance <= maxChange + 1e-9)
    .sort(byRatio);
  if (improving.length > 0) return finish(improving[0], false, limitedBy);

  const budgetMessage = before.target.passes
    ? `The pair meets the target as written, but it cannot be deployed in ${gamut} within maxChange (${options.maxChange}).`
    : "No change within the given constraints improves the contrast.";

  return {
    ...base,
    reached: false,
    changed: false,
    limitedBy,
    suggested: null,
    change: { deltaE: 0, dimensions: [] },
    notes: [
      before.target.passes
        ? { code: "max-change-limit", message: budgetMessage }
        : { code: "target-unreachable", message: `${budgetMessage}${alpha < 1 ? ` The color's alpha (${alpha}) also caps the contrast it can reach.` : ""}` },
    ],
  };
}

/**
 * Convenience wrapper over `find()` for a foreground/background pair: adjusts
 * the foreground (default) or the background and leaves the other alone.
 */
export function fix(foreground: ColorInput, background: ColorInput, options: FixOptions = {}): FixResult {
  const { change = "foreground", ...rest } = options;
  if (change !== "foreground" && change !== "background") {
    throw new RangeError(`unknown change target: ${String(change)}`);
  }
  validate(rest);
  const fg = resolveColor(foreground, "foreground");
  const bg = resolveColor(background, "background");
  return change === "foreground"
    ? solve({ original: fg, other: bg, role: "foreground" }, rest)
    : solve({ original: bg, other: fg, role: "background" }, rest);
}
