const { describe, test, expect } = require("bun:test");
require("../scripts/ensure-build");
const {
  COLOR_SPACES,
  SPACES,
  PARSE_ERROR_CODES,
  createColor,
  isColor,
  isColorSpace,
  withAlpha,
  normalizeHue,
  clampAlpha,
  clamp,
  angleToDegrees,
  percentageToNumber,
  succeed,
  fail,
} = require("../dist/cjs/color/index");

describe("spaces", () => {
  test("every supported space has three named components", () => {
    expect(COLOR_SPACES).toEqual([
      "srgb",
      "srgb-linear",
      "display-p3",
      "hsl",
      "hwb",
      "xyz-d65",
      "xyz-d50",
      "lab",
      "lch",
      "oklab",
      "oklch",
    ]);
    expect(Object.keys(SPACES).sort()).toEqual([...COLOR_SPACES].sort());
    for (const space of COLOR_SPACES) {
      expect(SPACES[space].id).toBe(space);
      expect(SPACES[space].components).toHaveLength(3);
    }
  });

  test("component names match CSS", () => {
    const names = (s) => SPACES[s].components.map((c) => c.name).join("");
    expect(names("srgb")).toBe("rgb");
    expect(names("hsl")).toBe("hsl");
    expect(names("hwb")).toBe("hwb");
    expect(names("lab")).toBe("lab");
    expect(names("lch")).toBe("lch");
    expect(names("oklab")).toBe("lab");
    expect(names("oklch")).toBe("lch");
    expect(names("xyz-d65")).toBe("xyz");
  });

  test("hue components exist exactly in the polar and cylindrical spaces", () => {
    for (const space of COLOR_SPACES) {
      const hues = SPACES[space].components.filter((c) => c.kind === "hue").length;
      expect(hues).toBe(["hsl", "hwb", "lch", "oklch"].includes(space) ? 1 : 0);
    }
  });

  test("isColorSpace", () => {
    expect(isColorSpace("oklch")).toBe(true);
    expect(isColorSpace("cmyk")).toBe(false);
    expect(isColorSpace(undefined)).toBe(false);
  });
});

describe("createColor", () => {
  test("builds a frozen color with default alpha 1", () => {
    const c = createColor("srgb", [1, 0.5, 0]);
    expect(c).toEqual({ space: "srgb", coords: [1, 0.5, 0], alpha: 1 });
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.coords)).toBe(true);
  });

  test("does not clamp wide-gamut coordinates", () => {
    expect(createColor("display-p3", [1.2, -0.1, 0.5]).coords).toEqual([1.2, -0.1, 0.5]);
    expect(createColor("srgb", [2, -1, 0]).coords).toEqual([2, -1, 0]);
  });

  test("wraps hue into [0, 360) and keeps the other components", () => {
    expect(createColor("hsl", [-30, 50, 50]).coords).toEqual([330, 50, 50]);
    expect(createColor("hsl", [390, 50, 50]).coords[0]).toBe(30);
    expect(createColor("oklch", [0.5, 0.1, 720]).coords[2]).toBe(0);
    expect(Object.is(createColor("lch", [50, 10, -0]).coords[2], 0)).toBe(true);
    // lab's third coordinate is "b", not a hue, and must not wrap.
    expect(createColor("lab", [50, 10, -400]).coords[2]).toBe(-400);
  });

  test("clamps alpha", () => {
    expect(createColor("srgb", [0, 0, 0], 2).alpha).toBe(1);
    expect(createColor("srgb", [0, 0, 0], -1).alpha).toBe(0);
    expect(createColor("srgb", [0, 0, 0], 0.25).alpha).toBe(0.25);
  });

  test("rejects non-finite input and unknown spaces", () => {
    for (const coords of [[NaN, 0, 0], [0, Infinity, 0], [0, 0, -Infinity], [0, 0]]) {
      expect(() => createColor("srgb", coords)).toThrow(RangeError);
    }
    expect(() => createColor("srgb", [0, 0, 0], NaN)).toThrow(RangeError);
    expect(() => createColor("cmyk", [0, 0, 0])).toThrow(RangeError);
  });

  test("does not alias or mutate the input array", () => {
    const coords = [0.1, 0.2, 0.3];
    const c = createColor("srgb", coords);
    coords[0] = 9;
    expect(c.coords[0]).toBe(0.1);
  });

  test("withAlpha returns a new color", () => {
    const c = createColor("hsl", [10, 20, 30]);
    const d = withAlpha(c, 0.5);
    expect(d).not.toBe(c);
    expect(d.alpha).toBe(0.5);
    expect(c.alpha).toBe(1);
    expect(d.coords).toEqual(c.coords);
  });

  test("isColor", () => {
    expect(isColor(createColor("srgb", [0, 0, 0]))).toBe(true);
    for (const v of [null, undefined, "red", {}, { space: "srgb", coords: [0, 0], alpha: 1 }, { space: "srgb", coords: [0, 0, 0], alpha: 2 }, { space: "nope", coords: [0, 0, 0], alpha: 1 }]) {
      expect(isColor(v)).toBe(false);
    }
  });
});

describe("normalization", () => {
  test("normalizeHue", () => {
    expect(normalizeHue(0)).toBe(0);
    expect(normalizeHue(360)).toBe(0);
    expect(normalizeHue(-90)).toBe(270);
    expect(normalizeHue(725)).toBe(5);
    expect(normalizeHue(-720)).toBe(0);
    expect(Object.is(normalizeHue(-0), 0)).toBe(true);
    expect(normalizeHue(359.999)).toBeCloseTo(359.999, 10);
  });

  test("clamp helpers", () => {
    expect(clampAlpha(1.5)).toBe(1);
    expect(clampAlpha(-0.5)).toBe(0);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  test("angleToDegrees covers every CSS unit", () => {
    expect(angleToDegrees(90)).toBe(90);
    expect(angleToDegrees(90, "deg")).toBe(90);
    expect(angleToDegrees(100, "grad")).toBe(90);
    expect(angleToDegrees(Math.PI, "rad")).toBeCloseTo(180, 12);
    expect(angleToDegrees(0.25, "turn")).toBe(90);
    expect(angleToDegrees(-1, "turn")).toBe(-360);
  });

  test("percentageToNumber uses each component's reference", () => {
    expect(percentageToNumber(50, "srgb", 0)).toBe(0.5);
    expect(percentageToNumber(100, "display-p3", 2)).toBe(1);
    expect(percentageToNumber(100, "lab", 0)).toBe(100);
    expect(percentageToNumber(100, "lab", 1)).toBe(125);
    expect(percentageToNumber(-100, "lab", 2)).toBe(-125);
    expect(percentageToNumber(100, "lch", 1)).toBe(150);
    expect(percentageToNumber(100, "oklab", 0)).toBe(1);
    expect(percentageToNumber(100, "oklab", 2)).toBe(0.4);
    expect(percentageToNumber(50, "oklch", 1)).toBeCloseTo(0.2, 12);
    expect(percentageToNumber(100, "xyz-d65", 1)).toBe(1);
  });
});

describe("parse result contract", () => {
  test("succeed wraps a color", () => {
    const color = createColor("srgb", [1, 0, 0]);
    expect(succeed(color)).toEqual({ ok: true, color });
  });

  test("fail builds a structured, display-safe error", () => {
    const r = fail("invalid-syntax", "nope", "x".repeat(500));
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("invalid-syntax");
    expect(r.error.message).toBe("nope");
    expect(r.error.input.length).toBe(83);
    expect(r.error.input.endsWith("...")).toBe(true);
  });

  test("fail never throws on odd input values", () => {
    for (const v of [undefined, null, 1, {}, [], Symbol("s"), () => 1, 10n]) {
      expect(fail("not-a-string", "m", v).error.input).toBe(typeof v);
    }
  });

  test("error codes are a closed, documented set", () => {
    expect(PARSE_ERROR_CODES).toEqual([
      "not-a-string",
      "empty",
      "invalid-syntax",
      "unsupported-function",
      "unsupported-color-space",
      "invalid-component",
    ]);
  });
});
