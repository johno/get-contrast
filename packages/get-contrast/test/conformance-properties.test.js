// Property and invariant tests for the color engine: random valid inputs,
// conversion/compositing invariants, and mutation fuzzing of valid syntax.
// Deterministic (seeded) so any failure reproduces.
const { describe, test, expect } = require("bun:test");
require("../scripts/ensure-build");
const {
  COLOR_SPACES,
  parseColor,
  convert,
  composite,
  createColor,
  isColor,
  isInGamut,
} = require("../dist/cjs/color/index.js");

function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

describe("parsing properties", () => {
  test("hex, rgb() and color(srgb) agree for random 8-bit colors", () => {
    const next = rng(1);
    for (let i = 0; i < 2000; i++) {
      const [r, g, b] = [0, 0, 0].map(() => Math.floor(next() * 256));
      const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
      const a = parseColor(hex).color;
      const b2 = parseColor(`rgb(${r}, ${g}, ${b})`).color;
      const c = parseColor(`rgb(${r} ${g} ${b})`).color;
      const d = parseColor(`color(srgb ${r / 255} ${g / 255} ${b / 255})`).color;
      for (const other of [b2, c, d]) {
        a.coords.forEach((v, k) => expect(other.coords[k]).toBeCloseTo(v, 12));
      }
    }
  });

  test("rgb() percentages equal the corresponding numbers", () => {
    const next = rng(2);
    for (let i = 0; i < 500; i++) {
      const pct = [0, 0, 0].map(() => Math.round(next() * 1000) / 10);
      const asPct = parseColor(`rgb(${pct.map((p) => p + "%").join(" ")})`).color;
      const asNum = parseColor(`rgb(${pct.map((p) => (p * 255) / 100).join(" ")})`).color;
      asPct.coords.forEach((v, k) => expect(asNum.coords[k]).toBeCloseTo(v, 12));
    }
  });

  test("hue angle units agree", () => {
    const next = rng(3);
    for (let i = 0; i < 300; i++) {
      const deg = Math.round(next() * 720 - 360);
      const forms = [`${deg}`, `${deg}deg`, `${deg / 360}turn`, `${(deg * 400) / 360}grad`, `${(deg * Math.PI) / 180}rad`];
      const hues = forms.map((f) => parseColor(`hsl(${f} 50% 50%)`).color.coords[0]);
      hues.forEach((h) => {
        const delta = Math.abs(h - hues[0]);
        expect(Math.min(delta, 360 - delta)).toBeLessThan(1e-6);
      });
      expect(hues[0]).toBeGreaterThanOrEqual(0);
      expect(hues[0]).toBeLessThan(360);
    }
  });

  test("alpha forms agree: number, percentage, slash and legacy comma", () => {
    const next = rng(4);
    for (let i = 0; i < 300; i++) {
      const a = Math.round(next() * 100) / 100;
      const alphas = [
        parseColor(`rgb(1 2 3 / ${a})`).color.alpha,
        parseColor(`rgb(1 2 3 / ${a * 100}%)`).color.alpha,
        parseColor(`rgba(1, 2, 3, ${a})`).color.alpha,
        parseColor(`hsl(1 2% 3% / ${a})`).color.alpha,
      ];
      alphas.forEach((v) => expect(v).toBeCloseTo(a, 12));
    }
  });
});

describe("mutation fuzz: malformed input fails cleanly", () => {
  const seeds = [
    "#336699", "#abcd", "rgb(10, 20, 30)", "rgb(10 20 30 / 50%)", "hsl(120deg 50% 50%)",
    "hsla(120, 50%, 50%, 0.5)", "hwb(120 10% 20%)", "lab(50% 20 -30)", "lch(50 30 120)",
    "oklab(0.5 0.1 -0.1)", "oklch(60% 0.2 30deg / 0.5)", "color(display-p3 1 0.5 0 / 0.5)",
    "color(xyz-d50 0.2 0.3 0.4)", "rebeccapurple", "transparent",
  ];
  const junk = ["(", ")", ",", "/", "%", ".", "-", "+", "e", " ", "\t", "#", "x", "9", "none", "deg", "\u0000", "é", "\u{1f600}", "K", "calc(1)"];

  test("20,000 mutations never throw and always return a well-formed result", () => {
    const next = rng(5);
    for (let i = 0; i < 20000; i++) {
      let s = seeds[Math.floor(next() * seeds.length)];
      const edits = 1 + Math.floor(next() * 4);
      for (let e = 0; e < edits; e++) {
        const at = Math.floor(next() * (s.length + 1));
        const op = Math.floor(next() * 3);
        if (op === 0) s = s.slice(0, at) + junk[Math.floor(next() * junk.length)] + s.slice(at);
        else if (op === 1) s = s.slice(0, at) + s.slice(at + 1 + Math.floor(next() * 3));
        else s = s.slice(0, at) + s.slice(Math.min(s.length, at + 1)) + s.charAt(at);
      }
      let r;
      expect(() => (r = parseColor(s))).not.toThrow();
      if (r.ok) {
        expect(isColor(r.color)).toBe(true);
        COLOR_SPACES.forEach((space) => expect(() => convert(r.color, space)).not.toThrow());
      } else {
        expect(typeof r.error.code).toBe("string");
        expect(r.error.input.length).toBeLessThanOrEqual(83);
      }
    }
  });
});

describe("conversion properties", () => {
  const next = rng(6);
  const random = () => createColor("srgb", [next(), next(), next()], next());

  test("converting to the same space twice is a no-op", () => {
    for (let i = 0; i < 200; i++) {
      for (const space of COLOR_SPACES) {
        const once = convert(random(), space);
        expect(convert(once, space)).toBe(once);
      }
    }
  });

  test("every conversion yields finite, valid colors", () => {
    for (let i = 0; i < 500; i++) {
      const c = random();
      for (const space of COLOR_SPACES) {
        const out = convert(c, space);
        expect(isColor(out)).toBe(true);
        out.coords.forEach((v) => expect(Number.isFinite(v)).toBe(true));
      }
    }
  });

  test("sRGB colors are inside both sRGB and Display P3", () => {
    for (let i = 0; i < 1000; i++) {
      const c = random();
      expect(isInGamut(c, "srgb")).toBe(true);
      expect(isInGamut(c, "display-p3")).toBe(true);
    }
  });

  test("lightness is monotonic in grays across lab and oklab", () => {
    let prevL = -1;
    let prevOk = -1;
    for (let v = 0; v <= 255; v++) {
      const gray = createColor("srgb", [v / 255, v / 255, v / 255]);
      const l = convert(gray, "lab").coords[0];
      const ok = convert(gray, "oklab").coords[0];
      expect(l).toBeGreaterThan(prevL);
      expect(ok).toBeGreaterThan(prevOk);
      prevL = l;
      prevOk = ok;
    }
  });

  test("hue and chroma rotate consistently between lab and lch", () => {
    for (let i = 0; i < 500; i++) {
      const lch = convert(random(), "lch").coords;
      const lab = convert(createColor("lch", lch), "lab").coords;
      expect(Math.hypot(lab[1], lab[2])).toBeCloseTo(lch[1], 9);
    }
  });
});

describe("compositing invariants", () => {
  const next = rng(7);
  const random = () => createColor("srgb", [next(), next(), next()], next());

  test("result alpha is in [0, 1] and at least each input's alpha", () => {
    for (let i = 0; i < 2000; i++) {
      const fg = random();
      const bg = random();
      const out = composite(fg, bg);
      expect(out.alpha).toBeGreaterThanOrEqual(Math.max(fg.alpha, bg.alpha) - 1e-12);
      expect(out.alpha).toBeLessThanOrEqual(1 + 1e-12);
      expect(out.alpha).toBeCloseTo(fg.alpha + bg.alpha * (1 - fg.alpha), 12);
    }
  });

  test("blended channels lie between foreground and background channels", () => {
    for (let i = 0; i < 2000; i++) {
      const fg = random();
      const bg = random();
      for (const space of ["srgb", "srgb-linear"]) {
        const out = composite(fg, bg, { space });
        const f = convert(fg, space).coords;
        const b = convert(bg, space).coords;
        const o = convert(out, space).coords;
        o.forEach((v, k) => {
          expect(v).toBeGreaterThanOrEqual(Math.min(f[k], b[k]) - 1e-9);
          expect(v).toBeLessThanOrEqual(Math.max(f[k], b[k]) + 1e-9);
        });
      }
    }
  });

  test("opaque foreground replaces; transparent foreground is invisible", () => {
    for (let i = 0; i < 500; i++) {
      const bg = random();
      const fg = random();
      const opaque = createColor("srgb", fg.coords, 1);
      composite(opaque, bg).coords.forEach((v, k) => expect(v).toBeCloseTo(fg.coords[k], 12));
      const clear = createColor("srgb", fg.coords, 0);
      const out = composite(clear, bg);
      out.coords.forEach((v, k) => expect(v).toBeCloseTo(bg.coords[k], 12));
      expect(out.alpha).toBeCloseTo(bg.alpha, 12);
    }
  });

  test("source-over is associative", () => {
    for (let i = 0; i < 500; i++) {
      const [a, b, c] = [random(), random(), random()];
      const left = composite(composite(a, b), c);
      const right = composite(a, composite(b, c));
      left.coords.forEach((v, k) => expect(right.coords[k]).toBeCloseTo(v, 9));
      expect(right.alpha).toBeCloseTo(left.alpha, 12);
    }
  });
});
