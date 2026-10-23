const { describe, test, expect } = require("bun:test");
require("../scripts/ensure-build");
const { pick, check, parseColor, ColorInputError } = require("..");

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
};

describe("pick() outcomes", () => {
  test("many pass: the highest contrast wins; passing candidates precede failing ones", () => {
    const r = pick("#ffffff", ["#cccccc", "#767676", "#000000", "#595959"]);
    expect(r.winner.input).toBe("#000000");
    expect(r.ranked.map((c) => c.input)).toEqual(["#000000", "#595959", "#767676", "#cccccc"]);
    expect(r.ranked.map((c) => c.passes)).toEqual([true, true, true, false]);
    expect(r.ranked.map((c) => c.rank)).toEqual([1, 2, 3, 4]);
    expect(r.reasonCode).toBe("highest-contrast");
    expect(r.reason).toContain("#000000");
    expect(r.reason).toContain("21.00:1");
    expect(r.reason).toContain("3 candidates");
    expect(r.winner).toBe(r.ranked[0]);
  });

  test("one passes", () => {
    const r = pick("#ffffff", ["#cccccc", "#767676", "#eeeeee"]);
    expect(r.winner.input).toBe("#767676");
    expect(r.reasonCode).toBe("only-passing");
    expect(r.reason).toContain("only candidate");
    expect(r.ranked.map((c) => c.index)).toEqual([1, 0, 2]); // failing ones ordered by contrast
  });

  test("none pass: no winner, ranked closest-first, explicit reason", () => {
    const r = pick("#ffffff", ["#eeeeee", "#aaaaaa", "#cccccc"]);
    expect(r.winner).toBeNull();
    expect(r.ranked.map((c) => c.input)).toEqual(["#aaaaaa", "#cccccc", "#eeeeee"]);
    expect(r.ranked.every((c) => !c.passes)).toBe(true);
    expect(r.reasonCode).toBe("none-pass");
    expect(r.reason).toContain("None of the 3 candidates");
    expect(r.reason).toContain("#aaaaaa");
    expect(r.target.threshold).toBe(4.5);
  });

  test("no candidates", () => {
    const r = pick("#fff", []);
    expect(r).toEqual({ winner: null, ranked: [], reasonCode: "no-candidates", reason: "No candidates were provided.", target: null });
  });

  test("a single candidate", () => {
    expect(pick("#fff", ["#000"]).reasonCode).toBe("only-passing");
    expect(pick("#fff", ["#ddd"]).winner).toBeNull();
  });
});

describe("determinism and ties", () => {
  test("equal contrast keeps input order, and says so", () => {
    const r = pick("#ffffff", ["#000000", "black", "rgb(0 0 0)"]);
    expect(r.ranked.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(r.winner.index).toBe(0);
    expect(r.reasonCode).toBe("tie-broken-by-order");
    expect(r.reason).toContain("tied on contrast with 2 other candidates");

    const reversed = pick("#ffffff", ["rgb(0 0 0)", "black", "#000000"]);
    expect(reversed.winner.input).toBe("rgb(0 0 0)");
  });

  test("a tie among failing candidates also keeps input order", () => {
    const r = pick("#fff", ["#ddd", "#dddddd", "#eee"]);
    expect(r.ranked.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  test("a tie between passing candidates below the winner does not change the reason", () => {
    const r = pick("#fff", ["#000", "#595959", "#595959"]);
    expect(r.reasonCode).toBe("highest-contrast");
    expect(r.ranked.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  test("the result is independent of input order except for ties", () => {
    const palette = ["#111111", "#444444", "#767676", "#999999", "#bbbbbb", "#e0e0e0"];
    const expected = pick("#fff", palette).ranked.map((c) => c.input);
    let seed = 3;
    const next = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 50; i++) {
      const shuffled = [...palette].sort(() => next() - 0.5);
      expect(pick("#fff", shuffled).ranked.map((c) => c.input)).toEqual(expected);
    }
  });

  test("same call twice gives deeply equal results", () => {
    const args = ["#102030", ["#eeeeee", "#ffcc00", "rgb(255 255 255 / 0.5)", "oklch(0.9 0.05 90)"]];
    expect(pick(...args)).toEqual(pick(...args));
  });
});

describe("targets", () => {
  test("level and use change who passes", () => {
    const palette = ["#595959", "#767676", "#949494"]; // 7.0, 4.54, 3.03 on white
    expect(pick("#fff", palette, { level: "AAA" }).ranked.map((c) => c.passes)).toEqual([true, false, false]);
    expect(pick("#fff", palette, { use: "large-text" }).ranked.map((c) => c.passes)).toEqual([true, true, true]);
    expect(pick("#fff", palette, { minRatio: 5 }).ranked.map((c) => c.passes)).toEqual([true, false, false]);
    expect(pick("#fff", palette, { minRatio: 5 }).reason).toContain("custom 5:1 target");
    expect(pick("#fff", palette, { level: "AAA" }).reason).toContain("AAA text 7:1 target");
  });

  test("invalid target options throw like check()", () => {
    expect(() => pick("#fff", ["#000"], { minRatio: 99 })).toThrow(RangeError);
    expect(() => pick("#fff", ["#000"], { level: "AAAA" })).toThrow(RangeError);
  });

  test("each ranked entry carries the same check() result as calling check()", () => {
    const r = pick("#fafafa", ["#222", "rgba(0,0,0,.5)"], { level: "AAA" });
    for (const entry of r.ranked) {
      expect(entry.check).toEqual(check(entry.input, "#fafafa", { level: "AAA" }));
    }
  });
});

describe("shared modern engine", () => {
  test("alpha candidates are composited over the background", () => {
    const r = pick("#ffffff", ["rgba(0, 0, 0, 0.5)", "rgba(0, 0, 0, 0.9)"]);
    expect(r.winner.input).toBe("rgba(0, 0, 0, 0.9)");
    expect(r.ranked[1].check.notes.map((n) => n.code)).toEqual(["foreground-alpha"]);
    expect(r.ranked[1].passes).toBe(false); // 50% black is only ~3.98:1
  });

  test("a translucent background uses the backdrop option", () => {
    const r = pick("rgb(0 0 0 / 0.5)", ["#ffffff", "#000000"], { backdrop: "#000000" });
    expect(r.ranked[0].check.background.hex).toBe("#000000");
    expect(r.winner.input).toBe("#ffffff");
  });

  test("wide-gamut and modern-syntax candidates rank alongside sRGB ones", () => {
    const r = pick("#ffffff", ["color(display-p3 0 0 0)", "oklch(0.3 0.05 250)", "lab(20 0 0)", "hsl(0 0% 40%)"]);
    expect(r.ranked.every((c) => Number.isFinite(c.check.ratio))).toBe(true);
    expect(r.winner.input).toBe("color(display-p3 0 0 0)");
  });

  test("accepts parsed Color objects", () => {
    const c = parseColor("#003366").color;
    const r = pick("#fff", [c, "#cccccc"]);
    expect(r.winner.input).toBe(c);
  });
});

describe("labelled candidates", () => {
  test("names are carried through and shown in the reason", () => {
    const r = pick("#ffffff", [
      { name: "text/secondary", color: "#767676" },
      { name: "text/primary", color: "#111111" },
      { color: "#dddddd" },
    ]);
    expect(r.winner.name).toBe("text/primary");
    expect(r.winner.input).toBe("#111111");
    expect(r.reason).toContain("text/primary (#111111)");
    expect("name" in r.ranked[2]).toBe(false);
  });
});

describe("safety", () => {
  test("does not mutate its arguments", () => {
    const candidates = deepFreeze([{ name: "a", color: "#777" }, "#222", parseColor("#036").color]);
    const background = deepFreeze(parseColor("#eee").color);
    const options = deepFreeze({ level: "AAA", backdrop: "#fff" });
    expect(() => pick(background, candidates, options)).not.toThrow();
    expect(candidates).toHaveLength(3);
  });

  test("the returned ranking does not alias the candidates array", () => {
    const candidates = ["#000", "#fff"];
    const r = pick("#fff", candidates);
    r.ranked.length = 0;
    expect(candidates).toEqual(["#000", "#fff"]);
  });

  test("errors name the offending argument", () => {
    for (const [args, role, code] of [
      [["nope", ["#000"]], "background", "invalid-syntax"],
      [["#fff", ["#000", "nope"]], "candidates[1]", "invalid-syntax"],
      [["#fff", ["#000", 7]], "candidates[1]", "not-a-string"],
      [["#fff", [{ name: "x", color: "" }]], "candidates[0]", "empty"],
      [["#fff", []], null, null],
    ]) {
      if (role === null) {
        expect(() => pick(...args)).not.toThrow();
        continue;
      }
      let error;
      try {
        pick(...args);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ColorInputError);
      expect(error.role).toBe(role);
      expect(error.code).toBe(code);
    }
  });

  test("an invalid background is reported even with no candidates", () => {
    expect(() => pick("nope", [])).toThrow(ColorInputError);
  });
});
