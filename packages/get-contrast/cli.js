#!/usr/bin/env node
// Published `contrast` binary. cli-run.js is copied from packages/cli/src by
// scripts/build-cli.js (the cli package owns the implementation).
require("./cli-run.js")(require("."), process.argv);
