import { Router } from "express";
import { ah } from "../async-handler.js";
import { withRequestTenant } from "../db.js";
import { ApiError } from "../errors.js";

export const memoryRouter = Router();

/**
 * Tier 2 (durable memory_facts) only, via literal text matching. Tier 3
 * (memory_embeddings, pgvector/HNSW) genuinely exists and works — see
 * tests/rls-adversarial or packages/db for schema — but ranking it by
 * semantic similarity to arbitrary query_text requires calling a real
 * embedding model, which no provider integration exists for yet
 * (model-router-gateway, build-order step 6). Wiring this endpoint to a
 * fabricated or hash-based pseudo-embedding would produce meaningless
 * similarity scores dressed up as real ones — worse than being explicit
 * about the gap. Tier 1 (working_memory_cache) is task-scoped, short-TTL
 * key/value and doesn't fit a free-text query shape; not queried here.
 */
memoryRouter.post(
  "/memory/query",
  ah(async (req, res) => {
    const { query_text, scope, subject_id, top_k } = req.body ?? {};
    if (!query_text) throw ApiError.validation("query_text is required.");
    const limit = typeof top_k === "number" && top_k > 0 ? Math.min(top_k, 100) : 10;

    const rows = await withRequestTenant(async (client) => {
      const conditions: string[] = ["fact ILIKE $1"];
      const values: unknown[] = [`%${query_text}%`];
      if (scope) {
        values.push(scope);
        conditions.push(`scope = $${values.length}`);
      }
      if (subject_id) {
        values.push(subject_id);
        conditions.push(`subject_id = $${values.length}`);
      }
      values.push(limit);
      const { rows } = await client.query(
        `SELECT memory_id, fact, confidence FROM memory_facts
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC LIMIT $${values.length}`,
        values,
      );
      return rows;
    });

    res.status(200).json(
      rows.map((row) => ({
        content: row.fact as string,
        similarity: row.confidence !== null ? Number(row.confidence) : 0,
        memoryFactId: row.memory_id as string,
      })),
    );
  }),
);
