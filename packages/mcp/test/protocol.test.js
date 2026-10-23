// MCP protocol and schema tests for the server core, in process.
const { describe, test, expect } = require("bun:test");
require("../../get-contrast/scripts/ensure-build");

const lib = require("get-contrast");
const { createContrastServer } = require("../src");
const { createServer, ERROR } = require("../src/server");
const { validate } = require("../src/schema");

const server = createContrastServer(lib, { version: "9.9.9" });
const rpc = (method, params, id = 1) => server.handle({ jsonrpc: "2.0", id, method, params });

const TOOL_NAMES = ["check_contrast", "check_wcag", "pick_color", "find_accessible_color", "audit_palette", "audit_tokens"];

describe("initialize", () => {
  test("negotiates the protocol version, advertises only tools, identifies itself", () => {
    const r = rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "c", version: "1" } });
    expect(r.jsonrpc).toBe("2.0");
    expect(r.id).toBe(1);
    expect(r.result.protocolVersion).toBe("2025-03-26"); // supported versions are echoed
    expect(r.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(r.result.serverInfo).toEqual({ name: "get-contrast", version: "9.9.9" });
    expect(r.result.instructions).toContain("read-only");
    expect(r.result.instructions).toContain("isError");
  });

  test("an unknown version gets the newest supported one", () => {
    expect(rpc("initialize", { protocolVersion: "1999-01-01" }).result.protocolVersion).toBe("2025-06-18");
    expect(rpc("initialize", {}).result.protocolVersion).toBe("2025-06-18");
    expect(rpc("initialize").result.protocolVersion).toBe("2025-06-18");
  });

  test("every supported version is accepted", () => {
    for (const version of server.supportedVersions) expect(rpc("initialize", { protocolVersion: version }).result.protocolVersion).toBe(version);
  });
});

describe("JSON-RPC behavior", () => {
  test("notifications never get a response", () => {
    for (const method of ["notifications/initialized", "notifications/cancelled", "notifications/anything"]) {
      expect(server.handle({ jsonrpc: "2.0", method })).toBeUndefined();
    }
    expect(server.handle({ jsonrpc: "2.0", method: "tools/list" })).toBeUndefined(); // a request without an id is a notification
  });

  test("ping", () => {
    expect(rpc("ping")).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  test("ids are echoed exactly, numbers and strings", () => {
    expect(rpc("ping", undefined, 0).id).toBe(0);
    expect(rpc("ping", undefined, "abc-1").id).toBe("abc-1");
    expect(rpc("ping", undefined, 12345678901).id).toBe(12345678901);
  });

  test("unknown methods are -32601", () => {
    const r = rpc("resources/list");
    expect(r.error.code).toBe(ERROR.METHOD_NOT_FOUND);
    expect(r.error.message).toContain("resources/list");
    expect(r.id).toBe(1);
  });

  test("malformed requests are -32600 and keep the id when there is one", () => {
    for (const message of [null, 5, "ping", {}, { jsonrpc: "1.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 7 }, { jsonrpc: "2.0", id: 7, method: 5 }]) {
      const r = server.handle(message);
      expect(r.error.code).toBe(ERROR.INVALID_REQUEST);
    }
    expect(server.handle({ jsonrpc: "2.0", id: 7 }).id).toBe(7);
    expect(server.handle(null).id).toBeNull();
  });

  test("batches (older clients) are answered element-wise; notifications omitted", () => {
    const r = server.handle([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }]);
    expect(r.map((x) => x.id)).toEqual([1, 2]);
    expect(server.handle([{ jsonrpc: "2.0", method: "notifications/initialized" }])).toBeUndefined();
    expect(server.handle([]).error.code).toBe(ERROR.INVALID_REQUEST);
  });
});

describe("tools/list", () => {
  const listed = rpc("tools/list").result.tools;

  test("exposes exactly the documented tools (no APCA tool until it is licensed)", () => {
    expect(listed.map((t) => t.name)).toEqual(TOOL_NAMES);
    expect(listed.map((t) => t.name)).not.toContain("check_apca");
  });

  test("every tool is described, read-only, and has a strict input schema", () => {
    for (const tool of listed) {
      expect(typeof tool.title).toBe("string");
      expect(tool.description.length).toBeGreaterThan(60);
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      const schema = tool.inputSchema;
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect(Array.isArray(schema.required)).toBe(true);
      for (const key of schema.required) expect(key in schema.properties).toBe(true);
      for (const [key, prop] of Object.entries(schema.properties)) {
        expect([tool.name, key, Boolean(prop.type || prop.anyOf)]).toEqual([tool.name, key, true]);
        expect([tool.name, key, typeof prop.description === "string" || tool.name === "audit_palette"]).toEqual([tool.name, key, true]);
      }
    }
  });

  test("schemas are JSON-serializable and stable across calls", () => {
    expect(JSON.parse(JSON.stringify(listed))).toEqual(listed);
    expect(rpc("tools/list").result.tools).toEqual(listed);
  });

  test("shared target options are described consistently", () => {
    for (const name of ["check_contrast", "pick_color", "find_accessible_color", "audit_palette", "audit_tokens"]) {
      const props = listed.find((t) => t.name === name).inputSchema.properties;
      expect(props.level.enum).toEqual(["AA", "AAA"]);
      expect(props.use.enum).toEqual(["text", "large-text", "ui"]);
      expect(props.minRatio).toMatchObject({ type: "number", minimum: 1, maximum: 21 });
    }
  });
});

describe("tools/call protocol errors", () => {
  test("unknown tool is -32602 and lists the real ones", () => {
    const r = rpc("tools/call", { name: "nope", arguments: {} });
    expect(r.error.code).toBe(ERROR.INVALID_PARAMS);
    expect(r.error.data.tools).toEqual(TOOL_NAMES);
  });

  test("missing name and non-object arguments are -32602", () => {
    for (const params of [undefined, {}, { name: 5 }]) expect(rpc("tools/call", params).error.code).toBe(ERROR.INVALID_PARAMS);
    for (const args of [null, [], "x", 5]) expect(rpc("tools/call", { name: "check_contrast", arguments: args }).error.code).toBe(ERROR.INVALID_PARAMS);
  });

  test("omitted arguments are treated as {} and reported as invalid input, not a protocol error", () => {
    const r = rpc("tools/call", { name: "check_contrast" });
    expect(r.error).toBeUndefined();
    expect(r.result.isError).toBe(true);
    expect(r.result.structuredContent.error.code).toBe("invalid-arguments");
  });

  test("a throwing tool is reported as a tool-failure result, not a crash", () => {
    const boom = createServer({ name: "x", version: "1", tools: [{ name: "boom", description: "d", inputSchema: { type: "object", properties: {} }, run() { throw new Error("kaput"); } }] });
    const r = boom.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "boom", arguments: {} } });
    expect(r.result.isError).toBe(true);
    expect(r.result.structuredContent.error).toEqual({ kind: "tool-failure", code: "internal", message: "kaput" });
    expect(r.result.content[0].text).toBe("Tool failure: kaput");
  });
});

describe("schema validator", () => {
  const schema = {
    type: "object",
    properties: {
      s: { type: "string", enum: ["a", "b"] },
      n: { type: "number", minimum: 1, maximum: 3 },
      i: { type: "integer" },
      b: { type: "boolean" },
      list: { type: "array", minItems: 1, items: { type: "string" } },
      either: { anyOf: [{ type: "string" }, { type: "object" }] },
    },
    required: ["s"],
    additionalProperties: false,
  };

  test("accepts valid input", () => {
    expect(validate(schema, { s: "a", n: 2, i: 3, b: false, list: ["x"], either: {} })).toEqual([]);
    expect(validate(schema, { s: "b", either: "text" })).toEqual([]);
  });

  test("explains every problem", () => {
    expect(validate(schema, {})).toEqual(['arguments: missing required property "s"']);
    expect(validate(schema, { s: "c" })).toEqual(["arguments.s: must be one of \"a\", \"b\""]);
    expect(validate(schema, { s: "a", n: 4 })).toEqual(["arguments.n: must be at most 3"]);
    expect(validate(schema, { s: "a", n: 0 })).toEqual(["arguments.n: must be at least 1"]);
    expect(validate(schema, { s: "a", n: NaN })).toEqual(["arguments.n: expected number, got number"]);
    expect(validate(schema, { s: "a", i: 1.5 })).toEqual(["arguments.i: expected integer, got number"]);
    expect(validate(schema, { s: "a", b: "yes" })).toEqual(["arguments.b: expected boolean, got string"]);
    expect(validate(schema, { s: "a", list: [] })).toEqual(["arguments.list: needs at least 1 item"]);
    expect(validate(schema, { s: "a", list: ["x", 5] })).toEqual(["arguments.list[1]: expected string, got number"]);
    expect(validate(schema, { s: "a", either: 5 })[0]).toContain("does not match any allowed form");
    expect(validate(schema, { s: "a", zzz: 1 })[0]).toBe('arguments: unknown property "zzz" (allowed: s, n, i, b, list, either)');
    expect(validate(schema, null)).toEqual(["arguments: expected object, got null"]);
  });
});
