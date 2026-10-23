// Copies the CLI (packages/cli) and MCP server (packages/mcp) implementations
// into this package so the published tarball is self-contained and has no
// dependency on those workspace packages.
const fs = require("node:fs");
const path = require("node:path");

for (const [from, to] of [
  ["cli", "cli-src"],
  ["mcp", "mcp-src"],
]) {
  const src = path.join(__dirname, "..", "..", from, "src");
  const dest = path.join(__dirname, "..", to);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

// The agent skill ships with the package so `contrast skill install` works offline.
const skillSource = path.join(__dirname, "..", "..", "..", "skills", "get-contrast", "SKILL.md");
const skillDest = path.join(__dirname, "..", "skill", "SKILL.md");
fs.mkdirSync(path.dirname(skillDest), { recursive: true });
fs.copyFileSync(skillSource, skillDest);
