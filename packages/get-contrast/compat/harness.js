// Shared by the golden suite and its fixture generator. Records what a call
// to the legacy API does as a single readable string, so fixture diffs are
// one line per behavior change.
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");

// cli.js delegates to cli-run.js, which is copied from packages/cli. Make sure
// it exists so these tests also work when run directly with `bun test`.
require("../scripts/build-cli");

// The "unparseable input" message is the JS engine's own null-dereference
// text (V8 vs JavaScriptCore). Normalize it so fixtures are engine-neutral.
const ENGINE_NULL_MESSAGE =
  /^(Cannot read properties of null \(reading 'match'\)|null is not an object \(evaluating 'color\.match'\))$/;

function describeError(e) {
  const message = ENGINE_NULL_MESSAGE.test(e.message)
    ? "<engine null-dereference>"
    : e.message;
  return `throws ${e.constructor.name}: ${message}`;
}

function observe(fn) {
  try {
    const value = fn();
    return `${typeof value} ${JSON.stringify(value)}`;
  } catch (e) {
    return describeError(e);
  }
}

// Inputs are [label, value] so non-string values stay readable in fixtures.
const NON_STRINGS = [
  ["undefined", undefined],
  ["null", null],
  ["1", 1],
  ["true", true],
  ["{}", {}],
  ["[]", []],
];

const COLORS = [
  "#000",
  "#fff",
  "#FFF",
  "#ffffff",
  "#fafafa",
  "#595959",
  "#767676",
  "#777",
  "#949494",
  "#ff0",
  "#ffff",
  "#ffffff80",
  "  #fff ",
  "rgb(0,0,0)",
  "rgb(255, 255, 255)",
  "RGB(255,0,0)",
  "rgb(10%,20%,30%)",
  "rgba(0,0,0,.75)",
  "rgba(0,0,0,.5)",
  "hsl(0, 100%, 50%)",
  "hsl(0,0%,100%)",
  "hsla(0,100%,50%,.5)",
  "tomato",
  "Tomato",
  "DarkSlateGray",
  "rebeccapurple",
  "white",
  "black",
  "#12345",
];

// Colors that are unparseable, transparent, or otherwise not usable.
const ODD_STRINGS = [
  "transparent",
  "rgba(0,0,0,0)",
  "rgba(0,0,0,0.0)",
  "rgb(0,0,0,0)",
  "hsla(0,100%,50%,0)",
  "hsl(100,100,100,0)",
  "#FFFFFF00",
  "#fff0",
  "",
  "  ",
  "foo",
  "#ff",
  "#ggg",
  " tomato",
  "inherit",
  "currentColor",
  "rgb(300,0,0)",
  "rgb(255 255 255)",
  "rgb(0 0 0 / 50%)",
  "hsl(0 100% 50%)",
  "hwb(0 0% 0%)",
  "lab(50% 0 0)",
  "oklch(0.5 0.1 100)",
  "color(srgb 1 0 0)",
];

const OPTIONS = [
  ["none", undefined],
  ["ignoreAlpha", { ignoreAlpha: true }],
];

function key(fn, args) {
  const shown = args.map((a) => (typeof a === "string" ? JSON.stringify(a) : a === undefined ? "undefined" : JSON.stringify(a)));
  return `${fn}(${shown.join(", ")})`;
}

function buildApiFixture(contrast) {
  const out = {};
  const record = (fn, args) => {
    out[key(fn, args)] = observe(() => contrast[fn](...args));
  };

  // Full ordered matrix over usable colors, for the three pair functions.
  for (const fn of ["ratio", "score", "isAccessible"]) {
    for (const a of COLORS) {
      for (const b of COLORS) record(fn, [a, b]);
    }
  }

  // Odd strings against a fixed partner, both positions, with and without
  // ignoreAlpha.
  for (const fn of ["ratio", "score", "isAccessible"]) {
    for (const odd of ODD_STRINGS) {
      for (const [, opts] of OPTIONS) {
        const tail = opts ? [opts] : [];
        record(fn, [odd, "#fff", ...tail]);
        record(fn, ["#fff", odd, ...tail]);
      }
    }
  }

  // Non-string values.
  for (const fn of ["ratio", "score", "isAccessible"]) {
    for (const [, v] of NON_STRINGS) {
      out[`${fn}(<${describe(v)}>, "#fff")`] = observe(() => contrast[fn](v, "#fff"));
      out[`${fn}("#fff", <${describe(v)}>)`] = observe(() => contrast[fn]("#fff", v));
    }
    out[`${fn}()`] = observe(() => contrast[fn]());
    out[`${fn}("#000")`] = observe(() => contrast[fn]("#000"));
  }

  // Options handling.
  out['ratio("#000", "#fff", null)'] = observe(() => contrast.ratio("#000", "#fff", null));
  out['ratio("#000", "#fff", {})'] = observe(() => contrast.ratio("#000", "#fff", {}));
  out['ratio("#000", "#fff", {}, "extra")'] = observe(() => contrast.ratio("#000", "#fff", {}, "extra"));

  // isNotTransparent over every input.
  for (const c of [...COLORS, ...ODD_STRINGS]) {
    for (const [, opts] of OPTIONS) {
      const args = opts ? [c, opts] : [c];
      record("isNotTransparent", args);
    }
  }
  for (const [, v] of NON_STRINGS) {
    out[`isNotTransparent(<${describe(v)}>)`] = observe(() => contrast.isNotTransparent(v));
  }
  out["isNotTransparent()"] = observe(() => contrast.isNotTransparent());

  return out;
}

function describe(v) {
  if (v === undefined) return "undefined";
  return JSON.stringify(v);
}

const CLI_CASES = [
  [],
  ["#000"],
  ["#000", "#fff"],
  ["#fff", "#000"],
  ["white"],
  ["#ff0", "#fff"],
  ["#777"],
  ["#767676"],
  ["tomato", "DarkSlateGray"],
  ["#000", "#fff", "extra"],
  ["", "#fff"],
  ["#000", ""],
  ["foo"],
  ["#000", "foo"],
  ["transparent"],
  ["rgba(0,0,0,0)"],
  ["rgb(0 0 0)"],
];

function runCli(args) {
  const r = spawnSync("node", [path.join(root, "cli.js"), ...args], { encoding: "utf8" });
  // Uncaught exceptions print a source excerpt and stack trace with paths and
  // engine-specific wording. Only the "TypeError: ..." line is contractual.
  let stderr = r.stderr;
  const m = stderr.match(/^(\w*Error): (.*)$/m);
  if (m) {
    stderr = `${describeError({ constructor: { name: m[1] }, message: m[2] })} (stack trace omitted)\n`;
  }
  return { status: r.status, stdout: r.stdout, stderr };
}

function buildCliFixture() {
  const out = {};
  for (const args of CLI_CASES) {
    out[`contrast ${args.map((a) => JSON.stringify(a)).join(" ")}`.trim()] = runCli(args);
  }
  return out;
}

module.exports = { root, buildApiFixture, buildCliFixture, observe };
