// Each tool against the same fixtures the library and CLI tests use. A tool
// response must carry exactly what the library returns.
const { describe, test, expect } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");
require("../../get-contrast/scripts/ensure-build");

const lib = require("get-contrast");
const { createContrastServer } = require("../src");

const server = createContrastServer(lib, { version: "1.0.0" });
const call = (name, args) => {
  const r = server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  expect(r.error).toBeUndefined();
  return r.result;
};
const asJson = (v) => JSON.parse(JSON.stringify(v));

const TOKENS = path.join(__dirname, "..", "..", "get-contrast", "test", "fixtures", "tokens");
const SKILL = path.join(__dirname, "..", "..", "..", "skills", "get-contrast", "fixtures");
const read = (dir, name) => fs.readFileSync(path.join(dir, name), "utf8");

describe("response envelope", () => {
  test("success: text for the model, structuredContent for programs, isError false", () => {
    const r = call("check_contrast", { foreground: "#767676", background: "#ffffff" });
    expect(r.isError).toBe(false);
    expect(r.content).toHaveLength(1);
    expect(r.content[0].type).toBe("text");
    expect(r.structuredContent).toMatchObject({ schema: 1, tool: "check_contrast", status: "pass" });
    expect(Object.keys(r.structuredContent).sort()).toEqual(["result", "schema", "status", "tool"]);
  });

  test("responses are JSON-serializable", () => {
    for (const r of [call("check_contrast", { foreground: "#777", background: "#fff" }), call("check_contrast", { foreground: "nope", background: "#fff" })]) {
      expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    }
  });
});

describe("check_contrast", () => {
  test("equals the library result; accessibility failure is a result, not an error", () => {
    const fail = call("check_contrast", { foreground: "#777", background: "#fff" });
    expect(fail.isError).toBe(false);
    expect(fail.structuredContent.status).toBe("fail");
    expect(fail.structuredContent.result).toEqual(asJson(lib.check("#777", "#fff")));
    expect(fail.content[0].text).toBe("FAIL: #777777 on #ffffff is 4.47:1; target AA text (4.5:1). AA text fail, AA large pass, AAA text fail, AAA large fail, UI pass.");
    const pass = call("check_contrast", { foreground: "#767676", background: "#fff" });
    expect(pass.structuredContent.status).toBe("pass");
    expect(pass.content[0].text.startsWith("PASS:")).toBe(true);
  });

  test("target options reach the library", () => {
    const r = call("check_contrast", { foreground: "#767676", background: "#fff", level: "AAA", use: "large-text" });
    expect(r.structuredContent.result.target).toEqual({ level: "AAA", use: "large-text", threshold: 4.5, custom: false, passes: true });
    expect(call("check_contrast", { foreground: "#767676", background: "#fff", minRatio: 5 }).structuredContent.status).toBe("fail");
  });

  test("alpha is explained in the text", () => {
    const r = call("check_contrast", { foreground: "rgba(0,0,0,.5)", background: "#fff" });
    expect(r.content[0].text).toContain("Note: The foreground has alpha 0.5");
    expect(r.structuredContent.result.notes[0].code).toBe("foreground-alpha");
    const bg = call("check_contrast", { foreground: "#fff", background: "rgb(0 0 0 / .5)", backdrop: "#000" });
    expect(bg.structuredContent.result.background.hex).toBe("#000000");
  });
});

describe("check_wcag", () => {
  test("ratio and measurement, status info", () => {
    const r = call("check_wcag", { foreground: "#777", background: "#fff" });
    expect(r.structuredContent.status).toBe("info");
    expect(r.structuredContent.result).toEqual(asJson(lib.wcag("#777", "#fff")));
    expect(r.content[0].text).toContain("contrast ratio 4.478089453577214");
  });
});

describe("pick_color", () => {
  test("winner, ranking, labels", () => {
    const candidates = [{ name: "text/secondary", color: "#767676" }, { name: "text/primary", color: "#111111" }, "#dddddd"];
    const r = call("pick_color", { background: "#ffffff", candidates });
    expect(r.structuredContent.status).toBe("pass");
    expect(r.structuredContent.result).toEqual(asJson(lib.pick("#ffffff", candidates)));
    expect(r.structuredContent.result.winner.name).toBe("text/primary");
    expect(r.content[0].text).toBe(`Winner: ${r.structuredContent.result.reason}`);
  });

  test("no winner is a result, with the closest listed first", () => {
    const r = call("pick_color", { background: "#fff", candidates: ["#ddd", "#eee"] });
    expect(r.isError).toBe(false);
    expect(r.structuredContent.status).toBe("fail");
    expect(r.structuredContent.result.winner).toBeNull();
    expect(r.content[0].text.startsWith("No winner:")).toBe(true);
  });
});

describe("find_accessible_color", () => {
  test("a reachable fix", () => {
    const r = call("find_accessible_color", { color: "#777777", against: "#ffffff" });
    expect(r.structuredContent.status).toBe("pass");
    expect(r.structuredContent.result).toEqual(asJson(lib.find("#777777", "#ffffff")));
    expect(r.structuredContent.result.suggested.css).toBe("#767676");
    expect(r.content[0].text).toContain("suggested #767676 (was #777777)");
  });

  test("role and options", () => {
    const r = call("find_accessible_color", { color: "#ffffff", against: "#3b82f6", role: "background", direction: "darker", level: "AA" });
    expect(r.structuredContent.result.adjusted).toBe("background");
    expect(r.structuredContent.result).toEqual(asJson(lib.find("#ffffff", "#3b82f6", { role: "background", direction: "darker", level: "AA" })));
  });

  test("unreachable targets are reported honestly", () => {
    const r = call("find_accessible_color", { color: "#999", against: "#777", level: "AAA" });
    expect(r.isError).toBe(false);
    expect(r.structuredContent.status).toBe("fail");
    expect(r.structuredContent.result.reached).toBe(false);
    expect(r.content[0].text).toContain("not met (unreachable)");
  });

  test("already passing", () => {
    const r = call("find_accessible_color", { color: "#000", against: "#fff" });
    expect(r.structuredContent.status).toBe("pass");
    expect(r.structuredContent.result.changed).toBe(false);
    expect(r.content[0].text.startsWith("PASS: The pair already meets")).toBe(true);
  });

  test("maxChange limits", () => {
    const r = call("find_accessible_color", { color: "#ffcc00", against: "#fff", maxChange: 0.05 });
    expect(r.structuredContent.result.limitedBy).toBe("max-change");
    expect(r.structuredContent.status).toBe("fail");
  });
});

describe("audit_palette", () => {
  const palette = JSON.parse(read(path.join(SKILL, "palette"), "palette.json"));

  test("equals the library audit; summary text per background", () => {
    const r = call("audit_palette", { palette });
    expect(r.structuredContent.status).toBe("info");
    expect(r.structuredContent.result).toEqual(asJson(lib.audit(palette)));
    expect(r.content[0].text.split("\n")[0]).toMatch(/^6 colors, 30 pairs: \d+ meet AA text \(4\.5:1\), \d+ do not\.$/);
    expect(r.content[0].text).toContain("On slate: best paper (1 qualify).");
  });

  test("array palettes, filters, targets", () => {
    const r = call("audit_palette", { palette: [{ name: "a", color: "#000" }, "#fff"], only: "passing", level: "AAA" });
    expect(r.structuredContent.result).toEqual(asJson(lib.audit([{ name: "a", color: "#000" }, "#fff"], { only: "passing", level: "AAA" })));
  });
});

describe("audit_tokens", () => {
  const tokens = read(TOKENS, "tokens.json");
  const relations = JSON.parse(read(TOKENS, "relations.json")).relations;

  test("equals the library audit and returns a patch; failures are results", () => {
    const r = call("audit_tokens", { tokens, relations });
    expect(r.isError).toBe(false);
    expect(r.structuredContent.status).toBe("fail");
    const expected = lib.auditTokens(lib.parseTokens(tokens), relations);
    expect(r.structuredContent.result).toEqual(asJson(expected));
    expect(r.structuredContent.patch).toEqual(lib.toJsonPatch(expected.edits));
    expect(r.structuredContent.patch.map((p) => p.path)).toEqual(["/text/muted/$value", "/text/subtle/$value", "/button/text/$value"]);
    expect(r.content[0].text).toContain("5 relations: 2 pass, 3 fail.");
    expect(r.content[0].text).toContain("Edit text.muted: {color.neutral.400} -> {text.secondary}");
  });

  test("tokens as an object, CSS with a scope, and everything passing", () => {
    const asObject = call("audit_tokens", { tokens: JSON.parse(tokens), relations });
    expect(asObject.structuredContent.result).toEqual(call("audit_tokens", { tokens, relations }).structuredContent.result);
    const css = call("audit_tokens", { tokens: read(TOKENS, "theme.css"), scope: '[data-theme="dark"]', relations: ["--text-muted -> --surface-default"] });
    expect(css.structuredContent.status).toBe("fail");
    expect(css.structuredContent.result.edits[0].source.selector).toBe('[data-theme="dark"]');
    expect(css.structuredContent.patch).toEqual([]);
    const pass = call("audit_tokens", { tokens, relations: ["text.default -> surface.default"] });
    expect(pass.structuredContent.status).toBe("pass");
  });

  test("unresolved tokens are invalid input, but the structured result is still there", () => {
    const r = call("audit_tokens", { tokens, relations: ["text.mutd -> surface.default", "text.default -> surface.default"] });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.status).toBe("error");
    expect(r.structuredContent.error).toMatchObject({ kind: "invalid-input", code: "unresolved-tokens" });
    expect(r.structuredContent.error.message).toContain('Did you mean "text.muted"?');
    expect(r.structuredContent.result.relations[0].issues[0].code).toBe("unknown-token");
    expect(r.structuredContent.result.relations[1].status).toBe("pass");
  });
});

describe("errors are categorized", () => {
  const cases = [
    ["invalid color", "check_contrast", { foreground: "nope", background: "#fff" }, "invalid-input", "invalid-syntax"],
    ["empty color", "check_contrast", { foreground: "", background: "#fff" }, "invalid-input", "empty"],
    ["unsupported syntax: relative color", "check_contrast", { foreground: "rgb(from red r g b)", background: "#fff" }, "unsupported-syntax", "unsupported-function"],
    ["unsupported syntax: color space", "check_wcag", { foreground: "color(rec2020 1 0 0)", background: "#fff" }, "unsupported-syntax", "unsupported-color-space"],
    ["unsupported syntax: calc", "find_accessible_color", { color: "rgb(calc(1 + 2) 0 0)", against: "#fff" }, "unsupported-syntax", "unsupported-function"],
    ["bad candidate", "pick_color", { background: "#fff", candidates: ["#000", "nope"] }, "invalid-input", "invalid-syntax"],
    ["bad palette entry", "audit_palette", { palette: { ink: "#000", bad: "nope" } }, "invalid-input", "invalid-syntax"],
    ["too many colors", "audit_palette", { palette: ["#000", "#111", "#222"], maxColors: 2 }, "invalid-input", "invalid-option"],
    ["missing argument", "check_contrast", { foreground: "#000" }, "invalid-input", "invalid-arguments"],
    ["unknown property", "check_contrast", { foreground: "#000", background: "#fff", colour: 1 }, "invalid-input", "invalid-arguments"],
    ["wrong type", "check_contrast", { foreground: 5, background: "#fff" }, "invalid-input", "invalid-arguments"],
    ["bad enum", "check_contrast", { foreground: "#000", background: "#fff", level: "A" }, "invalid-input", "invalid-arguments"],
    ["out of range", "check_contrast", { foreground: "#000", background: "#fff", minRatio: 40 }, "invalid-input", "invalid-arguments"],
    ["empty candidates", "pick_color", { background: "#fff", candidates: [] }, "invalid-input", "invalid-arguments"],
    ["bad token JSON", "audit_tokens", { tokens: '{"a": ', relations: ["a -> b"] }, "invalid-input", "invalid-json"],
    ["unknown token format", "audit_tokens", { tokens: "hello", relations: ["a -> b"] }, "invalid-input", "unknown-format"],
    ["unknown scope", "audit_tokens", { tokens: ":root { --a: #fff; }", scope: "[x]", relations: ["--a -> --a"] }, "invalid-input", "unknown-scope"],
    ["bad relation", "audit_tokens", { tokens: '{"a":"#fff"}', relations: ["nope"] }, "invalid-input", "invalid-relations"],
  ];

  test.each(cases)("%s", (_, tool, args, kind, code) => {
    const r = call(tool, args);
    expect(r.isError).toBe(true);
    expect(r.structuredContent.status).toBe("error");
    expect(r.structuredContent.error.kind).toBe(kind);
    expect(r.structuredContent.error.code).toBe(code);
    expect(r.content[0].text.startsWith(`${kind}: `)).toBe(true);
    expect(r.structuredContent.result).toBeUndefined();
  });

  test("color errors name the argument", () => {
    const r = call("check_contrast", { foreground: "#000", background: "nope" });
    expect(r.structuredContent.error).toMatchObject({ role: "background", input: "nope" });
    expect(call("pick_color", { background: "#fff", candidates: ["#000", "nope"] }).structuredContent.error.role).toBe("candidates[1]");
  });

  test("argument errors list every problem so the model can fix them in one go", () => {
    const r = call("check_contrast", { level: "A", minRatio: 99 });
    const message = r.structuredContent.error.message;
    expect(message).toContain('missing required property "foreground"');
    expect(message).toContain('missing required property "background"');
    expect(message).toContain("arguments.level: must be one of");
    expect(message).toContain("arguments.minRatio: must be at most 21");
  });

  test("a bug in the library is a tool-failure, never mislabeled as bad input", () => {
    const broken = createContrastServer({ ...lib, check: () => { throw new TypeError("Cannot read properties of undefined"); } }, {});
    const r = broken.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "check_contrast", arguments: { foreground: "#000", background: "#fff" } } }).result;
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.kind).toBe("tool-failure");
    expect(r.content[0].text).toContain("Cannot read properties of undefined");
  });
});

describe("the same results as the library for the skill fixtures", () => {
  test("component pairs from the skill evals", () => {
    for (const [fg, bg] of [["#ffffff", "#3b82f6"], ["#ffffff", "#2563eb"], ["#9ca3af", "#ffffff"]]) {
      const r = call("check_contrast", { foreground: fg, background: bg });
      expect(r.structuredContent.result).toEqual(asJson(lib.check(fg, bg)));
    }
  });
});
