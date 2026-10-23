#!/usr/bin/env node
// Starts the MCP server on stdio (workspace development entry point; users run
// `npx get-contrast mcp`).
require("./src/index").serve(require("get-contrast"), { version: require("get-contrast/package.json").version });
