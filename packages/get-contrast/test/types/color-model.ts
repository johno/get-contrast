// Compile-time coverage of the color model, run by `bun run typecheck`.
import {
  COLOR_SPACES,
  SPACES,
  createColor,
  type Color,
  type ColorSpace,
} from "../../src/color/index";

// Every space has component metadata (also enforced by the mapped type).
const covered: Record<ColorSpace, true> = {
  srgb: true,
  "srgb-linear": true,
  "display-p3": true,
  hsl: true,
  hwb: true,
  "xyz-d65": true,
  "xyz-d50": true,
  lab: true,
  lch: true,
  oklab: true,
  oklch: true,
};

// A switch over ColorSpace must stay exhaustive when a space is added.
export function exhaustive(space: ColorSpace): string {
  switch (space) {
    case "srgb":
    case "srgb-linear":
    case "display-p3":
      return "rgb-like";
    case "hsl":
    case "hwb":
      return "cylindrical";
    case "xyz-d65":
    case "xyz-d50":
      return "xyz";
    case "lab":
    case "oklab":
      return "rectangular";
    case "lch":
    case "oklch":
      return "polar";
    default: {
      const unreachable: never = space;
      return unreachable;
    }
  }
}

// The space type is preserved through construction.
const red: Color<"srgb"> = createColor("srgb", [1, 0, 0]);
// @ts-expect-error a srgb color is not an oklch color
const wrong: Color<"oklch"> = red;

// @ts-expect-error unknown spaces are rejected
createColor("cmyk", [0, 0, 0, 0]);

// @ts-expect-error colors are immutable
red.alpha = 0.5;

export { covered, wrong, COLOR_SPACES, SPACES };
