// The contract every color parser follows. Parsers are pure, total functions:
// they never throw for any input (including non-strings, huge strings, and
// malformed syntax) and report failure as a value that callers can show.
//
// Two kinds of parser exist and must not be conflated:
//
//  - The MODERN parser (`parseColor`, standards-oriented CSS Color 4). It is
//    strict, returns a `Color` in the space the CSS syntax names, and reports
//    structured errors.
//  - The LEGACY adapter (`parseLegacyColor` in ../legacy-parse.ts) reproduces
//    the v3 `rgb` package bug for bug and returns a normalized string or null.
//    It exists only so the v3 API keeps its exact behavior; it is not a
//    ParseResult producer and new code must not use it.
import type { Color } from "./model.js";

export const PARSE_ERROR_CODES = [
  /** The input was not a string. */
  "not-a-string",
  /** The string was empty or whitespace. */
  "empty",
  /** The text is not a color in any supported syntax. */
  "invalid-syntax",
  /** A recognized CSS color function this engine does not support. */
  "unsupported-function",
  /** `color(<space> ...)` named a space this engine does not support. */
  "unsupported-color-space",
  /** The syntax is right but a component is missing, extra, or malformed. */
  "invalid-component",
] as const;

export type ParseErrorCode = (typeof PARSE_ERROR_CODES)[number];

export interface ParseError {
  readonly code: ParseErrorCode;
  /** A short, human-readable explanation. Not a stable string; match on `code`. */
  readonly message: string;
  /** The offending input, truncated for display. */
  readonly input: string;
}

export type ParseResult =
  | { readonly ok: true; readonly color: Color }
  | { readonly ok: false; readonly error: ParseError };

/** The signature of a modern parser. */
export type ColorParser = (input: unknown) => ParseResult;

const MAX_ECHO = 80;

export function succeed(color: Color): ParseResult {
  return { ok: true, color };
}

export function fail(code: ParseErrorCode, message: string, input: unknown): ParseResult {
  const text = typeof input === "string" ? input : String(typeof input);
  return {
    ok: false,
    error: {
      code,
      message,
      input: text.length > MAX_ECHO ? text.slice(0, MAX_ECHO) + "..." : text,
    },
  };
}
