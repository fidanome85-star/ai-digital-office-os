import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { OpenAiEmbeddingAdapter } from "../src/embedding-provider.js";
import { embedAndStore, semanticSearch } from "../src/semantic.js";
import { sendJson, startMockServer, stopMockServer } from "./mock-server.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const APP_DATABASE_URL = process.env["APP_DATABASE_URL"];
if (!DATABASE_URL || !APP_DATABASE_URL) {
  throw new Error("DATABASE_URL and APP_DATABASE_URL must both be set to run this test.");
}

const DIMS = 1536;
const EMBEDDING_MODEL = "test-embed-model";

/** Unit vector with a single 1 at `index` — lets cosine similarity between
 * two of these be computed by hand, so the ranking assertions below are
 * verifying real pgvector math, not a semantic claim (see
 * embedding-provider.ts's comment on why no fake embedding is used for
 * anything claiming real search quality). */
function unitVector(index: number): number[] {
  const v = new Array(DIMS).fill(0);
  v[index] = 1;
  return v;
}

const queryVector = unitVector(0);
const closeVector = (() => {
  const v = unitVector(0);
  v[1] = 0.05; // cosine similarity to queryVector ~0.999
  return v;
})();
const farVector = unitVector(800); // orthogonal to queryVector -> cosine similarity 0

function vectorFor(input: string): number[] {
  if (input === "my query") return queryVector;
  if (input === "the close one" || input === "the close one (other model)") return closeVector;
  if (input === "the far one") return farVector;
  throw new Error(`unexpected embedding input in test: ${input}`);
}

let owner: Client;
let appPool: Pool;
let mockServer: Server;
let mockBaseUrl: string;
const tenantId = randomUUID();
const runTag = tenantId.slice(0, 8);

before(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  appPool = createDbPool(APP_DATABASE_URL);

  const mock = await startMockServer((req, res) => {
    const body = req.body as { input: string };
    sendJson(res, 200, { data: [{ embedding: vectorFor(body.input) }] });
  });
  mockServer = mock.server;
  mockBaseUrl = mock.baseUrl;

  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Memory Service Test Tenant (semantic)",
    `mem-sem-test-${runTag}`,
  ]);
});

after(async () => {
  await stopMockServer(mockServer);
  await appPool.end();
  await owner.query("DELETE FROM memory_embeddings WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  await owner.end();
});

describe("semantic memory (Tier 3, real pgvector)", () => {
  it("ranks a genuinely closer vector ahead of a genuinely farther one", async () => {
    const provider = new OpenAiEmbeddingAdapter(mockBaseUrl, EMBEDDING_MODEL);

    await embedAndStore(appPool, tenantId, {
      content: "the close one",
      embeddingProvider: provider,
      apiKey: "sk-test",
      embeddingModel: EMBEDDING_MODEL,
    });
    await embedAndStore(appPool, tenantId, {
      content: "the far one",
      embeddingProvider: provider,
      apiKey: "sk-test",
      embeddingModel: EMBEDDING_MODEL,
    });

    const results = await semanticSearch(appPool, tenantId, {
      queryText: "my query",
      embeddingProvider: provider,
      apiKey: "sk-test",
      embeddingModel: EMBEDDING_MODEL,
      topK: 2,
    });

    assert.equal(results.length, 2);
    assert.equal(results[0]!.content, "the close one");
    assert.equal(results[1]!.content, "the far one");
    assert.ok(results[0]!.similarity > 0.99, `expected close similarity > 0.99, got ${results[0]!.similarity}`);
    assert.ok(results[1]!.similarity < 0.01, `expected far similarity < 0.01, got ${results[1]!.similarity}`);
  });

  it("scopes results to the requested embedding_model, ignoring embeddings from a different model", async () => {
    const provider = new OpenAiEmbeddingAdapter(mockBaseUrl, EMBEDDING_MODEL);
    await embedAndStore(appPool, tenantId, {
      content: "the close one (other model)",
      embeddingProvider: provider,
      apiKey: "sk-test",
      embeddingModel: "some-other-model",
    });

    const results = await semanticSearch(appPool, tenantId, {
      queryText: "my query",
      embeddingProvider: provider,
      apiKey: "sk-test",
      embeddingModel: EMBEDDING_MODEL,
    });

    assert.ok(
      results.every((r) => r.content !== "the close one (other model)"),
      "a row stored under a different embedding_model must never be returned",
    );
  });
});
