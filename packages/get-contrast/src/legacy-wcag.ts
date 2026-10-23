// WCAG 2.x contrast math as the v3 API computed it (via wcag-contrast@3.0.0
// and relative-luminance@2.0.1, both BSD-2-Clause). It keeps the WCAG 2.0
// 0.03928 sRGB linearization threshold, which differs slightly from the
// 0.04045 used by WCAG 2.2 / the modern API. Do not change it here.

const RED = 0.2126;
const GREEN = 0.7152;
const BLUE = 0.0722;
const LOW_SLOPE = 1 / 12.92;

function linearize(channel: number): number {
  return Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** Relative luminance of `[r, g, b]` channels (0-255; numeric strings allowed). */
function relativeLuminance(rgb: readonly (number | string)[]): number {
  const r = (rgb[0] as number) / 255;
  const g = (rgb[1] as number) / 255;
  const b = (rgb[2] as number) / 255;
  const lr = r <= 0.03928 ? r * LOW_SLOPE : linearize(r);
  const lg = g <= 0.03928 ? g * LOW_SLOPE : linearize(g);
  const lb = b <= 0.03928 ? b * LOW_SLOPE : linearize(b);
  return lr * RED + lg * GREEN + lb * BLUE;
}

/** Contrast ratio between two `[r, g, b]` triplets. */
export function contrastRatio(
  a: readonly (number | string)[],
  b: readonly (number | string)[]
): number {
  const l1 = Math.max(relativeLuminance(a), relativeLuminance(b));
  const l2 = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Legacy score label for a contrast ratio. */
export function scoreForRatio(ratio: number): "AAA" | "AA" | "AA Large" | "Fail" {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA Large";
  return "Fail";
}
