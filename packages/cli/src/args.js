// A deliberately tiny argument parser: long flags only (`--flag value` or
// `--flag=value`), booleans, positionals, and `--` to end flag parsing.

/**
 * @typedef {{ name: string, type: "string" | "boolean", values?: string[] }} FlagSpec
 * @typedef {{ positionals: string[], flags: Record<string, string | boolean>, error?: string }} Parsed
 */

/**
 * @param {string[]} args
 * @param {Record<string, FlagSpec>} specs keyed by flag name without dashes
 * @returns {Parsed}
 */
function parseArgs(args, specs) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const rawName = arg.slice(2, eq === -1 ? undefined : eq);
    const negated =
      rawName.startsWith("no-") && !specs[rawName] && specs[rawName.slice(3)] && specs[rawName.slice(3)].type === "boolean";
    const name = negated ? rawName.slice(3) : rawName;
    const spec = specs[name];
    if (!spec) return { positionals, flags, error: `unknown option --${rawName}` };

    if (spec.type === "boolean") {
      if (eq !== -1) {
        const value = arg.slice(eq + 1);
        if (value !== "true" && value !== "false") return { positionals, flags, error: `--${name} does not take a value` };
        flags[name] = value === "true";
      } else {
        flags[name] = !negated;
      }
      continue;
    }

    let value;
    if (eq !== -1) value = arg.slice(eq + 1);
    else if (i + 1 < args.length && !(args[i + 1].startsWith("--") && args[i + 1].length > 2)) value = args[++i];
    else return { positionals, flags, error: `--${name} needs a value` };
    if (spec.values && !spec.values.includes(value)) {
      return { positionals, flags, error: `--${name} must be one of: ${spec.values.join(", ")} (got "${value}")` };
    }
    flags[name] = value;
  }
  return { positionals, flags };
}

module.exports = { parseArgs };
