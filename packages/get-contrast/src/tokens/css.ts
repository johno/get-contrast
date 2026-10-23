// CSS custom properties. Only what is needed to audit colors: rule blocks
// (nested one level inside at-rules are flattened) and `--name: value`
// declarations, with `var(--other[, fallback])` references. Comments are
// stripped. A "scope" is a selector (`:root`, `[data-theme=dark]`) or an
// at-rule prelude (`@media (prefers-color-scheme: dark)`); values from `:root`
// apply first and a scope's declarations override them, like the cascade.
import { TokenSourceError, type TokenDefinition } from "./types.js";

interface Block {
  selectors: string[];
  atRules: string[];
  declarations: { property: string; value: string }[];
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseBlocks(css: string): Block[] {
  const blocks: Block[] = [];
  let index = 0;
  const readUntil = (chars: string): string => {
    const start = index;
    while (index < css.length && !chars.includes(css[index])) index++;
    return css.slice(start, index);
  };

  const parseBody = (atRules: string[], depth: number): void => {
    while (index < css.length) {
      const prelude = readUntil("{};").trim();
      if (index >= css.length) {
        if (prelude) throw new TokenSourceError("invalid-css", `unexpected text "${prelude.slice(0, 40)}" at the end of the file`);
        if (depth !== 0) throw new TokenSourceError("invalid-css", "missing } at the end of the file");
        return;
      }
      const ch = css[index++];
      if (ch === "}") {
        if (depth === 0) throw new TokenSourceError("invalid-css", "unmatched } in CSS");
        return;
      }
      if (ch === ";") continue; // e.g. @import ...;
      // ch === "{": a rule or an at-rule block
      if (prelude.startsWith("@")) {
        parseBody([...atRules, prelude], depth + 1);
      } else {
        const declarations: Block["declarations"] = [];
        const inner = readUntil("}");
        if (index >= css.length) throw new TokenSourceError("invalid-css", `missing } after "${prelude.slice(0, 40)}"`);
        index++; // }
        for (const declaration of inner.split(";")) {
          const colon = declaration.indexOf(":");
          if (colon === -1) continue;
          const property = declaration.slice(0, colon).trim();
          if (!property.startsWith("--")) continue;
          const value = declaration.slice(colon + 1).replace(/!important\s*$/i, "").trim();
          declarations.push({ property, value });
        }
        blocks.push({ selectors: prelude.split(",").map((s) => s.trim()).filter(Boolean), atRules, declarations });
      }
    }
  };
  parseBody([], 0);
  return blocks;
}

export function parseCssTokens(text: string, scope = ":root"): TokenDefinition[] {
  const blocks = parseBlocks(stripComments(text));
  const applies = (block: Block, wanted: string) => block.selectors.includes(wanted) || block.atRules.includes(wanted);

  // Base: top-level :root. Then the scope's own declarations on top.
  const layers: { block: Block; selector: string }[] = [];
  for (const block of blocks) if (block.atRules.length === 0 && block.selectors.includes(":root")) layers.push({ block, selector: ":root" });
  if (scope !== ":root") {
    for (const block of blocks) {
      if (applies(block, scope)) layers.push({ block, selector: block.selectors.includes(scope) ? scope : block.selectors[0] });
    }
  }

  const byName = new Map<string, TokenDefinition>();
  for (const { block, selector } of layers) {
    for (const { property, value } of block.declarations) {
      byName.set(property, { name: property, value, source: { format: "css", selector, property } });
    }
  }
  return [...byName.values()];
}

/** `var(--a)` / `var(--a, fallback)` -> { name, fallback }, or null if not a whole-value var(). */
export function cssVar(value: string): { name: string; fallback: string | null } | null {
  const match = /^var\(\s*(--[^\s,()]+)\s*(?:,\s*([\s\S]*))?\)$/.exec(value.trim());
  return match ? { name: match[1], fallback: match[2] === undefined ? null : match[2].trim() } : null;
}
