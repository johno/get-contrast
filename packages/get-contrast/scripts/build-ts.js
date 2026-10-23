// Compiles src/ to dist/ with the workspace TypeScript compiler.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const pkgRoot = path.join(__dirname, "..");
const tsc = require.resolve("typescript/bin/tsc", { paths: [pkgRoot] });

execFileSync(process.execPath, [tsc, "-p", path.join(pkgRoot, "tsconfig.json")], {
  stdio: "inherit",
});
