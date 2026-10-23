// Conversion, gamut and compositing tests.
//
// Reference-vector provenance:
//  - sRGB and Display P3 primaries/white point: chromaticities from the sRGB
//    (IEC 61966-2-1) and Display P3 definitions, D65 white (0.3127, 0.3290).
//  - Lab/LCH/OKLab/OKLCH of sRGB red: CSS Color Module Level 4 examples
//    (lab(54.29% 80.8 69.89), lch(54.29% 106.84 40.85), oklab(62.8% 0.2249 0.1258),
//    oklch(62.8% 0.2577 29.23)).
//  - OKLab of XYZ unit vectors: Bjorn Ottosson, "A perceptual color space for
//    image processing", test values.
//  - D50 white point: ICC / CSS (0.3457, 0.3585).
const { describe, test, expect } = require("bun:test");
require("../scripts/ensure-build");
const {
  COLOR_SPACES,
  createColor,
  parseColor,
  convert,
  srgbToLinear,
  linearToSrgb,
  isInGamut,
  clampToGamut,
  composite,
  LINEAR_SRGB_TO_XYZ_D65,
  XYZ_D65_TO_LINEAR_SRGB,
  LINEAR_P3_TO_XYZ_D65,
  XYZ_D65_TO_LINEAR_P3,
} = require("../dist/cjs/color/index.js");

const P = (css) => {
  const r = parseColor(css);
  if (!r.ok) throw new Error(`${css}: ${r.error.message}`);
  return r.color;
};
const close = (actual, expected, digits = 4) =>
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], digits));

// Deterministic PRNG so failures reproduce.
function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

describe("transfer functions", () => {
  test("known points", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 15);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.21404114048223255, 14);
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 15);
    expect(linearToSrgb(0.5)).toBeCloseTo(0.7353569830524495, 14);
    expect(linearToSrgb(0.0031308)).toBeCloseTo(12.92 * 0.0031308, 12);
  });

  test("inverse pair, including the linear segment and out-of-range values", () => {
    for (const v of [-2, -0.5, -0.01, 0, 0.001, 0.03, 0.04045, 0.05, 0.3, 0.5, 0.9, 1, 1.5, 3]) {
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 12);
    }
  });

  test("odd extension for negatives", () => {
    expect(srgbToLinear(-0.5)).toBeCloseTo(-srgbToLinear(0.5), 15);
    expect(linearToSrgb(-0.5)).toBeCloseTo(-linearToSrgb(0.5), 15);
  });
});

describe("matrices", () => {
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const product = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));

  test.each([
    ["sRGB", LINEAR_SRGB_TO_XYZ_D65, XYZ_D65_TO_LINEAR_SRGB],
    ["Display P3", LINEAR_P3_TO_XYZ_D65, XYZ_D65_TO_LINEAR_P3],
  ])("%s matrices are inverses", (_, forward, back) => {
    const p = product(forward, back);
    p.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(identity[i][j], 12)));
  });

  // Independent derivation: build RGB -> XYZ from primaries' xy chromaticities
  // and the D65 white point (the standard construction), then compare.
  function derive(primaries, white) {
    const col = ([x, y]) => [x / y, 1, (1 - x - y) / y];
    const [r, g, b] = primaries.map(col);
    const w = col(white);
    const m = [[r[0], g[0], b[0]], [r[1], g[1], b[1]], [r[2], g[2], b[2]]];
    const det = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
    const d = det(m);
    // Cramer's rule for scale factors S such that m * S = w
    const col3 = (k) => m.map((row, i) => row.map((v, j) => (j === k ? w[i] : v)));
    const S = [0, 1, 2].map((k) => det(col3(k)) / d);
    return m.map((row) => row.map((v, j) => v * S[j]));
  }
  const D65 = [0.3127, 0.329];

  test.each([
    ["sRGB", [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]], LINEAR_SRGB_TO_XYZ_D65],
    ["Display P3", [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]], LINEAR_P3_TO_XYZ_D65],
  ])("%s matrix matches the one derived from primaries and white point", (_, primaries, actual) => {
    const expected = derive(primaries, D65);
    expected.forEach((row, i) => row.forEach((v, j) => expect(Math.abs(actual[i][j] - v)).toBeLessThan(1e-4)));
  });

  const xy = (css) => {
    const [X, Y, Z] = convert(P(css), "xyz-d65").coords;
    return [X / (X + Y + Z), Y / (X + Y + Z)];
  };

  test("sRGB primaries and white point have the standard chromaticities", () => {
    close(xy("color(srgb 1 0 0)"), [0.64, 0.33], 4);
    close(xy("color(srgb 0 1 0)"), [0.3, 0.6], 4);
    close(xy("color(srgb 0 0 1)"), [0.15, 0.06], 4);
    close(xy("color(srgb 1 1 1)"), [0.3127, 0.329], 4);
  });

  test("Display P3 primaries and white point have the standard chromaticities", () => {
    close(xy("color(display-p3 1 0 0)"), [0.68, 0.32], 4);
    close(xy("color(display-p3 0 1 0)"), [0.265, 0.69], 4);
    close(xy("color(display-p3 0 0 1)"), [0.15, 0.06], 4);
    close(xy("color(display-p3 1 1 1)"), [0.3127, 0.329], 4);
  });
});

describe("reference conversions", () => {
  test("sRGB red", () => {
    const red = P("red");
    close(convert(red, "srgb-linear").coords, [1, 0, 0], 12);
    close(convert(red, "xyz-d65").coords, [0.412391, 0.212639, 0.019331], 5);
    close(convert(red, "lab").coords, [54.2905, 80.8049, 69.891], 3);
    close(convert(red, "lch").coords, [54.2905, 106.837, 40.858], 2);
    close(convert(red, "oklab").coords, [0.62796, 0.22486, 0.12585], 4);
    close(convert(red, "oklch").coords, [0.62796, 0.25768, 29.2339], 3);
    close(convert(red, "hsl").coords, [0, 100, 50], 9);
    close(convert(red, "hwb").coords, [0, 0, 0], 9);
  });

  test("white and black", () => {
    const white = P("white");
    close(convert(white, "lab").coords, [100, 0, 0], 6);
    close(convert(white, "oklab").coords, [1, 0, 0], 6);
    close(convert(white, "xyz-d65").coords, [0.95045593, 1, 1.0890577], 6);
    close(convert(white, "xyz-d50").coords, [0.96429567, 1, 0.82510460], 6);
    close(convert(white, "display-p3").coords, [1, 1, 1], 9);
    close(convert(white, "hsl").coords, [0, 0, 100], 9);
    close(convert(white, "hwb").coords, [0, 100, 0], 9);
    const black = P("black");
    close(convert(black, "lab").coords, [0, 0, 0], 9);
    close(convert(black, "oklab").coords, [0, 0, 0], 9);
    close(convert(black, "xyz-d65").coords, [0, 0, 0], 12);
    close(convert(black, "hwb").coords, [0, 0, 100], 9);
  });

  test("primary and secondary colors map to the expected HSL/HWB hues", () => {
    for (const [css, hue] of [["red", 0], ["yellow", 60], ["lime", 120], ["cyan", 180], ["blue", 240], ["magenta", 300]]) {
      expect(convert(P(css), "hsl").coords[0]).toBeCloseTo(hue, 9);
      expect(convert(P(css), "hwb").coords[0]).toBeCloseTo(hue, 9);
    }
  });

  test("OKLab of XYZ unit vectors (Ottosson)", () => {
    const xyz = (v) => createColor("xyz-d65", v);
    close(convert(xyz([0.95, 1, 1.089]), "oklab").coords, [1, 0, 0], 3);
    close(convert(xyz([1, 0, 0]), "oklab").coords, [0.45, 1.236, -0.019], 3);
    close(convert(xyz([0, 1, 0]), "oklab").coords, [0.922, -0.671, 0.263], 3);
    close(convert(xyz([0, 0, 1]), "oklab").coords, [0.153, -1.415, -0.449], 3);
  });

  test("HSL and HWB to sRGB", () => {
    close(convert(P("hsl(120 100% 25%)"), "srgb").coords, [0, 0.5, 0], 12);
    close(convert(P("hsl(210 50% 40%)"), "srgb").coords, [0.2, 0.4, 0.6], 12);
    close(convert(P("hwb(0 0% 0%)"), "srgb").coords, [1, 0, 0], 12);
    close(convert(P("hwb(120 20% 30%)"), "srgb").coords, [0.2, 0.7, 0.2], 12);
    // whiteness + blackness >= 100% is a gray of w / (w + b)
    close(convert(P("hwb(0 60% 60%)"), "srgb").coords, [0.5, 0.5, 0.5], 12);
    close(convert(P("hwb(200 100% 100%)"), "srgb").coords, [0.5, 0.5, 0.5], 12);
  });

  test("Display P3 reference points", () => {
    close(convert(P("color(display-p3 1 0 0)"), "xyz-d65").coords, [0.486571, 0.228975, 0], 5);
    // P3 red is outside sRGB: negative green/blue, red above 1.
    const srgb = convert(P("color(display-p3 1 0 0)"), "srgb").coords;
    expect(srgb[0]).toBeGreaterThan(1);
    expect(srgb[1]).toBeLessThan(0);
    expect(srgb[2]).toBeLessThan(0);
    // sRGB sits inside P3
    close(convert(P("color(display-p3 0.5 0.5 0.5)"), "srgb").coords, [0.5, 0.5, 0.5], 9);
  });

  test("achromatic colors have no chroma in lab/oklab and zero hue", () => {
    for (const gray of ["#808080", "#111", "#eee"]) {
      const lch = convert(P(gray), "lch").coords;
      const oklch = convert(P(gray), "oklch").coords;
      expect(lch[1]).toBeLessThan(1e-4);
      expect(oklch[1]).toBeLessThan(1e-7);
    }
    expect(convert(P("white"), "lch").coords[2]).toBe(0);
    expect(convert(P("#808080"), "hsl").coords.slice(0, 2)).toEqual([0, 0]);
  });
});

describe("identity, alpha and immutability", () => {
  test("same-space conversion returns the same color", () => {
    const c = P("lab(50 20 30 / 0.4)");
    expect(convert(c, "lab")).toBe(c);
  });

  test("alpha is carried through every conversion", () => {
    const c = P("rgb(10 20 30 / 0.3)");
    for (const space of COLOR_SPACES) expect(convert(c, space).alpha).toBeCloseTo(0.3, 12);
  });

  test("results are frozen valid colors", () => {
    expect(Object.isFrozen(convert(P("red"), "oklch"))).toBe(true);
  });
});

describe("round trips (documented tolerances)", () => {
  const tolerance = {
    "srgb-linear": 1e-12,
    "display-p3": 1e-9,
    "xyz-d65": 1e-9,
    "xyz-d50": 1e-9,
    hsl: 1e-7,
    hwb: 1e-7,
    lab: 1e-7,
    lch: 1e-7,
    oklab: 1e-9,
    oklch: 1e-9,
  };

  function randomSrgb(next) {
    return createColor("srgb", [next(), next(), next()], 0.1 + 0.9 * next());
  }

  for (const [space, tol] of Object.entries(tolerance)) {
    test(`srgb -> ${space} -> srgb within ${tol}`, () => {
      const next = rng(1234);
      for (let i = 0; i < 3000; i++) {
        const start = randomSrgb(next);
        const back = convert(convert(start, space), "srgb");
        start.coords.forEach((v, k) => expect(Math.abs(back.coords[k] - v)).toBeLessThan(tol));
        expect(back.alpha).toBeCloseTo(start.alpha, 12);
      }
    });
  }

  test("edge colors round-trip through every space", () => {
    const edges = [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0.5], [0.0031308, 0.0031308, 0.0031308], [1e-9, 0, 1]];
    for (const rgb of edges) {
      const start = createColor("srgb", rgb);
      for (const space of COLOR_SPACES) {
        const back = convert(convert(start, space), "srgb");
        start.coords.forEach((v, k) => expect(Math.abs(back.coords[k] - v)).toBeLessThan(1e-7));
      }
    }
  });

  test("any space to any space via srgb agrees with the direct conversion", () => {
    const next = rng(99);
    for (let i = 0; i < 300; i++) {
      const start = convert(randomSrgb(next), COLOR_SPACES[Math.floor(next() * COLOR_SPACES.length)]);
      const target = COLOR_SPACES[Math.floor(next() * COLOR_SPACES.length)];
      const direct = convert(start, target);
      const viaSrgb = convert(convert(start, "srgb"), target);
      // hue-bearing targets can differ by a full turn at the wrap point
      direct.coords.forEach((v, k) => {
        const delta = Math.abs(v - viaSrgb.coords[k]);
        expect(Math.min(delta, Math.abs(delta - 360))).toBeLessThan(1e-5);
      });
    }
  });

  test("wide-gamut colors survive a round trip unclamped", () => {
    const p3 = createColor("display-p3", [1, 0, 0.2]);
    const back = convert(convert(p3, "oklch"), "display-p3");
    close(back.coords, p3.coords, 9);
    const outside = createColor("srgb", [1.3, -0.2, 0.5]);
    close(convert(convert(outside, "oklab"), "srgb").coords, outside.coords, 9);
  });
});

describe("gamut", () => {
  test("membership", () => {
    expect(isInGamut(P("red"))).toBe(true);
    expect(isInGamut(P("color(display-p3 1 0 0)"), "srgb")).toBe(false);
    expect(isInGamut(P("color(display-p3 1 0 0)"), "display-p3")).toBe(true);
    expect(isInGamut(P("color(display-p3 0.5 0.5 0.5)"), "srgb")).toBe(true);
    expect(isInGamut(P("oklch(0.7 0.4 150)"), "srgb")).toBe(false);
    expect(isInGamut(P("lab(50 0 0)"), "srgb")).toBe(true);
  });

  test("tolerates floating-point noise but not real excursions", () => {
    expect(isInGamut(createColor("srgb", [1 + 1e-9, -1e-9, 0.5]))).toBe(true);
    expect(isInGamut(createColor("srgb", [1.001, 0, 0]))).toBe(false);
    expect(isInGamut(createColor("srgb", [1.001, 0, 0]), "srgb", 0.01)).toBe(true);
  });

  test("conversion does not silently clamp", () => {
    const out = convert(P("color(display-p3 1 0 0)"), "srgb");
    expect(out.coords[0]).toBeGreaterThan(1);
    expect(out.coords[1]).toBeLessThan(0);
  });

  test("clampToGamut is explicit, per channel, and keeps alpha", () => {
    const clamped = clampToGamut(P("color(display-p3 1 0 0 / 0.5)"), "srgb");
    expect(clamped.space).toBe("srgb");
    expect(clamped.coords).toEqual([1, 0, 0]);
    expect(clamped.alpha).toBe(0.5);
    // in-gamut colors are unchanged (up to conversion noise)
    close(clampToGamut(P("#336699"), "srgb").coords, convert(P("#336699"), "srgb").coords, 12);
  });
});

describe("alpha compositing", () => {
  const white = P("white");
  const black = P("black");

  test("opaque foreground wins; transparent foreground disappears", () => {
    close(composite(P("#336699"), white).coords, P("#336699").coords, 12);
    expect(composite(P("#336699"), white).alpha).toBe(1);
    close(composite(P("rgb(10 20 30 / 0)"), P("#ff8000")).coords, P("#ff8000").coords, 12);
  });

  test("50% black over white blends encoded channels by default (browser behavior)", () => {
    const out = composite(P("rgb(0 0 0 / 0.5)"), white);
    close(out.coords, [0.5, 0.5, 0.5], 12);
    expect(out.alpha).toBe(1);
    expect(out.space).toBe("srgb");
  });

  test("linear-light blending is available explicitly", () => {
    const out = composite(P("rgb(0 0 0 / 0.5)"), white, { space: "srgb-linear" });
    close(out.coords, [linearToSrgb(0.5), linearToSrgb(0.5), linearToSrgb(0.5)], 12);
    expect(out.coords[0]).toBeGreaterThan(0.5);
  });

  test("README example: 75% black over #fafafa", () => {
    const out = composite(P("rgba(0,0,0,.75)"), P("#fafafa"));
    const expected = (250 / 255) * 0.25;
    close(out.coords, [expected, expected, expected], 12);
  });

  test("semi-transparent background composes alpha as 1 - (1 - a)(1 - b)", () => {
    const out = composite(P("rgb(255 0 0 / 0.5)"), P("rgb(0 0 255 / 0.5)"));
    expect(out.alpha).toBeCloseTo(0.75, 12);
    // premultiplied: (1*0.5 + 0*0.5*0.5) / 0.75 for red, blue gets 0.25/0.75
    close(out.coords, [2 / 3, 0, 1 / 3], 12);
  });

  test("fully transparent over fully transparent is transparent black", () => {
    const out = composite(P("transparent"), P("rgb(1 2 3 / 0)"));
    expect(out.alpha).toBe(0);
    expect(out.coords).toEqual([0, 0, 0]);
  });

  test("nested compositing is associative (same blending space)", () => {
    const a = P("rgb(200 30 60 / 0.4)");
    const b = P("rgb(20 220 90 / 0.5)");
    const c = P("rgb(10 40 250 / 0.7)");
    for (const space of ["srgb", "srgb-linear"]) {
      const left = composite(composite(a, b, { space }), c, { space });
      const right = composite(a, composite(b, c, { space }), { space });
      close(left.coords, right.coords, 10);
      expect(left.alpha).toBeCloseTo(right.alpha, 12);
    }
  });

  test("works across color spaces and keeps wide-gamut channels unclamped", () => {
    const fg = P("oklch(0.6 0.15 30 / 0.5)");
    const out = composite(fg, black);
    expect(out.space).toBe("srgb");
    expect(out.alpha).toBe(1);
    const p3 = composite(P("color(display-p3 1 0 0 / 0.9)"), white);
    expect(Number.isFinite(p3.coords[0])).toBe(true);
  });

  test("black on white is the contrast extreme", () => {
    close(composite(black, white).coords, [0, 0, 0], 12);
    close(composite(white, black).coords, [1, 1, 1], 12);
  });
});
