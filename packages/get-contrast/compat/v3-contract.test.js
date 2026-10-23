// Characterization tests for get-contrast@3.0.1. These capture what v3 does,
// including undesirable behavior. See docs/v3-compatibility.md.
const { describe, test, expect } = require("bun:test");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const contrast = require(root);
const pkg = require(path.join(root, "package.json"));

const NOT_STRING = "get-contrast expects colors as strings";
const TRANSPARENT = "get-contrast cannot contrast transparent colors";
// The unparseable-input message is the engine's own null-dereference text
// (V8 vs JavaScriptCore), so match both rather than one.
const UNPARSEABLE =
  /^(Cannot read properties of null \(reading 'match'\)|null is not an object \(evaluating 'color\.match'\))$/;

function thrown(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected function to throw");
}

describe("package metadata", () => {
  test("name, main, types, bin", () => {
    expect(pkg.name).toBe("get-contrast");
    expect(pkg.main).toBe("index.js");
    // Declarations are generated from src/ into dist/ (v3 shipped none).
    expect(pkg.types).toBe("dist/index.d.ts");
    expect(pkg.bin).toEqual({ contrast: "./cli.js" });
  });

  test("export shape", () => {
    expect(Object.keys(contrast).sort()).toEqual([
      "isAccessible",
      "isNotTransparent",
      "ratio",
      "score",
    ]);
    for (const fn of Object.values(contrast)) {
      expect(typeof fn).toBe("function");
    }
  });
});

describe("ratio", () => {
  test("returns an unrounded number", () => {
    expect(contrast.ratio("#000", "#fff")).toBe(21);
    expect(contrast.ratio("#fff", "#fff")).toBe(1);
    expect(contrast.ratio("#777", "#fff")).toBe(4.478089453577214);
    expect(contrast.ratio("tomato", "#fff")).toBe(2.946242628091934);
  });

  test("is symmetric", () => {
    expect(contrast.ratio("#fff", "#000")).toBe(21);
    expect(contrast.ratio("tomato", "rebeccapurple")).toBe(
      contrast.ratio("rebeccapurple", "tomato")
    );
  });

  test("accepts hex, rgb, hsl and named colors in any case", () => {
    for (const input of [
      "#fff",
      "#FFF",
      "#ffffff",
      "  #fff ",
      "#ffff",
      "#ffffff80",
      "rgb(255,255,255)",
      "rgb(255, 255, 255)",
      "RGB(255,255,255)",
      "hsl(0,0%,100%)",
    ]) {
      expect(contrast.ratio(input, "#000")).toBe(21);
    }
    for (const input of ["tomato", "Tomato", "TOMATO"]) {
      expect(contrast.ratio(input, "#fff")).toBe(2.946242628091934);
    }
    expect(contrast.ratio("rebeccapurple", "#fff")).toBe(8.405149896230322);
    expect(contrast.ratio("rgb(10%,20%,30%)", "#fff")).toBe(18.55589517445127);
    expect(contrast.ratio("hsl(0, 100%, 50%)", "#fff")).toBe(3.9984767707539985);
  });

  test("ignores non-zero alpha", () => {
    expect(contrast.ratio("rgba(0,0,0,.5)", "#fff")).toBe(21);
    expect(contrast.ratio("hsla(0,100%,50%,.5)", "#fff")).toBe(
      contrast.ratio("hsl(0,100%,50%)", "#fff")
    );
    expect(contrast.ratio("#ffffff80", "#000")).toBe(21);
  });

  test("throws on transparent colors unless ignoreAlpha", () => {
    for (const input of [
      "transparent",
      "rgba(0,0,0,0)",
      "rgba(0,0,0,0.0)",
      "rgb(0,0,0,0)",
      "hsla(0,100%,50%,0)",
      "#FFFFFF00",
      "#fff0",
    ]) {
      const e = thrown(() => contrast.ratio(input, "#fff"));
      expect(e).toBeInstanceOf(TypeError);
      expect(e.message).toBe(TRANSPARENT);
    }
    expect(contrast.ratio("rgba(0,0,0,0)", "#fff", { ignoreAlpha: true })).toBe(21);
    expect(contrast.ratio("transparent", "#fff", { ignoreAlpha: true })).toBe(21);
  });

  test("checks both colors", () => {
    expect(thrown(() => contrast.ratio("#fff", "transparent")).message).toBe(TRANSPARENT);
  });

  test("throws TypeError for non-string input", () => {
    for (const v of [undefined, null, 1, true, {}, [], () => 1]) {
      for (const args of [[v, "#fff"], ["#fff", v]]) {
        const e = thrown(() => contrast.ratio(...args));
        expect(e).toBeInstanceOf(TypeError);
        expect(e.message).toBe(NOT_STRING);
      }
    }
    expect(thrown(() => contrast.ratio("#000")).message).toBe(NOT_STRING);
    expect(thrown(() => contrast.ratio()).message).toBe(NOT_STRING);
  });

  test("throws TypeError for unparseable strings", () => {
    for (const input of [
      "",
      "  ",
      "foo",
      "#ff",
      "#ggg",
      "red!",
      " tomato",
      "inherit",
      "currentColor",
      "rgb(300,0,0)",
      "rgb(255 255 255)",
      "rgb(0 0 0 / 50%)",
      "hsl(0 100% 50%)",
      "hwb(0 0% 0%)",
      "lab(50% 0 0)",
      "oklch(0.5 0.1 100)",
      "color(srgb 1 0 0)",
    ]) {
      const e = thrown(() => contrast.ratio(input, "#fff"));
      expect(e).toBeInstanceOf(TypeError);
      expect(e.message).toMatch(UNPARSEABLE);
    }
  });

  test("quirk: malformed #12345 parses as rgb(18,52,5)", () => {
    expect(contrast.isNotTransparent("#12345")).toBe("rgb(18,52,5)");
    expect(contrast.ratio("#12345", "#fff")).toBe(13.82390465662025);
  });

  test("options: null, empty and extra arguments are equivalent", () => {
    expect(contrast.ratio("#000", "#fff", null)).toBe(21);
    expect(contrast.ratio("#000", "#fff", {})).toBe(21);
    expect(contrast.ratio("#000", "#fff", {}, "extra")).toBe(21);
  });
});

describe("score", () => {
  test.each([
    ["#000", "#fff", "AAA"],
    ["#595959", "#fff", "AAA"],
    ["#767676", "#fff", "AA"],
    ["#757575", "#fff", "AA"],
    ["#777", "#fff", "AA Large"],
    ["#949494", "#fff", "AA Large"],
    ["#808080", "#fff", "AA Large"],
    ["tomato", "DarkSlateGray", "AA Large"],
    ["#fafafa", "#fff", "Fail"],
    ["#fff", "#fff", "Fail"],
  ])("score(%s, %s) is %s", (a, b, expected) => {
    expect(contrast.score(a, b)).toBe(expected);
  });

  test("propagates ratio errors", () => {
    expect(thrown(() => contrast.score(1, "#fff")).message).toBe(NOT_STRING);
    expect(thrown(() => contrast.score("transparent", "#fff")).message).toBe(TRANSPARENT);
    expect(contrast.score("transparent", "#fff", { ignoreAlpha: true })).toBe("AAA");
  });
});

describe("isAccessible", () => {
  test("is true only above 4.5 (strict)", () => {
    expect(contrast.isAccessible("#000", "#fff")).toBe(true);
    expect(contrast.isAccessible("#767676", "#fff")).toBe(true);
    expect(contrast.isAccessible("#777", "#fff")).toBe(false);
    expect(contrast.isAccessible("#fff", "#fff")).toBe(false);
  });

  test("quirk: agrees with ratio > 4.5, not with score at exactly 4.5", () => {
    // There is no ratio of exactly 4.5 among 8-bit grays; assert the contract
    // by checking the comparison is derived from ratio().
    for (const [a, b] of [
      ["#767676", "#fff"],
      ["#777", "#fff"],
      ["tomato", "#fff"],
    ]) {
      expect(contrast.isAccessible(a, b)).toBe(contrast.ratio(a, b) > 4.5);
    }
  });

  test("propagates ratio errors", () => {
    expect(thrown(() => contrast.isAccessible(null, "#fff")).message).toBe(NOT_STRING);
    expect(thrown(() => contrast.isAccessible("rgba(0,0,0,0)", "#fff")).message).toBe(TRANSPARENT);
  });
});

describe("isNotTransparent", () => {
  test("returns a normalized color string", () => {
    expect(contrast.isNotTransparent("#fff")).toBe("rgb(255,255,255)");
    expect(contrast.isNotTransparent("#FFF")).toBe("rgb(255,255,255)");
    expect(contrast.isNotTransparent("rgb(255, 255, 255)")).toBe("rgb(255,255,255)");
    expect(contrast.isNotTransparent("hsl(0,0%,0%)")).toBe("rgb(0,0,0)");
    expect(contrast.isNotTransparent("rgba(0,0,0,.5)")).toBe("rgba(0,0,0,0.5)");
    expect(contrast.isNotTransparent("#ffffff80")).toBe(
      "rgba(255,255,255,0.5019607843137255)"
    );
  });

  test("throws on alpha 0", () => {
    for (const input of [
      "rgba(255,255,255,0)",
      "hsl(100,100,100,0)",
      "transparent",
      "#FFFFFF00",
    ]) {
      const e = thrown(() => contrast.isNotTransparent(input));
      expect(e).toBeInstanceOf(TypeError);
      expect(e.message).toBe(TRANSPARENT);
    }
  });

  test("ignoreAlpha returns the transparent color", () => {
    expect(contrast.isNotTransparent("rgba(0, 0, 0, 0)", { ignoreAlpha: true })).toBe(
      "rgba(0,0,0,0)"
    );
    expect(contrast.isNotTransparent("transparent", { ignoreAlpha: true })).toBe(
      "rgba(0,0,0,0)"
    );
    expect(contrast.isNotTransparent("#FFFFFF00", { ignoreAlpha: true })).toBe(
      "rgba(255,255,255,0)"
    );
  });

  test("quirk: does not resolve named colors (except transparent)", () => {
    for (const input of ["tomato", "rebeccapurple"]) {
      const e = thrown(() => contrast.isNotTransparent(input));
      expect(e).toBeInstanceOf(TypeError);
      expect(e.message).toMatch(UNPARSEABLE);
    }
  });

  test("quirk: non-strings throw an unparseable-input TypeError", () => {
    for (const v of [undefined, null, 1, {}, true]) {
      const e = thrown(() => contrast.isNotTransparent(v));
      expect(e).toBeInstanceOf(TypeError);
      expect(e.message).toMatch(UNPARSEABLE);
    }
  });

  test("throws TypeError for unparseable strings", () => {
    for (const input of ["", "foo", "#ff", "inherit", "rgb(0 0 0)"]) {
      expect(thrown(() => contrast.isNotTransparent(input)).message).toMatch(UNPARSEABLE);
    }
  });
});

describe("cli", () => {
  const cli = path.join(root, "cli.js");
  const run = (...args) => {
    const r = spawnSync("node", [cli, ...args], { encoding: "utf8" });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  test("no arguments prints usage to stderr and exits 0", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("usage: contrast <color1> [color2 (default: #fff)]\n");
  });

  test("accessible pair prints ratio and score, exits 0", () => {
    const r = run("#000");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("Ratio: 21\nScore: AAA\n");
    expect(r.stderr).toBe("");
  });

  test("second color is used when given", () => {
    const r = run("#fff", "#000");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("Ratio: 21\nScore: AAA\n");
  });

  test("defaults the second color to #fff", () => {
    expect(run("#777").stdout.startsWith("Ratio: 4.478089453577214\n")).toBe(true);
    expect(run("#000").stdout).toBe(run("#000", "#fff").stdout);
  });

  test("inaccessible pair prints a notice to stdout and exits 1", () => {
    const r = run("#777");
    expect(r.status).toBe(1);
    expect(r.stdout).toBe(
      "Ratio: 4.478089453577214\nScore: AA Large\nThe contrast is not accessible.\n"
    );
    expect(r.stderr).toBe("");
  });

  test("extra arguments are ignored", () => {
    expect(run("#000", "#fff", "extra").stdout).toBe("Ratio: 21\nScore: AAA\n");
  });

  test("invalid colors are uncaught TypeErrors: exit 1, empty stdout", () => {
    for (const [arg, message] of [
      ["foo", /TypeError: .*(null|match)/],
      ["transparent", new RegExp(`TypeError: ${TRANSPARENT}`)],
    ]) {
      const r = run(arg);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(message);
    }
  });
});
