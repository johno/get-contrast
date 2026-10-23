// `contrast tokens`: fixture projects for JSON and CSS tokens, end to end.
const { describe, test, expect, beforeAll, afterAll } = require("bun:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

require("../../get-contrast/scripts/ensure-build");

const lib = require("get-contrast");
const bin = path.join(__dirname, "..", "bin.js");
const FIXTURES = path.join(__dirname, "..", "..", "get-contrast", "test", "fixtures", "tokens");
const fx = (name) => path.join(FIXTURES, name);

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "contrast-tokens-"));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (name, content) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
};
const cli = (args, input) => {
  const r = spawnSync("node", [bin, ...args], { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: "", FORCE_COLOR: "" } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const json = (r) => JSON.parse(r.stdout);

function applyJsonPatch(text, patch) {
  const data = JSON.parse(text);
  for (const { path: pointer, value } of patch) {
    const keys = pointer.slice(1).split("/").map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    let node = data;
    for (const key of keys.slice(0, -1)) node = node[key];
    node[keys[keys.length - 1]] = value;
  }
  return JSON.stringify(data, null, 2);
}

describe("JSON tokens", () => {
  test("report: pass/fail per relation, existing token first, edits to review; exit 1", () => {
    const r = cli(["tokens", fx("tokens.json"), "--relations", fx("relations.json")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(
      [
        "5 relations over 16 json tokens: 2 pass, 3 fail",
        "",
        "PASS  text.default on surface.default  17.92:1  (needs 4.5:1)",
        "PASS  text.secondary on surface.default  7.81:1  (needs 4.5:1)",
        "FAIL  text.muted on surface.default  2.52:1  (needs 4.5:1)",
        "      text.muted #a3a3a3 on surface.default #ffffff",
        "      Use existing token text.secondary (#525252): 7.81:1, change 0.28",
        "      also qualifying: text.default",
        "      (a new color #767676 would change less: 0.15)",
        "FAIL  subtle caption  2.07:1  (needs 3:1)",
        "      text.subtle #b0b0b0 on surface.raised #fafafa",
        "      Use existing token text.secondary (#525252): 7.48:1, change 0.32",
        "      also qualifying: text.default",
        "      (a new color #919191 would change less: 0.10)",
        "FAIL  button.text on button.background  3.67:1  (needs 4.5:1)",
        "      button.text #ffffff on button.background #3b82f6",
        "      No existing token fits (0 considered in button.*).",
        "      Suggested new value #1e1e1e: 4.53:1, change 0.76",
        "",
        "Suggested edits (nothing was changed; review before applying)",
        "  text.muted: {color.neutral.400} -> {text.secondary}  [/text/muted/$value]",
        "  text.subtle: #b0b0b0 -> {text.secondary}  [/text/subtle/$value]",
        "  button.text: #ffffff -> #1e1e1e  [/button/text/$value]",
        "  --json also emits these as an RFC 6902 patch.",
        "",
      ].join("\n")
    );
  });

  test("never modifies the token file", () => {
    const tokens = write("untouched.json", fs.readFileSync(fx("tokens.json"), "utf8"));
    const before = fs.readFileSync(tokens, "utf8");
    cli(["tokens", tokens, "--relations", fx("relations.json")]);
    cli(["tokens", tokens, "--relations", fx("relations.json"), "--json"]);
    expect(fs.readFileSync(tokens, "utf8")).toBe(before);
  });

  test("--json is the library result plus an RFC 6902 patch; applying it passes (end to end)", () => {
    const r = cli(["tokens", fx("tokens.json"), "--relations", fx("relations.json"), "--json"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("");
    const doc = json(r);
    expect(doc).toMatchObject({ schema: 1, command: "tokens", exitCode: 1 });
    expect(doc.result.summary).toEqual({ relations: 5, pass: 2, fail: 3, error: 0 });
    expect(doc.result.verification).toEqual({ ok: true, regressions: [] });
    expect(doc.patch).toEqual(lib.toJsonPatch(doc.result.edits));
    expect(doc.patch.map((p) => p.path)).toEqual(["/text/muted/$value", "/text/subtle/$value", "/button/text/$value"]);

    // Apply the suggested patch to a copy and audit again through the CLI.
    const patched = write("patched.json", applyJsonPatch(fs.readFileSync(fx("tokens.json"), "utf8"), doc.patch));
    const again = cli(["tokens", patched, "--relations", fx("relations.json")]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("5 relations over 16 json tokens: 5 pass, 0 fail");
    expect(again.stdout).not.toContain("Suggested edits");
  });

  test("target flags and --candidates", () => {
    const strict = cli(["tokens", fx("tokens.json"), "--relations", fx("relations.json"), "--level", "AAA", "--json"]);
    expect(json(strict).result.relations[1].status).toBe("pass"); // secondary is 7.81:1
    const wide = json(cli(["tokens", fx("tokens.json"), "--relations", fx("relations.json"), "--candidates", "color.neutral.*,text.*", "--json"]));
    expect(wide.result.relations[4].suggestion.searched.pattern).toEqual(["color.neutral.*", "text.*"]);
  });

  test("everything passing exits 0 and prints no edits", () => {
    const relations = write("passing.json", ["text.default -> surface.default", "text.secondary -> surface.raised"]);
    const r = cli(["tokens", fx("tokens.json"), "--relations", relations]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("2 relations over 16 json tokens: 2 pass, 0 fail");
    expect(r.stdout).not.toContain("Suggested edits");
  });

  test("tokens from stdin", () => {
    const r = cli(["tokens", "-", "--relations", fx("relations.json"), "--quiet"], fs.readFileSync(fx("tokens.json"), "utf8"));
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
  });
});

describe("resolution errors are actionable (exit 2)", () => {
  const tokens = fx("tokens.json");

  test("an unknown token suggests near names; other relations still run", () => {
    const relations = write("typo.json", ["text.mutd -> surface.default", "text.default -> surface.default", "spacing.4 -> surface.default"]);
    const r = cli(["tokens", tokens, "--relations", relations]);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("3 relations over 16 json tokens: 1 pass, 0 fail, 2 errors");
    expect(r.stdout).toContain('ERROR text.mutd on surface.default');
    expect(r.stdout).toContain('Unknown token "text.mutd". Did you mean "text.muted"?');
    expect(r.stdout).toContain('Token "spacing.4" has the value "16px", and it is not a color.');
    expect(r.stdout).toContain("PASS  text.default on surface.default");
  });

  test("--json carries issues with codes and suggestions", () => {
    const relations = write("typo2.json", ["text.mutd -> surface.default"]);
    const doc = json(cli(["tokens", tokens, "--relations", relations, "--json"]));
    expect(doc.exitCode).toBe(2);
    expect(doc.result.relations[0].status).toBe("error");
    expect(doc.result.relations[0].issues[0]).toMatchObject({ code: "unknown-token", token: "text.mutd", suggestions: ["text.muted"] });
  });

  test("circular references show the loop", () => {
    const loop = write("loop.json", { a: "{b}", b: "{a}", bg: "#fff" });
    const r = cli(["tokens", loop, "--relations", write("loop-rel.json", ["a -> bg"])]);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("Circular reference: a -> b -> a");
  });
});

describe("CSS custom properties", () => {
  let relations;
  beforeAll(() => {
    relations = write("css-relations.json", ["--text-muted -> --surface-default", "text-default -> surface-default"]);
  });

  test("default scope is :root", () => {
    const r = cli(["tokens", fx("theme.css"), "--relations", relations]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("2 relations over 9 css tokens: 1 pass, 1 fail");
    expect(r.stdout).toContain("FAIL  --text-muted on --surface-default  2.52:1");
    expect(r.stdout).toContain("--text-muted: var(--color-gray-400) -> var(--text-secondary)");
    expect(r.stdout).not.toContain("RFC 6902"); // no JSON Pointer for CSS
    expect(json(cli(["tokens", fx("theme.css"), "--relations", relations, "--json"])).patch).toEqual([]);
  });

  test("--scope audits the dark theme, and the edit names its selector", () => {
    const r = cli(["tokens", fx("theme.css"), "--scope", '[data-theme="dark"]', "--relations", relations]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("--text-muted #666666 on --surface-default #111111");
    expect(r.stdout).toContain('[--text-muted in [data-theme="dark"]]');
    const media = cli(["tokens", fx("theme.css"), "--scope", "@media (prefers-color-scheme: dark)", "--relations", relations, "--json"]);
    expect(json(media).result.relations[0].background.hex).toBe("#101010");
  });

  test("an unknown scope is an error that lists the real ones (never a silent base-theme audit)", () => {
    const r = cli(["tokens", fx("theme.css"), "--scope", "[data-theme=sepia]", "--relations", relations]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain('no rule matches the scope "[data-theme=sepia]"');
    expect(r.stderr).toContain("scopes in this file:");
  });

  test("scope quoting does not matter", () => {
    const quoted = cli(["tokens", fx("theme.css"), "--scope", '[data-theme="dark"]', "--relations", relations]);
    const bare = cli(["tokens", fx("theme.css"), "--scope", "[data-theme=dark]", "--relations", relations]);
    expect(bare).toEqual(quoted);
  });

  test("a format override and stdin", () => {
    const css = fs.readFileSync(fx("theme.css"), "utf8");
    const r = cli(["tokens", "-", "--format", "css", "--relations", relations], css);
    expect(r.stdout).toContain("2 relations over 9 css tokens");
  });
});

describe("input errors (exit 2, one message, nothing on stdout)", () => {
  const relations = fx("relations.json");

  test.each([
    [["tokens"], undefined, "expected 1 color: contrast tokens <tokens-file | -> --relations <relations.json> (got 0)"],
    [["tokens", fx("tokens.json")], undefined, "tokens needs --relations <file>"],
    [["tokens", "missing.json", "--relations", relations], undefined, "cannot read tokens missing.json: no such file"],
    [["tokens", fx("tokens.json"), "--relations", "missing.json"], undefined, "cannot read relations missing.json: no such file"],
    [["tokens", "-", "--relations", "-"], "{}", "only one of the tokens file and --relations can be read from stdin"],
    [["tokens", "-", "--relations", relations], "", "stdin: the token file is empty"],
    [["tokens", "-", "--relations", relations], "hello", "could not tell whether this is JSON tokens or CSS"],
    [["tokens", "-", "--relations", relations], '{"a": ', "token file is not valid JSON"],
    [["tokens", "-", "--relations", relations, "--format", "css"], ":root { --a: #fff;", 'missing } after ":root"'],
    [["tokens", fx("tokens.json"), "--format", "yaml", "--relations", relations], undefined, "must be one of: json, css"],
  ])("%j", (args, input, message) => {
    const r = cli(args, input);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(message);
    expect(r.stdout).toBe("");
  });

  test("malformed relations name the file and the entry", () => {
    for (const [content, message] of [
      ['["a -> b", "nope"]', "relations.json: relation 1:"],
      ["{ not json", "not valid JSON"],
      ['[{"foreground":"a"}]', '"foreground" and "background"'],
      ['[{"foreground":"a","background":"b","level":"A"}]', '"level" must be one of: AA, AAA'],
    ]) {
      const file = write("relations.json", content);
      const r = cli(["tokens", fx("tokens.json"), "--relations", file]);
      expect([content, r.status]).toEqual([content, 2]);
      expect(r.stderr).toContain(message);
    }
  });

  test("in --json mode input errors have specific codes", () => {
    const bad = json(cli(["tokens", "-", "--relations", relations, "--json"], '{"a": '));
    expect(bad.error.code).toBe("invalid-tokens");
    const badRel = json(cli(["tokens", fx("tokens.json"), "--relations", write("bad-rel.json", '["x"]'), "--json"]));
    expect(badRel.error.code).toBe("invalid-relations");
    expect(badRel.exitCode).toBe(2);
  });
});

describe("help", () => {
  test("tokens help and main help list the command", () => {
    expect(cli(["help", "tokens"]).stdout).toContain("nearest EXISTING token");
    expect(cli(["tokens", "--help"]).stdout).toContain("Usage: contrast tokens");
    expect(cli(["help"]).stdout).toContain("tokens <file | -> --relations f");
  });
});
