// --json, --quiet, stdin, and the exit-code matrix, through the real binary.
const { describe, test, expect } = require("bun:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

require("../../get-contrast/scripts/ensure-build");

const lib = require("get-contrast");
const run = require("../src/run");
const bin = path.join(__dirname, "..", "bin.js");
const SHAPES = path.join(__dirname, "fixtures", "json-shapes.json");

function spawn(args, { input, env = {} } = {}) {
  const r = spawnSync("node", [bin, ...args], {
    encoding: "utf8",
    input,
    env: { ...process.env, NO_COLOR: "", FORCE_COLOR: "", ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const json = (r) => JSON.parse(r.stdout);
// The library's result as JSON would carry it (drops undefined, freezes nothing).
const asJson = (value) => JSON.parse(JSON.stringify(value));
// Deep equality where numbers may differ in the last bits: the test process
// (Bun/JavaScriptCore) and the spawned CLI (Node/V8) round transcendental
// functions slightly differently. Everything else must match exactly.
function expectClose(actual, expected, where = "$") {
  if (typeof expected === "number" && typeof actual === "number") {
    const tolerance = 1e-9 * Math.max(1, Math.abs(expected));
    if (Math.abs(actual - expected) > tolerance) throw new Error(`${where}: ${actual} != ${expected}`);
    return;
  }
  if (Array.isArray(expected)) {
    expect([where, Array.isArray(actual) ? actual.length : actual]).toEqual([where, expected.length]);
    expected.forEach((v, i) => expectClose(actual[i], v, `${where}[${i}]`));
    return;
  }
  if (expected !== null && typeof expected === "object") {
    expect([where, Object.keys(actual).sort()]).toEqual([where, Object.keys(expected).sort()]);
    for (const k of Object.keys(expected)) expectClose(actual[k], expected[k], `${where}.${k}`);
    return;
  }
  expect([where, actual]).toEqual([where, expected]);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[/;

// path -> type for every leaf, arrays collapsed to []
function shapeOf(value, prefix = "$", out = {}) {
  if (Array.isArray(value)) {
    out[prefix] = "array";
    value.forEach((v) => shapeOf(v, `${prefix}[]`, out));
  } else if (value !== null && typeof value === "object") {
    out[prefix] = "object";
    for (const k of Object.keys(value).sort()) shapeOf(value[k], `${prefix}.${k}`, out);
  } else if (!(prefix in out) || out[prefix] === "null") {
    out[prefix] = value === null ? "null" : typeof value;
  }
  return out;
}

describe("--json matches the library's result objects", () => {
  const cases = [
    ["check", ["check", "#767676", "white"], () => lib.check("#767676", "white")],
    ["check (failing, AAA)", ["check", "#777", "#fff", "--level", "AAA"], () => lib.check("#777", "#fff", { level: "AAA" })],
    ["check (alpha)", ["check", "rgba(0,0,0,.5)", "#fff"], () => lib.check("rgba(0,0,0,.5)", "#fff")],
    ["wcag", ["wcag", "#777", "#fff"], () => lib.wcag("#777", "#fff")],
    ["pick", ["pick", "#fff", "#767676", "#111", "#ddd"], () => lib.pick("#fff", ["#767676", "#111", "#ddd"])],
    ["pick (none pass)", ["pick", "#fff", "#ddd", "#eee"], () => lib.pick("#fff", ["#ddd", "#eee"])],
    ["fix", ["fix", "#777", "#fff"], () => lib.fix("#777", "#fff", { change: "foreground" })],
    ["fix (options)", ["fix", "#ffcc00", "#fff", "--level", "AAA", "--direction", "darker"], () => lib.fix("#ffcc00", "#fff", { level: "AAA", direction: "darker", change: "foreground" })],
    ["fix (unreachable)", ["fix", "#999", "#777", "--level", "AAA"], () => lib.fix("#999", "#777", { level: "AAA", change: "foreground" })],
    ["find", ["find", "#777", "--against", "#fff"], () => lib.find("#777", "#fff", { role: "foreground" })],
  ];

  test.each(cases)("%s", (_, args, expected) => {
    const r = spawn([...args, "--json"]);
    expect(r.stderr).toBe("");
    const doc = json(r); // parses cleanly: stdout is exactly one JSON document
    expect(doc.schema).toBe(1);
    expect(doc.command).toBe(args[0]);
    expect(doc.exitCode).toBe(r.status);
    expectClose(doc.result, asJson(expected()));
    expect(doc.error).toBeUndefined();
    expect(r.stdout.endsWith("}\n")).toBe(true);
  });

  test("the envelope exitCode is the process exit code", () => {
    expect(json(spawn(["check", "#777", "#fff", "--json"])).exitCode).toBe(1);
    expect(spawn(["check", "#777", "#fff", "--json"]).status).toBe(1);
    expect(json(spawn(["check", "#000", "#fff", "--json"])).exitCode).toBe(0);
  });

  test("stdout is only JSON: no ANSI even when color is forced, no warnings or logs", () => {
    const r = spawn(["fix", "#777", "#fff", "--json", "--color"], { env: { FORCE_COLOR: "1" } });
    expect(ANSI.test(r.stdout + r.stderr)).toBe(false);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stderr).toBe("");
  });

  test("--json=true works; --no-json turns it back off", () => {
    expect(() => JSON.parse(spawn(["wcag", "#000", "#fff", "--json=true"]).stdout)).not.toThrow();
    expect(spawn(["wcag", "#000", "#fff", "--json=false"]).stdout).toContain("Contrast ratio");
  });
});

describe("documented JSON shapes are stable", () => {
  // Shapes are the schema contract: a change shows up as a diff of this file.
  // Regenerate deliberately with UPDATE_SHAPES=1 and bump docs/cli.md if breaking.
  const invocations = {
    "check-pass": ["check", "#767676", "white"],
    "check-alpha": ["check", "rgba(0,0,0,.5)", "#fff"],
    wcag: ["wcag", "#777", "#fff"],
    "pick-winner": ["pick", "#fff", "#111", "#767676"],
    "pick-named-stdin": { args: ["pick", "#fff", "-"], input: '[{"name":"ink","color":"#111"},"#767676"]' },
    "fix-changed": ["fix", "#ffcc00", "#fff"],
    "fix-unchanged": ["fix", "#000", "#fff"],
    "fix-unreachable": ["fix", "#999", "#777", "--level", "AAA"],
    "audit-palette": { args: ["audit", "-"], input: '{"ink":"#111","paper":"#fff","white":"white","translucent":"rgb(0 0 0 / .5)"}' },
    "tokens-fail": { args: ["tokens", "-", "--relations", path.join(__dirname, "..", "..", "get-contrast", "test", "fixtures", "tokens", "relations.json")], input: fs.readFileSync(path.join(__dirname, "..", "..", "get-contrast", "test", "fixtures", "tokens", "tokens.json"), "utf8") },
    "error-input": ["check", "nope", "#fff"],
    "error-usage": ["check", "#000"],
  };

  const current = () =>
    Object.fromEntries(
      Object.entries(invocations).map(([name, spec]) => {
        const { args, input } = Array.isArray(spec) ? { args: spec } : spec;
        return [name, shapeOf(json(spawn([...args, "--json"], { input })))];
      })
    );

  test("shapes match the committed fixture", () => {
    if (process.env.UPDATE_SHAPES) fs.writeFileSync(SHAPES, JSON.stringify(current(), null, 2) + "\n");
    const expected = JSON.parse(fs.readFileSync(SHAPES, "utf8"));
    const actual = current();
    for (const name of Object.keys(invocations)) {
      expect([name, actual[name]]).toEqual([name, expected[name]]);
    }
  });

  test("every success envelope has schema, command, exitCode, result; errors have error", () => {
    const shapes = JSON.parse(fs.readFileSync(SHAPES, "utf8"));
    for (const [name, shape] of Object.entries(shapes)) {
      for (const key of ["$.schema", "$.command", "$.exitCode"]) expect(shape[key]).toBeDefined();
      expect(Boolean(shape["$.result"])).toBe(!name.startsWith("error"));
      expect(Boolean(shape["$.error"])).toBe(name.startsWith("error"));
    }
  });
});

describe("--json errors", () => {
  test("unusable colors: JSON error on stdout, nothing on stderr, exit 2", () => {
    const r = spawn(["check", "nope", "#fff", "--json"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("");
    expect(json(r)).toEqual({
      schema: 1,
      command: "check",
      exitCode: 2,
      error: { code: "invalid-syntax", message: "invalid foreground color: not a recognized color", role: "foreground", input: "nope" },
    });
  });

  test("usage errors, even when --json comes after the bad flag", () => {
    for (const args of [["check", "--bogus", "#000", "#fff", "--json"], ["check", "#000", "--json"], ["fix", "#000", "#fff", "--level", "A", "--json"], ["find", "#000", "--json"]]) {
      const r = spawn(args);
      expect(r.status).toBe(2);
      expect(r.stderr).toBe("");
      const doc = json(r);
      expect(doc.exitCode).toBe(2);
      expect(doc.error.code).toBe("usage");
      expect(typeof doc.error.message).toBe("string");
    }
  });

  test("a color error carries the library's error code and role", () => {
    const doc = json(spawn(["fix", "#000", "rgb(from red r g b)", "--json"]));
    expect(doc.error).toMatchObject({ code: "unsupported-function", role: "background" });
  });

  test("unexpected failures are exit 3 with code internal", () => {
    let stdout = "";
    const code = run(
      { ...lib, wcag: () => { throw new Error("boom"); } },
      ["node", "contrast", "wcag", "#000", "#fff", "--json"],
      { stdout: { write: (s) => (stdout += s) }, stderr: { write() {} }, env: {} }
    );
    expect(code).toBe(3);
    expect(JSON.parse(stdout).error).toEqual({ code: "internal", message: "unexpected failure: boom" });
  });

  test("--json and --quiet conflict", () => {
    const r = spawn(["check", "#000", "#fff", "--json", "--quiet"]);
    expect(r.status).toBe(2);
    expect(json(r).error.message).toBe("--json and --quiet cannot be combined");
  });
});

describe("--quiet", () => {
  test("prints nothing on success or failure; the exit code carries the result", () => {
    for (const [args, code] of [
      [["check", "#000", "#fff"], 0],
      [["check", "#777", "#fff"], 1],
      [["wcag", "#000", "#fff"], 0],
      [["pick", "#fff", "#000"], 0],
      [["pick", "#fff", "#eee"], 1],
      [["fix", "#777", "#fff"], 0],
      [["fix", "#999", "#777", "--level", "AAA"], 1],
      [["find", "#777", "--against", "#fff"], 0],
    ]) {
      const r = spawn([...args, "--quiet"]);
      expect([args.join(" "), r.status, r.stdout, r.stderr]).toEqual([args.join(" "), code, "", ""]);
    }
  });

  test("errors are still reported on stderr", () => {
    const r = spawn(["check", "nope", "#fff", "--quiet"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("error: ");
  });

  test("help and version still print when requested", () => {
    expect(spawn(["--version", "--quiet"]).stdout).not.toBe("");
  });
});

describe("stdin for pick", () => {
  test("one color per line, blank lines and CRLF ignored", () => {
    const r = spawn(["pick", "#fff", "-"], { input: "#767676\r\n\r\n#111111\n  #dddddd  \n" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(spawn(["pick", "#fff", "#767676", "#111111", "#dddddd"]).stdout);
  });

  test("a JSON array of colors or { name, color } objects", () => {
    const input = JSON.stringify([{ name: "text/primary", color: "#111" }, "#767676", { color: "#ddd" }]);
    const r = spawn(["pick", "#fff", "-", "--json"], { input });
    const doc = json(r);
    expect(doc.result.winner.name).toBe("text/primary");
    expect(doc.result.ranked.map((c) => c.index)).toEqual([0, 1, 2]);
    expectClose(doc.result, asJson(lib.pick("#fff", [{ name: "text/primary", color: "#111" }, "#767676", { color: "#ddd" }])));
    const human = spawn(["pick", "#fff", "-"], { input });
    expect(human.stdout).toContain("text/primary");
  });

  test("candidates from stdin respect the target flags and exit codes", () => {
    expect(spawn(["pick", "#fff", "-", "--level", "AAA"], { input: "#767676\n#ddd\n" }).status).toBe(1);
    expect(spawn(["pick", "#fff", "-", "--level", "AAA"], { input: "#767676\n#000\n" }).status).toBe(0);
  });

  test("empty, malformed, and conflicting input are usage errors", () => {
    for (const [args, input, message] of [
      [["pick", "#fff", "-"], "", "no candidates on stdin"],
      [["pick", "#fff", "-"], "   \n\n", "no candidates on stdin"],
      [["pick", "#fff", "-"], "[1, 2", "does not parse"],
      [["pick", "#fff", "-", "#000"], "#111", "cannot be combined"],
      [["pick", "-"], "#111", "expected a background and at least one candidate"],
    ]) {
      const r = spawn(args, { input });
      expect([args.join(" "), r.status]).toEqual([args.join(" "), 2]);
      expect(r.stderr).toContain(message);
      expect(r.stdout).toBe("");
    }
  });

  test("an unusable color on stdin names its position", () => {
    const r = spawn(["pick", "#fff", "-", "--json"], { input: "#111\nnope\n" });
    expect(r.status).toBe(2);
    expect(json(r).error).toMatchObject({ code: "invalid-syntax", role: "candidates[1]", input: "nope" });
  });

  test("a terminal on stdin is refused instead of hanging (in-process)", () => {
    let stderr = "";
    const code = run(lib, ["node", "contrast", "pick", "#fff", "-"], {
      stdout: { write() {} },
      stderr: { write: (s) => (stderr += s) },
      env: {},
      stdinIsTTY: true,
      readStdin: () => {
        throw new Error("must not read a terminal");
      },
    });
    expect(code).toBe(2);
    expect(stderr).toContain("stdin is a terminal");
  });

  test("a failing read is a usage-class error, not a crash (in-process)", () => {
    let stderr = "";
    const code = run(lib, ["node", "contrast", "pick", "#fff", "-"], {
      stdout: { write() {} },
      stderr: { write: (s) => (stderr += s) },
      env: {},
      readStdin: () => {
        throw new Error("EIO");
      },
    });
    expect(code).toBe(2);
    expect(stderr).toContain("could not read stdin: EIO");
  });

  test("stdin is not read unless asked for", () => {
    // A command that does not use "-" must not touch stdin (it would block on a pipe).
    const r = spawn(["pick", "#fff", "#000"], { input: undefined });
    expect(r.status).toBe(0);
  });
});

describe("exit-code matrix", () => {
  // Documented in docs/cli.md. 0 success/target met, 1 target not met,
  // 2 usage error or unusable color, 3 unexpected failure.
  const matrix = [
    ["check passes", ["check", "#000", "#fff"], 0],
    ["check fails", ["check", "#777", "#fff"], 1],
    ["check bad color", ["check", "x", "#fff"], 2],
    ["check bad usage", ["check", "#000"], 2],
    ["wcag", ["wcag", "#777", "#fff"], 0],
    ["wcag bad color", ["wcag", "x", "#fff"], 2],
    ["pick winner", ["pick", "#fff", "#000"], 0],
    ["pick none pass", ["pick", "#fff", "#eee"], 1],
    ["pick bad usage", ["pick", "#fff"], 2],
    ["fix already passes", ["fix", "#000", "#fff"], 0],
    ["fix reaches target", ["fix", "#777", "#fff"], 0],
    ["fix unreachable", ["fix", "#999", "#777", "--level", "AAA"], 1],
    ["fix budget-limited", ["fix", "#ffcc00", "#fff", "--max-change", "0.05"], 1],
    ["fix bad option", ["fix", "#777", "#fff", "--direction", "up"], 2],
    ["find reaches target", ["find", "#777", "--against", "#fff"], 0],
    ["find missing --against", ["find", "#777"], 2],
    ["audit", ["audit", "-"], 0],
    ["matrix", ["matrix", "-"], 0],
    ["audit without a palette", ["audit"], 2],
    ["help", ["help", "check"], 0],
    ["help unknown topic", ["help", "nope"], 2],
    ["version", ["--version"], 0],
  ];
  test.each(matrix)("%s -> %d", (_, args, code) => {
    for (const extra of [[], ["--json"]]) {
      const input = args[0] === "audit" || args[0] === "matrix" ? '["#111", "#fff"]' : undefined;
      const r = spawn([...args, ...(args[0] === "help" || args[0] === "--version" ? [] : extra)], { input });
      expect(r.status).toBe(code);
    }
  });

  test("legacy invocation keeps its historical codes", () => {
    expect(spawn(["#000"]).status).toBe(0);
    expect(spawn(["#777"]).status).toBe(1);
    expect(spawn([]).status).toBe(0);
  });
});
