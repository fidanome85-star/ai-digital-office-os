import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface MockRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: unknown;
}

export type MockHandler = (req: MockRequest, res: ServerResponse) => void;

export async function startMockServer(handler: MockHandler): Promise<{ baseUrl: string; server: Server; requests: MockRequest[] }> {
  const requests: MockRequest[] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = undefined;
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const mockRequest: MockRequest = { method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, body };
      requests.push(mockRequest);
      handler(mockRequest, res);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Failed to bind mock server.");

  return { baseUrl: `http://127.0.0.1:${address.port}`, server, requests };
}

export function stopMockServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}
