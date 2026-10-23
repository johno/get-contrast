// Modern CSS color parser tests. Conformance with browsers is checked against
// the examples in CSS Color Module Level 4 and MDN; expected values here are
// the parsed (pre-conversion) coordinates in the syntax's own space.
const { describe, test, expect } = require("bun:test");
require("../scripts/ensure-build");
const { parseColor, isColor } = require("../dist/cjs/color/index.js");
const { NAMED_COLORS: TABLE } = require("../dist/cjs/named-colors");

const parse = (input) => parseColor(input);

function expectColor(input, space, coords, alpha = 1) {
  const r = parse(input);
  if (!r.ok) throw new Error(`${JSON.stringify(input)} failed: ${r.error.code}: ${r.error.message}`);
  expect(r.color.space).toBe(space);
  coords.forEach((c, i) => expect(r.color.coords[i]).toBeCloseTo(c, 9));
  expect(r.color.alpha).toBeCloseTo(alpha, 9);
}

function expectError(input, code) {
  const r = parse(input);
  if (r.ok) throw new Error(`${JSON.stringify(input)} unexpectedly parsed as ${JSON.stringify(r.color)}`);
  expect(r.error.code).toBe(code);
}

const b = (n) => n / 255;

describe("named colors", () => {
  test("every vendored named color parses to its hex value, case-insensitively", () => {
    for (const [name, hex] of Object.entries(TABLE)) {
      const v = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
      for (const spelling of [name, name.toUpperCase(), name[0].toUpperCase() + name.slice(1)]) {
        expectColor(spelling, "srgb", [v(1), v(3), v(5)]);
      }
    }
  });

  test("spot checks", () => {
    expectColor("rebeccapurple", "srgb", [b(102), b(51), b(153)]);
    expectColor("tomato", "srgb", [b(255), b(99), b(71)]);
    expectColor("grey", "srgb", [b(128), b(128), b(128)]);
    expectColor("  Gray ", "srgb", [b(128), b(128), b(128)]);
  });

  test("transparent is black at alpha 0", () => {
    expectColor("transparent", "srgb", [0, 0, 0], 0);
    expectColor("TRANSPARENT", "srgb", [0, 0, 0], 0);
  });

  test("context keywords and unknown words are rejected", () => {
    for (const k of ["currentcolor", "currentColor", "inherit", "initial", "unset", "revert"]) {
      expectError(k, "invalid-syntax");
    }
    for (const k of ["notacolor", "reddish", "constructor", "__proto__", "toString"]) {
      expectError(k, "invalid-syntax");
    }
  });
});

describe("hex", () => {
  test.each([
    ["#fff", [1, 1, 1], 1],
    ["#FFF", [1, 1, 1], 1],
    ["#000", [0, 0, 0], 1],
    ["#f00", [1, 0, 0], 1],
    ["#abc", [b(0xaa), b(0xbb), b(0xcc)], 1],
    ["#f008", [1, 0, 0], b(0x88)],
    ["#ffffff", [1, 1, 1], 1],
    ["#663399", [b(102), b(51), b(153)], 1],
    ["#66339980", [b(102), b(51), b(153)], b(128)],
    ["#FFFFFF00", [1, 1, 1], 0],
    ["  #0f0  ", [0, 1, 0], 1],
  ])("%s", (input, rgb, alpha) => {
    expectColor(input, "srgb", rgb, alpha);
  });

  test("wrong lengths and non-hex digits are invalid", () => {
    for (const s of ["#", "#f", "#ff", "#fffff", "#fffffff", "#fffffffff", "#ggg", "#12 3", "# fff", "#ffg", "#fff;"]) {
      expectError(s, "invalid-syntax");
    }
  });
});

describe("rgb()/rgba()", () => {
  test.each([
    ["rgb(255, 0, 0)", [1, 0, 0], 1],
    ["rgb(255,0,0)", [1, 0, 0], 1],
    ["rgba(255, 0, 0, 0.5)", [1, 0, 0], 0.5],
    ["rgba(0,0,0,.25)", [0, 0, 0], 0.25],
    ["rgb(0, 0, 0, 50%)", [0, 0, 0], 0.5],
    ["rgb(100%, 0%, 50%)", [1, 0, 0.5], 1],
    ["rgb(255 0 0)", [1, 0, 0], 1],
    ["rgb(255 128 0 / 50%)", [1, b(128), 0], 0.5],
    ["rgb(255 128 0 / 0.5)", [1, b(128), 0], 0.5],
    ["rgba(255 128 0 / .5)", [1, b(128), 0], 0.5],
    ["RGB(255 0 0)", [1, 0, 0], 1],
    ["rgb(  255   0  0  /  1  )", [1, 0, 0], 1],
    ["rgb(10% 128 0)", [0.1, b(128), 0], 1],
    ["rgb(none 255 0)", [0, 1, 0], 1],
    ["rgb(0 0 0 / none)", [0, 0, 0], 0],
    ["rgb(127.5 0 0)", [127.5 / 255, 0, 0], 1],
    ["rgb(1e2 0 0)", [100 / 255, 0, 0], 1],
    ["rgb(+255 -0 0)", [1, 0, 0], 1],
  ])("%s", (input, rgb, alpha) => {
    expectColor(input, "srgb", rgb, alpha);
  });

  test("channels and alpha clamp like browsers", () => {
    expectColor("rgb(300, -20, 0)", "srgb", [1, 0, 0]);
    expectColor("rgb(150% 0% 0%)", "srgb", [1, 0, 0]);
    expectColor("rgb(0 0 0 / 2)", "srgb", [0, 0, 0], 1);
    expectColor("rgb(0 0 0 / -1)", "srgb", [0, 0, 0], 0);
    expectColor("rgba(0,0,0,150%)", "srgb", [0, 0, 0], 1);
  });

  test("legacy syntax cannot mix numbers and percentages or use none", () => {
    expectError("rgb(10%, 20, 30)", "invalid-component");
    expectError("rgb(none, 0, 0)", "invalid-component");
  });

  test("malformed", () => {
    for (const s of [
      "rgb()",
      "rgb(255)",
      "rgb(255, 0)",
      "rgb(255 0)",
      "rgb(255, 0, 0, 0, 0)",
      "rgb(255 0 0 0)",
      "rgb(255 0 0 /)",
      "rgb(255 0 0 / 1 2)",
      "rgb(255 0 0 / 1 / 2)",
      "rgb(255, 0, 0 / 1)",
      "rgb(255, 0, , 0)",
      "rgb(, 0, 0)",
      "rgb(a, b, c)",
      "rgb(1px 2px 3px)",
      "rgb(1deg 0 0)",
      "rgb(1. 0 0)",
      "rgb(.e1 0 0)",
      "rgb(1e 0 0)",
      "rgb(0x10 0 0)",
      "rgb(Infinity 0 0)",
      "rgb(1e999 0 0)",
      "rgb(255 0 0 / banana)",
      "rgb (255 0 0)",
    ]) {
      expect(parse(s).ok).toBe(false);
    }
    expectError("rgb(1e999 0 0)", "invalid-component");
  });
});

describe("hsl()/hsla()", () => {
  test.each([
    ["hsl(0, 100%, 50%)", [0, 100, 50], 1],
    ["hsl(120, 100%, 25%)", [120, 100, 25], 1],
    ["hsla(120, 100%, 25%, 0.5)", [120, 100, 25], 0.5],
    ["hsl(120deg 100% 25%)", [120, 100, 25], 1],
    ["hsl(120 100% 25% / 50%)", [120, 100, 25], 0.5],
    ["hsl(0.5turn 50% 50%)", [180, 50, 50], 1],
    ["hsl(3.141592653589793rad 50% 50%)", [180, 50, 50], 1],
    ["hsl(200grad 50% 50%)", [180, 50, 50], 1],
    ["hsl(-90 50% 50%)", [270, 50, 50], 1],
    ["hsl(450 50% 50%)", [90, 50, 50], 1],
    ["hsl(120 50 50)", [120, 50, 50], 1],
    ["hsl(none 0% 50%)", [0, 0, 50], 1],
    ["HSL(0 0% 0%)", [0, 0, 0], 1],
  ])("%s", (input, hsl, alpha) => {
    expectColor(input, "hsl", hsl, alpha);
  });

  test("saturation and lightness clamp to 0..100", () => {
    expectColor("hsl(0 150% 120%)", "hsl", [0, 100, 100]);
    expectColor("hsl(0 -50% -10%)", "hsl", [0, 0, 0]);
  });

  test("legacy syntax requires percentages", () => {
    expectError("hsl(0, 100, 50)", "invalid-component");
    expectError("hsl(none, 100%, 50%)", "invalid-component");
  });

  test("malformed", () => {
    for (const s of ["hsl()", "hsl(0 100%)", "hsl(0, 100%)", "hsl(0 100% 50% 1)", "hsl(0% 100% 50%)", "hsl(0 100% 50% / )", "hsl(0, 100%, 50%) x", "hsl(0 100px 50%)"]) {
      expect(parse(s).ok).toBe(false);
    }
  });
});

describe("hwb()", () => {
  test.each([
    ["hwb(0 0% 0%)", [0, 0, 0], 1],
    ["hwb(194 0% 0%)", [194, 0, 0], 1],
    ["hwb(194 20% 30% / 0.5)", [194, 20, 30], 0.5],
    ["hwb(0.25turn 10% 20%)", [90, 10, 20], 1],
    ["hwb(120 10 20)", [120, 10, 20], 1],
    ["hwb(none 0% 0%)", [0, 0, 0], 1],
    ["hwb(0 150% -5%)", [0, 150, 0], 1],
  ])("%s", (input, hwb, alpha) => {
    expectColor(input, "hwb", hwb, alpha);
  });

  test("no legacy comma syntax", () => {
    expectError("hwb(0, 0%, 0%)", "invalid-component");
  });
});

describe("lab()/lch()", () => {
  test.each([
    ["lab(29.2345% 39.3825 20.0664)", "lab", [29.2345, 39.3825, 20.0664], 1],
    ["lab(52.2345% 40.1645 59.9971)", "lab", [52.2345, 40.1645, 59.9971], 1],
    ["lab(50 0 0 / 50%)", "lab", [50, 0, 0], 0.5],
    ["lab(100% 100% -100%)", "lab", [100, 125, -125], 1],
    ["lab(120% 0 0)", "lab", [100, 0, 0], 1],
    ["lab(-5 0 0)", "lab", [0, 0, 0], 1],
    ["lab(none none none)", "lab", [0, 0, 0], 1],
    ["lch(29.2345% 44.2 27)", "lch", [29.2345, 44.2, 27], 1],
    ["lch(52.2345% 72.2 56.2)", "lch", [52.2345, 72.2, 56.2], 1],
    ["lch(50% 100% 0.5turn)", "lch", [50, 150, 180], 1],
    ["lch(50 -10 30)", "lch", [50, 0, 30], 1],
    ["lch(50 20 -30deg)", "lch", [50, 20, 330], 1],
    ["lch(50 20 30 / 0.2)", "lch", [50, 20, 30], 0.2],
  ])("%s", (input, space, coords, alpha) => {
    expectColor(input, space, coords, alpha);
  });

  test("lab/lch reject commas and hue in the wrong place", () => {
    expectError("lab(50, 0, 0)", "invalid-component");
    expectError("lab(50 0deg 0)", "invalid-component");
    expectError("lch(50 20 30%)", "invalid-component");
  });
});

describe("oklab()/oklch()", () => {
  test.each([
    ["oklab(40.101% 0.1147 0.0453)", "oklab", [0.40101, 0.1147, 0.0453], 1],
    ["oklab(0.5 0.1 -0.1)", "oklab", [0.5, 0.1, -0.1], 1],
    ["oklab(100% 100% -100%)", "oklab", [1, 0.4, -0.4], 1],
    ["oklab(2 0 0)", "oklab", [1, 0, 0], 1],
    ["oklab(0.5 0 0 / 25%)", "oklab", [0.5, 0, 0], 0.25],
    ["oklch(40.101% 0.12332 21.555)", "oklch", [0.40101, 0.12332, 21.555], 1],
    ["oklch(59.69% 0.156 49.77)", "oklch", [0.5969, 0.156, 49.77], 1],
    ["oklch(0.7 50% 120deg)", "oklch", [0.7, 0.2, 120], 1],
    ["oklch(0.7 -1 120)", "oklch", [0.7, 0, 120], 1],
    ["oklch(0.7 0.1 1turn)", "oklch", [0.7, 0.1, 0], 1],
    ["oklch(none none none / none)", "oklch", [0, 0, 0], 0],
  ])("%s", (input, space, coords, alpha) => {
    expectColor(input, space, coords, alpha);
  });
});

describe("color()", () => {
  test.each([
    ["color(display-p3 1 0 0)", "display-p3", [1, 0, 0], 1],
    ["color(display-p3 0.5 0.25 1 / 0.5)", "display-p3", [0.5, 0.25, 1], 0.5],
    ["color(display-p3 50% 25% 100%)", "display-p3", [0.5, 0.25, 1], 1],
    ["color(display-p3 1.2 -0.1 0.5)", "display-p3", [1.2, -0.1, 0.5], 1],
    ["color(DISPLAY-P3 none 1 0)", "display-p3", [0, 1, 0], 1],
    ["color(srgb 1 0.5 0)", "srgb", [1, 0.5, 0], 1],
    ["color(srgb-linear 0.2 0.2 0.2)", "srgb-linear", [0.2, 0.2, 0.2], 1],
    ["color(xyz 0.2 0.3 0.4)", "xyz-d65", [0.2, 0.3, 0.4], 1],
    ["color(xyz-d65 0.2 0.3 0.4)", "xyz-d65", [0.2, 0.3, 0.4], 1],
    ["color(xyz-d50 0.2 0.3 0.4)", "xyz-d50", [0.2, 0.3, 0.4], 1],
  ])("%s", (input, space, coords, alpha) => {
    expectColor(input, space, coords, alpha);
  });

  test("unsupported spaces are reported distinctly", () => {
    for (const s of ["color(a98-rgb 1 0 0)", "color(prophoto-rgb 1 0 0)", "color(rec2020 1 0 0)", "color(--custom 1 0 0)", "color(foo 1 0 0)", "color(1 0 0 0)"]) {
      expectError(s, "unsupported-color-space");
    }
  });

  test("component count and commas", () => {
    expectError("color(display-p3 1 0)", "invalid-component");
    expectError("color(display-p3 1 0 0 0)", "invalid-component");
    expectError("color(display-p3)", "invalid-component");
    expectError("color(display-p3, 1, 0, 0)", "invalid-component");
    expectError("color()", "invalid-component");
  });
});

describe("unsupported syntax is reported, not misparsed", () => {
  test.each([
    "rgb(from red r g b)",
    "hsl(from #fff h s l)",
    "color(from red display-p3 r g b)",
    "color-mix(in srgb, red, blue)",
    "light-dark(red, blue)",
    "device-cmyk(0 0 0 1)",
    "rgb(calc(255 / 2) 0 0)",
    "rgb(var(--x) 0 0)",
    "calc(1 + 2)",
    "var(--brand)",
    "env(x)",
  ])("%s", (input) => {
    expectError(input, "unsupported-function");
  });

  test("unknown functions and malformed wrappers", () => {
    expectError("foo(1 2 3)", "invalid-syntax");
    expectError("rgb(1 2 3", "invalid-syntax");
    expectError("rgb(1 2 3) x", "invalid-syntax");
    expectError("(1 2 3)", "invalid-syntax");
    expectError("1rgb(1 2 3)", "invalid-syntax");
  });
});

describe("input handling", () => {
  test("non-strings", () => {
    for (const v of [undefined, null, 1, true, {}, [], ["#fff"], () => 1, Symbol("x"), 10n, new String("#fff")]) {
      expectError(v, "not-a-string");
    }
  });

  test("empty and whitespace", () => {
    for (const s of ["", " ", "\t\n\r\f "]) expectError(s, "empty");
  });

  test("surrounding CSS whitespace is trimmed; non-CSS whitespace is not", () => {
    expectColor("\n\t rgb(0 0 0)\r\f ", "srgb", [0, 0, 0]);
    expectError(" #fff", "invalid-syntax");
  });

  test("results are valid immutable Colors", () => {
    const r = parse("oklch(0.5 0.1 400)");
    expect(isColor(r.color)).toBe(true);
    expect(Object.isFrozen(r.color)).toBe(true);
    expect(r.color.coords[2]).toBe(40);
  });

  test("errors are structured and echo a bounded input", () => {
    const r = parse("rgb(" + "9".repeat(500) + " 0)");
    expect(r.ok).toBe(false);
    expect(typeof r.error.message).toBe("string");
    expect(r.error.input.length).toBeLessThanOrEqual(83);
  });
});

describe("robustness", () => {
  test("fuzz: never throws and always returns a well-formed result", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pieces = ["rgb(", "rgba(", "hsl(", "hwb(", "lab(", "lch(", "oklab(", "oklch(", "color(", "display-p3", ")", "(", ",", "/", " ", "\t", "%", ".", "-", "+", "e", "E", "1", "0", "255", "360", "none", "deg", "turn", "#", "f", "x", "calc(", "var(", "from", "\u0000", "é", "\u{1f600}", "9".repeat(30), "1e999"];
    for (let i = 0; i < 20000; i++) {
      let s = "";
      const n = 1 + Math.floor(rnd() * 12);
      for (let j = 0; j < n; j++) s += pieces[Math.floor(rnd() * pieces.length)];
      let r;
      expect(() => (r = parseColor(s))).not.toThrow();
      expect(typeof r.ok).toBe("boolean");
      if (r.ok) {
        expect(isColor(r.color)).toBe(true);
      } else {
        expect(typeof r.error.code).toBe("string");
        expect(typeof r.error.message).toBe("string");
      }
    }
  });

  test("hostile inputs finish quickly (linear scanning)", () => {
    const hostile = [
      "(".repeat(100000),
      "rgb(" + "(".repeat(100000) + ")",
      "rgb(" + "1 ".repeat(50000) + ")",
      "rgb(" + "1,".repeat(50000) + ")",
      "rgb(" + "/".repeat(100000) + ")",
      "rgb(" + "1".repeat(200000) + " 0 0)",
      "rgb(" + "1e".repeat(50000) + " 0 0)",
      "rgb(1" + ".".repeat(100000) + " 0 0)",
      "#" + "f".repeat(200000),
      " ".repeat(200000) + "red" + " ".repeat(200000) + "x",
      "color(" + "a".repeat(200000) + " 0 0 0)",
    ];
    const start = performance.now();
    for (const h of hostile) {
      const r = parseColor(h);
      expect(r.ok).toBe(false);
    }
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
