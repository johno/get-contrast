// JSON token files: nested objects whose leaves are color strings, or objects
// with `$value` (W3C Design Tokens) / `value` (Style Dictionary), optionally
// with `$type`. A value of the form "{path.to.token}" is an alias.
import { TokenSourceError, type TokenDefinition } from "./types.js";

const escapePointer = (segment: string) => segment.replace(/~/g, "~0").replace(/\//g, "~1");

export function parseJsonTokens(text: string): TokenDefinition[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new TokenSourceError("invalid-json", `token file is not valid JSON: ${(error as Error).message}`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TokenSourceError("invalid-json", "a token file is a JSON object of (nested) tokens");
  }

  const out: TokenDefinition[] = [];
  const walk = (node: Record<string, unknown>, path: string[], inheritedType: string | undefined) => {
    const groupType = typeof node.$type === "string" ? node.$type : inheritedType;
    for (const key of Object.keys(node)) {
      if (key.startsWith("$")) continue;
      const child = node[key];
      const childPath = [...path, key];
      const pointer = "/" + childPath.map(escapePointer).join("/");
      if (child !== null && typeof child === "object" && !Array.isArray(child)) {
        const obj = child as Record<string, unknown>;
        const valueKey = "$value" in obj ? "$value" : "value" in obj && typeof obj.value !== "object" ? "value" : null;
        if (valueKey) {
          const raw = obj[valueKey];
          out.push({
            name: childPath.join("."),
            value: typeof raw === "string" ? raw : JSON.stringify(raw),
            type: typeof obj.$type === "string" ? obj.$type : groupType,
            source: { format: "json", pointer: `${pointer}/${valueKey}` },
          });
        } else {
          walk(obj, childPath, groupType);
        }
      } else if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
        out.push({ name: childPath.join("."), value: String(child), type: groupType, source: { format: "json", pointer } });
      }
    }
  };
  walk(data as Record<string, unknown>, [], undefined);
  return out;
}

/** "{a.b.c}" -> "a.b.c", or null if the value is not a whole-value alias. */
export function jsonAlias(value: string): string | null {
  const match = /^\{([^{}\s]+)\}$/.exec(value.trim());
  return match ? match[1] : null;
}
