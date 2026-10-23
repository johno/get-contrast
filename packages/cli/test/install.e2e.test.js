// `contrast skill ...` and `contrast mcp install|uninstall|config`: explicit,
// inspectable, reversible installation, against real temporary directories.
const { describe, test, expect, beforeEach, afterEach } = require("bun:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

require("../../get-contrast/scripts/ensure-build");

const bin = path.join(__dirname, "..", "bin.js");
const published = path.join(__dirname, "..", "..", "get-contrast", "cli.js");
const SKILL = fs.readFileSync(path.join(__dirname, "..", "..", "..", "skills", "get-contrast", "SKILL.md"), "utf8");

let dir;
let home;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "contrast-install-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "contrast-home-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

const cli = (args, { script = bin } = {}) => {
  const r = spawnSync("node", [script, ...args], { encoding: "utf8", cwd: dir, env: { ...process.env, HOME: home, NO_COLOR: "1" } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const tree = (root) => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      out.push(path.relative(root, p) + (e.isDirectory() ? "/" : ""));
      if (e.isDirectory()) walk(p);
    }
  };
  walk(root);
  return out.sort();
};
const skillFile = (base) => path.join(base, "get-contrast", "SKILL.md");

describe("skill install", () => {
  test("nothing is written without a location; the message says what to pass", () => {
    const r = cli(["skill", "install"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("--dir <skills-directory>");
    expect(r.stderr).toContain("--agent claude");
    expect(tree(dir)).toEqual([]);
    expect(tree(home)).toEqual([]);
  });

  test("--dir installs exactly <dir>/get-contrast/SKILL.md and says how to undo it", () => {
    const r = cli(["skill", "install", "--dir", "my-skills"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Installed the skill at");
    expect(r.stdout).toContain("contrast skill uninstall --dir my-skills");
    expect(tree(dir)).toEqual(["my-skills/", "my-skills/get-contrast/", "my-skills/get-contrast/SKILL.md"]);
    expect(fs.readFileSync(skillFile(path.join(dir, "my-skills")), "utf8")).toBe(SKILL);
  });

  test("--agent claude: project folder by default, user folder with --global", () => {
    expect(cli(["skill", "install", "--agent", "claude"]).status).toBe(0);
    expect(fs.existsSync(skillFile(path.join(dir, ".claude", "skills")))).toBe(true);
    expect(tree(home)).toEqual([]);
    expect(cli(["skill", "install", "--agent", "claude", "--global"]).status).toBe(0);
    expect(fs.readFileSync(skillFile(path.join(home, ".claude", "skills")), "utf8")).toBe(SKILL);
  });

  test("--dry-run shows the plan and writes nothing", () => {
    const r = cli(["skill", "install", "--dir", "s", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Dry run: would install the skill");
    expect(r.stdout).toContain("Nothing was written");
    expect(tree(dir)).toEqual([]);
  });

  test("reinstalling is a no-op", () => {
    cli(["skill", "install", "--dir", "s"]);
    const before = fs.statSync(skillFile(path.join(dir, "s"))).mtimeMs;
    const r = cli(["skill", "install", "--dir", "s"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("already installed and up to date");
    expect(fs.statSync(skillFile(path.join(dir, "s"))).mtimeMs).toBe(before);
  });

  test("a different existing SKILL.md is never overwritten without --force", () => {
    const file = skillFile(path.join(dir, "s"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "my own notes\n");
    const refused = cli(["skill", "install", "--dir", "s"]);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("already exists and differs");
    expect(refused.stderr).toContain("--force");
    expect(fs.readFileSync(file, "utf8")).toBe("my own notes\n");
    expect(cli(["skill", "install", "--dir", "s", "--dry-run", "--force"]).stdout).toContain("would update");
    expect(fs.readFileSync(file, "utf8")).toBe("my own notes\n");
    expect(cli(["skill", "install", "--dir", "s", "--force"]).stdout).toContain("Updated the skill");
    expect(fs.readFileSync(file, "utf8")).toBe(SKILL);
  });

  test("other files in the skills folder are untouched", () => {
    fs.mkdirSync(path.join(dir, "s", "other-skill"), { recursive: true });
    fs.writeFileSync(path.join(dir, "s", "other-skill", "SKILL.md"), "other\n");
    cli(["skill", "install", "--dir", "s"]);
    cli(["skill", "uninstall", "--dir", "s"]);
    expect(tree(dir)).toEqual(["s/", "s/other-skill/", "s/other-skill/SKILL.md"]);
    expect(fs.readFileSync(path.join(dir, "s", "other-skill", "SKILL.md"), "utf8")).toBe("other\n");
  });
});

describe("skill uninstall and show", () => {
  test("uninstall removes the file and its folder only", () => {
    cli(["skill", "install", "--dir", "s"]);
    const r = cli(["skill", "uninstall", "--dir", "s"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Removed");
    expect(tree(dir)).toEqual(["s/"]); // the parent we did not need to keep is the user's to remove
  });

  test("uninstall refuses a modified file unless --force, and --dry-run changes nothing", () => {
    cli(["skill", "install", "--dir", "s"]);
    const file = skillFile(path.join(dir, "s"));
    fs.appendFileSync(file, "\nlocal edit\n");
    const refused = cli(["skill", "uninstall", "--dir", "s"]);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("differs from the bundled skill");
    expect(fs.existsSync(file)).toBe(true);
    expect(cli(["skill", "uninstall", "--dir", "s", "--force", "--dry-run"]).stdout).toContain("would remove");
    expect(fs.existsSync(file)).toBe(true);
    expect(cli(["skill", "uninstall", "--dir", "s", "--force"]).status).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
  });

  test("uninstalling something that is not installed is harmless", () => {
    const r = cli(["skill", "uninstall", "--dir", "s"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Nothing to remove");
  });

  test("show prints the bundled skill", () => {
    expect(cli(["skill", "show"]).stdout).toBe(SKILL);
  });

  test("usage errors", () => {
    for (const [args, message] of [
      [["skill"], "expected one of: contrast skill install | uninstall | show"],
      [["skill", "frobnicate"], "expected one of"],
      [["skill", "install", "--dir", "a", "--agent", "claude"], "either --dir or --agent"],
      [["skill", "install", "--agent", "vim"], "must be one of: claude"],
      [["skill", "install", "extra", "--dir", "a"], "expected one of"],
    ]) {
      const r = cli(args);
      expect([args.join(" "), r.status]).toEqual([args.join(" "), 2]);
      expect(r.stderr).toContain(message);
    }
  });

  test("--json describes what happened", () => {
    const doc = JSON.parse(cli(["skill", "install", "--dir", "s", "--json"]).stdout);
    expect(doc).toMatchObject({ schema: 1, command: "skill", exitCode: 0, result: { action: "installed", dryRun: false } });
    expect(doc.result.path).toBe(fs.realpathSync(skillFile(path.join(dir, "s"))));
    expect(JSON.parse(cli(["skill", "install", "--dir", "s", "--json"]).stdout).result.action).toBe("unchanged");
    expect(JSON.parse(cli(["skill", "uninstall", "--dir", "s", "--dry-run", "--json"]).stdout).result.action).toBe("would-remove");
  });
});

describe("mcp config and install", () => {
  const ENTRY = { command: "npx", args: ["-y", "get-contrast", "mcp"] };
  const read = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));

  test("config prints the entry and touches nothing", () => {
    const r = cli(["mcp", "config"]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.split("\n\n")[0])).toEqual({ mcpServers: { "get-contrast": ENTRY } });
    expect(tree(dir)).toEqual([]);
    expect(JSON.parse(cli(["mcp", "config", "--local", "--name", "gc", "--key", "servers"]).stdout.split("\n\n")[0])).toEqual({ servers: { gc: { command: "contrast", args: ["mcp"] } } });
  });

  test("install needs --file and says what to do instead", () => {
    const r = cli(["mcp", "install"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--file <path>");
    expect(r.stderr).toContain("contrast mcp config");
    expect(tree(dir)).toEqual([]);
  });

  test("creates the file when it does not exist", () => {
    expect(cli(["mcp", "install", "--file", "cfg/mcp.json"]).status).toBe(0);
    expect(read("cfg/mcp.json")).toEqual({ mcpServers: { "get-contrast": ENTRY } });
  });

  test("merges into an existing file and preserves everything else, including indentation", () => {
    fs.writeFileSync(path.join(dir, "cfg.json"), '{\n    "theme": "dark",\n    "mcpServers": {\n        "other": { "command": "x" }\n    }\n}\n');
    const r = cli(["mcp", "install", "--file", "cfg.json"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("contrast mcp uninstall --file cfg.json");
    expect(read("cfg.json")).toEqual({ theme: "dark", mcpServers: { other: { command: "x" }, "get-contrast": ENTRY } });
    const text = fs.readFileSync(path.join(dir, "cfg.json"), "utf8");
    expect(text).toContain('\n    "theme"'); // four-space indent kept
    expect(text.endsWith("}\n")).toBe(true);
  });

  test("adds a missing key; --key, --name and --local are honored", () => {
    fs.writeFileSync(path.join(dir, "cfg.json"), '{"editor": 1}');
    expect(cli(["mcp", "install", "--file", "cfg.json", "--key", "servers", "--name", "gc", "--local"]).status).toBe(0);
    expect(read("cfg.json")).toEqual({ editor: 1, servers: { gc: { command: "contrast", args: ["mcp"] } } });
  });

  test("--dry-run prints the resulting file and writes nothing", () => {
    fs.writeFileSync(path.join(dir, "cfg.json"), '{"mcpServers":{}}\n');
    const before = fs.readFileSync(path.join(dir, "cfg.json"), "utf8");
    const r = cli(["mcp", "install", "--file", "cfg.json", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("would become");
    expect(r.stdout).toContain('"get-contrast"');
    expect(r.stdout).toContain("Nothing was written");
    expect(fs.readFileSync(path.join(dir, "cfg.json"), "utf8")).toBe(before);
    expect(cli(["mcp", "install", "--file", "new.json", "--dry-run"]).status).toBe(0);
    expect(fs.existsSync(path.join(dir, "new.json"))).toBe(false);
  });

  test("installing twice changes nothing the second time", () => {
    cli(["mcp", "install", "--file", "cfg.json"]);
    const text = fs.readFileSync(path.join(dir, "cfg.json"), "utf8");
    const r = cli(["mcp", "install", "--file", "cfg.json"]);
    expect(r.stdout).toContain("Nothing to do");
    expect(fs.readFileSync(path.join(dir, "cfg.json"), "utf8")).toBe(text);
  });

  test("a different existing entry is refused without --force", () => {
    fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({ mcpServers: { "get-contrast": { command: "node", args: ["mine.js"] } } }));
    const refused = cli(["mcp", "install", "--file", "cfg.json"]);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("configured differently");
    expect(refused.stderr).toContain("mine.js");
    expect(read("cfg.json").mcpServers["get-contrast"].command).toBe("node");
    expect(cli(["mcp", "install", "--file", "cfg.json", "--force"]).stdout).toContain('Updated "get-contrast"');
    expect(read("cfg.json").mcpServers["get-contrast"]).toEqual(ENTRY);
  });

  test("files that cannot be edited safely are left untouched", () => {
    for (const [content, message] of [
      ['{\n  // my servers\n  "mcpServers": {}\n}\n', "not strict JSON"],
      ["{ broken", "not strict JSON"],
      ["[]", "must contain a JSON object"],
      ['{"mcpServers": []}', '"mcpServers" in'],
      ['{"mcpServers": null}', '"mcpServers" in'],
    ]) {
      fs.writeFileSync(path.join(dir, "bad.json"), content);
      const r = cli(["mcp", "install", "--file", "bad.json"]);
      expect([content, r.status]).toEqual([content, 2]);
      expect(r.stderr).toContain(message);
      expect(fs.readFileSync(path.join(dir, "bad.json"), "utf8")).toBe(content);
    }
  });

  test("writes leave no temporary files behind and follow symlinks instead of replacing them", () => {
    fs.mkdirSync(path.join(dir, "real"));
    fs.writeFileSync(path.join(dir, "real", "mcp.json"), "{}\n");
    fs.symlinkSync(path.join(dir, "real", "mcp.json"), path.join(dir, "link.json"));
    expect(cli(["mcp", "install", "--file", "link.json"]).status).toBe(0);
    expect(fs.lstatSync(path.join(dir, "link.json")).isSymbolicLink()).toBe(true);
    expect(read("real/mcp.json").mcpServers["get-contrast"]).toEqual(ENTRY);
    expect(tree(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("mcp uninstall", () => {
  const read = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));

  test("removes only our entry and leaves the rest as it was", () => {
    fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" } } }, null, 2) + "\n");
    const original = fs.readFileSync(path.join(dir, "cfg.json"), "utf8");
    cli(["mcp", "install", "--file", "cfg.json"]);
    expect(cli(["mcp", "uninstall", "--file", "cfg.json"]).stdout).toContain('Removed "get-contrast"');
    expect(fs.readFileSync(path.join(dir, "cfg.json"), "utf8")).toBe(original); // a perfect round trip
  });

  test("the local entry is also recognized; an empty servers object is left in place", () => {
    cli(["mcp", "install", "--file", "cfg.json", "--local"]);
    expect(cli(["mcp", "uninstall", "--file", "cfg.json"]).status).toBe(0);
    expect(read("cfg.json")).toEqual({ mcpServers: {} });
  });

  test("an entry we did not add is refused unless --force", () => {
    fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({ mcpServers: { "get-contrast": { command: "node", args: ["mine.js"] } } }));
    const refused = cli(["mcp", "uninstall", "--file", "cfg.json"]);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("was not added by get-contrast");
    expect(read("cfg.json").mcpServers["get-contrast"]).toBeDefined();
    expect(cli(["mcp", "uninstall", "--file", "cfg.json", "--force"]).status).toBe(0);
    expect(read("cfg.json").mcpServers).toEqual({});
  });

  test("dry-run, missing file, and missing entry", () => {
    cli(["mcp", "install", "--file", "cfg.json"]);
    const text = fs.readFileSync(path.join(dir, "cfg.json"), "utf8");
    expect(cli(["mcp", "uninstall", "--file", "cfg.json", "--dry-run"]).stdout).toContain("would remove");
    expect(fs.readFileSync(path.join(dir, "cfg.json"), "utf8")).toBe(text);
    expect(cli(["mcp", "uninstall", "--file", "nope.json"]).stdout).toContain("Nothing to remove");
    expect(fs.existsSync(path.join(dir, "nope.json"))).toBe(false);
    expect(cli(["mcp", "uninstall", "--file", "cfg.json", "--name", "other"]).stdout).toContain("Nothing to remove");
  });

  test("needs --file", () => {
    const r = cli(["mcp", "uninstall"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Use --file <path>");
  });
});

describe("published layout", () => {
  test("the shipped binary installs the same skill and config", () => {
    expect(cli(["skill", "install", "--dir", "s"], { script: published }).status).toBe(0);
    expect(fs.readFileSync(skillFile(path.join(dir, "s")), "utf8")).toBe(SKILL);
    expect(cli(["mcp", "install", "--file", "c.json"], { script: published }).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "c.json"), "utf8")).mcpServers["get-contrast"].args).toEqual(["-y", "get-contrast", "mcp"]);
  });

  test("help lists the installation commands", () => {
    expect(cli(["help"]).stdout).toContain("skill install|uninstall|show");
    expect(cli(["help", "skill"]).stdout).toContain("Nothing is written unless you name a");
    expect(cli(["help", "mcp"]).stdout).toContain("Installing is explicit and inspectable");
  });
});
