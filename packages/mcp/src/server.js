// A minimal MCP server core: JSON-RPC 2.0 dispatch for the methods a tools-only
// server needs (initialize, ping, tools/list, tools/call) and nothing else.
// Transport-agnostic: `handle(message)` takes one parsed message and returns the
// response (or undefined for notifications). stdio framing lives in stdio.js.
//
// Protocol notes (https://modelcontextprotocol.io/specification):
//  - Tool *execution* problems are returned as a successful JSON-RPC response
//    whose result has isError: true, so the model can read and correct them.
//    Only protocol problems (unknown method, malformed request, unknown tool)
//    are JSON-RPC errors.
//  - Accessibility failures are results, not errors: a pair that fails WCAG is
//    reported with status "fail" and isError false.

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const ERROR = Object.freeze({ PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603 });

const rpcError = (id, code, message, data) => ({ jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });

/**
 * @param {{ name: string, version: string, instructions?: string, tools: { name: string, title?: string, description: string, inputSchema: object, annotations?: object, run: (args: object) => object }[] }} options
 */
function createServer({ name, version, instructions, tools }) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  function initialize(id, params) {
    const requested = params && params.protocolVersion;
    // Echo the client's version when we speak it, else offer our newest.
    const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
    return ok(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name, version },
      ...(instructions ? { instructions } : {}),
    });
  }

  function listTools(id) {
    return ok(id, {
      tools: tools.map(({ name: toolName, title, description, inputSchema, annotations }) => ({
        name: toolName,
        ...(title ? { title } : {}),
        description,
        inputSchema,
        ...(annotations ? { annotations } : {}),
      })),
    });
  }

  function callTool(id, params) {
    if (!params || typeof params.name !== "string") return rpcError(id, ERROR.INVALID_PARAMS, "tools/call needs a string `name`");
    const tool = byName.get(params.name);
    if (!tool) return rpcError(id, ERROR.INVALID_PARAMS, `Unknown tool: ${params.name}`, { tools: [...byName.keys()] });
    if (params.arguments !== undefined && (params.arguments === null || typeof params.arguments !== "object" || Array.isArray(params.arguments))) {
      return rpcError(id, ERROR.INVALID_PARAMS, "`arguments` must be an object");
    }
    let result;
    try {
      result = tool.run(params.arguments || {});
    } catch (error) {
      // run() reports expected problems itself; this is a bug in a tool.
      result = {
        isError: true,
        content: [{ type: "text", text: `Tool failure: ${error && error.message ? error.message : error}` }],
        structuredContent: { schema: 1, tool: tool.name, status: "error", error: { kind: "tool-failure", code: "internal", message: String(error && error.message ? error.message : error) } },
      };
    }
    return ok(id, result);
  }

  /** Handles one parsed JSON-RPC message. Returns a response, or undefined for notifications. */
  function handle(message) {
    if (Array.isArray(message)) {
      // Batches were removed from newer protocol versions but older clients may send them.
      if (message.length === 0) return rpcError(null, ERROR.INVALID_REQUEST, "empty batch");
      const responses = message.map(handle).filter((r) => r !== undefined);
      return responses.length ? responses : undefined;
    }
    if (message === null || typeof message !== "object" || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return rpcError(message && message.id, ERROR.INVALID_REQUEST, "not a JSON-RPC 2.0 request");
    }
    const isNotification = !("id" in message);
    const { id, method, params } = message;

    if (isNotification) return undefined; // notifications/initialized, notifications/cancelled, ... need no reply
    switch (method) {
      case "initialize":
        return initialize(id, params);
      case "ping":
        return ok(id, {});
      case "tools/list":
        return listTools(id);
      case "tools/call":
        return callTool(id, params);
      default:
        return rpcError(id, ERROR.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  return { handle, supportedVersions: SUPPORTED_VERSIONS };
}

module.exports = { createServer, ERROR, SUPPORTED_VERSIONS, rpcError };
