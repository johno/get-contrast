#!/usr/bin/env node
const lib = require("get-contrast");
const code = require("./src/run")(lib, process.argv, {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  version: require("get-contrast/package.json").version,
  stdinIsTTY: Boolean(process.stdin.isTTY),
});
if (code) process.exitCode = code;
