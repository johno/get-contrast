const { describe, test, expect } = require("bun:test");
require("../scripts/ensure-build");
const { audit, check, pick, parseColor, ColorInputError } = require("..");

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
};
function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

const PALETTE = { ink: "#111111", paper: "#ffffff", mid: "#767676", pale: "#dddddd" };

describe("structure", () => {
  test("a { name: color } map", () => {
    const r = audit(PALETTE);
    expect(r.colors.map((c) => [c.index, c.name, c.hex])).toEqual([
      [0, "ink", "#111111"],
      [1, "paper", "#ffffff"],
      [2, "mid", "#767676"],
      [3, "pale", "#dddddd"],
    ]);
    expect(r.unique).toEqual([0, 1, 2, 3]);
    expect(r.summary).toEqual({ colors: 4, unique: 4, duplicates: 0, pairs: 12, passing: 6, failing: 6 });
    expect(r.target).toEqual({ level: "AA", use: "text", threshold: 4.5, custom: false });
  });

  test("an array of colors and { name, color } entries", () => {
    const r = audit(["#111", { name: "paper", color: "#fff" }, "#767676"]);
    expect(r.colors.map((c) => c.name)).toEqual([undefined, "paper", undefined]);
    expect("name" in r.colors[0]).toBe(false);
    expect(r.colors[1].input).toBe("#fff");
    expect(r.summary.pairs).toBe(6);
  });

  test("the matrix is square, has a unit diagonal, and is symmetric for opaque colors", () => {
    const r = audit(PALETTE);
    expect(r.matrix).toHaveLength(4);
    r.matrix.forEach((row, a) => {
      expect(row).toHaveLength(4);
      expect(row[a]).toBe(1);
      row.forEach((v, b) => expect(v).toBe(r.matrix[b][a]));
    });
    expect(r.matrix[0][1]).toBeCloseTo(18.88, 2);
  });

  test("pairs are ordered, row-major, and exclude self-pairs", () => {
    const r = audit(PALETTE);
    expect(r.pairs.slice(0, 4).map((p) => [p.foreground, p.background])).toEqual([[0, 1], [0, 2], [0, 3], [1, 0]]);
    expect(r.pairs.every((p) => p.foreground !== p.background)).toBe(true);
  });

  test("empty and single-color palettes", () => {
    for (const palette of [[], {}]) {
      const r = audit(palette);
      expect(r.summary).toEqual({ colors: 0, unique: 0, duplicates: 0, pairs: 0, passing: 0, failing: 0 });
      expect(r.matrix).toEqual([]);
      expect(r.recommendations).toEqual([]);
    }
    const one = audit(["#123456"]);
    expect(one.matrix).toEqual([[1]]);
    expect(one.pairs).toEqual([]);
    expect(one.recommendations).toEqual([{ background: 0, candidates: [], best: null, closest: null }]);
  });
});

describe("every pair equals check()", () => {
  test("opaque colors in many syntaxes", () => {
    const palette = ["#111", "hsl(210 50% 40%)", "oklch(0.7 0.1 80)", "color(display-p3 0.9 0.2 0.1)", "lab(90 5 5)", "#fff"];
    const r = audit(palette);
    for (const p of r.pairs) {
      const expected = check(palette[p.foreground], palette[p.background]);
      expect(p.ratio).toBe(expected.ratio);
      expect(p.ratioText).toBe(expected.ratioText);
      expect(p.results).toEqual(expected.results);
      expect(p.passes).toBe(expected.target.passes);
      expect("notes" in p).toBe(false);
    }
  });

  test("translucent colors use real compositing, role by role", () => {
    const palette = ["rgb(0 0 0 / 0.5)", "#ffffff", "#3366cc"];
    const r = audit(palette);
    const pair = (f, b) => r.pairs.find((p) => p.foreground === f && p.background === b);
    const expectedAB = check(palette[0], palette[1]);
    expect(pair(0, 1).ratio).toBe(expectedAB.ratio);
    expect(pair(0, 1).notes.map((n) => n.code)).toEqual(["foreground-alpha"]);
    expect(r.matrix[0][1]).toBe(pair(0, 1).ratio);
    // the reverse direction is a different question: with a translucent color in
    // play, "A on B" and "B on A" composite differently (here: black at 50% over
    // blue, versus blue over black-at-50%-over-white).
    expect(pair(2, 0).ratio).toBe(check(palette[2], palette[0]).ratio);
    expect(pair(0, 2).ratio).toBe(check(palette[0], palette[2]).ratio);
    expect(pair(2, 0).ratio).not.toBeCloseTo(pair(0, 2).ratio, 3);
    expect(r.matrix[0][2]).toBe(pair(0, 2).ratio);
    expect(r.matrix[2][0]).toBe(pair(2, 0).ratio);
  });

  test("a backdrop reaches translucent backgrounds", () => {
    const light = audit(["#ffffff", "rgb(0 0 0 / 0.5)"]);
    const dark = audit(["#ffffff", "rgb(0 0 0 / 0.5)"], { backdrop: "#000000" });
    expect(dark.pairs[0].ratio).toBe(check("#ffffff", "rgb(0 0 0 / 0.5)", { backdrop: "#000000" }).ratio);
    expect(dark.pairs[0].ratio).toBeGreaterThan(light.pairs[0].ratio);
  });

  test("out-of-gamut colors are flagged on the color", () => {
    const r = audit(["color(display-p3 1 0 0)", "#fff"]);
    expect(r.colors[0].notes.map((n) => n.code)).toEqual(["foreground-out-of-gamut"]);
    expect("notes" in r.colors[1]).toBe(false);
  });
});

describe("targets and filters", () => {
  test("level, use and minRatio decide which pairs pass", () => {
    const aa = audit(PALETTE);
    const aaa = audit(PALETTE, { level: "AAA" });
    const large = audit(PALETTE, { use: "large-text" });
    const custom = audit(PALETTE, { minRatio: 10 });
    expect(aaa.summary.passing).toBeLessThan(aa.summary.passing);
    expect(large.summary.passing).toBeGreaterThan(aa.summary.passing);
    expect(custom.target).toEqual({ level: "AA", use: "text", threshold: 10, custom: true });
    expect(custom.pairs.every((p) => p.passes === p.ratio >= 10)).toBe(true);
    // results (all levels) do not depend on the target
    expect(aa.pairs.map((p) => p.results)).toEqual(aaa.pairs.map((p) => p.results));
  });

  test("`only` filters the pair list but not the matrix or summary", () => {
    const all = audit(PALETTE);
    const passing = audit(PALETTE, { only: "passing" });
    const failing = audit(PALETTE, { only: "failing" });
    expect(passing.pairs.every((p) => p.passes)).toBe(true);
    expect(failing.pairs.every((p) => !p.passes)).toBe(true);
    expect(passing.pairs.length + failing.pairs.length).toBe(all.pairs.length);
    expect(passing.pairs).toEqual(all.pairs.filter((p) => p.passes));
    expect(passing.matrix).toEqual(all.matrix);
    expect(passing.summary).toEqual(all.summary);
  });

  test("invalid options", () => {
    expect(() => audit(PALETTE, { only: "some" })).toThrow(RangeError);
    expect(() => audit(PALETTE, { level: "AAAA" })).toThrow(RangeError);
    expect(() => audit(PALETTE, { minRatio: 99 })).toThrow(RangeError);
    expect(() => audit(PALETTE, { maxColors: 0 })).toThrow(RangeError);
    expect(() => audit(PALETTE, { maxColors: 1.5 })).toThrow(RangeError);
  });
});

describe("duplicates and aliases", () => {
  test("equal colors are aliases of the first, whatever their syntax", () => {
    const r = audit({
      paper: "#ffffff",
      white: "white",
      snow: "rgb(100% 100% 100%)",
      p3: "color(display-p3 1 1 1)",
      ink: "#111",
      ink2: "#111111",
    });
    expect(r.unique).toEqual([0, 4]);
    expect(r.colors.map((c) => c.duplicateOf ?? null)).toEqual([null, 0, 0, 0, null, 4]);
    expect(r.colors[0].aliases).toEqual([1, 2, 3]);
    expect(r.colors[4].aliases).toEqual([5]);
    expect("aliases" in r.colors[1]).toBe(false);
    expect(r.summary).toEqual({ colors: 6, unique: 2, duplicates: 4, pairs: 2, passing: 2, failing: 0 });
    expect(r.matrix).toHaveLength(2);
    expect(r.pairs.every((p) => r.unique.includes(p.foreground) && r.unique.includes(p.background))).toBe(true);
  });

  test("same color with different alpha is not a duplicate", () => {
    expect(audit(["#000", "rgb(0 0 0 / 0.5)", "rgb(0 0 0 / 0.5)"]).unique).toEqual([0, 1]);
  });

  test("near-identical but distinct colors stay distinct", () => {
    expect(audit(["#111111", "#121212"]).unique).toEqual([0, 1]);
  });

  test("the same name for different colors is noted; the same name and color is not", () => {
    const r = audit([{ name: "text", color: "#111" }, { name: "text", color: "#222" }]);
    expect(r.notes.map((n) => n.code)).toEqual(["duplicate-name"]);
    expect(r.notes[0].message).toContain('"text"');
    expect(audit([{ name: "text", color: "#111" }, { name: "text", color: "#111111" }]).notes).toEqual([]);
  });
});

describe("recommendations", () => {
  test("best candidates per background, passing first", () => {
    const r = audit(PALETTE);
    const byBg = Object.fromEntries(r.recommendations.map((x) => [x.background, x]));
    expect(byBg[1]).toEqual({ background: 1, candidates: [0, 2], best: 0, closest: null }); // on paper: ink, then mid
    expect(byBg[0].best).toBe(1);
    expect(byBg[3]).toEqual({ background: 3, candidates: [0], best: 0, closest: null });
  });

  test("when nothing passes the closest is named", () => {
    const r = audit(["#ddd", "#eee", "#ccc"]);
    expect(r.recommendations.every((x) => x.best === null && x.candidates.length === 0)).toBe(true);
    expect(r.recommendations[0].closest).toBe(2); // #ccc is farthest from #ddd? ratios: eee 1.1, ccc 1.2
  });

  test("ordering matches pick() exactly, on random palettes and targets", () => {
    const next = rng(11);
    for (let run = 0; run < 60; run++) {
      const palette = Array.from({ length: 4 + Math.floor(next() * 8) }, () => `hsl(${Math.floor(next() * 360)} ${Math.floor(next() * 101)}% ${Math.floor(next() * 101)}%)`);
      const options = { level: next() < 0.5 ? "AA" : "AAA", use: ["text", "large-text", "ui"][Math.floor(next() * 3)] };
      const r = audit(palette, options);
      for (const rec of r.recommendations) {
        const others = r.unique.filter((i) => i !== rec.background);
        const picked = pick(palette[rec.background], others.map((i) => palette[i]), options);
        const rankedIndices = picked.ranked.map((entry) => others[entry.index]);
        const passing = picked.ranked.filter((entry) => entry.passes).map((entry) => others[entry.index]);
        expect(rec.candidates).toEqual(passing);
        expect(rec.best).toBe(picked.winner ? others[picked.winner.index] : null);
        if (!picked.winner && rankedIndices.length) expect(rec.closest).toBe(rankedIndices[0]);
      }
    }
  });
});

describe("determinism, safety, scale", () => {
  test("deterministic and independent of options object identity", () => {
    expect(audit(PALETTE, { level: "AAA" })).toEqual(audit(PALETTE, { level: "AAA" }));
  });

  test("object key order follows JavaScript property order (integer-like keys first)", () => {
    const r = audit({ b: "#000", 10: "#222", a: "#fff", 2: "#444" });
    expect(r.colors.map((c) => c.name)).toEqual(["2", "10", "b", "a"]);
  });

  test("does not mutate its input", () => {
    const palette = deepFreeze([{ name: "a", color: "#111" }, "#fff", parseColor("#808080").color]);
    expect(() => audit(palette, deepFreeze({ level: "AAA" }))).not.toThrow();
  });

  test("errors name the entry", () => {
    for (const [palette, role, code] of [
      [["#000", "nope"], "palette[1]", "invalid-syntax"],
      [{ ink: "#000", bad: "rgb(1 2)" }, "palette.bad", "invalid-component"],
      [[{ name: "x", color: "" }], "palette.x", "empty"],
      [["#000", 5], "palette[1]", "not-a-string"],
    ]) {
      let error;
      try {
        audit(palette);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ColorInputError);
      expect(error.role).toBe(role);
      expect(error.code).toBe(code);
    }
    expect(() => audit("#000")).toThrow(TypeError);
    expect(() => audit(null)).toThrow(TypeError);
  });

  test("maxColors counts unique colors, with an actionable message", () => {
    const palette = Array.from({ length: 6 }, (_, i) => `#${i}${i}${i}`);
    expect(() => audit(palette, { maxColors: 5 })).toThrow(/6 unique colors.*30 pairs.*raise maxColors/);
    expect(audit(palette, { maxColors: 6 }).summary.unique).toBe(6);
    expect(audit([...palette, "#000", "#111"], { maxColors: 6 }).summary.unique).toBe(6); // aliases do not count
  });

  test("a 150-color palette audits quickly", () => {
    const palette = Array.from({ length: 150 }, (_, i) => `hsl(${(i * 2.4) % 360} ${30 + (i % 50)}% ${5 + ((i * 7) % 90)}%)`);
    const start = performance.now();
    const r = audit(palette);
    expect(performance.now() - start).toBeLessThan(1500);
    expect(r.summary.pairs).toBe(150 * 149);
    expect(r.matrix).toHaveLength(150);
  });
});
