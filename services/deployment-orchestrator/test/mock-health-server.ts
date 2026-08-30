import { createServer, type Server } from "node:http";

export async function startMockHealthServer(status: number): Promise<{ url: string; server: Server }> {
  const server = createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: status >= 200 && status < 300 }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Failed to bind mock health server.");
  return { url: `http://127.0.0.1:${address.port}/health`, server };
}

export function stopMockHealthServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}
