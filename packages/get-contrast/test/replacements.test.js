// Direct tests for the local replacements of css-color-names, is-named-css-color,
// rgb, wcag-contrast/relative-luminance and is-blank. Behavior parity with the
// removed packages is pinned by compat/ (golden fixtures).
const { describe, test, expect } = require("bun:test");
require("../scripts/ensure-build");
const { NAMED_COLORS } = require("../dist/cjs/named-colors");
const {
  parseLegacyColor,
  isLegacyNamedColor,
  lookupNamedColor,
} = require("../dist/cjs/legacy-parse");
const { contrastRatio, scoreForRatio } = require("../dist/cjs/legacy-wcag");

describe("named colors", () => {
  test("has the 148 CSS named colors with lowercase keys and #rrggbb values", () => {
    const entries = Object.entries(NAMED_COLORS);
    expect(entries).toHaveLength(148);
    for (const [name, hex] of entries) {
      expect(name).toMatch(/^[a-z]+$/);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("transparent is not a named color", () => {
    expect("transparent" in NAMED_COLORS).toBe(false);
  });

  test("gray/grey aliases share values", () => {
    for (const base of [
      "gray",
      "darkgray",
      "dimgray",
      "lightgray",
      "slategray",
      "darkslategray",
      "lightslategray",
    ]) {
      const grey = base.replace("gray", "grey");
      if (base in NAMED_COLORS) {
        expect(NAMED_COLORS[grey]).toBe(NAMED_COLORS[base]);
      }
    }
    expect(NAMED_COLORS.gray).toBe("#808080");
    expect(NAMED_COLORS.grey).toBe("#808080");
    expect(NAMED_COLORS.darkslategrey).toBe(NAMED_COLORS.darkslategray);
  });

  test("known values", () => {
    expect(NAMED_COLORS.rebeccapurple).toBe("#663399");
    expect(NAMED_COLORS.tomato).toBe("#ff6347");
    expect(NAMED_COLORS.aqua).toBe(NAMED_COLORS.cyan);
    expect(NAMED_COLORS.fuchsia).toBe(NAMED_COLORS.magenta);
  });

  test("lookup is exact and own-property only", () => {
    expect(lookupNamedColor("tomato")).toBe("#ff6347");
    expect(lookupNamedColor("Tomato")).toBeUndefined();
    expect(lookupNamedColor("constructor")).toBeUndefined();
    expect(lookupNamedColor("__proto__")).toBeUndefined();
  });
});

describe("legacy named-color detection (is-named-css-color parity)", () => {
  test("every named color is detected", () => {
    for (const name of Object.keys(NAMED_COLORS)) {
      expect(isLegacyNamedColor(name)).toBe(true);
    }
  });

  test("detection is loose: first name anchored at start, last at end, others anywhere", () => {
    expect(isLegacyNamedColor("aquax")).toBe(true); // starts with first name
    expect(isLegacyNamedColor("xaqua")).toBe(false); // first name is not unanchored
    // The last name (rebeccapurple) is anchored to the end, but it contains
    // "purple", so it is indistinguishable from the unanchored names here.
    expect(isLegacyNamedColor(" red")).toBe(true);
    expect(isLegacyNamedColor("my-red-thing")).toBe(true);
  });

  test("non-names and color functions are not detected", () => {
    for (const s of ["", "foo", "#fff", "rgb(0,0,0)", "hsl(0,0%,0%)", "transparent", "inherit"]) {
      expect(isLegacyNamedColor(s)).toBe(false);
    }
  });
});

describe("legacy color parser (rgb parity)", () => {
  test.each([
    ["#fff", "rgb(255,255,255)"],
    ["#ffff", "rgb(255,255,255)"],
    ["#ffffff", "rgb(255,255,255)"],
    ["#ffffff80", "rgba(255,255,255,0.5019607843137255)"],
    ["#fff0", "rgba(255,255,255,0)"],
    ["rgb(1,2,3)", "rgb(1,2,3)"],
    ["rgba(1,2,3,.5)", "rgba(1,2,3,.5)".replace(".5", "0.5")],
    ["rgb(10%,20%,30%)", "rgb(10,20,30)"],
    ["rgb(1.5,2.5,3.5)", "rgb(2,3,4)"],
    ["hsl(0,100%,50%)", "rgb(255,0,0)"],
    ["hsla(120,100%,25%,.5)", "rgba(0,128,0,0.5)"],
    ["transparent", "rgba(0,0,0,0)"],
    ["red", "rgb(255,0,0)"],
    ["orange", "rgb(255,165,0)"],
  ])("%s -> %s", (input, expected) => {
    expect(parseLegacyColor(input)).toBe(expected);
  });

  test.each([
    ["#12345", "rgb(18,52,5)"],
    ["#fffffff", "rgba(255,255,255,0.058823529411764705)"],
    ["xx#fffxx", "rgb(255,255,255)"],
    ["foo rgb(1,2,3) bar", "rgb(1,2,3)"],
    ["argb(1,2,3)", "rgb(1,2,3)"],
    ["rgb(1,2,3,1)", "rgb(1,2,3)"],
    ["  #fff ", "rgb(255,255,255)"],
  ])("quirk: %s -> %s", (input, expected) => {
    expect(parseLegacyColor(input)).toBe(expected);
  });

  test("rejects out-of-range and malformed input with null", () => {
    for (const s of [
      "",
      "foo",
      "#ff",
      "#ggg",
      "rgb(256,0,0)",
      "rgb(1,2,3,2)",
      "rgb(1 2 3)",
      "rgb(1,2,3",
      "hsl(361,100%,50%)",
      "hsl(0,101%,50%)",
      "constructor",
      "__proto__",
    ]) {
      expect(parseLegacyColor(s)).toBeNull();
    }
    expect(parseLegacyColor(null)).toBeNull();
    expect(parseLegacyColor(undefined)).toBeNull();
  });

  test("coerces non-strings with + '' like v3 (arrays parse as their string form)", () => {
    expect(parseLegacyColor(["#fff"])).toBe("rgb(255,255,255)");
    expect(parseLegacyColor(new String("#000"))).toBe("rgb(0,0,0)");
    expect(parseLegacyColor(1)).toBeNull();
    expect(parseLegacyColor({})).toBeNull();
  });

  test("only the first whitespace run is stripped", () => {
    expect(parseLegacyColor("rgb(1, 2, 3)")).toBe("rgb(1,2,3)");
    expect(parseLegacyColor("# f f f")).toBeNull();
  });
});

describe("legacy WCAG math (wcag-contrast parity)", () => {
  test("extremes and symmetry", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBe(21);
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBe(21);
    expect(contrastRatio([10, 20, 30], [10, 20, 30])).toBe(1);
  });

  test("accepts numeric strings as the legacy parser produces them", () => {
    expect(contrastRatio(["0", "0", "0"], ["255", "255", "255"])).toBe(21);
  });

  test("known reference values", () => {
    // #767676 on white is the classic smallest gray passing AA (4.54:1).
    expect(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.542, 3);
    expect(contrastRatio([0xff, 0, 0], [255, 255, 255])).toBeCloseTo(3.998, 3);
  });

  test("keeps the WCAG 2.0 0.03928 linearization threshold", () => {
    // 10/255 = 0.03922 (<= 0.03928: linear segment); 11/255 = 0.04314 (power).
    const lin = (v) => v / 255 / 12.92;
    const l10 = lin(10);
    expect(contrastRatio([10, 10, 10], [0, 0, 0])).toBe((l10 + 0.05) / 0.05);
    const l11 = Math.pow((11 / 255 + 0.055) / 1.055, 2.4);
    expect(contrastRatio([11, 11, 11], [0, 0, 0])).toBe((l11 + 0.05) / 0.05);
  });

  test("score boundaries are inclusive at 7, 4.5 and 3", () => {
    expect(scoreForRatio(21)).toBe("AAA");
    expect(scoreForRatio(7)).toBe("AAA");
    expect(scoreForRatio(6.999)).toBe("AA");
    expect(scoreForRatio(4.5)).toBe("AA");
    expect(scoreForRatio(4.499)).toBe("AA Large");
    expect(scoreForRatio(3)).toBe("AA Large");
    expect(scoreForRatio(2.999)).toBe("Fail");
    expect(scoreForRatio(1)).toBe("Fail");
  });
});
