// Dependency guard: get-contrast ships with zero runtime dependencies. Adding
// one must be an explicit decision, made by editing ALLOWED_RUNTIME_DEPENDENCIES
// below with a documented reason, not an accident of an import.
const { test, expect } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");

require("../scripts/ensure-build");

const root = path.join(__dirname, "..");
const pkg = require("../package.json");

// Each entry: { name, reason }. Keep empty unless the maintainers agree.
const ALLOWED_RUNTIME_DEPENDENCIES = [];
const allowed = new Set(ALLOWED_RUNTIME_DEPENDENCIES.map((d) => d.name));

function sourceFiles(dir, exts) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? sourceFiles(path.join(dir, e.name), exts)
        : exts.some((x) => e.name.endsWith(x))
        ? [path.join(dir, e.name)]
        : []
    );
}

test("package.json declares no runtime dependencies beyond the allowlist", () => {
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    expect(Object.keys(pkg[field] || {}).filter((n) => !allowed.has(n))).toEqual([]);
  }
});

test("published code only imports relative modules", () => {
  const files = [
    ...sourceFiles(path.join(root, "src"), [".ts"]),
    ...sourceFiles(path.join(root, "dist"), [".js"]),
    ...sourceFiles(path.join(root, "cli-src"), [".js"]),
    ...["index.js", "warnings.js", "cli.js"].map((f) => path.join(root, f)),
  ];
  const specifier = /(?:require\(\s*|from\s+|import\(\s*)["']([^"']+)["']/g;
  const offenders = [];
  for (const file of files) {
    // Comments may quote import statements as examples; only code counts.
    const text = fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // The CLI runs on Node, so it may use Node built-ins; the library never may
    // (test/consumers.test.js enforces that for src/).
    const isCli = file.startsWith(path.join(root, "cli-src")) || path.basename(file) === "cli.js";
    for (const [, spec] of text.matchAll(specifier)) {
      if (isCli && spec.startsWith("node:")) continue;
      if (!spec.startsWith(".") && !allowed.has(spec)) {
        offenders.push(`${path.relative(root, file)}: ${spec}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
