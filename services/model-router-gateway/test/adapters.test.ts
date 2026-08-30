import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, describe, it } from "node:test";
import { AnthropicAdapter, GeminiAdapter, LocalEchoAdapter, OpenAiAdapter } from "../src/adapters/index.js";
import { ModelRouterError } from "../src/errors.js";
import type { CompletionRequest } from "../src/types.js";
import { sendJson, startMockServer, stopMockServer } from "./mock-server.js";

const servers: Server[] = [];
after(async () => {
  await Promise.all(servers.map(stopMockServer));
});

const REQUEST: CompletionRequest = {
  model: "test-model",
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user", content: "hello" }],
  maxTokens: 100,
};

describe("OpenAiAdapter", () => {
  it("sends the request in OpenAI's shape and parses a successful response", async () => {
    const { baseUrl, server, requests } = await startMockServer((req, res) => {
      sendJson(res, 200, {
        choices: [{ message: { content: "hi there" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      });
    });
    servers.push(server);

    const adapter = new OpenAiAdapter(baseUrl);
    const result = await adapter.complete(REQUEST, "sk-test");

    assert.equal(result.content, "hi there");
    assert.equal(result.inputTokens, 5);
    assert.equal(result.outputTokens, 3);
    assert.equal(result.finishReason, "stop");

    const sent = requests[0]!;
    assert.equal(sent.url, "/chat/completions");
    assert.equal(sent.headers.authorization, "Bearer sk-test");
    const body = sent.body as { messages: { role: string; content: string }[] };
    assert.equal(body.messages[0]!.role, "system");
    assert.equal(body.messages[1]!.content, "hello");
  });

  it("maps a 429 to a retryable RATE_LIMITED error", async () => {
    const { baseUrl, server } = await startMockServer((_req, res) => sendJson(res, 429, { error: "slow down" }));
    servers.push(server);

    const adapter = new OpenAiAdapter(baseUrl);
    await assert.rejects(
      () => adapter.complete(REQUEST, "sk-test"),
      (err: unknown) => {
        assert.ok(err instanceof ModelRouterError);
        assert.equal(err.code, "RATE_LIMITED");
        assert.equal(err.retryable, true);
        return true;
      },
    );
  });

  it("maps a malformed response body to INVALID_RESPONSE", async () => {
    const { baseUrl, server } = await startMockServer((_req, res) => sendJson(res, 200, { choices: [] }));
    servers.push(server);

    const adapter = new OpenAiAdapter(baseUrl);
    await assert.rejects(
      () => adapter.complete(REQUEST, "sk-test"),
      (err: unknown) => {
        assert.ok(err instanceof ModelRouterError);
        assert.equal(err.code, "INVALID_RESPONSE");
        return true;
      },
    );
  });
});

describe("AnthropicAdapter", () => {
  it("sends the request in Anthropic's shape and parses a successful response", async () => {
    const { baseUrl, server, requests } = await startMockServer((req, res) => {
      sendJson(res, 200, {
        content: [{ type: "text", text: "hi from claude" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 7, output_tokens: 4 },
      });
    });
    servers.push(server);

    const adapter = new AnthropicAdapter(baseUrl);
    const result = await adapter.complete(REQUEST, "sk-ant-test");

    assert.equal(result.content, "hi from claude");
    assert.equal(result.inputTokens, 7);
    assert.equal(result.outputTokens, 4);

    const sent = requests[0]!;
    assert.equal(sent.url, "/messages");
    assert.equal(sent.headers["x-api-key"], "sk-ant-test");
    assert.equal(sent.headers["anthropic-version"], "2023-06-01");
    const body = sent.body as { system?: string };
    assert.equal(body.system, "You are a helpful assistant.");
  });

  it("maps a 500 to a retryable PROVIDER_ERROR", async () => {
    const { baseUrl, server } = await startMockServer((_req, res) => sendJson(res, 500, { error: "oops" }));
    servers.push(server);

    const adapter = new AnthropicAdapter(baseUrl);
    await assert.rejects(
      () => adapter.complete(REQUEST, "sk-ant-test"),
      (err: unknown) => {
        assert.ok(err instanceof ModelRouterError);
        assert.equal(err.code, "PROVIDER_ERROR");
        assert.equal(err.retryable, true);
        return true;
      },
    );
  });
});

describe("GeminiAdapter", () => {
  it("sends the request in Gemini's shape and parses a successful response", async () => {
    const { baseUrl, server, requests } = await startMockServer((req, res) => {
      sendJson(res, 200, {
        candidates: [{ content: { parts: [{ text: "hi from gemini" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 2 },
      });
    });
    servers.push(server);

    const adapter = new GeminiAdapter(baseUrl);
    const result = await adapter.complete(REQUEST, "goog-test-key");

    assert.equal(result.content, "hi from gemini");
    assert.equal(result.inputTokens, 6);
    assert.equal(result.outputTokens, 2);

    const sent = requests[0]!;
    assert.equal(sent.url, "/models/test-model:generateContent");
    assert.equal(sent.headers["x-goog-api-key"], "goog-test-key");
  });

  it("maps a 401 to a non-retryable PROVIDER_ERROR", async () => {
    const { baseUrl, server } = await startMockServer((_req, res) => sendJson(res, 401, { error: "bad key" }));
    servers.push(server);

    const adapter = new GeminiAdapter(baseUrl);
    await assert.rejects(
      () => adapter.complete(REQUEST, "bad-key"),
      (err: unknown) => {
        assert.ok(err instanceof ModelRouterError);
        assert.equal(err.code, "PROVIDER_ERROR");
        assert.equal(err.retryable, false);
        return true;
      },
    );
  });
});

describe("LocalEchoAdapter", () => {
  it("is fully offline and deterministic", async () => {
    const adapter = new LocalEchoAdapter();
    const result = await adapter.complete(REQUEST);
    assert.match(result.content, /^\[local-echo:test-model\] hello$/);
    assert.equal(result.finishReason, "stop");
  });
});
