// `contrast skill ...` and `contrast mcp install|uninstall|config`.
//
// Principles (docs/agents.md): installation is explicit and inspectable, never
// silent. Nothing is written unless you name a target (--dir, --agent, --file);
// existing files are merged or refused, never rewritten wholesale; a different
// existing entry is only replaced with --force; --dry-run shows exactly what
// would happen; uninstall removes only what install added.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EXIT, UsageError } = require("./errors");

const SERVER_ENTRY = { command: "npx", args: ["-y", "get-contrast", "mcp"] };
const LOCAL_ENTRY = { command: "contrast", args: ["mcp"] };

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Writes via a temp file in the same directory, so a failure never leaves a half-written file. */
function writeAtomic(file, text) {
  const target = fs.existsSync(file) ? fs.realpathSync(file) : file; // do not replace a symlink with a file
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, target);
}

// -- skill -------------------------------------------------------------------

const AGENT_DIRS = {
  // Claude Code's project and user skill locations.
  claude: { project: [".claude", "skills"], global: [".claude", "skills"] },
};

function skillsDir(flags, ctx) {
  if (flags.dir && flags.agent) throw new UsageError("use either --dir or --agent, not both");
  if (flags.dir) return path.resolve(ctx.cwd, flags.dir);
  if (flags.agent) {
    const base = flags.global ? ctx.homedir : ctx.cwd;
    return path.join(base, ...AGENT_DIRS[flags.agent][flags.global ? "global" : "project"]);
  }
  throw new UsageError(
    "say where to install the skill. Either --dir <skills-directory> (the skill goes in <dir>/get-contrast/SKILL.md) " +
      "or --agent claude [--global]. Add --dry-run to see what would happen. `contrast skill show` prints the skill text."
  );
}

function skill({ positionals, flags }, ctx) {
  const [sub, ...extra] = positionals;
  if (!["install", "uninstall", "show"].includes(sub) || extra.length) {
    throw new UsageError("expected one of: contrast skill install | uninstall | show");
  }
  const text = ctx.skillText();

  if (sub === "show") {
    return { result: { text }, exitCode: EXIT.OK, human: (out) => out(text.replace(/\n$/, "")) };
  }

  const dir = skillsDir(flags, ctx);
  const file = path.join(dir, "get-contrast", "SKILL.md");
  const exists = fs.existsSync(file);
  const current = exists ? fs.readFileSync(file, "utf8") : null;
  const dry = Boolean(flags["dry-run"]);

  if (sub === "install") {
    if (exists && current !== text && !flags.force) {
      throw new UsageError(`${file} already exists and differs from the bundled skill (a different version or local edits). Re-run with --force to overwrite it, or --dry-run to inspect.`, "conflict");
    }
    const action = !exists ? "install" : current === text ? "unchanged" : "update";
    if (action !== "unchanged" && !dry) writeAtomic(file, text);
    const done = { install: "installed", update: "updated", unchanged: "unchanged" }[action];
    const label = dry && action !== "unchanged" ? `would-${action}` : done;
    return {
      result: { action: label, path: file, dryRun: dry },
      exitCode: EXIT.OK,
      human(out) {
        if (action === "unchanged") out(`The skill is already installed and up to date: ${file}`);
        else out(dry ? `Dry run: would ${action} the skill at ${file} (${text.split("\n").length} lines). Nothing was written.` : `${action === "install" ? "Installed" : "Updated"} the skill at ${file}`);
        if (!dry) out(`Remove it with: contrast skill uninstall ${flags.dir ? `--dir ${flags.dir}` : `--agent ${flags.agent}${flags.global ? " --global" : ""}`}`);
      },
    };
  }

  // uninstall
  if (!exists) {
    return { result: { action: "not-installed", path: file, dryRun: dry }, exitCode: EXIT.OK, human: (out) => out(`Nothing to remove: ${file} does not exist.`) };
  }
  if (current !== text && !flags.force) {
    throw new UsageError(`${file} differs from the bundled skill, so it may have local edits or come from another version. Re-run with --force to remove it anyway.`, "conflict");
  }
  if (!dry) {
    fs.rmSync(file);
    const folder = path.dirname(file);
    if (fs.readdirSync(folder).length === 0) fs.rmdirSync(folder); // only the folder we created, only if empty
  }
  return {
    result: { action: dry ? "would-remove" : "removed", path: file, dryRun: dry },
    exitCode: EXIT.OK,
    human: (out) => out(dry ? `Dry run: would remove ${file}. Nothing was changed.` : `Removed ${file}`),
  };
}

// -- mcp config --------------------------------------------------------------

function snippet(key, name, entry) {
  return JSON.stringify({ [key]: { [name]: entry } }, null, 2);
}

function indentOf(text) {
  const m = /^\{\r?\n([ \t]+)\S/.exec(text);
  return m ? m[1] : "  ";
}

function mcpConfig({ positionals, flags }, ctx) {
  const [sub, ...extra] = positionals;
  if (!["install", "uninstall", "config"].includes(sub) || extra.length) {
    throw new UsageError("expected one of: contrast mcp install | uninstall | config");
  }
  const key = flags.key || "mcpServers";
  const name = flags.name || "get-contrast";
  const entry = flags.local ? LOCAL_ENTRY : SERVER_ENTRY;

  if (sub === "config") {
    const text = snippet(key, name, entry);
    return {
      result: { key, name, entry, snippet: JSON.parse(text) },
      exitCode: EXIT.OK,
      human(out) {
        out(text);
        out("");
        out("Add this to your MCP client's configuration (the file and top-level key vary by client; some, such as VS Code,");
        out("also want an explicit \"type\": \"stdio\"). To merge it into a JSON config file for you: contrast mcp install --file <path>");
      },
    };
  }

  if (!flags.file) {
    throw new UsageError(
      `say which config file to ${sub}. ${sub === "install" ? "Use --file <path> to merge a get-contrast entry into a JSON config (add --dry-run to preview), " : "Use --file <path>, "}or run \`contrast mcp config\` to print the entry and add it yourself.`
    );
  }
  const file = path.resolve(ctx.cwd, flags.file);
  const dry = Boolean(flags["dry-run"]);
  const exists = fs.existsSync(file);
  let data = {};
  let indent = "  ";
  if (exists) {
    const raw = fs.readFileSync(file, "utf8");
    indent = indentOf(raw);
    if (raw.trim() !== "") {
      try {
        data = JSON.parse(raw);
      } catch (error) {
        throw new UsageError(`${file} is not strict JSON (${error.message}); it may contain comments, so it was not touched. Add the entry by hand: contrast mcp config`, "invalid-config");
      }
      if (data === null || typeof data !== "object" || Array.isArray(data)) throw new UsageError(`${file} must contain a JSON object`, "invalid-config");
    }
  }
  const servers = data[key];
  if (servers !== undefined && (servers === null || typeof servers !== "object" || Array.isArray(servers))) {
    throw new UsageError(`"${key}" in ${file} is not an object, so it was not touched`, "invalid-config");
  }
  const present = servers && name in servers ? servers[name] : undefined;
  const render = (value) => JSON.stringify(value, null, indent) + "\n";

  if (sub === "install") {
    if (present !== undefined && !same(present, entry) && !flags.force) {
      throw new UsageError(`${file} already has a "${name}" server configured differently: ${JSON.stringify(present)}. Re-run with --force to replace it, or choose another --name.`, "conflict");
    }
    const action = present === undefined ? "add" : same(present, entry) ? "unchanged" : "update";
    const next = { ...data, [key]: { ...(servers || {}), [name]: entry } };
    if (action !== "unchanged" && !dry) writeAtomic(file, render(next));
    const label = action === "unchanged" ? "unchanged" : dry ? `would-${action}` : action === "add" ? "added" : "updated";
    return {
      result: { action: label, file, key, name, entry, dryRun: dry },
      exitCode: EXIT.OK,
      human(out) {
        if (action === "unchanged") return out(`${file} already has the "${name}" server. Nothing to do.`);
        out(dry ? `Dry run: ${file} would become:` : `${action === "add" ? "Added" : "Updated"} "${name}" in ${file}:`);
        if (dry) out(render(next).replace(/\n$/, ""));
        else out(JSON.stringify({ [name]: entry }, null, 2));
        out(dry ? "Nothing was written." : `Remove it with: contrast mcp uninstall --file ${flags.file}${flags.key ? ` --key ${key}` : ""}${flags.name ? ` --name ${name}` : ""}`);
      },
    };
  }

  // uninstall
  if (present === undefined) {
    return { result: { action: "not-installed", file, key, name, dryRun: dry }, exitCode: EXIT.OK, human: (out) => out(`Nothing to remove: no "${name}" server in ${file}.`) };
  }
  if (!same(present, entry) && !same(present, LOCAL_ENTRY) && !same(present, SERVER_ENTRY) && !flags.force) {
    throw new UsageError(`The "${name}" server in ${file} was not added by get-contrast (${JSON.stringify(present)}). Re-run with --force to remove it anyway.`, "conflict");
  }
  const { [name]: _removed, ...rest } = servers;
  const next = { ...data, [key]: rest };
  if (!dry) writeAtomic(file, render(next));
  return {
    result: { action: dry ? "would-remove" : "removed", file, key, name, dryRun: dry },
    exitCode: EXIT.OK,
    human: (out) => out(dry ? `Dry run: would remove "${name}" from ${file}. Nothing was changed.` : `Removed "${name}" from ${file}`),
  };
}

module.exports = { skill, mcpConfig, AGENT_DIRS, SERVER_ENTRY, LOCAL_ENTRY, homedir: os.homedir };
