// stdio transport: one JSON-RPC message per line on stdin, one per line on
// stdout. Nothing else may ever be written to stdout; diagnostics go to stderr.
const { ERROR, rpcError } = require("./server");

/**
 * @param {{ handle: (message: any) => any }} server
 * @param {{ input: NodeJS.ReadableStream, output: { write(s: string): unknown }, error?: { write(s: string): unknown }, onClose?: () => void }} io
 */
function serveStdio(server, { input, output, error, onClose }) {
  let buffer = "";
  const send = (message) => output.write(JSON.stringify(message) + "\n");

  const processLine = (line) => {
    const text = line.trim();
    if (text === "") return;
    let message;
    try {
      message = JSON.parse(text);
    } catch (e) {
      send(rpcError(null, ERROR.PARSE, `Parse error: ${e.message}`));
      return;
    }
    let response;
    try {
      response = server.handle(message);
    } catch (e) {
      if (error) error.write(`get-contrast mcp: internal error: ${e && e.stack ? e.stack : e}\n`);
      send(rpcError(message && message.id, ERROR.INTERNAL, "Internal error"));
      return;
    }
    if (response !== undefined) send(response);
  };

  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      processLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  });
  input.on("end", () => {
    if (buffer.trim() !== "") processLine(buffer);
    buffer = "";
    if (onClose) onClose();
  });
}

module.exports = { serveStdio };
