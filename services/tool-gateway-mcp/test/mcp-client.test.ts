import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, describe, it } from "node:test";
import { McpClient } from "../src/mcp-client.js";
import { ToolGatewayError } from "../src/errors.js";
import { startMockMcpServer, stopMockMcpServer } from "./mock-mcp-server.js";

const servers: Server[] = [];
after(async () => {
  await Promise.all(servers.map(stopMockMcpServer));
});

describe("McpClient", () => {
  it("sends a well-formed JSON-RPC 2.0 tools/call request and parses the result", async () => {
    const { endpoint, server, requests } = await startMockMcpServer((req) => {
      if (req.method === "tools/call") {
        return { result: { content: [{ type: "text", text: "42" }], isError: false } };
      }
      return { error: { code: -32601, message: "unknown method" } };
    });
    servers.push(server);

    const client = new McpClient(endpoint);
    const result = await client.callTool("calculator", { expression: "6*7" });

    assert.deepEqual(result.content, [{ type: "text", text: "42" }]);
    assert.equal(result.isError, false);

    const sent = requests[0]!;
    assert.equal(sent.jsonrpc, "2.0");
    assert.equal(sent.method, "tools/call");
    assert.deepEqual(sent.params, { name: "calculator", arguments: { expression: "6*7" } });
    assert.equal(typeof sent.id, "number");
  });

  it("increments the request id across multiple calls on the same client", async () => {
    const { endpoint, server, requests } = await startMockMcpServer(() => ({ result: { tools: [] } }));
    servers.push(server);

    const client = new McpClient(endpoint);
    await client.listTools();
    await client.listTools();

    assert.equal(requests[0]!.id, 1);
    assert.equal(requests[1]!.id, 2);
  });

  it("throws MCP_PROTOCOL_ERROR when the server returns a JSON-RPC error object", async () => {
    const { endpoint, server } = await startMockMcpServer(() => ({ error: { code: -32602, message: "invalid params" } }));
    servers.push(server);

    const client = new McpClient(endpoint);
    await assert.rejects(
      () => client.callTool("bad_tool", {}),
      (err: unknown) => {
        assert.ok(err instanceof ToolGatewayError);
        assert.equal(err.code, "MCP_PROTOCOL_ERROR");
        assert.match(err.message, /invalid params/);
        return true;
      },
    );
  });

  it("throws MCP_UNREACHABLE when the server is not listening", async () => {
    const client = new McpClient("http://127.0.0.1:1", 1000);
    await assert.rejects(
      () => client.callTool("x", {}),
      (err: unknown) => {
        assert.ok(err instanceof ToolGatewayError);
        assert.equal(err.code, "MCP_UNREACHABLE");
        assert.equal(err.retryable, true);
        return true;
      },
    );
  });

  it("lists tools via tools/list", async () => {
    const { endpoint, server } = await startMockMcpServer(() => ({
      result: { tools: [{ name: "calculator", description: "does math" }] },
    }));
    servers.push(server);

    const client = new McpClient(endpoint);
    const tools = await client.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0]!.name, "calculator");
  });
});
