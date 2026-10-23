import { isColor, type Color } from "./color/model.js";
import { parseColor } from "./color/parse.js";
import { ColorInputError } from "./errors.js";

/** A color argument to the modern API: CSS text or an already-parsed Color. */
export type ColorInput = string | Color;

/** Resolves a ColorInput, throwing `ColorInputError` with the argument's role. */
export function resolveColor(input: unknown, role: string): Color {
  if (typeof input === "string") {
    const result = parseColor(input);
    if (result.ok) return result.color;
    throw new ColorInputError(role, result.error.code, result.error.message, result.error.input);
  }
  if (isColor(input)) return input;
  const shown = input === null ? "null" : typeof input;
  throw new ColorInputError(role, "not-a-string", "expected a CSS color string or a Color", shown);
}
