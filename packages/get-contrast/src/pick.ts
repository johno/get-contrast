// pick(): choose among existing colors. Answers "which of my palette values
// should I use on this background?" so callers (design systems, agents) can
// prefer a color they already have over inventing a new one.
import type { Color } from "./color/model.js";
import { resolveColor, type ColorInput } from "./input.js";
import { check, type CheckOptions, type CheckResult } from "./wcag.js";

/** A candidate color, optionally labelled (for example with a token name). */
export type PickCandidate = ColorInput | { readonly name?: string; readonly color: ColorInput };

export type PickOptions = CheckOptions;

export interface RankedCandidate {
  /** 1 for the best candidate. Ranks are unique and follow the ordering rules. */
  readonly rank: number;
  /** Position in the `candidates` array that was passed in. */
  readonly index: number;
  /** The label, if the candidate was given as `{ name, color }`. */
  readonly name?: string;
  /** The candidate exactly as it was passed in. */
  readonly input: ColorInput;
  /** Whether this candidate meets the target. */
  readonly passes: boolean;
  /** The full WCAG evaluation of this candidate on the background. */
  readonly check: CheckResult;
}

export type PickReasonCode =
  | "no-candidates"
  | "none-pass"
  | "only-passing"
  | "highest-contrast"
  | "tie-broken-by-order";

export interface PickResult {
  /** The best candidate if any candidate meets the target, else `null`. */
  readonly winner: RankedCandidate | null;
  /**
   * Every candidate, best first: passing candidates before failing ones, then by
   * contrast ratio (highest first), then by input order. When nothing passes,
   * `ranked[0]` is the closest candidate (but `winner` is still `null`).
   */
  readonly ranked: readonly RankedCandidate[];
  readonly reasonCode: PickReasonCode;
  /** A sentence explaining the outcome, suitable to show a person or an agent. */
  readonly reason: string;
  /** The threshold candidates were held to. */
  readonly target: CheckResult["target"] | null;
}

function normalize(candidate: PickCandidate): { name?: string; input: ColorInput } {
  if (typeof candidate === "object" && candidate !== null && "color" in candidate && !("space" in candidate)) {
    return { name: candidate.name, input: candidate.color };
  }
  return { input: candidate as ColorInput };
}

function label(entry: RankedCandidate): string {
  const hex = entry.check.foreground.hex;
  return entry.name ? `${entry.name} (${hex})` : hex;
}

/**
 * Ranks `candidates` as foregrounds on `background` against a WCAG target
 * (default AA text; see `CheckOptions`). Deterministic: candidates are never
 * reordered except by the stated rules, and equal contrast keeps input order.
 * Does not modify its arguments. Throws `ColorInputError` for unusable colors,
 * with `role` naming the argument (`background`, `candidates[2]`, ...).
 */
export function pick(
  background: ColorInput,
  candidates: readonly PickCandidate[],
  options: PickOptions = {}
): PickResult {
  // Validate the background (and options) even when there are no candidates.
  const bg: Color = resolveColor(background, "background");

  if (candidates.length === 0) {
    return {
      winner: null,
      ranked: [],
      reasonCode: "no-candidates",
      reason: "No candidates were provided.",
      target: null,
    };
  }

  const evaluated = candidates.map((candidate, index) => {
    const { name, input } = normalize(candidate);
    const color = resolveColor(input, `candidates[${index}]`);
    const result = check(color, bg, options);
    return { index, name, input, result };
  });

  evaluated.sort((a, b) => {
    const passDelta = Number(b.result.target.passes) - Number(a.result.target.passes);
    if (passDelta !== 0) return passDelta;
    if (a.result.ratio !== b.result.ratio) return b.result.ratio - a.result.ratio;
    return a.index - b.index;
  });

  const ranked: RankedCandidate[] = evaluated.map((e, i) => {
    const entry: { -readonly [K in keyof RankedCandidate]: RankedCandidate[K] } = {
      rank: i + 1,
      index: e.index,
      input: e.input,
      passes: e.result.target.passes,
      check: e.result,
    };
    if (e.name !== undefined) entry.name = e.name;
    return entry;
  });

  const target = ranked[0].check.target;
  const targetText = `${target.custom ? "the custom" : `${target.level} ${target.use}`} ${target.threshold}:1 target`;
  const passing = ranked.filter((r) => r.passes);

  if (passing.length === 0) {
    const closest = ranked[0];
    return {
      winner: null,
      ranked,
      reasonCode: "none-pass",
      reason: `None of the ${ranked.length} candidates meet ${targetText}. The closest is ${label(closest)} at ${closest.check.ratioText}.`,
      target,
    };
  }

  const winner = passing[0];
  const tied = passing.filter((r) => r.index !== winner.index && r.check.ratio === winner.check.ratio);
  let reasonCode: PickReasonCode;
  let reason: string;
  if (passing.length === 1) {
    reasonCode = "only-passing";
    reason = `${label(winner)} is the only candidate that meets ${targetText}, at ${winner.check.ratioText}.`;
  } else if (tied.length > 0) {
    reasonCode = "tie-broken-by-order";
    reason = `${label(winner)} meets ${targetText} at ${winner.check.ratioText}, tied on contrast with ${tied.length} other candidate${tied.length === 1 ? "" : "s"}; it was chosen because it appears first.`;
  } else {
    reasonCode = "highest-contrast";
    reason = `${label(winner)} has the highest contrast (${winner.check.ratioText}) of the ${passing.length} candidates that meet ${targetText}.`;
  }
  return { winner, ranked, reasonCode, reason, target };
}
