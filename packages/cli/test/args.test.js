const { describe, test, expect } = require("bun:test");
const { parseArgs } = require("../src/args");

const specs = {
  level: { name: "level", type: "string", values: ["AA", "AAA"] },
  against: { name: "against", type: "string" },
  color: { name: "color", type: "boolean" },
  "preserve-chroma": { name: "preserve-chroma", type: "boolean" },
};

describe("parseArgs", () => {
  test("positionals and flags in any order", () => {
    expect(parseArgs(["a", "--level", "AA", "b"], specs)).toEqual({ positionals: ["a", "b"], flags: { level: "AA" } });
    expect(parseArgs(["--level=AAA", "a"], specs)).toEqual({ positionals: ["a"], flags: { level: "AAA" } });
  });

  test("string flags take values, including ones that look like colors", () => {
    expect(parseArgs(["--against", "#fff"], specs).flags.against).toBe("#fff");
    expect(parseArgs(["--against=rgb(0 0 0 / 50%)"], specs).flags.against).toBe("rgb(0 0 0 / 50%)");
  });

  test("boolean flags and --no- negation", () => {
    expect(parseArgs(["--color"], specs).flags).toEqual({ color: true });
    expect(parseArgs(["--no-color"], specs).flags).toEqual({ color: false });
    expect(parseArgs(["--no-preserve-chroma"], specs).flags).toEqual({ "preserve-chroma": false });
    expect(parseArgs(["--color=false"], specs).flags).toEqual({ color: false });
  });

  test("-- ends flag parsing", () => {
    expect(parseArgs(["--level", "AA", "--", "--weird", "x"], specs)).toEqual({ positionals: ["--weird", "x"], flags: { level: "AA" } });
  });

  test("errors are reported, not thrown", () => {
    expect(parseArgs(["--nope"], specs).error).toBe("unknown option --nope");
    expect(parseArgs(["--level"], specs).error).toBe("--level needs a value");
    expect(parseArgs(["--level", "--color"], specs).error).toBe("--level needs a value");
    expect(parseArgs(["--level", "B"], specs).error).toContain("must be one of: AA, AAA");
    expect(parseArgs(["--color=maybe"], specs).error).toBe("--color does not take a value");
    expect(parseArgs(["--no-level"], specs).error).toBe("unknown option --no-level");
  });

  test("a lone dash and single-dash words are positionals", () => {
    expect(parseArgs(["-", "-x"], specs).positionals).toEqual(["-", "-x"]);
  });
});
