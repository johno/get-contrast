// Legacy v3 API (behavior frozen; see docs/v3-compatibility.md).
export { ratio, score, isAccessible, isNotTransparent } from "./legacy.js";
export type { LegacyOptions, LegacyScore } from "./types.js";

// Modern v4 API (see docs/modern-api.md).
export { check, wcag, WCAG_THRESHOLDS, thresholdFor } from "./wcag.js";
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
export { pick } from "./pick.js";
export type { PickCandidate, PickOptions, PickReasonCode, PickResult, RankedCandidate } from "./pick.js";
export { parseColor } from "./color/parse.js";
export type { Color, ColorSpace } from "./color/model.js";
export type { ParseError, ParseErrorCode, ParseResult } from "./color/parse-result.js";
export { ColorInputError } from "./errors.js";
export type { ColorInput } from "./input.js";
