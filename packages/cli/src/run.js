// The `contrast` command. `run` is a pure function of its inputs: the library
// is injected (the workspace package here, the sibling index.js inside the
// published tarball) and so is all I/O, which keeps it testable in-process.
// It returns the exit code instead of exiting.
const { runLegacy } = require("./legacy");
const { parseArgs } = require("./args");
const { colorEnabled, createStyle } = require("./style");
const { EXIT, UsageError, SPECS, COMMANDS } = require("./commands");
const { HELP, mainHelp } = require("./help");

const MODERN = Object.keys(COMMANDS);

function defaultIo() {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    version: undefined,
  };
}

/**
 * @param {any} lib the get-contrast library
 * @param {string[]} argv like process.argv: [node, script, ...args]
 * @param {{ stdout: {write(s: string): unknown, isTTY?: boolean}, stderr: {write(s: string): unknown, isTTY?: boolean}, env: Record<string, string | undefined>, version?: string }} [io]
 * @returns {number} exit code
 */
function run(lib, argv, io = defaultIo()) {
  const first = argv[2];
  const isCommand = MODERN.includes(first) || first === "help";
  const isMeta = first === "--help" || first === "-h" || first === "--version" || first === "-v";

  // Anything else is the historical invocation: contrast <color1> [color2].
  if (!isCommand && !isMeta) return runLegacy(lib, argv, io);

  const out = (line = "") => io.stdout.write(line + "\n");
  const err = (line = "") => io.stderr.write(line + "\n");

  if (first === "--version" || first === "-v") {
    out(io.version || "unknown");
    return EXIT.OK;
  }
  if (first === "--help" || first === "-h" || (first === "help" && argv.length <= 3)) {
    out(mainHelp(io.version));
    return EXIT.OK;
  }
  if (first === "help") {
    const topic = argv[3];
    if (!HELP[topic]) {
      err(`error: no help for "${topic}". Commands: ${MODERN.join(", ")}`);
      return EXIT.USAGE;
    }
    out(HELP[topic]);
    return EXIT.OK;
  }

  const parsed = parseArgs(argv.slice(3), SPECS[first]);
  if (parsed.error) {
    err(`error: ${parsed.error}`);
    err(`Run "contrast help ${first}" for usage.`);
    return EXIT.USAGE;
  }
  if (parsed.flags.help) {
    out(HELP[first]);
    return EXIT.OK;
  }
  if (parsed.flags.warnings === false) {
    // Honored by the library's warning helper (see docs/legacy-warnings.md).
    io.env.GET_CONTRAST_NO_WARNINGS = "1";
  }

  const style = createStyle(colorEnabled({ isTTY: io.stdout.isTTY, env: io.env }, parsed.flags.color));
  const errStyle = createStyle(colorEnabled({ isTTY: io.stderr.isTTY, env: io.env }, parsed.flags.color));

  try {
    return COMMANDS[first](lib, parsed, { out, style });
  } catch (error) {
    if (error instanceof UsageError) {
      err(`${errStyle.red("error:")} ${error.message}`);
      err(`Run "contrast help ${first}" for usage.`);
      return EXIT.USAGE;
    }
    if (lib.ColorInputError && error instanceof lib.ColorInputError) {
      err(`${errStyle.red("error:")} ${error.message}`);
      return EXIT.USAGE;
    }
    if (error instanceof RangeError) {
      err(`${errStyle.red("error:")} ${error.message}`);
      return EXIT.USAGE;
    }
    err(`${errStyle.red("error:")} unexpected failure: ${error && error.message ? error.message : error}`);
    return EXIT.FAILURE;
  }
}

module.exports = run;
module.exports.EXIT = EXIT;
