// The real server over stdio, driven by a client fixture: from the monorepo bin
// and from the published layout (`contrast mcp`), plus parity with the CLI.
const { describe, test, expect } = require("bun:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { McpClient } = require("./helpers");

require("../../get-contrast/scripts/ensure-build");

const bin = path.join(__dirname, "..", "bin.js");
const published = path.join(__dirname, "..", "..", "get-contrast", "cli.js");
const cliBin = path.join(__dirname, "..", "..", "cli", "bin.js");
const TOKENS = path.join(__dirname, "..", "..", "get-contrast", "test", "fixtures", "tokens");

const TOOL_NAMES = ["check_contrast", "check_wcag", "pick_color", "find_accessible_color", "audit_palette", "audit_tokens"];

describe.each([
  ["monorepo bin (packages/mcp/bin.js)", [bin]],
  ["published layout (contrast mcp)", [published, "mcp"]],
  ["workspace CLI (contrast mcp)", [cliBin, "mcp"]],
])("MCP client against %s", (_, args) => {
  test("handshake, discovery, a call per tool, clean shutdown", async () => {
    const client = new McpClient(args);
    const init = await client.initialize();
    expect(init.result.serverInfo.name).toBe("get-contrast");
    expect(init.result.protocolVersion).toBe("2025-06-18");

    const listed = await client.request("tools/list");
    expect(listed.result.tools.map((t) => t.name)).toEqual(TOOL_NAMES);

    const check = await client.call("check_contrast", { foreground: "#777", background: "#fff" });
    expect(check.isError).toBe(false);
    expect(check.structuredContent.status).toBe("fail");

    const wcag = await client.call("check_wcag", { foreground: "#000", background: "#fff" });
    expect(wcag.structuredContent.result.ratio).toBe(21);

    const picked = await client.call("pick_color", { background: "#fff", candidates: ["#767676", "#111", "#ddd"] });
    expect(picked.structuredContent.result.winner.input).toBe("#111");

    const found = await client.call("find_accessible_color", { color: "#777", against: "#fff" });
    expect(found.structuredContent.result.suggested.css).toBe("#767676");

    const palette = await client.call("audit_palette", { palette: { ink: "#111", paper: "#fff" } });
    expect(palette.structuredContent.result.summary.pairs).toBe(2);

    const tokens = await client.call("audit_tokens", { tokens: { a: { text: "#999999" }, bg: "#ffffff" }, relations: ["a.text -> bg"] });
    expect(tokens.structuredContent.status).toBe("fail");

    const closed = await client.close();
    expect(closed.code).toBe(0);
    expect(client.stderr).toBe("");
    // stdout carried JSON-RPC messages and nothing else
    for (const line of client.stdoutLines) {
      const message = JSON.parse(line);
      expect(message.jsonrpc).toBe("2.0");
    }
    expect(client.stdoutLines).toHaveLength(8); // 1 initialize + 1 list + 6 tool calls; the notification gets no reply
  }, 30000);

  test("protocol errors and recovery on one connection", async () => {
    const client = new McpClient(args);
    await client.initialize("2024-11-05");
    expect((await client.request("nope/method")).error.code).toBe(-32601);
    expect((await client.request("tools/call", { name: "nope", arguments: {} })).error.code).toBe(-32602);

    client.raw("this is not json\n");
    client.raw('{"jsonrpc":"2.0","id":99,"method":"ping"}\n');
    const ping = await new Promise((resolve) => {
      const timer = setInterval(() => {
        const found = client.stdoutLines.map((l) => JSON.parse(l)).find((m) => m.id === 99);
        if (found) {
          clearInterval(timer);
          resolve(found);
        }
      }, 20);
    });
    expect(ping.result).toEqual({});
    const parseError = client.stdoutLines.map((l) => JSON.parse(l)).find((m) => m.error && m.error.code === -32700);
    expect(parseError.id).toBeNull();

    // still serving after the garbage
    expect((await client.call("check_contrast", { foreground: "#000", background: "#fff" })).structuredContent.status).toBe("pass");
    await client.close();
  }, 30000);
});

describe("framing", () => {
  test("messages split across chunks, several per chunk, CRLF, and a final line without a newline", async () => {
    const client = new McpClient([bin]);
    const a = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    const b = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" });
    const c = JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    client.raw(a.slice(0, 10));
    await wait(30);
    client.raw(a.slice(10) + "\r\n" + b + "\n");
    await wait(30);
    client.raw(c); // no trailing newline: processed when stdin closes
    const closed = await client.close();
    expect(closed.code).toBe(0);
    expect(client.stdoutLines.map((l) => JSON.parse(l).id)).toEqual([1, 2, 3]);
  }, 30000);

  test("a large request and response", async () => {
    const client = new McpClient([bin]);
    await client.initialize();
    const palette = Array.from({ length: 90 }, (_, i) => `hsl(${(i * 4) % 360} ${30 + (i % 50)}% ${8 + ((i * 7) % 85)}%)`);
    const r = await client.call("audit_palette", { palette });
    expect(r.structuredContent.result.summary.pairs).toBe(90 * 89);
    expect(r.structuredContent.result.matrix).toHaveLength(90);
    await client.close();
  }, 30000);

  test("exits cleanly when the client disconnects without initializing", async () => {
    const client = new McpClient([bin]);
    const closed = await client.close();
    expect(closed.code).toBe(0);
    expect(client.stdoutLines).toEqual([]);
    expect(client.stderr).toBe("");
  });
});

describe("parity with the CLI (same fixtures, same engine)", () => {
  const cli = (args, input) => JSON.parse(spawnSync("node", [cliBin, ...args, "--json"], { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 }).stdout);

  test("every tool returns what the CLI's --json returns", async () => {
    const client = new McpClient([bin]);
    await client.initialize();

    const check = await client.call("check_contrast", { foreground: "#777", background: "#fff", level: "AAA" });
    expect(check.structuredContent.result).toEqual(cli(["check", "#777", "#fff", "--level", "AAA"]).result);

    const wcag = await client.call("check_wcag", { foreground: "rgba(0,0,0,.5)", background: "#fff" });
    expect(wcag.structuredContent.result).toEqual(cli(["wcag", "rgba(0,0,0,.5)", "#fff"]).result);

    const picked = await client.call("pick_color", { background: "#fff", candidates: ["#767676", "#111", "#ddd"] });
    expect(picked.structuredContent.result).toEqual(cli(["pick", "#fff", "#767676", "#111", "#ddd"]).result);

    const found = await client.call("find_accessible_color", { color: "#ffcc00", against: "#fff", direction: "darker" });
    expect(found.structuredContent.result).toEqual(cli(["find", "#ffcc00", "--against", "#fff", "--direction", "darker"]).result);

    const paletteText = JSON.stringify({ ink: "#111", paper: "#fff", mid: "#767676" });
    const palette = await client.call("audit_palette", { palette: JSON.parse(paletteText), level: "AAA" });
    expect(palette.structuredContent.result).toEqual(cli(["audit", "-", "--level", "AAA"], paletteText).result);

    const tokens = fs.readFileSync(path.join(TOKENS, "tokens.json"), "utf8");
    const relations = path.join(TOKENS, "relations.json");
    const audited = await client.call("audit_tokens", { tokens, relations: JSON.parse(fs.readFileSync(relations, "utf8")).relations });
    const viaCli = cli(["tokens", "-", "--relations", relations], tokens);
    expect(audited.structuredContent.result).toEqual(viaCli.result);
    expect(audited.structuredContent.patch).toEqual(viaCli.patch);

    await client.close();
  }, 60000);
});
