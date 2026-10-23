// A deliberately small JSON Schema validator: exactly the keywords the tool
// input schemas use (type, enum, required, properties, additionalProperties,
// items, minimum, maximum, minItems, anyOf). It exists so bad tool arguments
// come back as a precise, self-correcting tool error instead of surfacing as an
// accident deep in the library.

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

const matchesType = (value, type) =>
  type === "integer" ? Number.isInteger(value) : type === "number" ? typeof value === "number" && Number.isFinite(value) : typeOf(value) === type;

/** @returns {string[]} messages; empty when valid. */
function validate(schema, value, at = "arguments") {
  const errors = [];
  if (schema.anyOf) {
    const attempts = schema.anyOf.map((s) => validate(s, value, at));
    if (!attempts.some((a) => a.length === 0)) {
      errors.push(`${at}: does not match any allowed form (${schema.anyOf.map((s) => s.type || "object").join(" or ")}); got ${typeOf(value)}`);
    }
    return errors;
  }
  if (schema.type && !matchesType(value, schema.type)) {
    return [`${at}: expected ${schema.type}, got ${typeOf(value)}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: needs at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}`);
    if (schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, `${at}[${i}]`)));
  }
  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${at}: missing required property "${key}"`);
    for (const [key, v] of Object.entries(value)) {
      const sub = schema.properties && schema.properties[key];
      if (sub) errors.push(...validate(sub, v, `${at}.${key}`));
      else if (schema.additionalProperties === false) {
        errors.push(`${at}: unknown property "${key}"${schema.properties ? ` (allowed: ${Object.keys(schema.properties).join(", ")})` : ""}`);
      }
    }
  }
  return errors;
}

module.exports = { validate };
