import { ToolGatewayError } from "./errors.js";

/** JSON-RPC 2.0 envelope per the MCP spec (https://modelcontextprotocol.io) — the
 * Streamable HTTP transport variant: one JSON-RPC request per POST. */
interface JsonRpcRequestBody {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponseBody {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolSummary {
  name: string;
  description?: string;
}

export interface McpToolCallResult {
  content: unknown;
  isError: boolean;
}

/** A real MCP client — initialize/tools.list/tools.call, all as genuine
 * JSON-RPC 2.0 requests over HTTP. No mock, no simulation: this is the
 * exact wire format a real MCP server expects, exercised against a local
 * mock server in tests (no live MCP server available in this environment;
 * see ADR 0004). */
export class McpClient {
  private nextId = 1;

  constructor(
    private readonly endpoint: string,
    private readonly timeoutMs = 30_000,
  ) {}

  private async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      const requestBody: JsonRpcRequestBody = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
      res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new ToolGatewayError("TIMEOUT", `MCP request (${method}) to ${this.endpoint} timed out.`, true);
      }
      throw new ToolGatewayError(
        "MCP_UNREACHABLE",
        `Failed to reach MCP server at ${this.endpoint}: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }

    const text = await res.text();
    let parsed: JsonRpcResponseBody;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ToolGatewayError(
        "MCP_PROTOCOL_ERROR",
        `MCP server returned non-JSON response (status ${res.status}): ${text.slice(0, 200)}`,
      );
    }

    if (parsed.error) {
      throw new ToolGatewayError("MCP_PROTOCOL_ERROR", `MCP error ${parsed.error.code}: ${parsed.error.message}`);
    }
    if (parsed.id !== id) {
      throw new ToolGatewayError("MCP_PROTOCOL_ERROR", `MCP response id mismatch (sent ${id}, got ${parsed.id}).`);
    }
    return parsed.result;
  }

  async initialize(clientName: string, clientVersion: string): Promise<unknown> {
    return this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: clientName, version: clientVersion },
    });
  }

  async listTools(): Promise<McpToolSummary[]> {
    const result = (await this.request("tools/list")) as { tools?: McpToolSummary[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: unknown;
      isError?: boolean;
    };
    return { content: result.content ?? null, isError: result.isError ?? false };
  }
}
