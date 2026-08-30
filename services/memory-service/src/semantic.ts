import type { Pool } from "@ai-office/db";
import { withTenantTransaction } from "@ai-office/db";
import type { EmbeddingProvider } from "./embedding-provider.js";

export interface EmbedAndStoreInput {
  content: string;
  memoryFactId?: string;
  embeddingProvider: EmbeddingProvider;
  apiKey: string;
  embeddingModel: string;
}

/** Tier 3 — pgvector/HNSW semantic memory (packages/db/migrations/0006,
 * verified working since Phase 1). Storing an embedding requires a real
 * embedding call — no offline stand-in (see embedding-provider.ts). */
export async function embedAndStore(pool: Pool, tenantId: string, input: EmbedAndStoreInput): Promise<{ embeddingId: string }> {
  const embedding = await input.embeddingProvider.embed(input.content, input.apiKey);
  const vectorLiteral = `[${embedding.join(",")}]`;

  return withTenantTransaction(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ embedding_id: string }>(
      `INSERT INTO memory_embeddings (tenant_id, memory_fact_id, content, embedding, embedding_model)
       VALUES ($1, $2, $3, $4::vector, $5)
       RETURNING embedding_id`,
      [tenantId, input.memoryFactId ?? null, input.content, vectorLiteral, input.embeddingModel],
    );
    return { embeddingId: rows[0]!.embedding_id };
  });
}

export interface SemanticSearchInput {
  queryText: string;
  embeddingProvider: EmbeddingProvider;
  apiKey: string;
  embeddingModel: string;
  topK?: number;
}

export interface SemanticSearchResult {
  embeddingId: string;
  content: string;
  memoryFactId: string | null;
  /** 1 - cosine_distance. Not bounded to [0,1] for arbitrary vectors (raw
   * cosine distance ranges over [0,2]), but monotonic with similarity and
   * matches the common pgvector convention. */
  similarity: number;
}

/**
 * Embeds the query, then a real pgvector nearest-neighbor query
 * (`ORDER BY embedding <=> query`, HNSW-indexed) — genuine ranking, not a
 * text match dressed up as one. Scoped to `embedding_model` so mixing two
 * incompatible embedding spaces can't silently rank against each other
 * (the model_embeddings.embedding_model column exists exactly for this —
 * see migration 0006's own comment).
 */
export async function semanticSearch(pool: Pool, tenantId: string, input: SemanticSearchInput): Promise<SemanticSearchResult[]> {
  const queryEmbedding = await input.embeddingProvider.embed(input.queryText, input.apiKey);
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;
  const topK = Math.min(input.topK ?? 10, 100);

  return withTenantTransaction(pool, tenantId, async (client) => {
    const { rows } = await client.query<{
      embedding_id: string;
      content: string;
      memory_fact_id: string | null;
      similarity: string;
    }>(
      `SELECT embedding_id, content, memory_fact_id, 1 - (embedding <=> $1::vector) AS similarity
       FROM memory_embeddings
       WHERE embedding_model = $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vectorLiteral, input.embeddingModel, topK],
    );
    return rows.map((r) => ({
      embeddingId: r.embedding_id,
      content: r.content,
      memoryFactId: r.memory_fact_id,
      similarity: Number(r.similarity),
    }));
  });
}
