// Compile-time check of the public surface, run by `bun run typecheck`.
// Imports resolve through the built declarations, as a consumer's would.
import {
  ratio,
  score,
  isAccessible,
  isNotTransparent,
  type LegacyOptions,
  type LegacyScore,
  check,
  wcag,
  pick,
  audit,
  type AuditResult,
  find,
  fix,
  type PickResult,
  type FixResult,
  parseColor,
  thresholdFor,
  ColorInputError,
  type CheckResult,
  type WcagResult,
  type Color,
} from "../../dist/cjs/index";

const options: LegacyOptions = { ignoreAlpha: true };

const r: number = ratio("#000", "#fff");
const s: LegacyScore = score("#000", "#fff", options);
const a: boolean = isAccessible("#000", "#fff", {});
const t: string = isNotTransparent("rgba(0,0,0,0)", { ignoreAlpha: true });

// options are optional, and null is accepted at runtime.
ratio("#000", "#fff");
ratio("#000", "#fff", null);

// @ts-expect-error colors must be strings
ratio(1, "#fff");
// @ts-expect-error ratio is a number, not a string
const bad: string = ratio("#000", "#fff");

// Modern API
const result: CheckResult = check("#000", "#fff", { level: "AAA", use: "large-text" });
const passes: boolean = result.target.passes;
const ratioText: string = result.ratioText;
const aa: boolean = result.results.aa.largeText;
const measured: WcagResult = wcag("rgb(0 0 0 / 0.5)", "#fff", { backdrop: "#000" });
const hex: string = measured.foreground.hex;
const parsed = parseColor("oklch(0.5 0.1 200)");
const fromParsed: CheckResult | null = parsed.ok ? check(parsed.color, "#fff") : null;
const theColor: Color | null = parsed.ok ? parsed.color : null;
const threshold: number = thresholdFor("AA", "ui");
check("#000", "#fff", { minRatio: 5 });
// @ts-expect-error unknown level
check("#000", "#fff", { level: "AAAA" });
// @ts-expect-error unknown use
check("#000", "#fff", { use: "poster" });
// @ts-expect-error colors are strings or Color objects
check(1, "#fff");
// @ts-expect-error results are read-only
result.ratio = 1;
const err: ColorInputError | null = null;

const picked: PickResult = pick("#fff", ["#000", { name: "ink", color: "#111" }], { level: "AAA" });
const winnerName: string | undefined = picked.winner?.name;
const reason: string = picked.reason;
// @ts-expect-error candidates must be an array
pick("#fff", "#000");

const fixed: FixResult = fix("#777", "#fff", { level: "AAA", direction: "darker", maxChange: 0.2, gamut: "display-p3", preserveChroma: false });
const css: string | undefined = fixed.suggested?.css;
const reached: boolean = fixed.reached;
const limit: "max-change" | "unreachable" | null = fixed.limitedBy;
const moved: readonly ("lightness" | "chroma" | "hue")[] = fixed.change.dimensions;
find("#777", "#fff", { role: "background" });
fix("#777", "#fff", { change: "background" });
// @ts-expect-error unknown direction
fix("#777", "#fff", { direction: "sideways" });
// @ts-expect-error unknown gamut
fix("#777", "#fff", { gamut: "rec2020" });
// @ts-expect-error fix() takes `change`, find() takes `role`
fix("#777", "#fff", { role: "background" });

const audited: AuditResult = audit({ ink: "#111", paper: "#fff" }, { level: "AA", only: "failing", maxColors: 50 });
const unique: readonly number[] = audited.unique;
const cell: number = audited.matrix[0][1];
const best: number | null = audited.recommendations[0].best;
audit(["#111", { name: "paper", color: "#fff" }]);
// @ts-expect-error a palette is an array or a map, not a string
audit("#111");
// @ts-expect-error unknown filter
audit(["#111"], { only: "some" });

export { audited, unique, cell, best, fixed, css, reached, limit, moved, picked, winnerName, reason, r, s, a, t, bad, passes, ratioText, aa, hex, fromParsed, theColor, threshold, err };
