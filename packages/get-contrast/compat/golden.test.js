// Golden compatibility suite: replays the legacy API and CLI against
// fixtures captured from get-contrast@3.0.1. This is not a conformance suite;
// it records what v3 does, including undesirable behavior.
//
// A behavior change shows up as a list of changed fixture keys. If the change
// is intentional, run `bun run compat:update` and review the fixture diff.
const { describe, test, expect } = require("bun:test");
const fs = require("node:fs");
const path = require("node:path");
const { root, buildApiFixture, buildCliFixture, observe } = require("./harness");

const contrast = require(root);
const load = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));

function diff(expected, actual) {
  const lines = [];
  for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (JSON.stringify(expected[k]) !== JSON.stringify(actual[k])) {
      lines.push(
        `${k}\n  expected: ${JSON.stringify(expected[k])}\n  actual:   ${JSON.stringify(actual[k])}`
      );
    }
  }
  return lines;
}

function expectGolden(expected, actual, label) {
  const changes = diff(expected, actual);
  if (changes.length) {
    throw new Error(
      `${changes.length} ${label} fixture(s) changed:\n\n${changes.slice(0, 20).join("\n")}` +
        (changes.length > 20 ? `\n... and ${changes.length - 20} more` : "")
    );
  }
}

describe("golden fixtures", () => {
  test("api matrix: return values, types, and thrown errors", () => {
    expectGolden(load("api.json"), buildApiFixture(contrast), "api");
  });

  test("cli: stdout, stderr, and exit status", () => {
    expectGolden(load("cli.json"), buildCliFixture(), "cli");
  });

  test("fixtures cover the whole legacy surface", () => {
    const fixture = load("api.json");
    const keys = Object.keys(fixture);
    for (const fn of ["ratio", "score", "isAccessible", "isNotTransparent"]) {
      expect(keys.some((k) => k.startsWith(`${fn}(`))).toBe(true);
    }
    expect(Object.values(fixture).some((v) => v.startsWith("throws TypeError"))).toBe(true);
  });
});

// The README was written against an older version. These pin what the README
// examples actually evaluate to today, so the docs can be fixed against facts.
describe("historical README examples", () => {
  test("ratio: README says 10, v3 returns ~20.1 (rounds to 20)", () => {
    expect(Math.round(contrast.ratio("#fafafa", "rgba(0,0,0,.75)"))).toBe(20);
  });

  test("score and isAccessible examples", () => {
    expect(contrast.score("#fafafa", "rgba(0,0,0,.75)")).toBe("AAA");
    expect(contrast.isAccessible("#fafafa", "rgba(0,0,0,.75)")).toBe(true);
    expect(contrast.isAccessible("#fafafa", "#fff")).toBe(false);
  });

  test("README says 'F'; v3 returns 'Fail' for failing scores", () => {
    expect(contrast.score("rebeccapurple", "tomato")).toBe("Fail");
    expect(contrast.score("#fff", "#fff")).toBe("Fail");
  });

  test("ignoreAlpha example", () => {
    expect(
      contrast.score("rgba(0, 0, 0, 0)", "rgba(255, 255, 255, 0)", { ignoreAlpha: true })
    ).toBe("AAA");
  });

  test("failure without ignoreAlpha", () => {
    expect(() => contrast.score("rgba(0, 0, 0, 0)", "rgba(255, 255, 255, 0)")).toThrow(
      "get-contrast cannot contrast transparent colors"
    );
  });

  test("CLI examples", () => {
    const cli = load("cli.json");
    expect(cli['contrast "#000" "#fff"'].stdout).toBe("Ratio: 21\nScore: AAA\n");
    expect(cli['contrast "white"']).toEqual({
      status: 1,
      stdout: "Ratio: 1\nScore: Fail\nThe contrast is not accessible.\n",
      stderr: "",
    });
    expect(cli['contrast "#ff0" "#fff"'].stdout).toBe(
      "Ratio: 1.0738392309265699\nScore: Fail\nThe contrast is not accessible.\n"
    );
  });
});

describe("harness", () => {
  test("observe records type and value, or error class and message", () => {
    expect(observe(() => 1)).toBe("number 1");
    expect(observe(() => "AA")).toBe('string "AA"');
    expect(observe(() => false)).toBe("boolean false");
    expect(observe(() => contrast.ratio(1, "#fff"))).toBe(
      "throws TypeError: get-contrast expects colors as strings"
    );
  });
});
