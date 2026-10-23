import { RelationError } from "./types.js";
import type { WcagLevel, WcagUse } from "../wcag.js";

/** One foreground/background relationship between two tokens. */
export interface Relation {
  readonly foreground: string;
  readonly background: string;
  /** A label for reports. Default: "foreground on background". */
  readonly name?: string;
  /** Per-relation target; falls back to the audit's options. */
  readonly level?: WcagLevel;
  readonly use?: WcagUse;
  readonly minRatio?: number;
  /** Glob(s) of token names that may replace the foreground (see `auditTokens`). */
  readonly candidates?: string | readonly string[];
}

export type RelationInput =
  | string
  | readonly [string, string]
  | {
      readonly foreground: string;
      readonly background: string;
      readonly name?: string;
      readonly level?: string;
      readonly use?: string;
      readonly minRatio?: number;
      readonly candidates?: string | readonly string[];
    };

const LEVELS = ["AA", "AAA"];
const USES = ["text", "large-text", "ui"];

/**
 * Normalizes relations. Accepts:
 *   "text.default -> surface.default"
 *   ["text.default", "surface.default"]
 *   { foreground, background, level?, use?, minRatio?, name?, candidates? }
 * or an object with a `relations` array of those. Throws `RelationError`
 * (naming the offending entry) for anything malformed.
 */
export function parseRelations(input: unknown): Relation[] {
  const list =
    input !== null && typeof input === "object" && !Array.isArray(input) && "relations" in (input as object)
      ? (input as { relations: unknown }).relations
      : input;
  if (!Array.isArray(list)) throw new RelationError(0, 'expected an array of relations, or { "relations": [...] }');

  return list.map((entry, i): Relation => {
    if (typeof entry === "string") {
      const parts = entry.split("->").map((p) => p.trim());
      if (parts.length !== 2 || !parts[0] || !parts[1]) throw new RelationError(i, `"${entry}" should look like "foreground -> background"`);
      return { foreground: parts[0], background: parts[1] };
    }
    if (Array.isArray(entry)) {
      if (entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") {
        throw new RelationError(i, "an array relation is [foreground, background] (two token names)");
      }
      return { foreground: entry[0], background: entry[1] };
    }
    if (entry !== null && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      if (typeof o.foreground !== "string" || typeof o.background !== "string" || !o.foreground || !o.background) {
        throw new RelationError(i, 'an object relation needs string "foreground" and "background"');
      }
      if (o.level !== undefined && !LEVELS.includes(o.level as string)) throw new RelationError(i, `"level" must be one of: ${LEVELS.join(", ")}`);
      if (o.use !== undefined && !USES.includes(o.use as string)) throw new RelationError(i, `"use" must be one of: ${USES.join(", ")}`);
      if (o.minRatio !== undefined && !(typeof o.minRatio === "number" && o.minRatio >= 1 && o.minRatio <= 21)) {
        throw new RelationError(i, '"minRatio" must be a number from 1 to 21');
      }
      if (o.candidates !== undefined && !(typeof o.candidates === "string" || (Array.isArray(o.candidates) && o.candidates.every((c) => typeof c === "string")))) {
        throw new RelationError(i, '"candidates" must be a glob string or an array of them');
      }
      return {
        foreground: o.foreground,
        background: o.background,
        ...(typeof o.name === "string" ? { name: o.name } : {}),
        ...(o.level !== undefined ? { level: o.level as WcagLevel } : {}),
        ...(o.use !== undefined ? { use: o.use as WcagUse } : {}),
        ...(o.minRatio !== undefined ? { minRatio: o.minRatio as number } : {}),
        ...(o.candidates !== undefined ? { candidates: o.candidates as string | readonly string[] } : {}),
      };
    }
    throw new RelationError(i, "a relation is a string, a [foreground, background] pair, or an object");
  });
}
