// The modern commands. Each takes the library, parsed arguments and a context
// and returns { result, exitCode, human } where `result` is the library's own
// result object (what --json prints), `exitCode` follows the exit-code matrix,
// and `human(out, style)` renders the terminal report. Commands throw
// `UsageError` (or let the library's input errors through) for user mistakes;
// run.js turns those into exit code 2.

const EXIT = Object.freeze({ OK: 0, NOT_MET: 1, USAGE: 2, FAILURE: 3 });

class UsageError extends Error {}

const SHARED = {
  color: { name: "color", type: "boolean" },
  warnings: { name: "warnings", type: "boolean" },
  help: { name: "help", type: "boolean" },
  json: { name: "json", type: "boolean" },
  quiet: { name: "quiet", type: "boolean" },
};
const TARGET = {
  level: { name: "level", type: "string", values: ["AA", "AAA"] },
  use: { name: "use", type: "string", values: ["text", "large-text", "ui"] },
  "min-ratio": { name: "min-ratio", type: "string" },
  backdrop: { name: "backdrop", type: "string" },
};
const SOLVER = {
  direction: { name: "direction", type: "string", values: ["auto", "darker", "lighter"] },
  "preserve-chroma": { name: "preserve-chroma", type: "boolean" },
  gamut: { name: "gamut", type: "string", values: ["srgb", "display-p3"] },
  "max-change": { name: "max-change", type: "string" },
};

const SPECS = {
  check: { ...SHARED, ...TARGET },
  wcag: { ...SHARED, backdrop: TARGET.backdrop },
  pick: { ...SHARED, ...TARGET },
  find: {
    ...SHARED,
    ...TARGET,
    ...SOLVER,
    against: { name: "against", type: "string" },
    role: { name: "role", type: "string", values: ["foreground", "background"] },
  },
  fix: {
    ...SHARED,
    ...TARGET,
    ...SOLVER,
    change: { name: "change", type: "string", values: ["foreground", "background"] },
  },
};

function number(flags, name, { min, max }) {
  if (flags[name] === undefined) return undefined;
  const value = Number(flags[name]);
  if (!Number.isFinite(value) || value < min || value > max) {
    const range = max === Infinity ? `at least ${min}` : `between ${min} and ${max}`;
    throw new UsageError(`--${name} must be a number ${range} (got "${flags[name]}")`);
  }
  return value;
}

function targetOptions(flags) {
  const options = {};
  if (flags.level) options.level = flags.level;
  if (flags.use) options.use = flags.use;
  const minRatio = number(flags, "min-ratio", { min: 1, max: 21 });
  if (minRatio !== undefined) options.minRatio = minRatio;
  if (flags.backdrop) options.backdrop = flags.backdrop;
  return options;
}

function solverOptions(flags) {
  const options = targetOptions(flags);
  if (flags.direction) options.direction = flags.direction;
  if (flags["preserve-chroma"] === false) options.preserveChroma = false;
  if (flags.gamut) options.gamut = flags.gamut;
  const maxChange = number(flags, "max-change", { min: 0, max: Infinity });
  if (maxChange !== undefined) options.maxChange = maxChange;
  return options;
}

function needs(positionals, count, usage) {
  if (positionals.length !== count) {
    throw new UsageError(`expected ${count} color${count === 1 ? "" : "s"}: ${usage} (got ${positionals.length})`);
  }
}

const label = (target) =>
  target.custom ? `custom ${target.threshold}:1` : `${target.level} ${target.use === "large-text" ? "large text" : target.use === "ui" ? "UI components" : "text"} (${target.threshold}:1)`;

function noteLines(notes, style) {
  return notes.map((n) => `${style.yellow("note")} ${n.message}`);
}

// -- check -------------------------------------------------------------------

function check(lib, { positionals, flags }) {
  needs(positionals, 2, "contrast check <foreground> <background>");
  const r = lib.check(positionals[0], positionals[1], targetOptions(flags));
  return {
    result: r,
    exitCode: r.target.passes ? EXIT.OK : EXIT.NOT_MET,
    human(out, style) {
      const row = (name, ok, needsText) => `  ${name.padEnd(18)}${ok ? style.pass() : style.fail()}   ${style.dim(`needs ${needsText}`)}`;
      out(`${style.bold(r.foreground.hex)} on ${style.bold(r.background.hex)}`);
      out(`Contrast ratio  ${style.bold(r.ratioText)}`);
      out("");
      out(row("AA  text", r.results.aa.text, "4.5:1"));
      out(row("AA  large text", r.results.aa.largeText, "3:1"));
      out(row("AAA text", r.results.aaa.text, "7:1"));
      out(row("AAA large text", r.results.aaa.largeText, "4.5:1"));
      out(row("UI components", r.results.ui, "3:1"));
      out("");
      out(`Target ${label(r.target)}: ${r.target.passes ? style.pass("PASS") : style.fail("FAIL")}`);
      for (const line of noteLines(r.notes, style)) out(line);
    },
  };
}

// -- wcag --------------------------------------------------------------------

function wcag(lib, { positionals, flags }) {
  needs(positionals, 2, "contrast wcag <foreground> <background>");
  const r = lib.wcag(positionals[0], positionals[1], flags.backdrop ? { backdrop: flags.backdrop } : {});
  return {
    result: r,
    exitCode: EXIT.OK,
    human(out, style) {
      out(`Contrast ratio  ${style.bold(`${r.ratio.toFixed(2)}:1`)}  ${style.dim(`(${r.ratio})`)}`);
      out(`Foreground      ${r.foreground.hex}  ${style.dim(`luminance ${r.foreground.luminance.toFixed(4)}`)}`);
      out(`Background      ${r.background.hex}  ${style.dim(`luminance ${r.background.luminance.toFixed(4)}`)}`);
      for (const line of noteLines(r.notes, style)) out(line);
    },
  };
}

// -- pick --------------------------------------------------------------------

/**
 * Candidates from stdin: a JSON array of colors or { name, color } objects, or
 * one color per line (blank lines ignored).
 */
function candidatesFromStdin(text) {
  const trimmed = text.trim();
  if (trimmed === "") throw new UsageError("no candidates on stdin");
  if (trimmed.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new UsageError(`stdin looks like JSON but does not parse: ${error.message}`);
    }
    if (!Array.isArray(parsed)) throw new UsageError("stdin JSON must be an array of colors");
    return parsed;
  }
  return trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function pick(lib, { positionals, flags }, ctx) {
  const [background, ...rest] = positionals;
  let candidates = rest;
  if (rest.includes("-")) {
    if (rest.length !== 1) throw new UsageError('"-" (read candidates from stdin) cannot be combined with other candidates');
    candidates = candidatesFromStdin(ctx.readStdin());
  }
  if (!background || candidates.length === 0) {
    throw new UsageError("expected a background and at least one candidate: contrast pick <background> <candidate...>");
  }
  const r = lib.pick(background, candidates, targetOptions(flags));
  return {
    result: r,
    exitCode: r.winner ? EXIT.OK : EXIT.NOT_MET,
    human(out, style) {
      const width = String(r.ranked.length).length;
      for (const entry of r.ranked) {
        const mark = entry.passes ? style.pass("pass") : style.fail("fail");
        const shown = entry.name ? `${entry.name} ${style.dim(String(entry.input.color || entry.input))}` : style.dim(String(entry.input));
        out(`${String(entry.rank).padStart(width)}. ${entry.check.foreground.hex}  ${entry.check.ratioText.padStart(8)}  ${mark}  ${shown}`);
      }
      out("");
      out(r.winner ? `${style.bold("Winner:")} ${r.reason}` : `${style.bold("No winner:")} ${r.reason}`);
    },
  };
}

// -- find / fix --------------------------------------------------------------

function report(r) {
  const which = r.adjusted;
  const exitCode = r.reached ? EXIT.OK : EXIT.NOT_MET;
  return {
    result: r,
    exitCode,
    human(out, style) {
      if (!r.changed && r.reached) {
        out(`${style.pass("OK")} ${r.notes[0].message}`);
        return;
      }
      if (r.suggested) {
        out(`${style.bold("Suggested")} ${style.bold(r.suggested.css)}  ${style.dim(`(was ${r.original.check[which].hex})`)}`);
        out(`Contrast  ${r.suggested.check.ratioText}  ${style.dim(`(was ${r.original.check.ratioText})`)}`);
        const dims = r.change.dimensions.length ? r.change.dimensions.join(", ") : "within rounding";
        out(`Change    ${r.change.deltaE.toFixed(3)} perceptual distance  ${style.dim(`(${dims})`)}`);
      } else {
        out(`${style.fail("No suggestion")} (${r.original.check.ratioText}, target ${label(r.target)})`);
      }
      for (const line of noteLines(r.notes, style)) out(line);
      if (r.reached) {
        out(`${style.pass("Target met:")} ${label(r.target)}`);
      } else {
        out(`${style.fail("Target not met:")} ${label(r.target)} (${r.limitedBy === "max-change" ? "limited by --max-change" : "unreachable"})`);
      }
    },
  };
}

function find(lib, { positionals, flags }) {
  needs(positionals, 1, "contrast find <color> --against <color>");
  if (!flags.against) throw new UsageError("find needs --against <color>");
  const options = { ...solverOptions(flags), role: flags.role || "foreground" };
  return report(lib.find(positionals[0], flags.against, options));
}

function fix(lib, { positionals, flags }) {
  needs(positionals, 2, "contrast fix <foreground> <background>");
  const options = { ...solverOptions(flags), change: flags.change || "foreground" };
  return report(lib.fix(positionals[0], positionals[1], options));
}

module.exports = { EXIT, UsageError, SPECS, COMMANDS: { check, wcag, pick, find, fix } };
