// Copies the CLI implementation owned by packages/cli into this package so the
// published tarball is self-contained and has no dependency on the cli package.
const fs = require("node:fs");
const path = require("node:path");

const src = path.join(__dirname, "..", "..", "cli", "src");
const dest = path.join(__dirname, "..", "cli-src");
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
