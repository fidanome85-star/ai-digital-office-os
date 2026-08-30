import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, describe, it } from "node:test";
import { OpenAiEmbeddingAdapter } from "../src/embedding-provider.js";
import { MemoryServiceError } from "../src/errors.js";
import { sendJson, startMockServer, stopMockServer } from "./mock-server.js";

const servers: Server[] = [];
after(async () => {
  await Promise.all(servers.map(stopMockServer));
});

describe("OpenAiEmbeddingAdapter", () => {
  it("sends the request in OpenAI's embeddings shape and parses the vector", async () => {
    const { baseUrl, server, requests } = await startMockServer((_req, res) => {
      sendJson(res, 200, { data: [{ embedding: [0.1, 0.2, 0.3] }] });
    });
    servers.push(server);

    const adapter = new OpenAiEmbeddingAdapter(baseUrl, "test-embed-model");
    const vector = await adapter.embed("hello world", "sk-test");

    assert.deepEqual(vector, [0.1, 0.2, 0.3]);
    const sent = requests[0]!;
    assert.equal(sent.url, "/embeddings");
    assert.equal(sent.headers.authorization, "Bearer sk-test");
    const body = sent.body as { model: string; input: string };
    assert.equal(body.model, "test-embed-model");
    assert.equal(body.input, "hello world");
  });

  it("maps a 429 to a retryable RATE_LIMITED error", async () => {
    const { baseUrl, server } = await startMockServer((_req, res) => sendJson(res, 429, { error: "slow down" }));
    servers.push(server);

    const adapter = new OpenAiEmbeddingAdapter(baseUrl);
    await assert.rejects(
      () => adapter.embed("x", "sk-test"),
      (err: unknown) => {
        assert.ok(err instanceof MemoryServiceError);
        assert.equal(err.code, "RATE_LIMITED");
        assert.equal(err.retryable, true);
        return true;
      },
    );
  });

  it("maps a response missing the embedding to INVALID_RESPONSE", async () => {
    const { baseUrl, server } = await startMockServer((_req, res) => sendJson(res, 200, { data: [] }));
    servers.push(server);

    const adapter = new OpenAiEmbeddingAdapter(baseUrl);
    await assert.rejects(
      () => adapter.embed("x", "sk-test"),
      (err: unknown) => {
        assert.ok(err instanceof MemoryServiceError);
        assert.equal(err.code, "INVALID_RESPONSE");
        return true;
      },
    );
  });
});
