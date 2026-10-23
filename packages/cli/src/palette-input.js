// Reads a palette from a file or stdin. This is only a format adapter: it turns
// text into the plain shapes lib.audit() accepts and knows nothing about
// contrast. New formats (CSS custom properties, token files, ...) belong in
// their own adapters next to this one.
//
// Accepted:
//   - a JSON array:            ["#fff", { "name": "ink", "color": "#111" }]
//   - a JSON object map:       { "ink": "#111", "paper": "#fff" }
//   - a wrapper object:        { "colors": <array or map> }
//   - plain text, one color per line (blank lines ignored)

class InputError extends Error {}

/**
 * @param {string} text
 * @param {string} source for error messages ("palette.json", "stdin")
 */
function parsePalette(text, source) {
  const trimmed = text.trim();
  if (trimmed === "") throw new InputError(`${source} is empty`);

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch (error) {
      throw new InputError(`${source} looks like JSON but does not parse: ${error.message}`);
    }
    if (!Array.isArray(data) && data !== null && typeof data === "object" && Object.keys(data).length === 1 && "colors" in data) {
      data = data.colors;
    }
    const isMap = data !== null && typeof data === "object" && !Array.isArray(data);
    if (!Array.isArray(data) && !isMap) {
      throw new InputError(`${source}: expected an array of colors, a { name: color } object, or { "colors": ... }`);
    }
    if (isMap && Object.values(data).some((v) => typeof v !== "string")) {
      const bad = Object.entries(data).find(([, v]) => typeof v !== "string");
      throw new InputError(`${source}: "${bad[0]}" must be a color string (for nested token files, use the token audit)`);
    }
    return data;
  }

  return trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/**
 * @param {string} spec a file path, or "-" for stdin
 * @param {{ readStdin: () => string, readFile: (path: string) => string }} io
 */
function readPalette(spec, io) {
  if (spec === "-") return parsePalette(io.readStdin(), "stdin");
  let text;
  try {
    text = io.readFile(spec);
  } catch (error) {
    const why = error && error.code === "ENOENT" ? "no such file" : error && error.code === "EISDIR" ? "is a directory" : error.message;
    throw new InputError(`cannot read ${spec}: ${why}`);
  }
  return parsePalette(text, spec);
}

module.exports = { InputError, parsePalette, readPalette };
