// Serialization used by result objects. Deliberately tiny: just enough to show
// a measured color to a human or an agent, not a general formatting library.
import { clamp, type Color } from "./model.js";
import { convert } from "./convert.js";

const byte = (unit: number) => Math.round(clamp(unit, 0, 1) * 255);

/**
 * `#rrggbb` for an sRGB view of `color`. Alpha is ignored and out-of-gamut
 * channels are clamped, so use it for display only, never for math.
 */
export function toHex(color: Color): string {
  const [r, g, b] = convert(color, "srgb").coords;
  return "#" + [r, g, b].map((v) => byte(v).toString(16).padStart(2, "0")).join("");
}
