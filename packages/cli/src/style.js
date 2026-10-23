// Terminal styling that only happens when it should: never when output is
// piped, when NO_COLOR is set, or when the terminal is "dumb". `--color` /
// `--no-color` and FORCE_COLOR override.

/**
 * @param {{ isTTY: boolean, env: Record<string, string | undefined> }} stream
 * @param {boolean | undefined} flag value of --color (undefined when not given)
 */
function colorEnabled(stream, flag) {
  if (flag !== undefined) return flag;
  const env = stream.env;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0") return true;
  if (env.TERM === "dumb") return false;
  return Boolean(stream.isTTY);
}

const CODES = { bold: [1, 22], dim: [2, 22], red: [31, 39], green: [32, 39], yellow: [33, 39] };

function createStyle(enabled) {
  const paint = (name) => (text) => (enabled ? `\u001b[${CODES[name][0]}m${text}\u001b[${CODES[name][1]}m` : String(text));
  return {
    enabled,
    bold: paint("bold"),
    dim: paint("dim"),
    red: paint("red"),
    green: paint("green"),
    yellow: paint("yellow"),
    pass: (text = "pass") => paint("green")(text),
    fail: (text = "fail") => paint("red")(text),
  };
}

module.exports = { colorEnabled, createStyle };
