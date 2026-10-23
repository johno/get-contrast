#!/usr/bin/env node
// Published `contrast` binary. cli-src/ is copied from packages/cli/src by
// scripts/build-cli.js (the cli package owns the implementation).
const code = require("./cli-src/run.js")(require("."), process.argv, {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  version: require("./package.json").version,
});
if (code) process.exitCode = code;
