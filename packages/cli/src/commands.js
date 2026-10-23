// The modern commands. Each takes the library, parsed arguments and a context
// and returns { result, exitCode, human } where `result` is the library's own
// result object (what --json prints), `exitCode` follows the exit-code matrix,
// and `human(out, style)` renders the terminal report. Commands throw
// `UsageError` (or let the library's input errors through) for user mistakes;
// run.js turns those into exit code 2.

const { readPalette, InputError } = require("./palette-input");

const EXIT = Object.freeze({ OK: 0, NOT_MET: 1, USAGE: 2, FAILURE: 3 });

class UsageError extends Error {
  /** @param {string} message @param {string} [code] error.code in --json output */
  constructor(message, code = "usage") {
    super(message);
    this.code = code;
  }
}

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

const PALETTE = {
  "max-colors": { name: "max-colors", type: "string" },
};

const SPECS = {
  tokens: {
    ...SHARED,
    ...TARGET,
    relations: { name: "relations", type: "string" },
    format: { name: "format", type: "string", values: ["json", "css"] },
    scope: { name: "scope", type: "string" },
    candidates: { name: "candidates", type: "string" },
  },
  audit: {
    ...SHARED,
    ...TARGET,
    ...PALETTE,
    only: { name: "only", type: "string", values: ["passing", "failing"] },
    limit: { name: "limit", type: "string" },
  },
  matrix: { ...SHARED, ...TARGET, ...PALETTE, only: { name: "only", type: "string", values: ["passing", "failing"] }, wide: { name: "wide", type: "boolean" } },
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

// Truncate, never round up, so a failing ratio can never print as passing (4.4999 is 4.49).
const fmt = (n) => (Math.floor(n * 100 + 1e-9) / 100).toFixed(2);

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
      out(`Contrast ratio  ${style.bold(`${fmt(r.ratio)}:1`)}  ${style.dim(`(${r.ratio})`)}`);
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

// -- audit / matrix ------------------------------------------------------------

function loadAudit(lib, { positionals, flags }, ctx, usage) {
  needs(positionals, 1, usage);
  let palette;
  try {
    palette = readPalette(positionals[0], ctx);
  } catch (error) {
    if (error instanceof InputError) throw new UsageError(error.message);
    throw error;
  }
  const options = targetOptions(flags);
  if (flags.only) options.only = flags.only;
  const maxColors = number(flags, "max-colors", { min: 1, max: Infinity });
  if (maxColors !== undefined) options.maxColors = maxColors;
  return lib.audit(palette, options);
}

const nameOf = (color) => color.name || color.hex;

function summaryLines(r, style, out) {
  const s = r.summary;
  out(`${style.bold(`${s.colors} colors`)}${s.duplicates ? ` (${s.unique} unique)` : ""}, ${s.pairs} pairs: ${style.pass(`${s.passing} pass`)}, ${s.failing ? style.fail(`${s.failing} fail`) : "0 fail"}`);
  out(style.dim(`Target ${label(r.target)}`));
  for (const color of r.colors) {
    if (color.duplicateOf !== undefined) {
      out(`${style.yellow("note")} ${nameOf(color)} is the same color as ${nameOf(r.colors[color.duplicateOf])}; it is not counted twice.`);
    }
  }
  for (const note of r.notes) out(`${style.yellow("note")} ${note.message}`);
}

function audit(lib, parsed, ctx) {
  const r = loadAudit(lib, parsed, ctx, "contrast audit <palette.json | ->");
  const limit = number(parsed.flags, "limit", { min: 0, max: Infinity }) ?? 25;
  return {
    result: r,
    exitCode: EXIT.OK,
    human(out, style) {
      summaryLines(r, style, out);
      const failing = r.pairs.filter((p) => !p.passes);
      if (failing.length) {
        out("");
        out(style.bold("Pairs that do not meet the target"));
        // Opaque pairs are symmetric: list each combination once.
        const seen = new Set();
        const rows = failing.filter((p) => {
          const key = [p.foreground, p.background].sort().join("-");
          const symmetric = !p.notes;
          if (symmetric && seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const shown = limit === 0 ? rows : rows.slice(0, limit);
        for (const p of shown) {
          out(`  ${nameOf(r.colors[p.foreground])} on ${nameOf(r.colors[p.background])}  ${style.fail(p.ratioText)}`);
        }
        if (shown.length < rows.length) out(style.dim(`  ... and ${rows.length - shown.length} more (--limit 0 shows all, --json has everything)`));
      }
      out("");
      out(style.bold("Best foreground for each background"));
      for (const rec of r.recommendations) {
        const bg = nameOf(r.colors[rec.background]);
        if (rec.best !== null) {
          const pair = r.pairs.find((p) => p.foreground === rec.best && p.background === rec.background);
          const more = rec.candidates.length - 1;
          out(`  on ${bg}: ${style.pass(nameOf(r.colors[rec.best]))} ${fmt(pair.ratio)}:1${more ? style.dim(` (+${more} more)`) : ""}`);
        } else if (rec.closest !== null) {
          out(`  on ${bg}: ${style.fail("none meets the target")}${style.dim(` (closest: ${nameOf(r.colors[rec.closest])})`)}`);
        } else {
          out(`  on ${bg}: ${style.dim("no other colors")}`);
        }
      }
    },
  };
}

const WIDE_LIMIT = 16;

function matrix(lib, parsed, ctx) {
  const r = loadAudit(lib, parsed, ctx, "contrast matrix <palette.json | ->");
  return {
    result: r,
    exitCode: EXIT.OK,
    human(out, style) {
      summaryLines(r, style, out);
      const n = r.unique.length;
      if (n > WIDE_LIMIT && !parsed.flags.wide) {
        out("");
        out(`The matrix has ${n} columns, too wide to read here. Use --wide to print it anyway, --json for the data, or "contrast audit" for a summary.`);
        return;
      }
      if (n < 2) return;
      out("");
      const labels = r.unique.map((i) => nameOf(r.colors[i]).slice(0, 12));
      const width = Math.max(...labels.map((l) => l.length), 7); // 7 fits "(21.00)"
      const cell = (text, painted) => painted + " ".repeat(Math.max(0, width + 1 - text.length));
      out(" ".repeat(width + 1) + labels.map((l) => l.padEnd(width + 1)).join(""));
      r.unique.forEach((fgIndex, a) => {
        const cells = r.unique.map((bgIndex, b) => {
          if (a === b) return cell("-", style.dim("-"));
          const ratio = r.matrix[a][b];
          const passes = ratio >= r.target.threshold;
          const text = passes ? fmt(ratio) : `(${fmt(ratio)})`;
          return cell(text, passes ? style.pass(text) : style.fail(text));
        });
        out(labels[a].padEnd(width + 1) + cells.join(""));
      });
      out("");
      out(style.dim("Rows are the foreground, columns the background. (Parenthesized) ratios do not meet the target."));
    },
  };
}

// -- tokens ------------------------------------------------------------------

function tokens(lib, { positionals, flags }, ctx) {
  needs(positionals, 1, "contrast tokens <tokens-file | -> --relations <relations.json>");
  if (!flags.relations) {
    throw new UsageError("tokens needs --relations <file>: a JSON list of foreground/background token pairs, e.g. [\"text.default -> surface.default\"]");
  }
  if (flags.relations === "-" && positionals[0] === "-") throw new UsageError("only one of the tokens file and --relations can be read from stdin");

  const read = (spec) => (spec === "-" ? ctx.readStdin() : ctx.readFile(spec));
  const readText = (spec, what) => {
    try {
      return read(spec);
    } catch (error) {
      if (error instanceof UsageError) throw error;
      const why = error && error.code === "ENOENT" ? "no such file" : error && error.code === "EISDIR" ? "is a directory" : error.message;
      throw new UsageError(`cannot read ${what} ${spec}: ${why}`);
    }
  };

  const tokenSource = positionals[0];
  const tokenText = readText(tokenSource, "tokens");
  const format = flags.format || (/\.css$/i.test(tokenSource) ? "css" : /\.json$/i.test(tokenSource) ? "json" : undefined);
  let set;
  try {
    set = lib.parseTokens(tokenText, { format, scope: flags.scope });
  } catch (error) {
    if (lib.TokenSourceError && error instanceof lib.TokenSourceError) throw new UsageError(`${tokenSource === "-" ? "stdin" : tokenSource}: ${error.message}`, "invalid-tokens");
    throw error;
  }

  const relationsText = readText(flags.relations, "relations");
  let relations;
  try {
    let data;
    try {
      data = JSON.parse(relationsText);
    } catch (error) {
      throw new UsageError(`${flags.relations}: not valid JSON: ${error.message}`, "invalid-relations");
    }
    relations = lib.parseRelations(data);
  } catch (error) {
    if (lib.RelationError && error instanceof lib.RelationError) throw new UsageError(`${flags.relations}: ${error.message}`, "invalid-relations");
    throw error;
  }

  const options = targetOptions(flags);
  if (flags.candidates) options.candidates = flags.candidates.split(",").map((g) => g.trim()).filter(Boolean);
  const r = lib.auditTokens(set, relations, options);
  const exitCode = r.summary.error ? EXIT.USAGE : r.summary.fail ? EXIT.NOT_MET : EXIT.OK;

  return {
    result: r,
    patch: lib.toJsonPatch(r.edits),
    exitCode,
    human(out, style) {
      const s = r.summary;
      out(`${style.bold(`${s.relations} relation${s.relations === 1 ? "" : "s"}`)} over ${set.tokens.length} ${r.format} tokens: ${style.pass(`${s.pass} pass`)}, ${s.fail ? style.fail(`${s.fail} fail`) : "0 fail"}${s.error ? `, ${style.red(`${s.error} error${s.error === 1 ? "" : "s"}`)}` : ""}`);
      out("");
      for (const rel of r.relations) {
        if (rel.status === "pass") {
          out(`${style.pass("PASS")}  ${rel.name}  ${rel.ratioText}  ${style.dim(`(needs ${rel.target.threshold}:1)`)}`);
        } else if (rel.status === "fail") {
          out(`${style.fail("FAIL")}  ${rel.name}  ${rel.ratioText}  ${style.dim(`(needs ${rel.target.threshold}:1)`)}`);
          out(`      ${style.dim(`${rel.foreground.token} ${rel.foreground.hex} on ${rel.background.token} ${rel.background.hex}`)}`);
          const sug = rel.suggestion;
          if (sug.existing) {
            out(`      Use existing token ${style.bold(sug.existing.token)} (${sug.existing.hex}): ${sug.existing.ratioText}, change ${sug.existing.deltaE.toFixed(2)}`);
            if (sug.alternatives.length) out(`      ${style.dim(`also qualifying: ${sug.alternatives.map((a) => a.token).join(", ")}`)}`);
          } else if (sug.recommended === "synthesized") {
            out(`      No existing token fits (${sug.searched.considered} considered in ${sug.searched.pattern.join(", ")}).`);
            out(`      Suggested new value ${style.bold(sug.synthesized.css)}: ${sug.synthesized.ratioText}, change ${sug.synthesized.deltaE.toFixed(2)}`);
          } else {
            out(`      ${style.red("No fix available.")} ${sug.reason}`);
          }
          if (sug.existing && sug.synthesized && sug.synthesized.reached && sug.synthesized.deltaE < sug.existing.deltaE) {
            out(`      ${style.dim(`(a new color ${sug.synthesized.css} would change less: ${sug.synthesized.deltaE.toFixed(2)})`)}`);
          }
        } else {
          out(`${style.red("ERROR")} ${rel.name}`);
          for (const issue of rel.issues) out(`      ${issue.message}`);
        }
      }
      if (r.edits.length) {
        out("");
        out(style.bold("Suggested edits (nothing was changed; review before applying)"));
        for (const edit of r.edits) {
          const where = edit.source.format === "json" ? edit.source.pointer : `${edit.source.property} in ${edit.source.selector}`;
          out(`  ${edit.token}: ${edit.from} -> ${style.bold(edit.to)}  ${style.dim(`[${where}]`)}`);
        }
        if (r.format === "json") out(style.dim("  --json also emits these as an RFC 6902 patch."));
      }
      for (const note of r.notes) out(`${style.yellow("note")} ${note.message}`);
    },
  };
}

module.exports = { EXIT, UsageError, SPECS, COMMANDS: { check, wcag, pick, find, fix, audit, matrix, tokens } };
