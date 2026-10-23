// The get-contrast MCP tools: thin adapters over the library. This file maps
// tool arguments to library calls and library results to tool responses. It
// contains no color or contrast logic: every number comes from `lib`.
//
// Every tool is read-only: nothing here touches the filesystem or the network.
// Callers pass file CONTENTS (token text, palettes), not paths.
const { validate } = require("./schema");

const COLOR_HELP = "a CSS color: hex, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch(), color(display-p3 ...), or a named color; alpha is allowed";

const color = (description) => ({ type: "string", description: `${description} (${COLOR_HELP}).` });

const TARGET = {
  level: { type: "string", enum: ["AA", "AAA"], description: "WCAG 2.2 level to hold the pair to. Default AA." },
  use: {
    type: "string",
    enum: ["text", "large-text", "ui"],
    description: "What the color is used for: text (AA 4.5:1, AAA 7:1), large-text (18pt, or 14pt bold: AA 3:1, AAA 4.5:1), ui (components and graphics: 3:1). Default text.",
  },
  minRatio: { type: "number", minimum: 1, maximum: 21, description: "A custom minimum contrast ratio that replaces level/use, for project policies WCAG does not name." },
  backdrop: color("The opaque color behind a translucent background. Default #ffffff"),
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const CANDIDATE = {
  anyOf: [{ type: "string" }, { type: "object", properties: { name: { type: "string" }, color: { type: "string" } }, required: ["color"], additionalProperties: false }],
};

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const TARGET_KEYS = ["level", "use", "minRatio", "backdrop"];

const label = (t) => (t.custom ? `custom ${t.threshold}:1` : `${t.level} ${t.use === "large-text" ? "large text" : t.use === "ui" ? "UI components" : "text"} (${t.threshold}:1)`);

function build(lib, version) {
  const ok = (tool, status, result, text, extra = {}) => ({
    isError: false,
    content: [{ type: "text", text }],
    structuredContent: { schema: 1, tool, status, result, ...extra },
  });

  const failure = (tool, kind, code, message, extra = {}) => ({
    isError: true,
    content: [{ type: "text", text: `${kind}: ${message}` }],
    structuredContent: { schema: 1, tool, status: "error", error: { kind, code, message }, ...extra },
  });

  /** Sorts anything the library throws into the four categories agents need to tell apart. */
  function classify(tool, error) {
    if (lib.ColorInputError && error instanceof lib.ColorInputError) {
      const unsupported = error.code === "unsupported-function" || error.code === "unsupported-color-space";
      const result = failure(tool, unsupported ? "unsupported-syntax" : "invalid-input", error.code, error.message);
      result.structuredContent.error.role = error.role;
      result.structuredContent.error.input = error.input;
      return result;
    }
    if (lib.TokenSourceError && error instanceof lib.TokenSourceError) return failure(tool, "invalid-input", error.code, error.message);
    if (lib.RelationError && error instanceof lib.RelationError) return failure(tool, "invalid-input", "invalid-relations", error.message);
    if (error instanceof RangeError) return failure(tool, "invalid-input", "invalid-option", error.message);
    throw error; // a bug, not bad input: reported by the server as a tool-failure
  }

  const tools = [
    {
      name: "check_contrast",
      title: "Check contrast",
      description:
        "Check a foreground/background color pair against WCAG 2.2. Returns the contrast ratio, whether it passes AA/AAA for normal text, large text and UI components, and whether it meets the requested target. Translucent colors are composited like a browser. Use this to verify any pair, before and after a change. A failing pair is a normal result (status \"fail\"), not an error.",
      inputSchema: {
        type: "object",
        properties: { foreground: color("The text or icon color"), background: color("The color it is drawn on"), ...TARGET },
        required: ["foreground", "background"],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      run(args) {
        const r = lib.check(args.foreground, args.background, pick(args, TARGET_KEYS));
        const yes = (b) => (b ? "pass" : "fail");
        const text =
          `${r.target.passes ? "PASS" : "FAIL"}: ${r.foreground.hex} on ${r.background.hex} is ${r.ratioText}; target ${label(r.target)}. ` +
          `AA text ${yes(r.results.aa.text)}, AA large ${yes(r.results.aa.largeText)}, AAA text ${yes(r.results.aaa.text)}, AAA large ${yes(r.results.aaa.largeText)}, UI ${yes(r.results.ui)}.` +
          r.notes.map((n) => ` Note: ${n.message}`).join("");
        return ok("check_contrast", r.target.passes ? "pass" : "fail", r, text);
      },
    },
    {
      name: "check_wcag",
      title: "WCAG contrast ratio",
      description: "Return the WCAG 2.2 contrast ratio between two colors and what was measured (the opaque colors after compositing, and their relative luminance), without judging pass or fail. Use when you only need the number or want to see how transparency was handled.",
      inputSchema: {
        type: "object",
        properties: { foreground: color("The text or icon color"), background: color("The color it is drawn on"), backdrop: TARGET.backdrop },
        required: ["foreground", "background"],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      run(args) {
        const r = lib.wcag(args.foreground, args.background, pick(args, ["backdrop"]));
        return ok("check_wcag", "info", r, `${r.foreground.hex} on ${r.background.hex}: contrast ratio ${r.ratio} (WCAG 2.2).` + r.notes.map((n) => ` Note: ${n.message}`).join(""));
      },
    },
    {
      name: "pick_color",
      title: "Pick an existing color",
      description:
        "Rank candidate foreground colors on a background and pick the best one that meets the WCAG target (highest contrast among those that pass; ties keep input order). Prefer this over inventing a color: pass the project's existing palette or token values as candidates. If none passes, there is no winner and the closest is listed first.",
      inputSchema: {
        type: "object",
        properties: {
          background: color("The color the text sits on"),
          candidates: { type: "array", minItems: 1, items: CANDIDATE, description: "Colors to choose from: strings, or { name, color } to label them (for example with token names)." },
          ...TARGET,
        },
        required: ["background", "candidates"],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      run(args) {
        const r = lib.pick(args.background, args.candidates, pick(args, TARGET_KEYS));
        return ok("pick_color", r.winner ? "pass" : "fail", r, r.winner ? `Winner: ${r.reason}` : `No winner: ${r.reason}`);
      },
    },
    {
      name: "find_accessible_color",
      title: "Find the nearest accessible color",
      description:
        "Given a color that fails against another, find the smallest perceptual change (in OKLCH; lightness only by default, keeping hue and chroma) that meets the WCAG target. `color` is the one that changes; `against` stays fixed. Returns the suggestion as ready-to-paste CSS, before/after checks, the perceptual change, and notes. Never claims success it did not verify: check `reached`. If the pair already passes, nothing changes.",
      inputSchema: {
        type: "object",
        properties: {
          color: color("The color to adjust"),
          against: color("The color that stays fixed"),
          role: { type: "string", enum: ["foreground", "background"], description: "Which side `color` is. Default foreground (it is text on `against`)." },
          ...TARGET,
          direction: { type: "string", enum: ["auto", "darker", "lighter"], description: "Which way to move lightness. Default auto: whichever changes the color less." },
          preserveChroma: { type: "boolean", description: "Keep the original chroma where the gamut allows (default true). False lets the solver also lower chroma if that changes the color less." },
          gamut: { type: "string", enum: ["srgb", "display-p3"], description: "Gamut the result must fit. Default srgb." },
          maxChange: { type: "number", minimum: 0, description: "Largest allowed perceptual change as an OKLab distance (black to white is 1; 0.05 is a small tweak). Beyond it the target is reported as not reached." },
        },
        required: ["color", "against"],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      run(args) {
        const r = lib.find(args.color, args.against, pick(args, ["role", ...TARGET_KEYS, "direction", "preserveChroma", "gamut", "maxChange"]));
        let text;
        if (!r.changed && r.reached) text = `PASS: ${r.notes[0].message}`;
        else if (r.suggested) {
          text =
            `${r.reached ? "PASS" : "FAIL"}: suggested ${r.suggested.css} (was ${r.original.check[r.adjusted].hex}), ${r.suggested.check.ratioText} vs ${r.original.check.ratioText} before; ` +
            `perceptual change ${r.change.deltaE.toFixed(3)} (${r.change.dimensions.join(", ") || "within rounding"}).` +
            (r.reached ? "" : ` Target ${label(r.target)} not met (${r.limitedBy}).`) +
            r.notes.map((n) => ` Note: ${n.message}`).join("");
        } else text = `FAIL: no change within the constraints improves ${r.original.check.ratioText} (target ${label(r.target)}; ${r.limitedBy}).`;
        return ok("find_accessible_color", r.reached ? "pass" : "fail", r, text);
      },
    },
    {
      name: "audit_palette",
      title: "Audit a palette",
      description:
        "Audit every foreground/background relationship in a palette: the all-pairs ratio matrix, which pairs meet the target, and for each background the best foreground colors. Repeated colors are noted and counted once. Informational: it does not fail a palette for having pairs that never go together.",
      inputSchema: {
        type: "object",
        properties: {
          palette: {
            anyOf: [{ type: "array", items: CANDIDATE }, { type: "object" }],
            description: "An array of colors or { name, color } objects, or a { name: color } map.",
          },
          ...TARGET,
          only: { type: "string", enum: ["passing", "failing"], description: "List only passing or failing pairs in `pairs` (the matrix and summary always cover everything)." },
          maxColors: { type: "integer", minimum: 1, description: "Safety limit on unique colors (default 200)." },
        },
        required: ["palette"],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      run(args) {
        const r = lib.audit(args.palette, pick(args, [...TARGET_KEYS, "only", "maxColors"]));
        const s = r.summary;
        const name = (i) => r.colors[i].name || r.colors[i].hex;
        const lines = [`${s.colors} colors${s.duplicates ? ` (${s.unique} unique)` : ""}, ${s.pairs} pairs: ${s.passing} meet ${label(r.target)}, ${s.failing} do not.`];
        for (const rec of r.recommendations) {
          lines.push(rec.best !== null ? `On ${name(rec.background)}: best ${name(rec.best)} (${rec.candidates.length} qualify).` : `On ${name(rec.background)}: none meets the target${rec.closest !== null ? ` (closest ${name(rec.closest)})` : ""}.`);
        }
        return ok("audit_palette", "info", r, lines.join("\n"));
      },
    },
    {
      name: "audit_tokens",
      title: "Audit design tokens",
      description:
        "Audit design tokens against explicit foreground/background relationships (not every possible pair) and get reviewable fixes. For each failing relation it suggests the nearest EXISTING token that meets the target before synthesizing a new color, and returns edits plus an RFC 6902 patch for JSON tokens. It never edits files: apply the edits yourself, then call this tool again to verify. Unresolvable tokens are reported per relation with suggestions.",
      inputSchema: {
        type: "object",
        properties: {
          tokens: { anyOf: [{ type: "string" }, { type: "object" }], description: "The token file CONTENTS: JSON (as text or an object; W3C '$value' / Style Dictionary 'value'; aliases like \"{color.gray.500}\") or CSS custom properties (text)." },
          relations: {
            type: "array",
            items: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }, { type: "object" }] },
            description: 'Relationships to audit: "text.muted -> surface.default" strings, [foreground, background] pairs, or { foreground, background, name?, level?, use?, minRatio?, candidates? }.',
          },
          format: { type: "string", enum: ["json", "css"], description: "Token format. Default: detected." },
          scope: { type: "string", description: "CSS only: audit a scope, for example [data-theme=dark] or @media (prefers-color-scheme: dark). Default :root." },
          candidates: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Token-name globs (with *) to search for replacements. Default: the foreground token's own namespace, such as text.*." },
          ...TARGET,
        },
        required: ["tokens", "relations"],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      run(args) {
        const set = lib.parseTokens(typeof args.tokens === "string" ? args.tokens : JSON.stringify(args.tokens), pick(args, ["format", "scope"]));
        const relations = lib.parseRelations(args.relations);
        const r = lib.auditTokens(set, relations, { ...pick(args, TARGET_KEYS), ...(args.candidates ? { candidates: args.candidates } : {}) });
        const s = r.summary;
        const lines = [`${s.relations} relations: ${s.pass} pass, ${s.fail} fail${s.error ? `, ${s.error} unresolved` : ""}.`];
        for (const rel of r.relations) {
          if (rel.status === "fail") lines.push(`FAIL ${rel.name} ${rel.ratioText}: ${rel.suggestion.reason}`);
          if (rel.status === "error") lines.push(`ERROR ${rel.name}: ${rel.issues.map((i) => i.message).join(" ")}`);
        }
        for (const e of r.edits) lines.push(`Edit ${e.token}: ${e.from} -> ${e.to}`);
        if (!r.verification.ok) lines.push("Warning: applying these edits would break another relation; see result.verification.");
        const patch = lib.toJsonPatch(r.edits);
        if (s.error) {
          const out = failure("audit_tokens", "invalid-input", "unresolved-tokens", lines.join("\n"), { result: r, patch });
          return out;
        }
        return ok("audit_tokens", s.fail ? "fail" : "pass", r, lines.join("\n"), { patch });
      },
    },
  ];

  // Wrap each run(): validate arguments, then sort library errors into categories.
  return tools.map((tool) => ({
    ...tool,
    run(args) {
      const problems = validate(tool.inputSchema, args);
      if (problems.length) return failure(tool.name, "invalid-input", "invalid-arguments", problems.join("; "));
      try {
        return tool.run(args);
      } catch (error) {
        return classify(tool.name, error);
      }
    },
  }));
}

module.exports = { build };
