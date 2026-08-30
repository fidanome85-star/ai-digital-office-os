import { createServer, type Server } from "node:http";

interface JsonRpcRequestBody {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export type MockMcpHandler = (req: JsonRpcRequestBody) => { result?: unknown } | { error: { code: number; message: string } };

export async function startMockMcpServer(handler: MockMcpHandler): Promise<{ endpoint: string; server: Server; requests: JsonRpcRequestBody[] }> {
  const requests: JsonRpcRequestBody[] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonRpcRequestBody;
      requests.push(parsed);
      const outcome = handler(parsed);
      const body =
        "error" in outcome
          ? { jsonrpc: "2.0", id: parsed.id, error: outcome.error }
          : { jsonrpc: "2.0", id: parsed.id, result: outcome.result };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Failed to bind mock MCP server.");

  return { endpoint: `http://127.0.0.1:${address.port}`, server, requests };
}

export function stopMockMcpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}
