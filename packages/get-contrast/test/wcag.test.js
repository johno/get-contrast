// Modern WCAG 2.2 API: wcag() and check().
const { describe, test, expect } = require("bun:test");
require("../scripts/ensure-build");
const api = require("..");
const { check, wcag, thresholdFor, WCAG_THRESHOLDS, ColorInputError, parseColor } = api;
const { relativeLuminance, contrastFromLuminance } = require("../dist/cjs/wcag.js");

describe("published reference ratios", () => {
  // Values every WCAG checker agrees on (WebAIM, WCAG techniques examples).
  test.each([
    ["#000000", "#ffffff", 21, "21.00:1"],
    ["#ffffff", "#ffffff", 1, "1.00:1"],
    ["#767676", "#ffffff", 4.5422, "4.54:1"],
    ["#777777", "#ffffff", 4.4781, "4.47:1"],
    ["#595959", "#ffffff", 7.0047, "7.00:1"],
    ["#ff0000", "#ffffff", 3.9985, "3.99:1"],
    ["#0000ff", "#ffffff", 8.5925, "8.59:1"],
    ["#ffff00", "#ffffff", 1.0738, "1.07:1"],
    ["#00ff00", "#000000", 15.304, "15.30:1"],
    ["#808080", "#ffffff", 3.9494, "3.94:1"],
  ])("%s on %s is %s", (fg, bg, ratio, text) => {
    const result = check(fg, bg);
    expect(result.ratio).toBeCloseTo(ratio, 3);
    expect(result.ratioText).toBe(text);
  });

  test("black on white is exactly 21 and symmetric", () => {
    expect(wcag("#000", "#fff").ratio).toBe(21);
    expect(wcag("#fff", "#000").ratio).toBe(21);
    expect(wcag("#123456", "#abcdef").ratio).toBe(wcag("#abcdef", "#123456").ratio);
  });

  test("relative luminance of black, white and the sRGB primaries (WCAG weights)", () => {
    const lum = (css) => relativeLuminance(parseColor(css).color);
    expect(lum("#000")).toBe(0);
    expect(lum("#fff")).toBeCloseTo(1, 12);
    expect(lum("#f00")).toBeCloseTo(0.2126, 12);
    expect(lum("#0f0")).toBeCloseTo(0.7152, 12);
    expect(lum("#00f")).toBeCloseTo(0.0722, 12);
  });
});

describe("agreement with the legacy implementation (independent code path)", () => {
  // WCAG 2.2 changed the sRGB threshold from 0.03928 to 0.04045, which makes no
  // difference for any 8-bit channel value, so for opaque 8-bit colors the
  // modern ratio must equal the v3 ratio.
  test("opaque 8-bit colors: modern == legacy", () => {
    let s = 42;
    const next = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const hex = () => "#" + [0, 0, 0].map(() => Math.floor(next() * 256).toString(16).padStart(2, "0")).join("");
    for (let i = 0; i < 3000; i++) {
      const a = hex();
      const b = hex();
      expect(Math.abs(wcag(a, b).ratio - api.ratio(a, b))).toBeLessThan(1e-12);
    }
  });

  test("channel values around the old and new thresholds agree", () => {
    for (let v = 0; v < 256; v++) {
      const gray = "#" + v.toString(16).padStart(2, "0").repeat(3);
      expect(Math.abs(wcag(gray, "#fff").ratio - api.ratio(gray, "#fff"))).toBeLessThan(1e-12);
    }
  });

  test("the modern API differs from legacy where the legacy API is wrong: alpha", () => {
    // legacy ignores alpha entirely; modern composites.
    expect(api.ratio("rgba(0,0,0,.5)", "#fff")).toBe(21);
    // 50% black over white blends to 50% gray (unrounded): luminance 0.2140
    expect(wcag("rgba(0,0,0,.5)", "#fff").ratio).toBeCloseTo(1.05 / (0.2140411405 + 0.05), 6);
  });
});

describe("thresholds", () => {
  test("WCAG 2.2 values", () => {
    expect(WCAG_THRESHOLDS).toEqual({
      AA: { text: 4.5, "large-text": 3, ui: 3 },
      AAA: { text: 7, "large-text": 4.5, ui: 3 },
    });
    expect(thresholdFor("AA", "text")).toBe(4.5);
    expect(thresholdFor("AAA", "large-text")).toBe(4.5);
    expect(() => thresholdFor("A", "text")).toThrow(RangeError);
    expect(() => thresholdFor("AA", "poster")).toThrow(RangeError);
  });

  test("check() reports every level and use at once", () => {
    const grid = [
      ["#ffffff", "#ffffff", false, false, false, false, false],
      ["#949494", "#ffffff", false, true, false, false, true], // 3.03
      ["#767676", "#ffffff", true, true, false, true, true], // 4.54
      ["#595959", "#ffffff", true, true, true, true, true], // 7.00
    ];
    for (const [fg, bg, aaText, aaLarge, aaaText, aaaLarge, ui] of grid) {
      const { results } = check(fg, bg);
      expect(results).toEqual({
        aa: { text: aaText, largeText: aaLarge },
        aaa: { text: aaaText, largeText: aaaLarge },
        ui,
      });
    }
  });

  test("adjacent grays straddle AA text (4.5:1)", () => {
    expect(check("#767676", "#fff").results.aa.text).toBe(true);
    expect(check("#777777", "#fff").results.aa.text).toBe(false);
  });

  test("contrastFromLuminance is exact at the extremes and never rounds up", () => {
    expect(contrastFromLuminance(1, 0)).toBe(21);
    expect(contrastFromLuminance(0.3, 0.3)).toBe(1);
    expect(contrastFromLuminance(0, 1)).toBe(21);
  });

  test("target defaults to AA text and follows level/use", () => {
    const base = check("#767676", "#fff");
    expect(base.target).toEqual({ level: "AA", use: "text", threshold: 4.5, custom: false, passes: true });
    const aaa = check("#767676", "#fff", { level: "AAA" });
    expect(aaa.target).toEqual({ level: "AAA", use: "text", threshold: 7, custom: false, passes: false });
    const large = check("#949494", "#fff", { use: "large-text" });
    expect(large.target.threshold).toBe(3);
    expect(large.target.passes).toBe(true);
    const ui = check("#949494", "#fff", { use: "ui", level: "AAA" });
    expect(ui.target.threshold).toBe(3);
    expect(ui.target.passes).toBe(true);
  });

  test("custom minRatio replaces the threshold, inclusively", () => {
    expect(check("#000", "#fff", { minRatio: 21 }).target).toMatchObject({ threshold: 21, custom: true, passes: true });
    expect(check("#767676", "#fff", { minRatio: 5 }).target.passes).toBe(false);
    expect(check("#767676", "#fff", { minRatio: 4.54 }).target.passes).toBe(true);
    expect(() => check("#000", "#fff", { minRatio: 0.5 })).toThrow(RangeError);
    expect(() => check("#000", "#fff", { minRatio: 22 })).toThrow(RangeError);
    expect(() => check("#000", "#fff", { minRatio: NaN })).toThrow(RangeError);
    expect(() => check("#000", "#fff", { level: "AAAA" })).toThrow(RangeError);
  });

  test("the ratio text never rounds a failure up to a pass", () => {
    const r = check("#777777", "#fff"); // 4.478
    expect(r.ratioText).toBe("4.47:1");
    expect(r.results.aa.text).toBe(false);
  });
});

describe("alpha and compositing", () => {
  test("opaque colors produce no notes", () => {
    expect(check("#000", "#fff").notes).toEqual([]);
  });

  test("translucent foreground is composited over the background", () => {
    const r = check("rgba(0, 0, 0, 0.5)", "#ffffff");
    expect(r.foreground.hex).toBe("#808080");
    expect(r.foreground.original.alpha).toBe(0.5);
    expect(r.foreground.color.alpha).toBe(1);
    expect(r.ratio).toBeCloseTo(3.9767, 3); // measured unrounded; the hex is display only
    expect(r.notes.map((n) => n.code)).toEqual(["foreground-alpha"]);
    expect(r.notes[0].message).toContain("#808080");
  });

  test("README example: 75% black text on #fafafa", () => {
    const r = check("rgba(0,0,0,.75)", "#fafafa");
    expect(r.foreground.hex).toBe("#3f3f3f"); // 62.5 rounds to 63 for display
    expect(r.results.aa.text).toBe(true);
    expect(r.ratio).toBeGreaterThan(9);
    expect(r.ratio).toBeLessThan(11); // the legacy API reported ~20 here
  });

  test("a translucent background is composited over white by default, with a note", () => {
    const r = check("#000", "rgb(0 0 0 / 0.5)");
    expect(r.background.hex).toBe("#808080");
    expect(r.notes.map((n) => n.code)).toEqual(["backdrop-assumed", "background-alpha"]);
  });

  test("an explicit backdrop replaces the white assumption", () => {
    const r = check("#fff", "rgb(0 0 0 / 0.5)", { backdrop: "#000" });
    expect(r.background.hex).toBe("#000000");
    expect(r.ratio).toBe(21);
    expect(r.notes.map((n) => n.code)).toEqual(["background-alpha"]);
  });

  test("background and foreground alpha stack", () => {
    const r = check("rgb(255 255 255 / 0.5)", "rgb(0 0 0 / 0.5)", { backdrop: "#ffffff" });
    expect(r.background.hex).toBe("#808080");
    expect(r.foreground.hex).toBe("#bfbfbf"); // 0.75 * 255 = 191.25
    expect(r.notes.map((n) => n.code)).toEqual(["background-alpha", "foreground-alpha"]);
  });

  test("fully transparent foreground measures as the background", () => {
    const r = check("transparent", "#336699");
    expect(r.ratio).toBeCloseTo(1, 12);
    expect(r.foreground.hex).toBe("#336699");
  });

  test("backdrop must be opaque", () => {
    expect(() => check("#000", "#fff", { backdrop: "rgb(0 0 0 / 0.5)" })).toThrow(ColorInputError);
  });
});

describe("modern syntax and gamut", () => {
  test("accepts every modern syntax", () => {
    for (const css of ["rgb(0 0 0)", "hsl(0 0% 0%)", "hwb(0 0% 100%)", "lab(0 0 0)", "lch(0 0 0)", "oklab(0 0 0)", "oklch(0 0 0)", "color(display-p3 0 0 0)", "black"]) {
      expect(check(css, "#fff").ratio).toBeCloseTo(21, 9);
    }
  });

  test("accepts parsed Color objects", () => {
    const fg = parseColor("oklch(0.5 0.1 200)").color;
    expect(check(fg, "#fff").ratio).toBe(check("oklch(0.5 0.1 200)", "#fff").ratio);
  });

  test("wide-gamut colors are measured without clipping and flagged", () => {
    const r = check("color(display-p3 1 0 0)", "#ffffff");
    expect(r.notes.map((n) => n.code)).toEqual(["foreground-out-of-gamut"]);
    // P3 red is brighter than sRGB red: lower contrast with white
    expect(r.ratio).toBeLessThan(check("#ff0000", "#fff").ratio);
    expect(r.foreground.original.space).toBe("display-p3");
    expect(r.foreground.color.space).toBe("srgb");
  });

  test("in-gamut P3 colors carry no gamut note", () => {
    expect(check("color(display-p3 0.5 0.5 0.5)", "#fff").notes).toEqual([]);
  });

  test("results do not mutate their inputs", () => {
    const fg = parseColor("rgb(10 20 30 / 0.5)").color;
    const before = JSON.stringify(fg);
    check(fg, "#fff");
    expect(JSON.stringify(fg)).toBe(before);
  });
});

describe("errors", () => {
  test("unparseable colors throw ColorInputError naming the argument", () => {
    for (const [args, role, code] of [
      [["nope", "#fff"], "foreground", "invalid-syntax"],
      [["#000", "rgb(1 2)"], "background", "invalid-component"],
      [["#000", ""], "background", "empty"],
      [["rgb(from red r g b)", "#fff"], "foreground", "unsupported-function"],
      [[undefined, "#fff"], "foreground", "not-a-string"],
      [["#000", 42], "background", "not-a-string"],
      [[{}, "#fff"], "foreground", "not-a-string"],
    ]) {
      let error;
      try {
        check(...args);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ColorInputError);
      expect(error).toBeInstanceOf(TypeError);
      expect(error.role).toBe(role);
      expect(error.code).toBe(code);
      expect(error.message).toContain(role);
      expect(error.name).toBe("ColorInputError");
    }
  });

  test("a bad backdrop is reported as the backdrop", () => {
    try {
      check("#000", "#fff", { backdrop: "nope" });
      throw new Error("expected throw");
    } catch (e) {
      expect(e.role).toBe("backdrop");
    }
  });
});

describe("package surface", () => {
  test("modern API is additive: the v3 functions keep working", () => {
    expect(api.score("#fafafa", "rgba(0,0,0,.75)")).toBe("AAA");
    expect(typeof check).toBe("function");
    expect(typeof wcag).toBe("function");
  });
});
