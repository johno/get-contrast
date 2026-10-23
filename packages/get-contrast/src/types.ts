/** Options accepted by the legacy API. */
export interface LegacyOptions {
  /** Don't throw for fully transparent colors such as `rgba(0, 0, 0, 0)`. */
  ignoreAlpha?: boolean;
}

/** WCAG 2.x score strings returned by `score()`. */
export type LegacyScore = "AAA" | "AA" | "AA Large" | "Fail";
