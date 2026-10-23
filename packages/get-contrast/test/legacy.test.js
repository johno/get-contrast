const { test, expect } = require("bun:test");
const contrast = require("..");

test("ratio", () => {
  expect(Math.round(contrast.ratio("#fafafa", "rgba(0,0,0,.75)"))).toBe(20);
  expect(contrast.ratio("tomato", "rebeccapurple")).toBeTruthy();
});

test("score", () => {
  expect(contrast.score("#fafafa", "rgba(0,0,0,.75)")).toBe("AAA");
  expect(contrast.score("#fafafa", "#fff")).toBe("Fail");
  expect(contrast.score("tomato", "DarkSlateGray")).toBe("AA Large");
});

test("isAccessible", () => {
  expect(contrast.isAccessible("#fafafa", "#fff")).toBeFalsy();
  expect(contrast.isAccessible("#fafafa", "rgba(0,0,0,.75)")).toBeTruthy();
});

test("isNotTransparent", () => {
  expect(() => contrast.isNotTransparent("rgba(255,255,255,0)")).toThrow();
  expect(() => contrast.isNotTransparent("hsl(100,100,100,0)")).toThrow();
  expect(() => contrast.isNotTransparent("transparent")).toThrow();
  expect(() => contrast.isNotTransparent("#FFFFFF00")).toThrow();

  expect(
    contrast.isNotTransparent("rgba(0, 0, 0, 0)", { ignoreAlpha: true })
  ).toBeTruthy();
});
