const { describe, test, expect } = require("bun:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

require("../scripts/ensure-build");

const root = path.join(__dirname, "..");
const pkg = require("../package.json");
const entry = JSON.stringify(root);
const entryFile = JSON.stringify(path.join(root, "index.js"));
// The public value exports: the compiled CommonJS build is the source of truth.
const exportedNames = Object.keys(require("../dist/cjs/index.js")).filter((k) => k !== "__esModule");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

describe("runtime consumers", () => {
  const cjs = `const c = require(${entry}); console.log(JSON.stringify([Object.keys(c).slice(0, 4), c.ratio("#000","#fff"), c.score("#000","#fff"), c.isAccessible("#000","#fff"), c.isNotTransparent("#fff"), "__esModule" in c]))`;
  const expected = JSON.stringify([
    ["ratio", "score", "isAccessible", "isNotTransparent"],
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

  test("native ESM build: named exports plus default", () => {
    const esmEntry = JSON.stringify(path.join(root, "dist", "esm", "index.js"));
    const r = run("node", [
      "--input-type=module",
      "-e",
      `import c, * as ns from ${esmEntry}; console.log(Object.keys(ns).sort().join(), typeof c.ratio, c.ratio === ns.ratio)`,
    ]);
    expect(r.stderr).toBe("");
    const names = r.stdout.split(" ")[0].split(",");
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(["default", ...exportedNames].sort());
    expect(r.stdout.endsWith(" function true")).toBe(true);
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
  const surface = (s) => [...s.matchAll(/^export declare function (\w+)\(/gm)].map((m) => m[1]);

  test("types entries point at generated declarations", () => {
    expect(pkg.types).toBe("dist/cjs/index.d.ts");
    expect(fs.existsSync(path.join(root, pkg.types))).toBe(true);
    for (const target of [
      pkg.exports["."].import.types,
      pkg.exports["."].require.types,
      pkg.exports["./warnings"].import.types,
      pkg.exports["./warnings"].require.types,
    ]) {
      expect(fs.existsSync(path.join(root, target))).toBe(true);
    }
  });

  test("every public export is present in the CJS entry shim, ESM build, and declarations", () => {
    const shim = Object.keys(require("../index.js"));
    expect([...shim].sort()).toEqual([...exportedNames].sort());
    // the four v3 exports come first, in their original order
    expect(shim.slice(0, 4)).toEqual(["ratio", "score", "isAccessible", "isNotTransparent"]);

    const declared = (file) =>
      [...dts(file).matchAll(/^export (?:declare )?(?:function|const|class) (\w+)/gm)].map((m) => m[1]);
    const reExported = (file) =>
      [...dts(file).matchAll(/^export \{([^}]*)\} from/gm)].flatMap((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean));
    const surface = new Set([...declared("cjs/index.d.ts"), ...reExported("cjs/index.d.ts")]);
    for (const name of exportedNames) expect(surface.has(name)).toBe(true);
  });

  test("legacy declarations are unchanged", () => {
    expect(surface(dts("cjs/legacy.d.ts"))).toEqual([
      "ratio",
      "score",
      "isAccessible",
      "isNotTransparent",
    ]);
    expect(dts("cjs/legacy.d.ts")).toContain("): number;");
  });

  test("ESM declarations add only a default export", () => {
    const esm = dts("esm/index.d.ts");
    expect(esm).toContain("export { ratio, score, isAccessible, isNotTransparent };");
    expect(esm).toContain("export default _default;");
    for (const name of exportedNames) expect(esm).toContain(name);
  });

  test("library source has no Bun- or Node-only APIs", () => {
    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
      );
    const files = walk(path.join(root, "src"));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      expect(fs.readFileSync(file, "utf8")).not.toMatch(/\bBun\b|from ["']node:|require\(["']node:/);
    }
  });
});
