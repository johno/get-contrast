// The MCP package is a thin adapter: no contrast or color algorithms, no
// filesystem or network access, no dependencies beyond the library.
const { describe, test, expect } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");

const src = path.join(__dirname, "..", "src");
const files = fs.readdirSync(src).filter((f) => f.endsWith(".js"));
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = (file) => strip(fs.readFileSync(path.join(src, file), "utf8"));
const pkg = require("../package.json");

describe("MCP package architecture", () => {
  test("has the expected modules", () => {
    expect(files.sort()).toEqual(["index.js", "schema.js", "server.js", "stdio.js", "tools.js"]);
  });

  test("contains no color or contrast logic", () => {
    for (const file of files) {
      const text = code(file);
      expect([file, /0\.2126|0\.7152|0\.0722|0\.04045|0\.03928|2\.4\b|12\.92|1\.055/.test(text)]).toEqual([file, false]);
      expect([file, /Math\.(pow|cbrt|atan2|hypot|sin|cos|exp|log)\b/.test(text)]).toEqual([file, false]);
      expect([file, /parseColor|relativeLuminance|contrastFromLuminance|convert\(|composite\(|createColor/.test(text)]).toEqual([file, false]);
    }
  });

  test("every number in a tool response comes from the library: tools only call lib.*", () => {
    const calls = new Set([...code("tools.js").matchAll(/\blib\.(\w+)/g)].map((m) => m[1]));
    expect([...calls].sort()).toEqual(["ColorInputError", "RelationError", "TokenSourceError", "audit", "auditTokens", "check", "find", "parseRelations", "parseTokens", "pick", "toJsonPatch", "wcag"]);
  });

  test("is read-only: no filesystem, network, process spawning, or environment access", () => {
    for (const file of files) {
      const text = code(file);
      expect([file, /require\(\s*["'](node:)?(fs|child_process|net|http|https|dns|os|worker_threads)["']/.test(text)]).toEqual([file, false]);
      expect([file, /\b(fetch|XMLHttpRequest|process\.env|writeFile|readFile|unlink|rmSync)\b/.test(text)]).toEqual([file, false]);
    }
  });

  test("requires only its own modules", () => {
    for (const file of files) {
      for (const [, spec] of code(file).matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) expect([file, spec.startsWith("./")]).toEqual([file, true]);
    }
  });

  test("depends on the library only", () => {
    expect(Object.keys(pkg.dependencies)).toEqual(["get-contrast"]);
  });

  test("never writes anything but protocol messages to stdout", () => {
    expect(code("stdio.js")).not.toMatch(/console\.(log|info|debug)/);
    for (const file of files) expect([file, /console\.log/.test(code(file))]).toEqual([file, false]);
  });
});
