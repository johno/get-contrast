// End to end: a scripted agent follows the skill's flow on a small app, once
// through the CLI and once through the MCP server, and both must finish with the
// same clean, structured result. The agent never computes contrast: every number
// in its report is read from a tool response.
const { describe, test, expect } = require("bun:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repo = path.join(__dirname, "..", "..", "..");
const cliBin = path.join(repo, "packages", "cli", "bin.js");
const mcpBin = path.join(repo, "packages", "mcp", "bin.js");
const { McpClient } = require(path.join(repo, "packages", "mcp", "test", "helpers.js"));
require(path.join(repo, "packages", "get-contrast", "scripts", "ensure-build"));

const FIXTURE = path.join(__dirname, "..", "fixtures", "e2e-app");

function applyJsonPatch(text, patch) {
  let result = text;
  for (const { path: pointer, value } of patch) {
    const keys = pointer.slice(1).split("/").map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    let at = 0;
    for (const key of keys) {
      at = result.indexOf(JSON.stringify(key), at);
      at += key.length + 2;
    }
    const open = result.indexOf('"', result.indexOf(":", at));
    const close = result.indexOf('"', open + 1);
    result = result.slice(0, open) + JSON.stringify(value) + result.slice(close + 1);
  }
  return result;
}

// -- two drivers with the same shape: audit(tokensText, relations) -> data -----

function cliDriver(dir) {
  return {
    name: "CLI",
    async audit(tokensText, relations) {
      const relationsFile = path.join(dir, "relations.json");
      fs.writeFileSync(relationsFile, JSON.stringify(relations));
      const r = spawnSync("node", [cliBin, "tokens", "-", "--relations", relationsFile, "--json"], { input: tokensText, encoding: "utf8", cwd: dir });
      const doc = JSON.parse(r.stdout);
      return { ok: r.status === 0, status: r.status === 0 ? "pass" : r.status === 1 ? "fail" : "error", result: doc.result, patch: doc.patch };
    },
    async close() {},
  };
}

function mcpDriver() {
  const client = new McpClient([mcpBin]);
  const ready = client.initialize();
  return {
    name: "MCP",
    async audit(tokensText, relations) {
      await ready;
      const response = await client.call("audit_tokens", { tokens: tokensText, relations });
      const s = response.structuredContent;
      return { ok: s.status === "pass", status: s.status, result: s.result, patch: s.patch };
    },
    async close() {
      await client.close();
    },
  };
}

/** The scripted agent. Returns the final tokens text and a report built only from tool output. */
async function runAgent(driver, dir) {
  const tokensFile = path.join(dir, "src", "tokens.json");
  const relations = JSON.parse(fs.readFileSync(path.join(dir, "relations.json"), "utf8"));
  const log = [];

  // 1. Discover the failure.
  let tokensText = fs.readFileSync(tokensFile, "utf8");
  const first = await driver.audit(tokensText, relations);
  log.push(`audit -> ${first.status}`);
  expect(first.status).toBe("fail");
  const failing = first.result.relations.filter((r) => r.status === "fail");
  expect(failing.length).toBeGreaterThan(0);

  // 2. Inspect existing tokens (the agent reads the file; it does not guess).
  const known = JSON.parse(tokensText);
  expect(Object.keys(known)).toContain("text");

  // 3 + 4. Prefer an existing passing token; otherwise take the constrained synthesized fix.
  const choices = failing.map((rel) => ({
    relation: rel.name,
    token: rel.foreground.token,
    from: rel.foreground.written,
    kind: rel.suggestion.recommended,
    to: rel.suggestion.edit.to,
    ratioBefore: rel.ratioText,
    ratioAfter: rel.suggestion.after.ratioText,
  }));
  tokensText = applyJsonPatch(tokensText, first.patch);
  fs.writeFileSync(tokensFile, tokensText);

  // 5. Re-run the audit.
  const second = await driver.audit(tokensText, relations);
  log.push(`audit -> ${second.status}`);

  // 6. Finish with a structured report that cites the tool's numbers.
  const report = {
    before: first.result.summary,
    after: second.result.summary,
    verified: second.ok && second.result.verification.ok,
    changes: choices,
  };
  return { tokensText, report, log, first, second };
}

describe("end to end: discover, prefer existing, fall back to a constrained fix, re-audit", () => {
  const outcomes = {};

  for (const [name, make] of [["CLI", (dir) => cliDriver(dir)], ["MCP", () => mcpDriver()]]) {
    test(`${name}-driven agent finishes clean`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-${name}-`));
      fs.cpSync(FIXTURE, dir, { recursive: true });
      const driver = make(dir);
      try {
        const { tokensText, report, first, second } = await runAgent(driver, dir);

        // The failures were found and each got the right kind of fix.
        expect(report.before).toEqual({ relations: 4, pass: 2, fail: 2, error: 0 });
        expect(report.changes.map((c) => [c.token, c.kind])).toEqual([
          ["text.muted", "existing"], // text.secondary already passes: reuse it
          ["link.default", "synthesized"], // nothing in link.* qualifies: constrained nearest-color fix
        ]);
        expect(report.changes[0].to).toBe("{text.secondary}");
        expect(report.changes[1].to).toMatch(/^#[0-9a-f]{6}$/);

        // Clean structured result, and it is the tool's own verdict.
        expect(second.status).toBe("pass");
        expect(report.after).toEqual({ relations: 4, pass: 4, fail: 0, error: 0 });
        expect(report.verified).toBe(true);
        expect(second.patch).toEqual([]);

        // Minimal churn: exactly the two failing tokens changed, nothing else.
        const before = JSON.parse(fs.readFileSync(path.join(FIXTURE, "src", "tokens.json"), "utf8"));
        const after = JSON.parse(tokensText);
        const diff = [];
        const walk = (a, b, trail) => {
          for (const key of Object.keys(b)) {
            if (a[key] && typeof a[key] === "object") walk(a[key], b[key], [...trail, key]);
            else if (a[key] !== b[key]) diff.push([...trail, key].join("."));
          }
        };
        walk(before, after, []);
        expect(diff).toEqual(["text.muted.$value", "link.default.$value"]);

        // Every figure in the report is a figure the tool returned (nothing recomputed).
        const toolText = JSON.stringify([first.result, second.result]);
        for (const change of report.changes) {
          expect(toolText).toContain(JSON.stringify(change.ratioBefore));
          expect(toolText).toContain(JSON.stringify(change.ratioAfter));
        }

        outcomes[name] = { tokensText, report };
      } finally {
        await driver.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 60000);
  }

  test("both drivers produce byte-identical files and identical reports (deterministic)", () => {
    expect(outcomes.CLI).toBeDefined();
    expect(outcomes.MCP).toBeDefined();
    expect(outcomes.MCP.tokensText).toBe(outcomes.CLI.tokensText);
    expect(outcomes.MCP.report).toEqual(outcomes.CLI.report);
  });

  test("running the whole flow again gives the same result", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-again-"));
    fs.cpSync(FIXTURE, dir, { recursive: true });
    const driver = cliDriver(dir);
    try {
      const { tokensText } = await runAgent(driver, dir);
      expect(tokensText).toBe(outcomes.CLI.tokensText);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe("installed skill is the tested skill", () => {
  test("`contrast skill install` writes exactly SKILL.md, and uninstall removes it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-skill-"));
    try {
      const run = (...args) => spawnSync("node", [cliBin, "skill", ...args, "--dir", dir], { encoding: "utf8" });
      expect(run("install").status).toBe(0);
      expect(fs.readFileSync(path.join(dir, "get-contrast", "SKILL.md"), "utf8")).toBe(fs.readFileSync(path.join(__dirname, "..", "SKILL.md"), "utf8"));
      expect(run("uninstall").status).toBe(0);
      expect(fs.existsSync(path.join(dir, "get-contrast"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
