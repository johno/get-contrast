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

/** Version of the --json envelope. Bump only for breaking changes (see docs/cli.md). */
const SCHEMA_VERSION = 1;

/** Maps anything thrown by a command to the documented error object. */
function describeError(lib, error) {
  if (error instanceof UsageError) return { exitCode: EXIT.USAGE, error: { code: "usage", message: error.message } };
  if (lib.ColorInputError && error instanceof lib.ColorInputError) {
    return {
      exitCode: EXIT.USAGE,
      error: { code: error.code, message: error.message, role: error.role, input: error.input },
    };
  }
  if (error instanceof RangeError) return { exitCode: EXIT.USAGE, error: { code: "invalid-option", message: error.message } };
  return {
    exitCode: EXIT.FAILURE,
    error: { code: "internal", message: `unexpected failure: ${error && error.message ? error.message : error}` },
  };
}

/**
 * @param {any} lib the get-contrast library
 * @param {string[]} argv like process.argv: [node, script, ...args]
 * @param {{
 *   stdout: {write(s: string): unknown, isTTY?: boolean},
 *   stderr: {write(s: string): unknown, isTTY?: boolean},
 *   env: Record<string, string | undefined>,
 *   version?: string,
 *   stdinIsTTY?: boolean,
 *   readStdin?: () => string,
 *   readFile?: (path: string) => string,
 * }} [io]
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

  const rest = argv.slice(3);
  // Decided before parsing so even usage errors are reported as JSON when asked.
  const json = rest.includes("--json") || rest.includes("--json=true");

  const style = (stream) => createStyle(colorEnabled({ isTTY: stream.isTTY, env: io.env }, parsedColorFlag));
  let parsedColorFlag;

  /** Report an error: JSON envelope on stdout in --json mode, a line on stderr otherwise. */
  const fail = ({ exitCode, error }, hint) => {
    if (json) {
      out(JSON.stringify({ schema: SCHEMA_VERSION, command: first, exitCode, error }, null, 2));
    } else {
      err(`${style(io.stderr).red("error:")} ${error.message}`);
      if (hint) err(hint);
    }
    return exitCode;
  };
  const usageHint = `Run "contrast help ${first}" for usage.`;

  const parsed = parseArgs(rest, SPECS[first]);
  parsedColorFlag = parsed.flags.color;
  if (parsed.error) return fail({ exitCode: EXIT.USAGE, error: { code: "usage", message: parsed.error } }, usageHint);
  if (parsed.flags.help) {
    out(HELP[first]);
    return EXIT.OK;
  }
  if (parsed.flags.json && parsed.flags.quiet) {
    return fail({ exitCode: EXIT.USAGE, error: { code: "usage", message: "--json and --quiet cannot be combined" } }, usageHint);
  }
  if (parsed.flags.warnings === false) {
    // Honored by the library's warning helper (see docs/legacy-warnings.md).
    io.env.GET_CONTRAST_NO_WARNINGS = "1";
  }

  const readStdin = () => {
    if (io.stdinIsTTY) throw new UsageError("candidates were requested from stdin (-), but stdin is a terminal");
    try {
      return (io.readStdin || (() => require("node:fs").readFileSync(0, "utf8")))();
    } catch (error) {
      throw new UsageError(`could not read stdin: ${error.message}`);
    }
  };

  const readFile = (file) => (io.readFile || ((f) => require("node:fs").readFileSync(f, "utf8")))(file);

  let outcome;
  try {
    outcome = COMMANDS[first](lib, parsed, { readStdin, readFile });
  } catch (error) {
    const described = describeError(lib, error);
    return fail(described, described.exitCode === EXIT.USAGE && !json ? usageHint : undefined);
  }

  if (json) {
    out(JSON.stringify({ schema: SCHEMA_VERSION, command: first, exitCode: outcome.exitCode, result: outcome.result }, null, 2));
  } else if (!parsed.flags.quiet) {
    outcome.human(out, style(io.stdout));
  }
  return outcome.exitCode;
}

module.exports = run;
module.exports.EXIT = EXIT;
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
