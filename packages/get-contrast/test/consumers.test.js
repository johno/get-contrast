const { describe, test, expect } = require("bun:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

require("../scripts/ensure-build");

const root = path.join(__dirname, "..");
const pkg = require("../package.json");
const entry = JSON.stringify(root);
const entryFile = JSON.stringify(path.join(root, "index.js"));

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

describe("runtime consumers", () => {
  const cjs = `const c = require(${entry}); console.log(JSON.stringify([Object.keys(c).sort(), c.ratio("#000","#fff"), c.score("#000","#fff"), c.isAccessible("#000","#fff"), c.isNotTransparent("#fff"), "__esModule" in c]))`;
  const expected = JSON.stringify([
    ["isAccessible", "isNotTransparent", "ratio", "score"],
    21,
    "AAA",
    true,
    "rgb(255,255,255)",
    false,
  ]);
  const esm = `import c, { ratio, score } from ${entryFile}; console.log(ratio("#000","#fff"), score("#000","#fff"), typeof c.isAccessible)`;

  test("node: CommonJS require", () => {
    const r = run("node", ["-e", cjs]);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(expected);
  });

  test("bun: CommonJS require", () => {
    const r = run(process.execPath, ["-e", cjs]);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(expected);
  });

  test("node: ESM named and default imports", () => {
    const r = run("node", ["--input-type=module", "-e", esm]);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("21 AAA function");
  });

  test("bun: ESM named and default imports", () => {
    const r = run(process.execPath, ["-e", esm]);
    expect(r.stdout).toBe("21 AAA function");
  });

  test("get-contrast/warnings subpath exports the helper", () => {
    const r = run("node", [
      "-e",
      `const w = require(${JSON.stringify(path.join(root, "warnings"))}); console.log(Object.keys(w).sort().join())`,
    ]);
    expect(r.stdout).toBe("ENV_VAR,configure,reset,warn");
  });
});

describe("generated declarations", () => {
  const dts = (f) => fs.readFileSync(path.join(root, "dist", f), "utf8");

  test("types entry points at generated declarations", () => {
    expect(pkg.types).toBe("dist/index.d.ts");
    expect(fs.existsSync(path.join(root, pkg.types))).toBe(true);
  });

  test("declarations expose exactly the public legacy surface", () => {
    expect(dts("index.d.ts").trim().split("\n")).toEqual([
      'export { ratio, score, isAccessible, isNotTransparent } from "./legacy";',
      'export type { LegacyOptions, LegacyScore } from "./types";',
    ]);
    const legacy = dts("legacy.d.ts");
    expect([...legacy.matchAll(/^export declare function (\w+)\(/gm)].map((m) => m[1])).toEqual([
      "ratio",
      "score",
      "isAccessible",
      "isNotTransparent",
    ]);
    expect(legacy).toContain("): number;");
  });

  test("library source has no Bun- or Node-only APIs", () => {
    for (const f of fs.readdirSync(path.join(root, "src"))) {
      const src = fs.readFileSync(path.join(root, "src", f), "utf8");
      expect(src).not.toMatch(/\bBun\b|from ["']node:|require\(["']node:/);
    }
  });
});
