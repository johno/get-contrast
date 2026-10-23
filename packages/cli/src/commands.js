// The modern commands. Each takes the library, parsed arguments and an output
// context, and returns an exit code. They never throw for bad user input:
// usage errors and unusable colors are printed and returned as exit code 2.

const EXIT = Object.freeze({ OK: 0, NOT_MET: 1, USAGE: 2, FAILURE: 3 });

class UsageError extends Error {}

const SHARED = {
  color: { name: "color", type: "boolean" },
  warnings: { name: "warnings", type: "boolean" },
  help: { name: "help", type: "boolean" },
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

function check(lib, { positionals, flags }, { out, style }) {
  needs(positionals, 2, "contrast check <foreground> <background>");
  const r = lib.check(positionals[0], positionals[1], targetOptions(flags));
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
  return r.target.passes ? EXIT.OK : EXIT.NOT_MET;
}

// -- wcag --------------------------------------------------------------------

function wcag(lib, { positionals, flags }, { out, style }) {
  needs(positionals, 2, "contrast wcag <foreground> <background>");
  const r = lib.wcag(positionals[0], positionals[1], flags.backdrop ? { backdrop: flags.backdrop } : {});
  out(`Contrast ratio  ${style.bold(`${r.ratio.toFixed(2)}:1`)}  ${style.dim(`(${r.ratio})`)}`);
  out(`Foreground      ${r.foreground.hex}  ${style.dim(`luminance ${r.foreground.luminance.toFixed(4)}`)}`);
  out(`Background      ${r.background.hex}  ${style.dim(`luminance ${r.background.luminance.toFixed(4)}`)}`);
  for (const line of noteLines(r.notes, style)) out(line);
  return EXIT.OK;
}

// -- pick --------------------------------------------------------------------

function pick(lib, { positionals, flags }, { out, style }) {
  if (positionals.length < 2) {
    throw new UsageError("expected a background and at least one candidate: contrast pick <background> <candidate...>");
  }
  const [background, ...candidates] = positionals;
  const r = lib.pick(background, candidates, targetOptions(flags));
  const width = String(r.ranked.length).length;
  for (const entry of r.ranked) {
    const mark = entry.passes ? style.pass("pass") : style.fail("fail");
    out(`${String(entry.rank).padStart(width)}. ${entry.check.foreground.hex}  ${entry.check.ratioText.padStart(8)}  ${mark}  ${style.dim(String(entry.input))}`);
  }
  out("");
  out(r.winner ? `${style.bold("Winner:")} ${r.reason}` : `${style.bold("No winner:")} ${r.reason}`);
  return r.winner ? EXIT.OK : EXIT.NOT_MET;
}

// -- find / fix --------------------------------------------------------------

function report(r, { out, style }) {
  const which = r.adjusted;
  if (!r.changed && r.reached) {
    out(`${style.pass("OK")} ${r.notes[0].message}`);
    return EXIT.OK;
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
    return EXIT.OK;
  }
  out(`${style.fail("Target not met:")} ${label(r.target)} (${r.limitedBy === "max-change" ? "limited by --max-change" : "unreachable"})`);
  return EXIT.NOT_MET;
}

function find(lib, { positionals, flags }, ctx) {
  needs(positionals, 1, "contrast find <color> --against <color>");
  if (!flags.against) throw new UsageError("find needs --against <color>");
  const options = { ...solverOptions(flags), role: flags.role || "foreground" };
  return report(lib.find(positionals[0], flags.against, options), ctx);
}

function fix(lib, { positionals, flags }, ctx) {
  needs(positionals, 2, "contrast fix <foreground> <background>");
  const options = { ...solverOptions(flags), change: flags.change || "foreground" };
  return report(lib.fix(positionals[0], positionals[1], options), ctx);
}

module.exports = { EXIT, UsageError, SPECS, COMMANDS: { check, wcag, pick, find, fix } };
