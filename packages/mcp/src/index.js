const { createServer } = require("./server");
const { serveStdio } = require("./stdio");
const { build } = require("./tools");

const INSTRUCTIONS =
  "get-contrast checks color contrast against WCAG 2.2. Use check_contrast to verify a foreground/background pair, " +
  "pick_color to prefer an existing palette or token value, find_accessible_color for the smallest change that passes, " +
  "and audit_palette / audit_tokens for sets of colors. All tools are read-only. A pair that fails WCAG is a normal result " +
  "(status \"fail\"); isError means the input was invalid or the tool failed. Always re-run a check after changing a color.";

/** @param {any} lib the get-contrast library @param {{ version?: string }} [options] */
function createContrastServer(lib, options = {}) {
  return createServer({ name: "get-contrast", version: options.version || "0.0.0", instructions: INSTRUCTIONS, tools: build(lib, options.version) });
}

/** Runs the server on stdio until the input closes. */
function serve(lib, { input = process.stdin, output = process.stdout, error = process.stderr, version, onClose } = {}) {
  serveStdio(createContrastServer(lib, { version }), { input, output, error, onClose });
}

module.exports = { createContrastServer, serve };
