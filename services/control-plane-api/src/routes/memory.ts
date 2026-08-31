import { Router } from "express";
import { getCurrentTenantId } from "@ai-office/auth";
import { OpenAiEmbeddingAdapter, recallFacts, semanticSearch } from "@ai-office/memory-service";
import { ah } from "../async-handler.js";
import { pool, withRequestTenant } from "../db.js";
import { ApiError } from "../errors.js";
import { EnvSecretResolver } from "../secret-resolver.js";

export const memoryRouter = Router();

/** Convention for the one secrets_vault_references row that configures
 * this tenant's embedding provider — unscoped by agent/provider/tool
 * (those columns stay NULL), looked up by this fixed secret_name. */
const EMBEDDING_SECRET_NAME = "memory-embedding-provider";
const EMBEDDING_MODEL = "text-embedding-3-small";
const secretResolver = new EnvSecretResolver();

interface MemoryQueryResult {
  content: string;
  similarity: number;
  memoryFactId: string | null;
}

/**
 * Tier 2 (memory_facts, ILIKE text match) is always queried, through
 * @ai-office/memory-service's recallFacts — real, shared, tested logic
 * (Phase 6), replacing the inline SQL this endpoint used to duplicate.
 *
 * Tier 3 (memory_embeddings, real pgvector cosine search) is queried too,
 * but only when this tenant has actually configured an embedding-provider
 * secret (a secrets_vault_references row with secret_name =
 * "memory-embedding-provider"). No such secret exists in this environment
 * by design (ADR 0004 §1, ADR 0006 §1) — wiring this endpoint to a
 * fabricated embedding would produce similarity scores that look real but
 * mean nothing. When a secret is configured, this calls the exact same
 * OpenAiEmbeddingAdapter + semanticSearch code path already proven against
 * a mock server in memory-service's own test suite.
 */
memoryRouter.post(
  "/memory/query",
  ah(async (req, res) => {
    const { query_text, scope, subject_id, top_k } = req.body ?? {};
    if (!query_text) throw ApiError.validation("query_text is required.");
    const limit = typeof top_k === "number" && top_k > 0 ? Math.min(top_k, 100) : 10;
    const tenantId = getCurrentTenantId()!;

    const facts = await recallFacts(pool, tenantId, { queryText: query_text, scope, subjectId: subject_id, limit });
    const results: MemoryQueryResult[] = facts.map((f) => ({
      content: f.fact,
      similarity: f.confidence ?? 0,
      memoryFactId: f.memoryId,
    }));

    const vaultPath = await withRequestTenant(async (client) => {
      const { rows } = await client.query<{ vault_path: string }>(
        `SELECT vault_path FROM secrets_vault_references
         WHERE tenant_id = $1 AND secret_name = $2
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, EMBEDDING_SECRET_NAME],
      );
      return rows[0]?.vault_path;
    });

    if (vaultPath) {
      const apiKey = await secretResolver.resolve(vaultPath);
      // Test-only override, same pattern as model-router-gateway's
      // ExecuteModelRunOptions.adapterBaseUrl — points the adapter at a
      // local mock server instead of the real OpenAI endpoint.
      const embeddingProvider = new OpenAiEmbeddingAdapter(process.env["EMBEDDING_PROVIDER_BASE_URL"]);
      const semanticResults = await semanticSearch(pool, tenantId, {
        queryText: query_text,
        embeddingProvider,
        apiKey,
        embeddingModel: EMBEDDING_MODEL,
        topK: limit,
      });
      for (const r of semanticResults) {
        results.push({ content: r.content, similarity: r.similarity, memoryFactId: r.memoryFactId });
      }
      results.sort((a, b) => b.similarity - a.similarity);
    }

    res.status(200).json(results.slice(0, limit));
  }),
);
