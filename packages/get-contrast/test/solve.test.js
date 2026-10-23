const { describe, test, expect } = require("bun:test");
require("../scripts/ensure-build");
const { find, fix, check, parseColor, ColorInputError } = require("..");
const colorEngine = require("../dist/cjs/color/index.js");

const { convert, createColor, isInGamut } = colorEngine;
const P = (css) => parseColor(css).color;
const deltaE = (a, b) => {
  const x = convert(a, "oklab").coords;
  const y = convert(b, "oklab").coords;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
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

describe("fix() basics", () => {
  test("#777 on white needs one tiny step: #767676", () => {
    const r = fix("#777777", "#ffffff");
    expect(r.reached).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.limitedBy).toBeNull();
    expect(r.suggested.css).toBe("#767676");
    expect(r.suggested.check.ratio).toBeGreaterThanOrEqual(4.5);
    expect(r.original.check.ratio).toBeLessThan(4.5);
    expect(r.change.dimensions).toEqual(["lightness"]);
    expect(r.change.deltaE).toBeLessThan(0.01); // one 8-bit step
    expect(r.adjusted).toBe("foreground");
  });

  test("a chromatic color keeps its hue and chroma when it can", () => {
    const r = fix("#3b82f6", "#ffffff");
    expect(r.reached).toBe(true);
    expect(r.change.dimensions).toEqual(["lightness"]);
    expect(r.suggested.oklch.l).toBeLessThan(r.original.oklch.l);
    expect(Math.abs(r.suggested.oklch.h - r.original.oklch.h)).toBeLessThan(1.5);
    expect(Math.abs(r.suggested.oklch.c - r.original.oklch.c)).toBeLessThan(0.01);
    expect(r.notes).toEqual([]);
  });

  test("already passing pairs are returned untouched", () => {
    const r = fix("#000000", "#ffffff");
    expect(r.reached).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.suggested.color).toEqual(r.original.color);
    expect(r.suggested.css).toBe("#000000");
    expect(r.change).toEqual({ deltaE: 0, dimensions: [] });
    expect(r.notes.map((n) => n.code)).toEqual(["already-passes"]);
    expect(r.suggested.check).toEqual(r.original.check);
  });

  test("before and after are full check() results", () => {
    const r = fix("#ffcc00", "#ffffff", { level: "AAA" });
    expect(r.original.check).toEqual(check("#ffcc00", "#ffffff", { level: "AAA" }));
    expect(r.suggested.check).toEqual(check(r.suggested.css, "#ffffff", { level: "AAA" }));
    expect(r.target).toEqual(r.original.check.target);
  });

  test("a barely tinted gray changes lightness only; 8-bit hue wobble is not reported", () => {
    const r = fix("#9ca3af", "#ffffff"); // oklch chroma ~0.02: its hue turns by degrees when rounded to 8-bit
    expect(r.reached).toBe(true);
    expect(r.change.dimensions).toEqual(["lightness"]);
  });

  test("dark yellow needs chroma reduced to fit the gamut, and says so", () => {
    const r = fix("#ffcc00", "#ffffff");
    expect(r.reached).toBe(true);
    expect(r.change.dimensions).toContain("lightness");
    expect(r.change.dimensions).toContain("chroma");
    expect(r.notes.map((n) => n.code)).toEqual(["chroma-reduced-for-gamut"]);
    expect(Math.abs(r.suggested.oklch.h - r.original.oklch.h)).toBeLessThan(2); // hue preserved
  });
});

describe("optimality (lightness-only default)", () => {
  test("for grays the result is the nearest passing 8-bit gray", () => {
    const targets = ["#ffffff", "#000000", "#808080", "#202020"];
    for (const bg of targets) {
      for (let v = 0; v < 256; v += 5) {
        const gray = "#" + v.toString(16).padStart(2, "0").repeat(3);
        const r = fix(gray, bg);
        if (r.original.check.target.passes) continue;
        let best = null;
        for (let w = 0; w < 256; w++) {
          const candidate = "#" + w.toString(16).padStart(2, "0").repeat(3);
          if (!check(candidate, bg).target.passes) continue;
          const d = deltaE(P(gray), P(candidate));
          if (best === null || d < best.d) best = { d, candidate };
        }
        if (best === null) {
          expect(r.reached).toBe(false);
        } else {
          expect(r.reached).toBe(true);
          // the solver works in continuous lightness then re-verifies the 8-bit color;
          // it may differ from the brute-force 8-bit optimum by at most a couple of steps.
          expect(r.change.deltaE).toBeLessThan(best.d + 0.012);
          expect(r.change.deltaE).toBeGreaterThanOrEqual(best.d - 1e-6);
        }
      }
    }
  }, 60000);

  test("chromatic colors: no passing color of the same hue/chroma is closer", () => {
    const cases = [["#3b82f6", "#ffffff"], ["#e11d48", "#ffffff"], ["#16a34a", "#ffffff"], ["#facc15", "#1e293b"], ["#38bdf8", "#f8fafc"]];
    for (const [fg, bg] of cases) {
      const r = fix(fg, bg);
      expect(r.reached).toBe(true);
      const { c, h } = r.original.oklch;
      // brute force along lightness with the same chroma reduction rule
      let best = Infinity;
      for (let i = 0; i <= 1000; i++) {
        const l = i / 1000;
        let chroma = c;
        const at = (cc) => createColor("oklch", [l, cc, h]);
        if (!isInGamut(at(chroma), "srgb", 1e-9)) {
          let lo = 0;
          let hi = chroma;
          for (let k = 0; k < 40; k++) {
            const mid = (lo + hi) / 2;
            if (isInGamut(at(mid), "srgb", 1e-9)) lo = mid;
            else hi = mid;
          }
          chroma = lo;
        }
        const color = at(chroma);
        const hex = require("../dist/cjs/color/format.js").toHex(color);
        if (check(hex, bg).target.passes) best = Math.min(best, deltaE(r.original.color, parseColor(hex).color));
      }
      expect(r.change.deltaE).toBeLessThan(best + 0.01);
      expect(r.change.deltaE).toBeGreaterThanOrEqual(best - 0.005);
    }
  }, 60000);

  test("the ratio lands just above the threshold, not far past it", () => {
    for (const [fg, bg] of [["#3b82f6", "#ffffff"], ["#e11d48", "#fff1f2"], ["#16a34a", "#f0fdf4"], ["#999999", "#ffffff"]]) {
      const r = fix(fg, bg);
      expect(r.reached).toBe(true);
      expect(r.suggested.check.ratio).toBeGreaterThanOrEqual(4.5);
      expect(r.suggested.check.ratio).toBeLessThan(4.5 + 0.12);
    }
  });
});

describe("constraints and impossible targets", () => {
  test("impossible targets are reported, with the best available suggestion", () => {
    // AAA (7:1) against mid gray #777 cannot be met by any color: black is 4.69:1.
    const r = fix("#999999", "#777777", { level: "AAA" });
    expect(r.reached).toBe(false);
    expect(r.limitedBy).toBe("unreachable");
    expect(r.suggested.css).toBe("#000000");
    expect(r.suggested.check.target.passes).toBe(false);
    expect(r.suggested.check.ratio).toBeGreaterThan(r.original.check.ratio);
    expect(r.notes.map((n) => n.code)).toContain("target-unreachable");
  });

  test("a custom minRatio above what is possible is unreachable, not a fake success", () => {
    const r = fix("#999999", "#777777", { minRatio: 5 }); // black is only 4.69:1 on #777
    expect(r.reached).toBe(false);
    expect(r.limitedBy).toBe("unreachable");
    expect(r.suggested.css).toBe("#000000");
    // and exactly 21:1 on white is reachable, but only by black itself
    expect(fix("#999999", "#ffffff", { minRatio: 21 }).suggested.css).toBe("#000000");
    expect(fix("#999999", "#ffffff", { minRatio: 21 }).reached).toBe(true);
  });

  test("maxChange stops the search and says why", () => {
    const r = fix("#ffcc00", "#ffffff", { maxChange: 0.05 });
    expect(r.reached).toBe(false);
    expect(r.limitedBy).toBe("max-change");
    expect(r.change.deltaE).toBeLessThanOrEqual(0.05 + 1e-6);
    expect(r.suggested.check.ratio).toBeGreaterThan(r.original.check.ratio - 1e-9);
    expect(r.notes.map((n) => n.code)).toContain("max-change-limit");
    expect(r.suggested.check.target.passes).toBe(false);
  });

  test("a generous maxChange behaves like no limit", () => {
    const unlimited = fix("#3b82f6", "#ffffff");
    const limited = fix("#3b82f6", "#ffffff", { maxChange: 0.5 });
    expect(limited.reached).toBe(true);
    expect(limited.suggested.css).toBe(unlimited.suggested.css);
    expect(limited.change.deltaE).toBeLessThanOrEqual(0.5);
  });

  test("maxChange of 0 changes nothing", () => {
    const r = fix("#999999", "#ffffff", { maxChange: 0 });
    expect(r.reached).toBe(false);
    expect(r.changed).toBe(false);
    expect(r.suggested).toBeNull();
  });

  test("unreachable vs budget-limited is distinguished", () => {
    expect(fix("#999999", "#777777", { level: "AAA", maxChange: 0.1 }).limitedBy).toBe("unreachable");
    expect(fix("#ffcc00", "#ffffff", { maxChange: 0.1 }).limitedBy).toBe("max-change");
  });

  test("no improvement is possible in the requested direction", () => {
    const r = fix("#ffcc00", "#ffffff", { direction: "lighter" });
    expect(r.reached).toBe(false);
    expect(r.suggested).toBeNull();
    expect(r.limitedBy).toBe("unreachable");
  });
});

describe("options", () => {
  test("direction", () => {
    const darker = fix("#808080", "#808080", { direction: "darker", level: "AA", use: "large-text" });
    expect(darker.reached).toBe(true);
    expect(darker.suggested.oklch.l).toBeLessThan(darker.original.oklch.l);
    const lighter = fix("#808080", "#808080", { direction: "lighter", use: "large-text" });
    expect(lighter.reached).toBe(true);
    expect(lighter.suggested.oklch.l).toBeGreaterThan(lighter.original.oklch.l);
    // auto picks the nearer of the two and is one of them
    const auto = fix("#808080", "#808080", { use: "large-text" });
    expect(auto.change.deltaE).toBeLessThanOrEqual(Math.min(darker.change.deltaE, lighter.change.deltaE) + 1e-9);
  });

  test("level, use and minRatio set the target", () => {
    const aa = fix("#999999", "#ffffff");
    const aaa = fix("#999999", "#ffffff", { level: "AAA" });
    const large = fix("#999999", "#ffffff", { use: "large-text" });
    const custom = fix("#999999", "#ffffff", { minRatio: 6 });
    expect(aa.suggested.check.ratio).toBeGreaterThanOrEqual(4.5);
    expect(aaa.suggested.check.ratio).toBeGreaterThanOrEqual(7);
    expect(large.suggested.check.ratio).toBeGreaterThanOrEqual(3); // #999 is 2.85:1, just under
    expect(large.change.deltaE).toBeLessThan(aa.change.deltaE);
    expect(aa.change.deltaE).toBeLessThan(aaa.change.deltaE);
    expect(custom.suggested.check.ratio).toBeGreaterThanOrEqual(6);
    expect(custom.target).toMatchObject({ threshold: 6, custom: true });
  });

  test("changing the background keeps the foreground", () => {
    const r = fix("#333333", "#444444", { change: "background" });
    expect(r.adjusted).toBe("background");
    expect(r.reached).toBe(true);
    expect(r.suggested.check.foreground.hex).toBe("#333333");
    expect(r.suggested.check.background.hex).toBe(r.suggested.css);
    expect(r.original.color).toEqual(P("#444444"));
  });

  test("find() adjusts the first color; role selects which side it is", () => {
    const asForeground = find("#777777", "#ffffff");
    expect(asForeground.suggested.css).toBe("#767676");
    const asBackground = find("#333333", "#444444", { role: "background" });
    expect(asBackground.suggested.check.background.hex).toBe(asBackground.suggested.css);
    // fix() is find() with the roles arranged
    expect(fix("#444444", "#333333", { change: "foreground" }).suggested.css).toBe(find("#444444", "#333333").suggested.css);
    expect(fix("#333333", "#444444", { change: "background" })).toEqual(find("#444444", "#333333", { role: "background" }));
  });

  test("preserveChroma: false may trade chroma for a smaller change", () => {
    const preserved = fix("#0000ff", "#101010");
    const free = fix("#0000ff", "#101010", { preserveChroma: false });
    expect(free.reached).toBe(true);
    expect(free.change.deltaE).toBeLessThanOrEqual(preserved.change.deltaE + 1e-9);
    expect(free.change.dimensions).toContain("chroma");
    expect(free.notes.map((n) => n.code)).toContain("chroma-reduced-to-reach-target");
    expect(Math.abs(free.suggested.oklch.h - free.original.oklch.h)).toBeLessThan(5); // still the same hue family
  });

  test("gamut: display-p3 results are in P3 and may keep more chroma", () => {
    const p3 = fix("color(display-p3 1 0.8 0)", "#ffffff", { gamut: "display-p3" });
    expect(p3.reached).toBe(true);
    expect(p3.suggested.css.startsWith("color(display-p3 ")).toBe(true);
    expect(isInGamut(p3.suggested.color, "display-p3")).toBe(true);
    expect(check(p3.suggested.css, "#ffffff").target.passes).toBe(true);
    const srgb = fix("color(display-p3 1 0.8 0)", "#ffffff");
    expect(srgb.suggested.css.startsWith("#")).toBe(true);
    expect(isInGamut(srgb.suggested.color, "srgb")).toBe(true);
    expect(p3.suggested.oklch.c).toBeGreaterThanOrEqual(srgb.suggested.oklch.c - 1e-6);
  });

  test("alpha is preserved and the result is verified with it", () => {
    const r = fix("rgb(120 120 120 / 0.9)", "#ffffff");
    expect(r.reached).toBe(true);
    expect(r.suggested.color.alpha).toBeCloseTo(0.9, 4);
    expect(r.notes.map((n) => n.code)).toContain("alpha-preserved");
    expect(check(r.suggested.css, "#ffffff").target.passes).toBe(true);
    expect(r.suggested.css.startsWith("rgb(")).toBe(true);
  });

  test("when alpha caps the contrast the target is reported unreachable, with a hint", () => {
    // 50% black over white is 3.98:1 at best: no lightness change can reach 4.5.
    const r = fix("rgb(80 80 80 / 0.5)", "#ffffff");
    expect(r.reached).toBe(false);
    expect(r.limitedBy).toBe("unreachable");
    expect(r.suggested.color.alpha).toBeCloseTo(0.5, 4);
    expect(r.notes.map((n) => n.message).join(" ")).toContain("alpha");
  });

  test("an out-of-gamut original that passes only unclipped is not reported as unchanged", () => {
    // oklch(0.515 0.321 343) is outside sRGB; as written it clears 3:1, but the sRGB hex does not.
    const r = fix("oklch(0.515 0.321 343)", "oklch(0.785 0.071 288)", { level: "AAA", use: "ui" });
    expect(r.original.check.target.passes).toBe(true);
    expect(r.reached).toBe(true);
    expect(check(r.suggested.css, "oklch(0.785 0.071 288)", { level: "AAA", use: "ui" }).target.passes).toBe(true);
    expect(r.suggested.check.target.passes).toBe(true);
  });

  test("backdrop reaches the checks", () => {
    const r = fix("#888888", "rgb(0 0 0 / 0.5)", { backdrop: "#000000" });
    expect(r.original.check.background.hex).toBe("#000000");
    expect(r.suggested.check.background.hex).toBe("#000000");
  });
});

describe("safety and determinism", () => {
  test("deterministic", () => {
    const args = ["#e11d48", "#fff1f2", { level: "AAA", preserveChroma: false }];
    expect(fix(...args)).toEqual(fix(...args));
  });

  test("does not mutate inputs", () => {
    const fg = deepFreeze(P("#e11d48"));
    const options = deepFreeze({ level: "AAA", gamut: "srgb", maxChange: 1 });
    expect(() => fix(fg, "#fff1f2", options)).not.toThrow();
  });

  test("accepts Color objects and any syntax", () => {
    expect(fix(P("oklch(0.7 0.15 250)"), "lab(95 0 0)").reached).toBe(true);
    expect(fix("hsl(210 80% 60%)", "hwb(0 100% 0%)").reached).toBe(true);
  });

  test("errors identify the argument", () => {
    for (const [fn, args, role] of [
      [fix, ["nope", "#fff"], "foreground"],
      [fix, ["#000", "nope"], "background"],
      [find, ["nope", "#fff"], "color"],
      [find, ["#000", "nope"], "against"],
    ]) {
      let error;
      try {
        fn(...args);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ColorInputError);
      expect(error.role).toBe(role);
    }
  });

  test("invalid options throw RangeError", () => {
    for (const options of [{ direction: "sideways" }, { gamut: "rec2020" }, { maxChange: -1 }, { maxChange: "big" }, { change: "both" }, { level: "AAAA" }, { minRatio: 30 }]) {
      expect(() => fix("#777", "#fff", options)).toThrow(RangeError);
    }
    expect(() => find("#777", "#fff", { role: "middle" })).toThrow(RangeError);
  });
});

describe("randomized: reported successes really pass", () => {
  // SOLVE_FUZZ_RUNS / SOLVE_FUZZ_SEED let you run a longer or different sweep locally.
  test("random pairs and option sets", () => {
    const runs = Number(process.env.SOLVE_FUZZ_RUNS || 300);
    const next = rng(Number(process.env.SOLVE_FUZZ_SEED || 2024));
    const randomColor = () => {
      const kind = Math.floor(next() * 4);
      if (kind === 0) return "#" + [0, 0, 0].map(() => Math.floor(next() * 256).toString(16).padStart(2, "0")).join("");
      if (kind === 1) return `hsl(${Math.floor(next() * 360)} ${Math.floor(next() * 101)}% ${Math.floor(next() * 101)}%)`;
      if (kind === 2) return `oklch(${next().toFixed(3)} ${(next() * 0.35).toFixed(3)} ${Math.floor(next() * 360)})`;
      return `rgb(${Math.floor(next() * 256)} ${Math.floor(next() * 256)} ${Math.floor(next() * 256)} / ${(0.4 + next() * 0.6).toFixed(2)})`;
    };
    let reachedCount = 0;
    let unreachableCount = 0;
    for (let i = 0; i < runs; i++) {
      const fg = randomColor();
      let bg = randomColor();
      if (parseColor(bg).color.alpha < 1) bg = "#ffffff"; // keep the background opaque
      const options = {
        level: next() < 0.5 ? "AA" : "AAA",
        use: ["text", "large-text", "ui"][Math.floor(next() * 3)],
        preserveChroma: next() < 0.7,
        direction: ["auto", "auto", "darker", "lighter"][Math.floor(next() * 4)],
        change: next() < 0.8 ? "foreground" : "background",
      };
      if (next() < 0.2) options.maxChange = next() * 0.3;
      if (next() < 0.15) options.gamut = "display-p3";
      let r;
      try {
        r = fix(fg, bg, options);
      } catch (e) {
        // translucent colors in the background role are legitimately rejected only for backdrop; none expected
        throw new Error(`fix(${fg}, ${bg}, ${JSON.stringify(options)}) threw ${e.message}`);
      }
      const label = `fix(${fg}, ${bg}, ${JSON.stringify(options)})`;

      const violations = [];
      if (r.reached) {
        reachedCount++;
        // recheck through the public API with the serialized suggestion
        const args = options.change === "background" ? [fg, r.suggested.css] : [r.suggested.css, bg];
        const again = check(...args, { level: options.level, use: options.use });
        if (!again.target.passes) violations.push(`rechecked suggestion ${r.suggested.css} does not pass (${again.ratio})`);
        if (!r.suggested.check.target.passes) violations.push("suggested.check does not pass");
        if (r.limitedBy !== null) violations.push("reached but limitedBy is set");
        if (options.maxChange !== undefined && r.change.deltaE > options.maxChange + 1e-6) violations.push("exceeds maxChange");
        if (r.changed) {
          // Changing a pair that already passes is only legitimate when the
          // original cannot be deployed as written (outside the target gamut).
          // A pair that passes as written can still fail once rounded to 8-bit
          // hex (when it passes by a hair); that case is allowed to change.
          const gamut = options.gamut || "srgb";
          const hex = colorEngine.toHex(r.original.color);
          const alphaText = r.original.color.alpha < 1 ? ` / ${r.original.color.alpha}` : "";
          const deployed = gamut === "srgb" && r.original.color.alpha === 1 ? hex : null;
          const deployedPasses = deployed
            ? (options.change === "background" ? check(fg, deployed, options) : check(deployed, bg, options)).target.passes
            : false;
          if (r.original.check.target.passes && isInGamut(r.original.color, gamut, 1e-6) && deployedPasses) {
            violations.push(`changed a deployable pair that already passes${alphaText}`);
          }
          if (!(r.change.deltaE > 0)) violations.push("changed but deltaE is 0");
        }
        // Hue stays put when there is enough light and chroma for 8-bit color to carry it.
        const s = r.suggested.oklch;
        const o = r.original.oklch;
        if (s.c > 0.04 && o.c > 0.04 && s.l > 0.2 && s.l < 0.95) {
          const d = Math.abs(s.h - o.h);
          if (Math.min(d, 360 - d) > 6) violations.push(`hue moved ${Math.min(d, 360 - d).toFixed(1)} degrees`);
        }
      } else {
        if (r.suggested !== null && r.suggested.check.target.passes) violations.push("not reached but suggestion passes");
        if (r.limitedBy === "unreachable" && options.maxChange === undefined && options.direction === "auto" && options.gamut === undefined) {
          unreachableCount++;
          // truly unreachable: neither black nor white meets the target
          // (alpha is part of the color and is kept, so probe with the same alpha)
          const other = options.change === "background" ? fg : bg;
          const alpha = r.original.color.alpha;
          const black = `rgb(0 0 0 / ${alpha})`;
          const white = `rgb(255 255 255 / ${alpha})`;
          const probe = (c) => (options.change === "background" ? check(other, c, options) : check(c, other, options));
          if (probe(black).target.passes || probe(white).target.passes) violations.push("called unreachable but black or white passes");
        }
      }
      expect([label, violations]).toEqual([label, []]);
    }
    expect(reachedCount).toBeGreaterThan(runs / 3);
  }, 120000);
});
