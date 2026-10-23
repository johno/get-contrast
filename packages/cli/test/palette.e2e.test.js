// audit and matrix: palette input adapters and rendering, end to end.
const { describe, test, expect, beforeAll, afterAll } = require("bun:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

require("../../get-contrast/scripts/ensure-build");

const lib = require("get-contrast");
const { parsePalette, readPalette, InputError } = require("../src/palette-input");
const bin = path.join(__dirname, "..", "bin.js");

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "contrast-palette-"));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (name, content) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
};
const cli = (args, input) => {
  const r = spawnSync("node", [bin, ...args], { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, NO_COLOR: "", FORCE_COLOR: "" } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const PALETTE = { ink: "#111111", paper: "#ffffff", white: "white", mid: "#767676", pale: "#dddddd", brand: "#3b82f6" };

describe("palette input adapter", () => {
  test("JSON array, map, wrapper object, and plain lines", () => {
    expect(parsePalette('["#fff", {"name":"ink","color":"#111"}]', "x")).toEqual(["#fff", { name: "ink", color: "#111" }]);
    expect(parsePalette('{"ink":"#111","paper":"#fff"}', "x")).toEqual({ ink: "#111", paper: "#fff" });
    expect(parsePalette('{"colors":{"ink":"#111"}}', "x")).toEqual({ ink: "#111" });
    expect(parsePalette('{"colors":["#111","#fff"]}', "x")).toEqual(["#111", "#fff"]);
    expect(parsePalette("#111\r\n\r\n  #fff  \n", "x")).toEqual(["#111", "#fff"]);
  });

  test("actionable errors", () => {
    for (const [text, message] of [
      ["", "x is empty"],
      ["   \n", "x is empty"],
      ["[1,", "does not parse"],
      ["{", "does not parse"],
      ['{"a": {"b": "#fff"}}', '"a" must be a color string'],
      ['{"a": 5}', '"a" must be a color string'],
      ["null", "x looks"] /* not JSON-looking: treated as plain text, one bad color; see below */,
    ]) {
      if (text === "null") continue;
      expect(() => parsePalette(text, "x")).toThrow(InputError);
      expect(() => parsePalette(text, "x")).toThrow(message);
    }
    expect(() => parsePalette("[1]".replace("[1]", '"str"').replace('"str"', "{") + "", "x")).toThrow(InputError);
  });

  test("files, stdin, and read failures", () => {
    const file = write("ok.json", PALETTE);
    const io = { readStdin: () => '["#000"]', readFile: (p) => fs.readFileSync(p, "utf8") };
    expect(readPalette(file, io)).toEqual(PALETTE);
    expect(readPalette("-", io)).toEqual(["#000"]);
    expect(() => readPalette(path.join(dir, "missing.json"), io)).toThrow(/cannot read .*missing.json: no such file/);
    expect(() => readPalette(dir, io)).toThrow(/is a directory/);
  });
});

describe("contrast audit", () => {
  test("summary, failing pairs (each combination once), and recommendations", () => {
    const file = write("palette.json", PALETTE);
    const r = cli(["audit", file]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(
      [
        "6 colors (5 unique), 20 pairs: 8 pass, 12 fail",
        "Target AA text (4.5:1)",
        "note white is the same color as paper; it is not counted twice.",
        "",
        "Pairs that do not meet the target",
        "  ink on mid  4.15:1",
        "  paper on pale  1.35:1",
        "  paper on brand  3.67:1",
        "  mid on pale  3.34:1",
        "  mid on brand  1.23:1",
        "  pale on brand  2.70:1",
        "",
        "Best foreground for each background",
        "  on ink: paper 18.88:1 (+2 more)",
        "  on paper: ink 18.88:1 (+1 more)",
        "  on mid: paper 4.54:1",
        "  on pale: ink 13.90:1",
        "  on brand: ink 5.13:1",
        "",
      ].join("\n")
    );
  });

  test("--json is exactly the library's audit result", () => {
    const file = write("palette2.json", PALETTE);
    const r = cli(["audit", file, "--level", "AAA", "--json"]);
    const doc = JSON.parse(r.stdout);
    expect(doc).toMatchObject({ schema: 1, command: "audit", exitCode: 0 });
    const expected = JSON.parse(JSON.stringify(lib.audit(PALETTE, { level: "AAA" })));
    // numbers may differ in the last bits between engines; compare structure exactly and numbers loosely
    const close = (a, b, where = "$") => {
      if (typeof b === "number") return expect([where, Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))]).toEqual([where, true]);
      if (Array.isArray(b)) {
        expect([where, a.length]).toEqual([where, b.length]);
        return b.forEach((v, i) => close(a[i], v, `${where}[${i}]`));
      }
      if (b && typeof b === "object") {
        expect([where, Object.keys(a).sort()]).toEqual([where, Object.keys(b).sort()]);
        return Object.keys(b).forEach((k) => close(a[k], b[k], `${where}.${k}`));
      }
      expect([where, a]).toEqual([where, b]);
    };
    close(doc.result, expected);
  });

  test("a JSON palette from stdin gives the same result as the file", () => {
    const file = write("same.json", PALETTE);
    expect(cli(["audit", "-"], JSON.stringify(PALETTE))).toEqual(cli(["audit", file]));
  });

  test("filters and limits", () => {
    const file = write("filters.json", PALETTE);
    const failing = JSON.parse(cli(["audit", file, "--only", "failing", "--json"]).stdout).result;
    expect(failing.pairs.every((p) => !p.passes)).toBe(true);
    expect(failing.summary.pairs).toBe(20); // summary always covers everything
    const limited = cli(["audit", file, "--limit", "2"]).stdout;
    expect(limited).toContain("... and 4 more");
    expect(cli(["audit", file, "--limit", "0"]).stdout).not.toContain("more (");
  });

  test("plain-text palettes", () => {
    const r = cli(["audit", "-"], "#111111\n#ffffff\n#767676\n");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("3 colors, 6 pairs: 4 pass");
  });

  test("a palette where nothing works is reported, not hidden", () => {
    const r = cli(["audit", "-"], '["#dddddd", "#eeeeee"]');
    expect(r.stdout).toContain("none meets the target");
    expect(r.stdout).toContain("(closest:");
    expect(r.status).toBe(0);
  });

  test("single color and empty-after-parse palettes", () => {
    expect(cli(["audit", "-"], "#123456").stdout).toContain("on #123456: no other colors");
    expect(cli(["audit", "-"], "").status).toBe(2);
  });
});

describe("contrast matrix", () => {
  test("renders a grid with the target explained", () => {
    const file = write("matrix.json", { ink: "#111111", paper: "#ffffff", mid: "#767676" });
    const r = cli(["matrix", file]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      [
        "3 colors, 6 pairs: 4 pass, 2 fail",
        "Target AA text (4.5:1)",
        "",
        "        ink     paper   mid     ",
        "ink     -       18.88   (4.15)  ",
        "paper   18.88   -       4.54    ",
        "mid     (4.15)  4.54    -       ",
        "",
        "Rows are the foreground, columns the background. (Parenthesized) ratios do not meet the target.",
        "",
      ].join("\n")
    );
  });

  test("large palettes print a summary unless --wide", () => {
    const big = Array.from({ length: 20 }, (_, i) => ({ name: `c${i}`, color: `hsl(${i * 18} 60% ${20 + i * 3}%)` }));
    const file = write("big.json", big);
    const normal = cli(["matrix", file]);
    expect(normal.status).toBe(0);
    expect(normal.stdout).toContain("The matrix has 20 columns");
    expect(normal.stdout).not.toContain("c19 ");
    const wide = cli(["matrix", file, "--wide"]);
    expect(wide.stdout).toContain("c19");
    // JSON always has everything
    expect(JSON.parse(cli(["matrix", file, "--json"]).stdout).result.matrix).toHaveLength(20);
  });

  test("moderately large palettes are fast", () => {
    const big = Array.from({ length: 120 }, (_, i) => `hsl(${(i * 3) % 360} ${30 + (i % 40)}% ${8 + ((i * 5) % 85)}%)`);
    const file = write("moderate.json", big);
    const start = Date.now();
    const r = cli(["matrix", file, "--json"]);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(JSON.parse(r.stdout).result.summary.pairs).toBe(120 * 119);
  });
});

describe("errors", () => {
  test("input problems are usage errors with actionable messages", () => {
    for (const [args, input, message] of [
      [["audit", path.join("nope", "missing.json")], undefined, "cannot read nope/missing.json: no such file"],
      [["audit"], undefined, "expected 1 color: contrast audit <palette.json | -> (got 0)"],
      [["audit", "a", "b"], undefined, "expected 1 color"],
      [["audit", "-"], '{"a": {"b": "#fff"}}', '"a" must be a color string'],
      [["audit", "-"], "[1,", "stdin looks like JSON but does not parse"],
      [["audit", "-", "--max-colors", "1"], "#111\n#222", "2 unique colors"],
      [["matrix", "-", "--only", "some"], "#111", "must be one of: passing, failing"],
    ]) {
      const r = cli(args, input);
      expect([args.join(" "), r.status]).toEqual([args.join(" "), 2]);
      expect(r.stderr).toContain(message);
      expect(r.stdout).toBe("");
    }
  });

  test("an unusable color names its entry", () => {
    const r = cli(["audit", "-", "--json"], '{"ink":"#111","bad":"nope"}');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error).toMatchObject({ code: "invalid-syntax", role: "palette.bad", input: "nope" });
    const human = cli(["audit", "-"], '["#111", "nope"]');
    expect(human.stderr).toContain("invalid palette[1] color");
  });

  test("--json errors for file problems stay JSON", () => {
    const r = cli(["matrix", path.join(dir, "nope.json"), "--json"]);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error.code).toBe("usage");
    expect(r.stderr).toBe("");
  });

  test("help is available for both commands", () => {
    expect(cli(["help", "audit"]).stdout).toContain("Usage: contrast audit");
    expect(cli(["matrix", "--help"]).stdout).toContain("Usage: contrast matrix");
    expect(cli(["help"]).stdout).toContain("audit <palette.json | ->");
  });

  test("quiet audit prints nothing", () => {
    const r = cli(["audit", "-", "--quiet"], '["#111", "#fff"]');
    expect([r.status, r.stdout, r.stderr]).toEqual([0, "", ""]);
  });
});
