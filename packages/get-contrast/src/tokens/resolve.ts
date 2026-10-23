import type { Color } from "../color/model.js";
import { parseColor } from "../color/parse.js";
import { cssVar } from "./css.js";
import { jsonAlias } from "./json.js";
import type { TokenDefinition, TokenIssue, TokenSet } from "./types.js";

export type Resolution =
  | { readonly ok: true; readonly token: string; readonly value: string; readonly color: Color; readonly chain: readonly string[] }
  | { readonly ok: false; readonly issue: TokenIssue };

/** Edit distance, capped: enough for "did you mean" suggestions. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

export function suggestNames(set: TokenSet, name: string): string[] {
  const wanted = name.replace(/^--/, "").toLowerCase();
  return set.tokens
    .map((t) => ({ name: t.name, d: distance(t.name.replace(/^--/, "").toLowerCase(), wanted) }))
    .filter((c) => c.d <= Math.max(2, Math.floor(wanted.length / 4)))
    .sort((x, y) => x.d - y.d)
    .slice(0, 3)
    .map((c) => c.name);
}

export function findToken(set: TokenSet, name: string): TokenDefinition | undefined {
  const exact = set.tokens.find((t) => t.name === name);
  if (exact) return exact;
  // CSS tokens may be referred to without the leading "--".
  if (set.format === "css" && !name.startsWith("--")) return set.tokens.find((t) => t.name === `--${name}`);
  return undefined;
}

/** Resolves a token to a color, following aliases (`{a.b}`) and `var(--x)` references. */
export function resolveToken(set: TokenSet, name: string): Resolution {
  const chain: string[] = [];

  const fail = (code: TokenIssue["code"], token: string, message: string, suggestions?: string[]): Resolution => ({
    ok: false,
    issue: { code, token, message, ...(suggestions && suggestions.length ? { suggestions } : {}), chain: [...chain] },
  });

  const follow = (tokenName: string, from: string | null): Resolution => {
    const definition = findToken(set, tokenName);
    if (!definition) {
      const suggestions = suggestNames(set, tokenName);
      const where = from ? ` (referenced by "${from}")` : "";
      const hint = suggestions.length ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(", ")}?` : "";
      return fail("unknown-token", tokenName, `Unknown token "${tokenName}"${where}.${hint}`, suggestions);
    }
    if (chain.includes(definition.name)) {
      return fail("circular-reference", definition.name, `Circular reference: ${[...chain, definition.name].join(" -> ")}`);
    }
    chain.push(definition.name);

    const reference = set.format === "json" ? jsonAlias(definition.value) : null;
    if (reference) return follow(reference, definition.name);

    if (set.format === "css") {
      const v = cssVar(definition.value);
      if (v) {
        if (findToken(set, v.name)) return follow(v.name, definition.name);
        if (v.fallback !== null) return evaluate(v.fallback, definition);
        return follow(v.name, definition.name); // reports unknown-token
      }
    }
    return evaluate(definition.value, definition);
  };

  const evaluate = (value: string, definition: TokenDefinition): Resolution => {
    // A fallback can itself be a var().
    if (set.format === "css") {
      const v = cssVar(value);
      if (v) return findToken(set, v.name) ? follow(v.name, definition.name) : v.fallback !== null ? evaluate(v.fallback, definition) : follow(v.name, definition.name);
    }
    const parsed = parseColor(value);
    if (parsed.ok) return { ok: true, token: name, value, color: parsed.color, chain: [...chain] };
    const code = parsed.error.code === "unsupported-function" || parsed.error.code === "unsupported-color-space" ? "unsupported-value" : "not-a-color";
    const detail = code === "unsupported-value" ? parsed.error.message : "it is not a color";
    return fail(code, definition.name, `Token "${definition.name}" has the value "${value}", and ${detail}.`);
  };

  return follow(name, null);
}
