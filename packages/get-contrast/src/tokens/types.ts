// Design-token audit types. Tokens are read from a source format (JSON or CSS
// custom properties), resolved to colors, and checked against explicit
// foreground/background relationships. Nothing here writes files: fixes are
// returned as edits for a person (or an agent) to review.

export type TokenFormat = "json" | "css";

/** Where a token's value lives in its source, for reviewable edits. */
export type TokenSource =
  | { readonly format: "json"; readonly pointer: string }
  | { readonly format: "css"; readonly selector: string; readonly property: string };

export interface TokenDefinition {
  /** Dot path for JSON (`text.muted`), the property name for CSS (`--text-muted`). */
  readonly name: string;
  /** The value as written: a color, or a reference to another token. */
  readonly value: string;
  /** Declared type (`$type` in JSON), if any. */
  readonly type?: string;
  readonly source: TokenSource;
}

export interface TokenSet {
  readonly format: TokenFormat;
  /** Definitions in source order. */
  readonly tokens: readonly TokenDefinition[];
}

export type TokenIssueCode =
  | "unknown-token"
  | "circular-reference"
  | "not-a-color"
  | "unsupported-value";

/** Why a token could not be resolved to a color. */
export interface TokenIssue {
  readonly code: TokenIssueCode;
  readonly token: string;
  readonly message: string;
  /** Similarly named tokens, for `unknown-token`. */
  readonly suggestions?: readonly string[];
  /** The reference chain followed before failing. */
  readonly chain: readonly string[];
}

export class TokenSourceError extends Error {
  readonly code: "invalid-json" | "invalid-css" | "empty" | "unknown-format";
  constructor(code: TokenSourceError["code"], message: string) {
    super(message);
    this.name = "TokenSourceError";
    this.code = code;
  }
}

export class RelationError extends Error {
  readonly index: number;
  constructor(index: number, message: string) {
    super(`relation ${index}: ${message}`);
    this.name = "RelationError";
    this.index = index;
  }
}
