const { describe, test, expect } = require("bun:test");
const { colorEnabled, createStyle } = require("../src/style");

describe("colorEnabled", () => {
  const tty = { isTTY: true, env: {} };
  test("on for a terminal, off when piped", () => {
    expect(colorEnabled(tty)).toBe(true);
    expect(colorEnabled({ isTTY: false, env: {} })).toBe(false);
    expect(colorEnabled({ isTTY: undefined, env: {} })).toBe(false);
  });

  test("NO_COLOR and TERM=dumb win over a terminal", () => {
    expect(colorEnabled({ isTTY: true, env: { NO_COLOR: "1" } })).toBe(false);
    expect(colorEnabled({ isTTY: true, env: { TERM: "dumb" } })).toBe(false);
    expect(colorEnabled({ isTTY: true, env: { NO_COLOR: "" } })).toBe(true); // empty means unset
  });

  test("FORCE_COLOR turns it on for pipes, 0 does not", () => {
    expect(colorEnabled({ isTTY: false, env: { FORCE_COLOR: "1" } })).toBe(true);
    expect(colorEnabled({ isTTY: false, env: { FORCE_COLOR: "0" } })).toBe(false);
    expect(colorEnabled({ isTTY: false, env: { FORCE_COLOR: "1", NO_COLOR: "1" } })).toBe(false);
  });

  test("an explicit flag beats everything", () => {
    expect(colorEnabled({ isTTY: false, env: { NO_COLOR: "1" } }, true)).toBe(true);
    expect(colorEnabled({ isTTY: true, env: { FORCE_COLOR: "1" } }, false)).toBe(false);
  });
});

describe("createStyle", () => {
  test("disabled: returns the text unchanged", () => {
    const s = createStyle(false);
    expect(s.red("x")).toBe("x");
    expect(s.pass()).toBe("pass");
    expect(s.fail()).toBe("fail");
    expect(s.bold(12)).toBe("12");
  });

  test("enabled: wraps in ANSI codes that reset", () => {
    const s = createStyle(true);
    expect(s.green("ok")).toBe("\u001b[32mok\u001b[39m");
    expect(s.bold("b")).toBe("\u001b[1mb\u001b[22m");
    expect(s.pass()).toContain("\u001b[32m");
    expect(s.fail()).toContain("\u001b[31m");
  });
});
