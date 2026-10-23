// Keeps the skill honest: its text is checked for the rules it must follow, and
// its recommended command sequences are replayed against fixture projects by a
// deterministic "agent" (evals/evals.json), so the instructions cannot rot.
const { describe, test, expect } = require("bun:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const repo = path.join(root, "..", "..");
const skill = fs.readFileSync(path.join(root, "SKILL.md"), "utf8");
const flat = skill.replace(/\s+/g, " "); // line wraps removed, for phrase checks
const evals = JSON.parse(fs.readFileSync(path.join(root, "evals", "evals.json"), "utf8"));
const cliBin = path.join(repo, "packages", "cli", "bin.js");

require(path.join(repo, "packages", "get-contrast", "scripts", "ensure-build"));

// -- helpers -----------------------------------------------------------------

function words(command) {
  // Minimal shell-style splitting: whitespace separated, "double" and 'single' quotes.
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(command))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

function get(object, pathExpr) {
  return pathExpr
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .reduce((node, key) => (node === undefined || node === null ? undefined : node[key]), object);
}

// Applies RFC 6902 "replace" operations IN PLACE (text edits), the way an agent
// editing a file would, so unrelated lines and formatting stay untouched.
function applyJsonPatch(text, patch) {
  let result = text;
  for (const { op, path: pointer, value } of patch) {
    expect(op).toBe("replace");
    const keys = pointer.slice(1).split("/").map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    let at = 0;
    for (const key of keys) {
      at = result.indexOf(JSON.stringify(key), at);
      if (at < 0) throw new Error(`${pointer}: key ${key} not found`);
      at += key.length + 2;
    }
    const open = result.indexOf('"', result.indexOf(":", at));
    const close = result.indexOf('"', open + 1);
    result = result.slice(0, open) + JSON.stringify(value) + result.slice(close + 1);
  }
  return result;
}

function applyCssEdit(text, edit) {
  const { selector, property } = edit.source;
  const start = text.indexOf(selector + " {") >= 0 ? text.indexOf(selector + " {") : text.indexOf(selector + "{");
  if (start < 0) throw new Error(`selector ${selector} not found`);
  const declaration = `${property}: ${edit.from};`;
  const at = text.indexOf(declaration, start);
  if (at < 0) throw new Error(`${declaration} not found under ${selector}`);
  return text.slice(0, at) + `${property}: ${edit.to};` + text.slice(at + declaration.length);
}

function changedLines(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  let changed = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) changed++;
  return changed;
}

const template = (text, saved) =>
  text.replace(/\{\{(\w+)\.([^}]+)\}\}/g, (_, name, pathExpr) => String(get(saved[name], pathExpr)));

function playback(task) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `skill-${task.id}-`));
  fs.cpSync(path.join(root, "fixtures", task.fixture), dir, { recursive: true });
  const original = (file) => fs.readFileSync(path.join(root, "fixtures", task.fixture, file), "utf8");
  const saved = {};
  const log = [];
  try {
    task.steps.forEach((step, n) => {
      const label = `${task.id} step ${n + 1}`;
      if (step.run) {
        const args = words(template(step.run, saved));
        expect([label, args[0]]).toEqual([label, "contrast"]);
        const r = spawnSync("node", [cliBin, ...args.slice(1)], { cwd: dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
        log.push(step.run);
        expect([label, step.run, r.status, r.stderr]).toEqual([label, step.run, step.expectExit, r.stderr]);
        // JSON commands must be parseable, with nothing else on stdout.
        const parsed = args.includes("--json") ? JSON.parse(r.stdout) : undefined;
        if (step.save) saved[step.save] = parsed;
        for (const check of step.expect || []) {
          if (check.note && !check.path) continue;
          const value = get(parsed, check.path);
          if ("equals" in check) expect([label, check.path, value]).toEqual([label, check.path, check.equals]);
          if ("matches" in check) expect([label, check.path, new RegExp(check.matches).test(value)]).toEqual([label, check.path, true]);
          if ("greaterThan" in check) expect([label, check.path, value > check.greaterThan]).toEqual([label, check.path, true]);
        }
      } else if (step.applyPatch) {
        const file = path.join(dir, step.applyPatch.file);
        fs.writeFileSync(file, applyJsonPatch(fs.readFileSync(file, "utf8"), saved[step.applyPatch.from].patch));
      } else if (step.applyCssEdits) {
        const file = path.join(dir, step.applyCssEdits.file);
        let text = fs.readFileSync(file, "utf8");
        for (const edit of saved[step.applyCssEdits.from].result.edits) text = applyCssEdit(text, edit);
        fs.writeFileSync(file, text);
      } else if (step.replace) {
        const { file, from, toPrefix = "", toSaved, toSuffix = "" } = step.replace;
        const target = path.join(dir, file);
        const text = fs.readFileSync(target, "utf8");
        expect([label, text.includes(from)]).toEqual([label, true]);
        fs.writeFileSync(target, text.replace(from, toPrefix + get(saved[toSaved.from], toSaved.path) + toSuffix));
      } else if (step.assertChangedLines) {
        const { file, max } = step.assertChangedLines;
        const n2 = changedLines(original(file), fs.readFileSync(path.join(dir, file), "utf8"));
        expect([label, "changed lines", n2 >= 1 && n2 <= max]).toEqual([label, "changed lines", true]);
      } else if (step.assertFlippedToFail) {
        const { base, changed, equals } = step.assertFlippedToFail;
        const flipped = saved[changed].result.relations.filter((r, i) => saved[base].result.relations[i].status === "pass" && r.status !== "pass").map((r) => r.name);
        expect([label, flipped]).toEqual([label, equals]);
      } else {
        throw new Error(`${label}: unknown step ${JSON.stringify(Object.keys(step))}`);
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return log;
}

// -- the skill text ----------------------------------------------------------

describe("SKILL.md", () => {
  const front = skill.match(/^---\n([\s\S]*?)\n---\n/);

  test("has valid frontmatter: name matches the directory, description is useful and short", () => {
    expect(front).not.toBeNull();
    const fields = Object.fromEntries(front[1].split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
    expect(Object.keys(fields).sort()).toEqual(["description", "name"]);
    expect(fields.name).toBe("get-contrast");
    expect(fields.name).toBe(path.basename(root));
    expect(fields.description.length).toBeLessThanOrEqual(1024);
    for (const trigger of ["contrast", "WCAG", "design tokens", "palette", "accessibility"]) expect(fields.description).toContain(trigger);
  });

  test("covers every required workflow", () => {
    for (const heading of ["Check a component", "Fix one failed pair", "Audit a palette", "Audit design tokens", "Review color changes for regressions"]) {
      expect(skill).toContain(`### ${heading}`);
    }
  });

  test("is concise enough for practical agent context", () => {
    expect(skill.split("\n").length).toBeLessThanOrEqual(160);
    expect(skill.split(/\s+/).length).toBeLessThanOrEqual(1500);
  });

  test("never asks the agent to do contrast arithmetic", () => {
    expect(skill).not.toMatch(/0\.2126|0\.7152|0\.0722|relative luminance|\(L1|\bpow\b|Math\./i);
    expect(flat).toContain("Never compute contrast ratios yourself");
  });

  test("treats WCAG 2.2 as normative and APCA only as supplemental, never as compliance", () => {
    expect(skill).toContain("WCAG 2.2 decides compliance");
    const apcaSentences = skill.split(/(?<=[.!?])\s+/).filter((s) => /APCA/.test(s));
    expect(apcaSentences.length).toBeGreaterThan(0);
    for (const sentence of apcaSentences) expect(sentence).toMatch(/not|supplemental|never/i);
  });

  test("encodes the judgment rules", () => {
    for (const rule of ["Look before you invent", "Change as little as possible", "Verify after every change", "Find the real pair first", "keeps hue and chroma"]) {
      expect(flat).toContain(rule);
    }
    expect(flat).toMatch(/prefer a color that already exists/i);
    expect(flat).toContain("Do not recolor a palette to fix one pair");
  });

  test("every CLI command and flag it mentions exists", () => {
    const help = (c) => spawnSync("node", [cliBin, "help", c], { encoding: "utf8" }).stdout;
    const known = ["check", "wcag", "pick", "find", "fix", "audit", "matrix", "tokens"];
    const commands = [...new Set([...skill.matchAll(/`contrast (\w+)/g)].map((m) => m[1]))];
    expect(commands.length).toBeGreaterThan(3);
    for (const c of commands) expect([c, known.includes(c)]).toEqual([c, true]);
    for (const c of commands) expect([c, help(c).includes(`Usage: contrast ${c}`)]).toEqual([c, true]);
    const allHelp = known.map(help).join("\n") + "\n--version";
    for (const flag of new Set(skill.match(/--[a-z][a-z-]+/g))) expect([flag, allHelp.includes(flag)]).toEqual([flag, true]);
  });

  test("names only MCP tools that are planned for the server", () => {
    const tools = [...skill.matchAll(/\| `(\w+)` \|/g)].map((m) => m[1]).filter((t) => t.includes("_"));
    expect(tools.sort()).toEqual(["audit_palette", "audit_tokens", "check_contrast", "check_wcag", "find_accessible_color", "pick_color"]);
  });
});

// -- the skill's workflows, replayed -----------------------------------------

describe("fixture tasks (a scripted agent follows the skill)", () => {
  test("covers every workflow with example prompts", () => {
    expect([...new Set(evals.map((t) => t.workflow))].sort()).toEqual(
      ["Audit a palette", "Audit design tokens", "Check a component", "Fix one failed pair", "Review color changes for regressions"].sort()
    );
    for (const task of evals) {
      expect(typeof task.prompt).toBe("string");
      expect(task.prompt.length).toBeGreaterThan(20);
      expect(fs.existsSync(path.join(root, "fixtures", task.fixture))).toBe(true);
    }
  });

  for (const task of evals) {
    test(`${task.id}: ${task.workflow}`, () => {
      const commands = playback(task);
      expect(commands.length).toBeGreaterThan(0);
      // The scripted agent only ever calls get-contrast; it never computes contrast itself.
      for (const command of commands) expect(command.startsWith("contrast ")).toBe(true);
    }, 60000);
  }

  test("every fix task ends by re-running the check", () => {
    for (const task of evals.filter((t) => t.id.startsWith("fix") || t.id.startsWith("keep") || t.id.startsWith("audit-tokens"))) {
      const last = [...task.steps].reverse().find((s) => s.run);
      expect(last.expectExit).toBe(0);
    }
  });
});
