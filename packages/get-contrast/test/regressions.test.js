// One test per bug found while building the color engine, so none can return.
const { describe, test, expect } = require("bun:test");
require("../scripts/ensure-build");
const {
  parseColor,
  convert,
  createColor,
  srgbToLinear,
  linearToSrgb,
} = require("../dist/cjs/color/index.js");

const parse = (s) => parseColor(s);

describe("parser regressions", () => {
  test("long whitespace runs do not cause quadratic trimming (#39)", () => {
    const hostile = " ".repeat(200000) + "red" + " ".repeat(200000) + "x";
    const start = performance.now();
    expect(parse(hostile).ok).toBe(false);
    expect(performance.now() - start).toBeLessThan(500);
  });

  test("keywords fold ASCII case only: Kelvin sign is not 'k' (found by WPT)", () => {
    expect(parse("black").ok).toBe(true);
    expect(parse("blacK").ok).toBe(false);
    expect(parse("darKgray").ok).toBe(false);
    expect(parse("rgb(0 0 0 / NÅNE)").ok).toBe(false);
    expect(parse("hsl(0DEG 0% 0%)").ok).toBe(true);
    expect(parse("hsl(0KEG 0% 0%)").ok).toBe(false);
    // long s (U+017F) uppercases to "S" but must not match
    expect(parse("tranſparent").ok).toBe(false);
  });

  test("legacy comma syntax rejects `none` in alpha as well (found by WPT)", () => {
    expect(parse("rgb(255, 255, 255, none)").ok).toBe(false);
    expect(parse("hsla(120, 100%, 50%, none)").ok).toBe(false);
    expect(parse("rgb(255 255 255 / none)").ok).toBe(true);
  });

  test("hwb whiteness/blackness are not clamped to 100% before normalization (found by WPT)", () => {
    const c = parse("hwb(0 200% 100%)").color;
    expect(c.coords).toEqual([0, 200, 100]);
    const rgb = convert(c, "srgb").coords;
    rgb.forEach((v) => expect(v).toBeCloseTo(2 / 3, 12));
  });
});

describe("conversion regressions", () => {
  test("white converts to display-p3 white (XYZ -> P3 matrix is the exact inverse)", () => {
    const p3 = convert(createColor("srgb", [1, 1, 1]), "display-p3").coords;
    p3.forEach((v) => expect(v).toBeCloseTo(1, 9));
  });

  test("transfer functions are exact inverses at the segment boundary", () => {
    const boundary = 0.04045;
    expect(linearToSrgb(srgbToLinear(boundary))).toBeCloseTo(boundary, 14);
  });

  test("primary red is exactly hsl(0 100% 50%), not 359.99999deg", () => {
    expect(convert(parse("red").color, "hsl").coords).toEqual([0, 100, 50]);
    expect(convert(parse("lime").color, "hsl").coords).toEqual([120, 100, 50]);
    expect(convert(parse("blue").color, "hsl").coords).toEqual([240, 100, 50]);
    expect(convert(parse("red").color, "hwb").coords).toEqual([0, 0, 0]);
  });
});
