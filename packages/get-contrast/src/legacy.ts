// Legacy (v3) API. Behavior here is frozen by the compatibility suite in
// compat/ and documented in docs/v3-compatibility.md. Do not "fix" quirks in
// this file; corrected behavior belongs in new APIs.
import rgb from "rgb";
import * as wcag from "wcag-contrast";
import isBlank from "is-blank";
import isNamedCssColor from "is-named-css-color";
import cssColorNames from "css-color-names";
import type { LegacyOptions, LegacyScore } from "./types";

/** Channel values as the strings they were parsed from, e.g. ["255", "0", "0"]. */
type RgbChannels = string[];

export function ratio(
  colorOne: string,
  colorTwo: string,
  options?: LegacyOptions | null
): number {
  const channelsOne = getRgbTriplet(colorOne, options);
  const channelsTwo = getRgbTriplet(colorTwo, options);

  return wcag.rgb(channelsOne, channelsTwo);
}

export function score(
  colorOne: string,
  colorTwo: string,
  options?: LegacyOptions | null
): LegacyScore {
  const wcagScore = wcag.score(ratio(colorOne, colorTwo, options));

  if (isBlank(wcagScore)) {
    // Unreachable in practice (wcag.score always returns a non-empty string),
    // but v3 returned "F" here, so keep it.
    return "F" as LegacyScore;
  } else {
    return wcagScore as LegacyScore;
  }
}

export function isAccessible(
  colorOne: string,
  colorTwo: string,
  options?: LegacyOptions | null
): boolean {
  return ratio(colorOne, colorTwo, options) > 4.5;
}

function getRgbTriplet(
  providedColor: string,
  options?: LegacyOptions | null
): RgbChannels {
  if (typeof providedColor !== "string") {
    throw new TypeError("get-contrast expects colors as strings");
  }

  let color = providedColor.toLowerCase();

  if (isNamedCssColor(color)) {
    color = cssColorNames[color];
  }

  color = isNotTransparent(color, options);
  return color.match(/\((.*)\)/)![1].split(",").slice(0, 3);
}

/**
 * Returns the normalized `rgb(...)`/`rgba(...)` string for `color`, or throws
 * a `TypeError` when it is fully transparent (unless `ignoreAlpha`). Despite
 * the name it returns a string, not a boolean.
 */
export function isNotTransparent(
  color: string,
  options?: LegacyOptions | null
): string {
  options = options || {};

  // Convert to RGB. `rgb()` returns null for input it cannot parse, and v3
  // then fails with a TypeError on the `.match` below. That is the observable
  // contract for invalid input, so the null is deliberately not handled.
  // (JavaScriptCore words that TypeError using the variable name, so keep it
  // `color` to match v3's message on both engines.)
  color = rgb(color) as string;
  // Check if the rgb returned color is rgba and if the 'a' value is 0.
  const cArray = color.match(/\((.*)\)/)![1].split(",");
  if (cArray.length == 4 && cArray[3] == "0" && !options.ignoreAlpha) {
    throw new TypeError("get-contrast cannot contrast transparent colors");
  } else {
    return color;
  }
}
