const { describe, test, expect } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");
require("../scripts/ensure-build");
const api = require("..");
const { parseTokens, parseRelations, resolveToken, auditTokens, toJsonPatch, check, RelationError, TokenSourceError } = api;

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", "tokens", name), "utf8");
const tokensJson = fixture("tokens.json");
const relations = parseRelations(JSON.parse(fixture("relations.json")));

function applyJsonPatch(text, patch) {
  const data = JSON.parse(text);
  for (const { op, path: pointer, value } of patch) {
    expect(op).toBe("replace");
    const keys = pointer.slice(1).split("/").map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    let node = data;
    for (const key of keys.slice(0, -1)) node = node[key];
    expect(keys[keys.length - 1] in node).toBe(true); // replace requires the target to exist
    node[keys[keys.length - 1]] = value;
  }
  return JSON.stringify(data);
}
const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
};
function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

describe("JSON token parsing", () => {
  test("nested groups, $value / value / bare strings, $type inheritance", () => {
    const set = parseTokens(JSON.stringify({
      $description: "ignored",
      color: { $type: "color", red: { $value: "#f00", $description: "d" }, blue: "#00f", legacy: { value: "#0f0" } },
      size: { s: { $type: "dimension", $value: "4px" }, n: 8 },
    }));
    expect(set.format).toBe("json");
    expect(set.tokens.map((t) => [t.name, t.value, t.type, t.source.pointer])).toEqual([
      ["color.red", "#f00", "color", "/color/red/$value"],
      ["color.blue", "#00f", "color", "/color/blue"],
      ["color.legacy", "#0f0", "color", "/color/legacy/value"],
      ["size.s", "4px", "dimension", "/size/s/$value"],
      ["size.n", "8", undefined, "/size/n"],
    ]);
  });

  test("JSON Pointers escape ~ and /", () => {
    const set = parseTokens(JSON.stringify({ "a/b": { "c~d": { $value: "#fff" } } }));
    expect(set.tokens[0].source.pointer).toBe("/a~1b/c~0d/$value");
  });

  test("the fixture parses with stable names", () => {
    const set = parseTokens(tokensJson);
    expect(set.tokens.map((t) => t.name)).toContain("text.muted");
    expect(set.tokens.find((t) => t.name === "text.muted").value).toBe("{color.neutral.400}");
  });
});

describe("CSS token parsing", () => {
  const css = fixture("theme.css");

  test("custom properties from :root, with comments and non-custom properties ignored", () => {
    const set = parseTokens(css);
    expect(set.format).toBe("css");
    expect(set.tokens.map((t) => t.name)).toEqual(["--color-white", "--color-gray-400", "--color-gray-600", "--color-gray-900", "--surface-default", "--text-default", "--text-secondary", "--text-muted", "--space-4"]);
    expect(set.tokens.find((t) => t.name === "--surface-default")).toMatchObject({ value: "var(--color-white)", source: { format: "css", selector: ":root", property: "--surface-default" } });
  });

  test("a selector scope overrides :root like the cascade", () => {
    const set = parseTokens(css, { scope: '[data-theme="dark"]' });
    const value = (n) => set.tokens.find((t) => t.name === n).value;
    expect(value("--surface-default")).toBe("#111111");
    expect(value("--text-default")).toBe("#fafafa");
    expect(value("--text-secondary")).toBe("var(--color-gray-600)"); // not overridden: inherited from :root
    expect(set.tokens.find((t) => t.name === "--text-muted").source.selector).toBe('[data-theme="dark"]');
  });

  test("scopes compare without attribute-value quotes or extra spaces", () => {
    const quoted = parseTokens(css, { scope: '[data-theme="dark"]' });
    for (const scope of ["[data-theme=dark]", "[data-theme='dark']", "  [data-theme=dark]  "]) {
      expect(parseTokens(css, { scope })).toEqual(quoted);
    }
    expect(parseTokens(css, { scope: "@media (prefers-color-scheme:  dark)" }).tokens.find((t) => t.name === "--surface-default").value).toBe("#101010");
  });

  test("a scope that matches nothing is an error, not the base theme", () => {
    let error;
    try {
      parseTokens(css, { scope: "[data-theme=sepia]" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TokenSourceError);
    expect(error.code).toBe("unknown-scope");
    expect(error.message).toContain('no rule matches the scope "[data-theme=sepia]"');
    expect(error.message).toContain('scopes in this file: "[data-theme="dark"]", "@media (prefers-color-scheme: dark)"');
    // with nothing else in the file, the message does not invent a list
    expect(() => parseTokens(":root { --a: #fff; }", { scope: "[x]" })).toThrow(/no rule matches the scope "\[x\]"$/);
  });

  test("an at-rule scope selects the blocks inside it", () => {
    const set = parseTokens(css, { scope: "@media (prefers-color-scheme: dark)" });
    expect(set.tokens.find((t) => t.name === "--surface-default").value).toBe("#101010");
    expect(set.tokens.find((t) => t.name === "--text-muted").value).toBe("#777777");
  });

  test("selector lists, !important, and multiple blocks", () => {
    const set = parseTokens(".a, :root { --x: #111 !important; } :root { --y: #222; }");
    expect(set.tokens.map((t) => [t.name, t.value])).toEqual([["--x", "#111"], ["--y", "#222"]]);
  });

  test("malformed CSS is reported", () => {
    for (const text of [":root { --a: #fff;", ":root { --a: #fff; } }", "--a: #fff; :root"]) {
      expect(() => parseTokens(text, { format: "css" })).toThrow(TokenSourceError);
    }
  });
});

describe("parseTokens errors", () => {
  test("empty, unknown format, bad JSON", () => {
    for (const [text, code] of [["", "empty"], ["   \n", "empty"], ["hello", "unknown-format"], ["[1]", "invalid-json"], ['{"a": ', "invalid-json"]]) {
      let error;
      try {
        parseTokens(text, text.startsWith("[") ? { format: "json" } : {});
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(TokenSourceError);
      expect(error.code).toBe(code);
    }
  });
});

describe("resolveToken", () => {
  const set = parseTokens(tokensJson);

  test("follows aliases and records the chain", () => {
    const r = resolveToken(set, "text.muted");
    expect(r.ok).toBe(true);
    expect(r.chain).toEqual(["text.muted", "color.neutral.400"]);
    expect(r.value).toBe("#a3a3a3");
    expect(resolveToken(set, "surface.default").chain).toEqual(["surface.default", "color.white"]);
  });

  test("unknown tokens suggest near names", () => {
    const r = resolveToken(set, "text.mutd");
    expect(r.ok).toBe(false);
    expect(r.issue.code).toBe("unknown-token");
    expect(r.issue.suggestions).toContain("text.muted");
    expect(r.issue.message).toBe('Unknown token "text.mutd". Did you mean "text.muted"?');
    expect(resolveToken(set, "zzz.qqq").issue.suggestions).toBeUndefined();
  });

  test("a broken alias names the referencing token", () => {
    const broken = parseTokens(JSON.stringify({ a: { $value: "{b.missing}" }, b: { real: "#fff" } }));
    const r = resolveToken(broken, "a");
    expect(r.issue.code).toBe("unknown-token");
    expect(r.issue.message).toBe('Unknown token "b.missing" (referenced by "a").');
    expect(r.issue.chain).toEqual(["a"]);
  });

  test("circular references show the loop", () => {
    const loop = parseTokens(JSON.stringify({ a: "{b}", b: "{c}", c: "{a}" }));
    const r = resolveToken(loop, "a");
    expect(r.issue.code).toBe("circular-reference");
    expect(r.issue.message).toBe("Circular reference: a -> b -> c -> a");
    expect(resolveToken(parseTokens(JSON.stringify({ a: "{a}" })), "a").issue.code).toBe("circular-reference");
  });

  test("non-colors and unsupported syntax", () => {
    const r = resolveToken(set, "spacing.4");
    expect(r.issue).toMatchObject({ code: "not-a-color", token: "spacing.4" });
    expect(r.issue.message).toBe('Token "spacing.4" has the value "16px", and it is not a color.');
    const mixed = parseTokens(JSON.stringify({ a: "color-mix(in srgb, red, blue)" }));
    expect(resolveToken(mixed, "a").issue.code).toBe("unsupported-value");
  });

  test("CSS var() chains, fallbacks, and the missing -- prefix", () => {
    const css = parseTokens(fixture("theme.css"));
    expect(resolveToken(css, "--text-muted").chain).toEqual(["--text-muted", "--color-gray-400"]);
    expect(resolveToken(css, "text-muted").ok).toBe(true);
    const fallback = parseTokens(":root { --a: var(--missing, #123456); --b: var(--a); --c: var(--nope); }");
    expect(resolveToken(fallback, "--a").value).toBe("#123456");
    expect(resolveToken(fallback, "--b").value).toBe("#123456");
    expect(resolveToken(fallback, "--c").issue.code).toBe("unknown-token");
    expect(resolveToken(parseTokens(":root { --a: var(--b); --b: var(--a); }"), "--a").issue.code).toBe("circular-reference");
  });
});

describe("parseRelations", () => {
  test("strings, pairs, objects, and the { relations } wrapper", () => {
    expect(parseRelations(["a -> b", ["c", "d"], { foreground: "e", background: "f", level: "AAA", use: "ui", minRatio: 5, name: "n", candidates: "x.*" }])).toEqual([
      { foreground: "a", background: "b" },
      { foreground: "c", background: "d" },
      { foreground: "e", background: "f", name: "n", level: "AAA", use: "ui", minRatio: 5, candidates: "x.*" },
    ]);
    expect(parseRelations({ relations: ["a -> b"] })).toEqual([{ foreground: "a", background: "b" }]);
    expect(parseRelations([])).toEqual([]);
  });

  test("errors name the entry", () => {
    for (const [input, index, message] of [
      [["a -> b", "nope"], 1, 'should look like "foreground -> background"'],
      [["a -> b -> c"], 0, "should look like"],
      [[["only-one"]], 0, "[foreground, background]"],
      [[{ foreground: "a" }], 0, '"foreground" and "background"'],
      [[{ foreground: "a", background: "b", level: "A" }], 0, '"level" must be one of: AA, AAA'],
      [[{ foreground: "a", background: "b", use: "poster" }], 0, '"use" must be one of'],
      [[{ foreground: "a", background: "b", minRatio: 30 }], 0, '"minRatio" must be a number from 1 to 21'],
      [[{ foreground: "a", background: "b", candidates: 5 }], 0, '"candidates"'],
      [[5], 0, "a relation is a string"],
      ["a -> b", 0, "expected an array"],
      [null, 0, "expected an array"],
    ]) {
      let error;
      try {
        parseRelations(input);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(RelationError);
      expect(error.index).toBe(index);
      expect(error.message).toContain(message);
    }
  });
});

describe("auditTokens", () => {
  const set = parseTokens(tokensJson);
  const result = auditTokens(set, relations);

  test("statuses and summary", () => {
    expect(result.relations.map((r) => [r.name, r.status])).toEqual([
      ["text.default on surface.default", "pass"],
      ["text.secondary on surface.default", "pass"],
      ["text.muted on surface.default", "fail"],
      ["subtle caption", "fail"],
      ["button.text on button.background", "fail"],
    ]);
    expect(result.summary).toEqual({ relations: 5, pass: 2, fail: 3, error: 0 });
    expect(result.format).toBe("json");
  });

  test("each relation reports resolved tokens and the check", () => {
    const r = result.relations[2];
    expect(r.foreground).toMatchObject({ token: "text.muted", written: "{color.neutral.400}", hex: "#a3a3a3", chain: ["text.muted", "color.neutral.400"] });
    expect(r.background).toMatchObject({ token: "surface.default", hex: "#ffffff" });
    expect(r.ratio).toBe(check("#a3a3a3", "#ffffff").ratio);
    expect(r.check.target.threshold).toBe(4.5);
    expect(r.target).toEqual({ level: "AA", use: "text", threshold: 4.5, custom: false });
    expect(result.relations[3].target).toEqual({ level: "AA", use: "large-text", threshold: 3, custom: false });
  });

  test("prefers the nearest EXISTING token over inventing a color", () => {
    const s = result.relations[2].suggestion;
    expect(s.recommended).toBe("existing");
    expect(s.existing).toMatchObject({ token: "text.secondary", hex: "#525252" });
    expect(s.alternatives.map((a) => a.token)).toEqual(["text.default"]);
    expect(s.existing.deltaE).toBeLessThan(s.alternatives[0].deltaE); // nearest first
    expect(s.synthesized.reached).toBe(true); // shown for comparison
    expect(s.synthesized.deltaE).toBeLessThan(s.existing.deltaE); // a synthesized color would be a smaller change...
    expect(s.edit).toEqual({ token: "text.muted", from: "{color.neutral.400}", to: "{text.secondary}", kind: "existing-token", source: { format: "json", pointer: "/text/muted/$value" } });
    expect(s.after.passes).toBe(true);
    expect(s.searched).toEqual({ pattern: ["text.*"], considered: 2 }); // default, secondary (subtle is itself being edited)
    expect(s.reason).toContain("text.secondary");
  });

  test("falls back to a synthesized color when no existing token qualifies", () => {
    const s = result.relations[4].suggestion;
    expect(s.recommended).toBe("synthesized");
    expect(s.existing).toBeNull();
    expect(s.searched.considered).toBe(0);
    expect(s.edit).toMatchObject({ token: "button.text", from: "#ffffff", kind: "synthesized" });
    expect(s.edit.to).toBe(s.synthesized.css);
    expect(s.reason).toContain("No token in button.*");
  });

  test("per-relation targets override the audit's", () => {
    const strict = auditTokens(set, [{ foreground: "text.secondary", background: "surface.default", level: "AAA" }, { foreground: "text.secondary", background: "surface.default", minRatio: 9 }]);
    expect(strict.relations.map((r) => r.status)).toEqual(["pass", "fail"]);
    expect(strict.relations[1].target).toMatchObject({ threshold: 9, custom: true });
    expect(auditTokens(set, [["text.muted", "surface.default"]], { level: "AAA" }).relations[0].target.threshold).toBe(7);
  });

  test("candidate pools: relation > options > default namespace", () => {
    const rel = { foreground: "text.muted", background: "surface.default" };
    const wide = auditTokens(set, [rel], { candidates: "color.neutral.*" });
    expect(wide.relations[0].suggestion.searched.pattern).toEqual(["color.neutral.*"]);
    expect(wide.relations[0].suggestion.existing.token).toBe("color.neutral.500");
    const own = auditTokens(set, [{ ...rel, candidates: ["color.neutral.9*"] }], { candidates: "color.neutral.*" });
    expect(own.relations[0].suggestion.existing.token).toBe("color.neutral.900");
    const none = auditTokens(set, [{ ...rel, candidates: "nothing.*" }]);
    expect(none.relations[0].suggestion.existing).toBeNull();
    expect(none.relations[0].suggestion.recommended).toBe("synthesized");
  });

  test("an unreachable target recommends nothing and says so", () => {
    const mid = parseTokens(JSON.stringify({ text: { a: "#999999" }, bg: { mid: "#777777" } }));
    const r = auditTokens(mid, [{ foreground: "text.a", background: "bg.mid", level: "AAA" }]);
    expect(r.relations[0].status).toBe("fail");
    expect(r.relations[0].suggestion.recommended).toBeNull();
    expect(r.relations[0].suggestion.edit).toBeNull();
    expect(r.relations[0].suggestion.reason).toContain("can reach 7:1");
    expect(r.edits).toEqual([]);
  });

  test("resolution errors are per relation and actionable; other relations still run", () => {
    const r = auditTokens(set, [["text.mutd", "surface.default"], ["text.default", "surface.default"], ["spacing.4", "surface.default"], ["text.default", "nope.nope"]]);
    expect(r.relations.map((x) => x.status)).toEqual(["error", "pass", "error", "error"]);
    expect(r.summary).toEqual({ relations: 4, pass: 1, fail: 0, error: 3 });
    expect(r.relations[0].issues[0].message).toBe('Unknown token "text.mutd". Did you mean "text.muted"?');
    expect(r.relations[0].background.token).toBe("surface.default"); // the resolvable side is still reported
    expect(r.relations[0].foreground).toBeNull();
    expect(r.relations[2].issues[0].code).toBe("not-a-color");
  });

  test("both sides unresolvable reports both issues", () => {
    expect(auditTokens(set, [["x", "y"]]).relations[0].issues).toHaveLength(2);
  });

  test("edits are de-duplicated; conflicting wants are flagged", () => {
    const dup = auditTokens(set, [["text.muted", "surface.default"], ["text.muted", "surface.default"]]);
    expect(dup.edits).toHaveLength(1);
    expect(dup.notes).toEqual([]);
    // On white the nearest passing token is text.mid; on #999 only text.dark qualifies.
    const conflict = parseTokens(JSON.stringify({ text: { x: "#bbbbbb", dark: "#222222", mid: "#555555" }, bg: { light: "#ffffff", grey: "#999999" } }));
    const r = auditTokens(conflict, [["text.x", "bg.light"], ["text.x", "bg.grey"]]);
    expect(r.edits.filter((e) => e.token === "text.x")).toHaveLength(1);
    expect(r.notes.map((n) => n.code)).toContain("conflicting-edits");
    expect(r.notes.find((n) => n.code === "conflicting-edits").message).toContain('"text.x"');
    // the unmet second want is caught by verification, not hidden
    expect(r.verification.ok).toBe(false);
    expect(r.verification.regressions.map((x) => x.index)).toEqual([1]);
  });

  test("does not mutate its inputs", () => {
    const frozenSet = deepFreeze(parseTokens(tokensJson));
    const frozenRelations = deepFreeze(parseRelations(JSON.parse(fixture("relations.json"))));
    expect(() => auditTokens(frozenSet, frozenRelations, deepFreeze({ level: "AA" }))).not.toThrow();
  });

  test("invalid options", () => {
    expect(() => auditTokens(set, [], { level: "AAAA" })).toThrow(RangeError);
    expect(() => auditTokens(set, [], { maxAlternatives: -1 })).toThrow(RangeError);
  });

  test("maxAlternatives limits the list", () => {
    const wide = auditTokens(set, [["text.muted", "surface.default"]], { candidates: "color.neutral.*", maxAlternatives: 1 });
    expect(wide.relations[0].suggestion.alternatives).toHaveLength(1);
    expect(auditTokens(set, [["text.muted", "surface.default"]], { candidates: "color.neutral.*", maxAlternatives: 0 }).relations[0].suggestion.alternatives).toEqual([]);
  });
});

describe("edit interactions", () => {
  test("tokens that are about to be edited are never offered as replacements", () => {
    // text.a and text.b both fail on white; text.c passes. text.a must not be
    // told to use text.b (which is itself being rewritten), only text.c.
    const set = parseTokens(JSON.stringify({ bg: "#ffffff", text: { a: "#bbbbbb", b: "#aaaaaa", c: "#333333" } }));
    const r = auditTokens(set, [["text.a", "bg"], ["text.b", "bg"], ["text.c", "bg"]]);
    expect(r.relations.map((x) => x.status)).toEqual(["fail", "fail", "pass"]);
    expect(r.relations[0].suggestion.existing.token).toBe("text.c");
    expect(r.relations[1].suggestion.existing.token).toBe("text.c");
    expect(r.relations[0].suggestion.searched.considered).toBe(1);
    expect(r.verification).toEqual({ ok: true, regressions: [] });
  });

  test("candidates whose alias chain passes through an edited token are excluded", () => {
    const set = parseTokens(JSON.stringify({ bg: "#ffffff", base: { gray: "#aaaaaa" }, text: { a: "{base.gray}", alias: "{base.gray}", c: "#222222" } }));
    // text.a fails and will be edited; text.alias resolves THROUGH base.gray, not text.a, so it is still a candidate...
    const r = auditTokens(set, [["text.a", "bg"]], { candidates: ["text.*", "base.*"] });
    expect(r.relations[0].suggestion.existing.token).toBe("text.c");
    // ...but if base.gray itself is the failing foreground, anything aliasing it is excluded.
    const r2 = auditTokens(set, [["base.gray", "bg"], ["text.alias", "bg"]], { candidates: "text.*" });
    expect(r2.relations[1].suggestion.existing.token).toBe("text.c");
    expect(r2.relations[1].suggestion.searched.considered).toBe(1); // text.a aliases the edited base.gray: excluded
  });

  test("verification catches an edit that breaks another relation", () => {
    // surface.mid is the foreground of a failing relation, and the BACKGROUND of a passing one.
    const set = parseTokens(JSON.stringify({ surface: { page: "#ffffff", mid: "#cccccc" }, text: { body: "#333333" }, ink: { dark: "#101010" } }));
    const r = auditTokens(set, [["text.body", "surface.mid"], ["surface.mid", "surface.page"]], { candidates: ["ink.*"] });
    expect(r.relations.map((x) => x.status)).toEqual(["pass", "fail"]);
    expect(r.edits).toHaveLength(1);
    expect(r.edits[0].token).toBe("surface.mid");
    expect(r.verification.ok).toBe(false);
    expect(r.verification.regressions).toEqual([{ index: 0, name: "text.body on surface.mid", status: "fail" }]);
    expect(r.notes.map((n) => n.code)).toContain("edit-regression");
  });

  test("no edits means trivially verified", () => {
    const r = auditTokens(parseTokens(tokensJson), [["text.default", "surface.default"]]);
    expect(r.verification).toEqual({ ok: true, regressions: [] });
  });
});

describe("suggested fixes revalidate", () => {
  test("applying the JSON Patch makes every fixable relation pass", () => {
    const set = parseTokens(tokensJson);
    const first = auditTokens(set, relations);
    const patch = toJsonPatch(first.edits);
    expect(patch).toEqual([
      { op: "replace", path: "/text/muted/$value", value: "{text.secondary}" },
      { op: "replace", path: "/text/subtle/$value", value: "{text.secondary}" },
      { op: "replace", path: "/button/text/$value", value: first.edits[2].to },
    ]);
    const second = auditTokens(parseTokens(applyJsonPatch(tokensJson, patch)), relations);
    expect(second.summary).toEqual({ relations: 5, pass: 5, fail: 0, error: 0 });
    expect(second.edits).toEqual([]);
    expect(first.verification).toEqual({ ok: true, regressions: [] }); // the audit itself predicted this
  });

  test("CSS: applying the edits to the declarations makes the relations pass", () => {
    const css = fixture("theme.css");
    const rel = parseRelations(["--text-muted -> --surface-default", "text-default -> surface-default"]);
    const set = parseTokens(css);
    const first = auditTokens(set, rel, { candidates: "--color-gray-*" });
    expect(first.relations.map((r) => r.status)).toEqual(["fail", "pass"]);
    const edit = first.edits[0];
    expect(edit).toMatchObject({ token: "--text-muted", from: "var(--color-gray-400)", kind: "existing-token", source: { format: "css", selector: ":root", property: "--text-muted" } });
    expect(edit.to).toMatch(/^var\(--color-gray-/);
    const patched = css.replace("--text-muted: var(--color-gray-400);", `--text-muted: ${edit.to};`);
    expect(auditTokens(parseTokens(patched), rel).summary).toMatchObject({ pass: 2, fail: 0 });
    expect(toJsonPatch(first.edits)).toEqual([]); // CSS edits have no JSON Pointer
  });

  test("CSS dark scope: the scope's own values are audited", () => {
    const rel = parseRelations(["--text-muted -> --surface-default"]);
    const light = auditTokens(parseTokens(fixture("theme.css")), rel);
    const dark = auditTokens(parseTokens(fixture("theme.css"), { scope: '[data-theme="dark"]' }), rel);
    expect(light.relations[0].foreground.hex).toBe("#a3a3a3");
    expect(dark.relations[0].foreground.hex).toBe("#666666");
    expect(dark.relations[0].background.hex).toBe("#111111");
    expect(dark.relations[0].status).toBe("fail");
    expect(dark.edits[0].source.selector).toBe('[data-theme="dark"]');
  });

  test("randomized: every recommended edit, applied, passes", () => {
    const next = rng(77);
    const hex = () => "#" + [0, 0, 0].map(() => Math.floor(next() * 256).toString(16).padStart(2, "0")).join("");
    for (let run = 0; run < 60; run++) {
      const tokens = { surface: { default: hex(), raised: hex() }, text: {}, color: {} };
      for (let i = 0; i < 6; i++) tokens.text[`t${i}`] = next() < 0.5 ? hex() : { $value: hex() };
      for (let i = 0; i < 4; i++) tokens.color[`c${i}`] = hex();
      const rels = [];
      for (let i = 0; i < 6; i++) rels.push([`text.t${i}`, next() < 0.5 ? "surface.default" : "surface.raised"]);
      const options = { level: next() < 0.5 ? "AA" : "AAA", candidates: next() < 0.5 ? undefined : ["text.*", "color.*"] };
      const text = JSON.stringify(tokens);
      const first = auditTokens(parseTokens(text), rels, options);
      // Skip token sets where two relations want different values for one token.
      if (first.notes.length) continue;
      const patch = toJsonPatch(first.edits);
      const patched = patch.length ? applyJsonPatch(text, patch) : text;
      const second = auditTokens(parseTokens(patched), rels, options);
      // the audit's own in-memory verification must agree with applying the patch
      if (first.verification.ok) {
        first.relations.forEach((r, i) => {
          if (r.status === "pass" || (r.status === "fail" && r.suggestion.edit)) expect([run, i, second.relations[i].status]).toEqual([run, i, "pass"]);
        });
      }
      first.relations.forEach((r, i) => {
        if (r.status === "pass") expect(second.relations[i].status).toBe("pass");
        if (r.status === "fail" && r.suggestion.edit) {
          expect([run, i, second.relations[i].status]).toEqual([run, i, "pass"]);
          expect(r.suggestion.after.passes).toBe(true);
        }
      });
    }
  });
});
