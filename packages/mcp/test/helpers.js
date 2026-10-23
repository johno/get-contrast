// A minimal MCP client for tests: spawns a server, speaks newline-delimited
// JSON-RPC over stdio, and records everything the server writes.
const { spawn } = require("node:child_process");

class McpClient {
  /** @param {string[]} args node arguments, e.g. [binPath] */
  constructor(args, { env } = {}) {
    this.child = spawn("node", args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
    this.stdoutLines = [];
    this.stderr = "";
    this.nextId = 1;
    this.waiting = new Map();
    this.buffer = "";
    this.exited = new Promise((resolve) => this.child.on("exit", (code, signal) => resolve({ code, signal })));
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        this.stdoutLines.push(line);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue; // recorded in stdoutLines; tests assert every line parses
        }
        const entry = this.waiting.get(message.id);
        if (entry) {
          this.waiting.delete(message.id);
          entry(message);
        }
      }
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (c) => (this.stderr += c));
  }

  /** Sends a request and resolves with the response message. */
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method} (id ${id}); stdout: ${this.stdoutLines.join(" | ")}; stderr: ${this.stderr}`)), 10000);
      this.waiting.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  raw(text) {
    this.child.stdin.write(text);
  }

  /** Standard handshake. */
  async initialize(protocolVersion = "2025-06-18") {
    const response = await this.request("initialize", { protocolVersion, capabilities: {}, clientInfo: { name: "test-client", version: "1.0.0" } });
    this.notify("notifications/initialized");
    return response;
  }

  async call(name, args) {
    const response = await this.request("tools/call", { name, arguments: args });
    return response.result || response; // protocol errors come back as { error }
  }

  async close() {
    this.child.stdin.end();
    return this.exited;
  }
}

module.exports = { McpClient };
