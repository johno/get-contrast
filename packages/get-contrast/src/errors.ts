import type { ParseErrorCode } from "./color/parse-result.js";

/**
 * Thrown by the modern API (`check`, `wcag`, ...) when a color argument cannot
 * be used. Extends `TypeError`, like the legacy API's errors. `code` is stable
 * and machine-readable; `input` is a bounded echo of the offending value.
 */
export class ColorInputError extends TypeError {
  readonly code: ParseErrorCode;
  readonly input: string;
  /** Which argument was bad, e.g. "foreground". */
  readonly role: string;

  constructor(role: string, code: ParseErrorCode, message: string, input: string) {
    super(`invalid ${role} color: ${message}`);
    this.name = "ColorInputError";
    this.role = role;
    this.code = code;
    this.input = input;
  }
}
