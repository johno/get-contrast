// Tests exercise the built package (index.js -> dist/cjs). Build it when dist/
// is missing so plain `bun test` works from a clean checkout. `bun run test`
// and turbo always rebuild first.
const fs = require("node:fs");
const path = require("node:path");

require("./build-cli");

const pkgRoot = path.join(__dirname, "..");
if (!fs.existsSync(path.join(pkgRoot, "dist", "cjs", "index.js"))) {
  require("./build-ts");
}
