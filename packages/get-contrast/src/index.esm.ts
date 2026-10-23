// Entry point of the ESM build (built as dist/esm/index.js in place of
// index.ts). Same named exports, plus a default export so
// `import contrast from "get-contrast"` keeps working as it did when Node
// handed ESM importers the CommonJS `module.exports` object.
import { ratio, score, isAccessible, isNotTransparent } from "./legacy.js";
import { check, wcag, WCAG_THRESHOLDS, thresholdFor } from "./wcag.js";
import { pick } from "./pick.js";
import { parseColor } from "./color/parse.js";
import { ColorInputError } from "./errors.js";

export { ratio, score, isAccessible, isNotTransparent };
export { check, wcag, WCAG_THRESHOLDS, thresholdFor };
export { pick };
export { parseColor };
export { ColorInputError };
export type { LegacyOptions, LegacyScore } from "./types.js";
export type {
  CheckOptions,
  CheckResult,
  MeasuredColor,
  Note,
  NoteCode,
  WcagLevel,
  WcagOptions,
  WcagResult,
  WcagUse,
} from "./wcag.js";
export type { PickCandidate, PickOptions, PickReasonCode, PickResult, RankedCandidate } from "./pick.js";
export type { Color, ColorSpace } from "./color/model.js";
export type { ParseError, ParseErrorCode, ParseResult } from "./color/parse-result.js";
export type { ColorInput } from "./input.js";

export default {
  ratio,
  score,
  isAccessible,
  isNotTransparent,
  check,
  wcag,
  WCAG_THRESHOLDS,
  thresholdFor,
  pick,
  parseColor,
  ColorInputError,
};
