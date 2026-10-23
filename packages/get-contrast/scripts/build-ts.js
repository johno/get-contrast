// Builds dist/cjs (CommonJS) and dist/esm (native ESM) with the workspace
// TypeScript compiler. The ESM entry is src/index.esm.ts, renamed to index.*
// so both builds expose the same `dist/<format>/index.js` layout.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pkgRoot = path.join(__dirname, "..");
const tsc = require.resolve("typescript/bin/tsc", { paths: [pkgRoot] });
const dist = path.join(pkgRoot, "dist");

function compile(config) {
  execFileSync(process.execPath, [tsc, "-p", path.join(pkgRoot, config)], {
    stdio: "inherit",
  });
}

fs.rmSync(dist, { recursive: true, force: true });

compile("tsconfig.build.cjs.json");
compile("tsconfig.build.esm.json");

const esm = path.join(dist, "esm");
for (const ext of [".js", ".d.ts"]) {
  fs.renameSync(path.join(esm, "index.esm" + ext), path.join(esm, "index" + ext));
}
// Marks dist/esm as ES modules without making the package itself "type": "module".
fs.writeFileSync(path.join(esm, "package.json"), JSON.stringify({ type: "module" }) + "\n");
