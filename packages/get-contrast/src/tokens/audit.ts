// auditTokens(): check explicit foreground/background token relationships and,
// for failures, suggest the smallest reviewable change.
//
// Suggestions prefer EXISTING tokens: among tokens that meet the target (as
// judged by pick()), the one perceptually nearest to the current value is
// recommended, because swapping to a nearby token is a smaller, more
// design-system-friendly change than inventing a color. Only when no existing
// token qualifies is a new color synthesized with fix(). Either way the result
// is an edit to the foreground token, never a file write.
import { deltaEOk } from "../color/distance.js";
import { toHex } from "../color/format.js";
import type { Color } from "../color/model.js";
import { fix } from "../solve.js";
import { pick } from "../pick.js";
import { check, resolveTarget } from "../wcag.js";
import type { CheckOptions, CheckResult } from "../wcag.js";
import { parseCssTokens } from "./css.js";
import { parseJsonTokens } from "./json.js";
import { parseRelations, type Relation, type RelationInput } from "./relations.js";
import { findToken, resolveToken } from "./resolve.js";
import {
  TokenSourceError,
  type TokenFormat,
  type TokenIssue,
  type TokenSet,
  type TokenSource,
} from "./types.js";

/** Parses token source text. The format is sniffed when not given. */
export function parseTokens(text: string, options: { format?: TokenFormat; scope?: string } = {}): TokenSet {
  const trimmed = text.trim();
  if (trimmed === "") throw new TokenSourceError("empty", "the token file is empty");
  const format: TokenFormat | undefined = options.format ?? (trimmed.startsWith("{") ? "json" : /--[\w-]+\s*:/.test(trimmed) ? "css" : undefined);
  if (format !== "json" && format !== "css") {
    throw new TokenSourceError("unknown-format", "could not tell whether this is JSON tokens or CSS custom properties; pass the format explicitly");
  }
  const tokens = format === "json" ? parseJsonTokens(trimmed) : parseCssTokens(trimmed, options.scope);
  return { format, tokens };
}

export interface AuditTokensOptions extends CheckOptions {
  /**
   * Glob(s) (`*` wildcards) of token names considered when suggesting an
   * existing token. Default: tokens in the foreground token's own namespace
   * (`text.*` for `text.muted`, `--text-*` for `--text-muted`). A relation's
   * own `candidates` takes precedence.
   */
  readonly candidates?: string | readonly string[];
  /** How many other passing tokens to list besides the recommended one. Default 3. */
  readonly maxAlternatives?: number;
}

export interface TokenReference {
  readonly token: string;
  /** The value as written in the source. */
  readonly written: string;
  /** `#rrggbb` of the resolved color (display only). */
  readonly hex: string;
  /** The aliases / var() references followed, starting with this token. */
  readonly chain: readonly string[];
  readonly color: Color;
}

export interface ExistingSuggestion {
  readonly token: string;
  readonly hex: string;
  readonly ratio: number;
  readonly ratioText: string;
  /** Perceptual distance from the current value (OKLab; black to white = 1). */
  readonly deltaE: number;
}

export interface SynthesizedSuggestion {
  readonly css: string;
  readonly reached: boolean;
  readonly limitedBy: "max-change" | "unreachable" | null;
  readonly ratio: number;
  readonly ratioText: string;
  readonly deltaE: number;
  readonly dimensions: readonly string[];
  readonly noteCodes: readonly string[];
}

export interface TokenEdit {
  /** The token to change (always the relation's foreground). */
  readonly token: string;
  readonly from: string;
  readonly to: string;
  readonly kind: "existing-token" | "synthesized";
  readonly source: TokenSource;
}

export interface TokenSuggestion {
  readonly recommended: "existing" | "synthesized" | null;
  readonly existing: ExistingSuggestion | null;
  readonly alternatives: readonly ExistingSuggestion[];
  readonly synthesized: SynthesizedSuggestion | null;
  /** What the recommendation changes the foreground token to. */
  readonly edit: TokenEdit | null;
  /** The pair after applying the recommendation (re-checked, not assumed). */
  readonly after: { readonly ratio: number; readonly ratioText: string; readonly passes: boolean } | null;
  /** The glob(s) existing tokens were searched in, and how many were considered. */
  readonly searched: { readonly pattern: readonly string[]; readonly considered: number };
  readonly reason: string;
}

export interface RelationResult {
  readonly index: number;
  readonly name: string;
  readonly status: "pass" | "fail" | "error";
  readonly target: { readonly level: string; readonly use: string; readonly threshold: number; readonly custom: boolean };
  readonly foreground: TokenReference | null;
  readonly background: TokenReference | null;
  readonly ratio?: number;
  readonly ratioText?: string;
  readonly check?: CheckResult;
  /** Why a token could not be resolved (status "error"). */
  readonly issues: readonly TokenIssue[];
  /** Present when status is "fail". */
  readonly suggestion?: TokenSuggestion;
}

export interface TokenAuditNote {
  readonly code: "conflicting-edits" | "edit-regression";
  readonly message: string;
}

/**
 * The recommended edits applied in memory and every relation re-checked. `ok`
 * is false if some relation that passed, or that an edit was meant to fix, does
 * not pass afterwards (for example, an edited token is also a background in
 * another relation, or two relations wanted different values for one token).
 */
export interface EditVerification {
  readonly ok: boolean;
  readonly regressions: readonly { readonly index: number; readonly name: string; readonly status: "fail" | "error" }[];
}

export interface TokenAuditResult {
  readonly format: TokenFormat;
  readonly relations: readonly RelationResult[];
  /** Recommended edits, de-duplicated by token and in relation order. */
  readonly edits: readonly TokenEdit[];
  readonly summary: { readonly relations: number; readonly pass: number; readonly fail: number; readonly error: number };
  readonly verification: EditVerification;
  readonly notes: readonly TokenAuditNote[];
}

/** RFC 6902 operations for the JSON-sourced edits. CSS edits have no JSON Pointer and are skipped. */
export function toJsonPatch(edits: readonly TokenEdit[]): { op: "replace"; path: string; value: string }[] {
  return edits.flatMap((edit) => (edit.source.format === "json" ? [{ op: "replace" as const, path: edit.source.pointer, value: edit.to }] : []));
}

function globToRegExp(glob: string): RegExp {
  return new RegExp("^" + glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
}

/** The default candidate pool: tokens sharing the foreground token's first name segment. */
function defaultPattern(set: TokenSet, token: string): string {
  if (set.format === "css") {
    const first = token.replace(/^--/, "").split("-")[0];
    return `--${first}-*`;
  }
  return `${token.split(".")[0]}.*`;
}

const toArray = (v: string | readonly string[] | undefined): readonly string[] | undefined =>
  v === undefined ? undefined : typeof v === "string" ? [v] : v;

function reference(set: TokenSet, name: string): { ok: true; ref: TokenReference } | { ok: false; issue: TokenIssue } {
  const resolved = resolveToken(set, name);
  if (!resolved.ok) return resolved;
  const definition = findToken(set, name)!;
  return {
    ok: true,
    ref: { token: definition.name, written: definition.value, hex: toHex(resolved.color), chain: resolved.chain, color: resolved.color },
  };
}

/**
 * Audits relations (as accepted by `parseRelations`) over `set`. Never throws for
 * problems in the token data:
 * unresolvable tokens become relations with status "error" and actionable
 * issues. Throws `RelationError` for malformed relations and `RangeError` for
 * invalid options.
 */
export function auditTokens(set: TokenSet, relationInput: readonly (Relation | RelationInput)[], options: AuditTokensOptions = {}): TokenAuditResult {
  const relations = parseRelations(relationInput); // accepts the same shorthands; idempotent for Relation objects
  const maxAlternatives = options.maxAlternatives ?? 3;
  if (!(Number.isInteger(maxAlternatives) && maxAlternatives >= 0)) throw new RangeError("maxAlternatives must be a non-negative integer");
  resolveTarget(options); // validate options up front

  const evaluated = evaluate(set, relations, options);

  // Foreground tokens of failing relations are the ones that will be edited, so
  // they (and anything that aliases them) cannot be offered as replacements.
  const edited = new Set(evaluated.filter((e) => e.status === "fail").map((e) => e.fg!.token));

  const results: RelationResult[] = evaluated.map((e, index): RelationResult => {
    const relation = relations[index];
    const common = { index, name: e.name, target: e.target, foreground: e.fg, background: e.bg };
    if (e.status === "error") return { ...common, status: "error", issues: e.issues };
    const base = { ...common, ratio: e.result!.ratio, ratioText: e.result!.ratioText, check: e.result!, issues: [] as TokenIssue[] };
    if (e.status === "pass") return { ...base, status: "pass" };

    const fg = e.fg!;
    const bg = e.bg!;
    const targetOptions = e.targetOptions;

    // -- A failing relation: look for an existing token first. ---------------
    const patterns = toArray(relation.candidates) ?? toArray(options.candidates) ?? [defaultPattern(set, fg.token)];
    const matchers = patterns.map(globToRegExp);
    const pool: { name: string; color: Color }[] = [];
    for (const definition of set.tokens) {
      if (definition.name === fg.token || definition.name === bg.token) continue;
      if (!matchers.some((m) => m.test(definition.name))) continue;
      const resolved = resolveToken(set, definition.name);
      if (!resolved.ok) continue;
      if (resolved.chain.some((link) => edited.has(link))) continue; // its value is about to change
      if (pool.some((p) => deltaEOk(p.color, resolved.color) === 0 && p.color.alpha === resolved.color.alpha)) continue; // same color, earlier token wins
      pool.push({ name: definition.name, color: resolved.color });
    }

    let existing: ExistingSuggestion | null = null;
    let alternatives: ExistingSuggestion[] = [];
    let qualifying = 0;
    if (pool.length > 0) {
      const ranked = pick(bg.color, pool.map((p) => ({ name: p.name, color: p.color })), targetOptions).ranked;
      const passing = ranked
        .filter((r) => r.passes)
        .map((r) => ({
          token: r.name as string,
          hex: r.check.foreground.hex,
          ratio: r.check.ratio,
          ratioText: r.check.ratioText,
          deltaE: deltaEOk(fg.color, pool[r.index].color),
          rank: r.rank,
        }))
        // nearest to the current value; ties keep pick()'s order
        .sort((a, b) => a.deltaE - b.deltaE || a.rank - b.rank)
        .map(({ rank: _rank, ...rest }) => rest);
      qualifying = passing.length;
      existing = passing[0] ?? null;
      alternatives = passing.slice(1, 1 + maxAlternatives);
    }

    // -- Otherwise (or additionally, for comparison) synthesize one. ---------
    const fixed = fix(fg.color, bg.color, { ...targetOptions, change: "foreground" });
    const synthesized: SynthesizedSuggestion | null = fixed.suggested
      ? {
          css: fixed.suggested.css,
          reached: fixed.reached,
          limitedBy: fixed.limitedBy,
          ratio: fixed.suggested.check.ratio,
          ratioText: fixed.suggested.check.ratioText,
          deltaE: fixed.change.deltaE,
          dimensions: fixed.change.dimensions,
          noteCodes: fixed.notes.map((n) => n.code),
        }
      : null;

    const recommended = existing ? "existing" : synthesized && synthesized.reached ? "synthesized" : null;
    const definition = findToken(set, fg.token)!;
    let edit: TokenEdit | null = null;
    let after: TokenSuggestion["after"] = null;
    let reason: string;
    if (recommended === "existing" && existing) {
      const to = set.format === "json" ? `{${existing.token}}` : `var(${existing.token})`;
      edit = { token: definition.name, from: definition.value, to, kind: "existing-token", source: definition.source };
      after = { ratio: existing.ratio, ratioText: existing.ratioText, passes: true };
      reason = `Existing token ${existing.token} (${existing.hex}) meets the target at ${existing.ratioText}, the nearest to the current ${fg.hex} of ${qualifying} qualifying token${qualifying === 1 ? "" : "s"} in ${patterns.join(", ")}.`;
    } else if (recommended === "synthesized" && synthesized) {
      edit = { token: definition.name, from: definition.value, to: synthesized.css, kind: "synthesized", source: definition.source };
      after = { ratio: synthesized.ratio, ratioText: synthesized.ratioText, passes: true };
      reason = `No token in ${patterns.join(", ")} (${pool.length} considered) meets the target, so a new color ${synthesized.css} is suggested (${synthesized.ratioText}).`;
    } else {
      reason = `No token in ${patterns.join(", ")} (${pool.length} considered) meets the target, and no color in the ${synthesized ? "target gamut" : "given constraints"} can reach ${e.target.threshold}:1 against ${bg.hex}.`;
    }

    return {
      ...base,
      status: "fail",
      suggestion: { recommended, existing, alternatives, synthesized, edit, after, searched: { pattern: patterns, considered: pool.length }, reason },
    };
  });

  // De-duplicate edits by token; flag tokens whose relations want different values.
  const edits: TokenEdit[] = [];
  const notes: TokenAuditNote[] = [];
  const reported = new Set<string>();
  for (const r of results) {
    const edit = r.suggestion?.edit;
    if (!edit) continue;
    const earlier = edits.find((e) => e.token === edit.token);
    if (!earlier) {
      edits.push(edit);
    } else if (earlier.to !== edit.to && !reported.has(edit.token)) {
      reported.add(edit.token);
      notes.push({
        code: "conflicting-edits",
        message: `Token "${edit.token}" appears as the foreground of several failing relations that want different values ("${earlier.to}" and "${edit.to}"). Only the first is listed in edits; review the relations together.`,
      });
    }
  }

  // Apply the edits in memory and re-check every relation.
  const verification = verify(set, relations, options, edits, results, notes);

  const count = (status: RelationResult["status"]) => results.filter((r) => r.status === status).length;
  return {
    format: set.format,
    relations: results,
    edits,
    summary: { relations: results.length, pass: count("pass"), fail: count("fail"), error: count("error") },
    verification,
    notes,
  };
}

interface Evaluated {
  readonly name: string;
  readonly status: "pass" | "fail" | "error";
  readonly target: RelationResult["target"];
  readonly targetOptions: CheckOptions;
  readonly fg: TokenReference | null;
  readonly bg: TokenReference | null;
  readonly result?: CheckResult;
  readonly issues: TokenIssue[];
}

/** Resolves and checks every relation (no suggestions). */
function evaluate(set: TokenSet, relations: readonly Relation[], options: AuditTokensOptions): Evaluated[] {
  return relations.map((relation) => {
    const name = relation.name ?? `${relation.foreground} on ${relation.background}`;
    const targetOptions: CheckOptions = {
      level: relation.level ?? options.level,
      use: relation.use ?? options.use,
      minRatio: relation.minRatio ?? options.minRatio,
      backdrop: options.backdrop,
    };
    const t = resolveTarget(targetOptions);
    const target = { level: t.level, use: t.use, threshold: t.threshold, custom: t.custom };
    const fg = reference(set, relation.foreground);
    const bg = reference(set, relation.background);
    const issues = [fg, bg].flatMap((r) => (r.ok ? [] : [r.issue]));
    if (!fg.ok || !bg.ok) {
      return { name, status: "error" as const, target, targetOptions, fg: fg.ok ? fg.ref : null, bg: bg.ok ? bg.ref : null, issues };
    }
    const result = check(fg.ref.color, bg.ref.color, targetOptions);
    return { name, status: result.target.passes ? ("pass" as const) : ("fail" as const), target, targetOptions, fg: fg.ref, bg: bg.ref, result, issues: [] };
  });
}

function verify(
  set: TokenSet,
  relations: readonly Relation[],
  options: AuditTokensOptions,
  edits: readonly TokenEdit[],
  before: readonly RelationResult[],
  notes: TokenAuditNote[]
): EditVerification {
  if (edits.length === 0) return { ok: true, regressions: [] };
  const byToken = new Map(edits.map((e) => [e.token, e.to]));
  const patched: TokenSet = {
    format: set.format,
    tokens: set.tokens.map((t) => (byToken.has(t.name) ? { ...t, value: byToken.get(t.name)! } : t)),
  };
  const after = evaluate(patched, relations, options);
  const regressions: { index: number; name: string; status: "fail" | "error" }[] = [];
  after.forEach((a, index) => {
    const was = before[index];
    const shouldPass = was.status === "pass" || (was.status === "fail" && Boolean(was.suggestion?.edit));
    if (shouldPass && a.status !== "pass") regressions.push({ index, name: a.name, status: a.status as "fail" | "error" });
  });
  for (const r of regressions) {
    notes.push({
      code: "edit-regression",
      message: `After applying the edits, "${r.name}" no longer meets its target. An edited token is probably also used by another relation; review the edits together.`,
    });
  }
  return { ok: regressions.length === 0, regressions };
}
