// Compile-time check of the public surface, run by `bun run typecheck`.
// Imports resolve through the built declarations, as a consumer's would.
import {
  ratio,
  score,
  isAccessible,
  isNotTransparent,
  type LegacyOptions,
  type LegacyScore,
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

export { r, s, a, t, bad };
