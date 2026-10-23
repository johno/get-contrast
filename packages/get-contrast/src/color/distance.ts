import { convert } from "./convert.js";
import type { Color } from "./model.js";

/**
 * Perceptual distance between two colors: Euclidean distance in OKLab
 * (black to white is 1; around 0.02 is a just-noticeable difference). Alpha is
 * ignored.
 */
export function deltaEOk(a: Color, b: Color): number {
  const x = convert(a, "oklab").coords;
  const y = convert(b, "oklab").coords;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
