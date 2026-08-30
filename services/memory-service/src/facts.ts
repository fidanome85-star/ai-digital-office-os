import type { Pool } from "@ai-office/db";
import { withTenantTransaction } from "@ai-office/db";

export interface RememberFactInput {
  scope: "AGENT" | "PROJECT" | "ORG";
  subjectType: string;
  subjectId: string;
  fact: string;
  sourceReference?: string;
  confidence?: number;
}

export async function rememberFact(pool: Pool, tenantId: string, input: RememberFactInput): Promise<{ memoryId: string }> {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ memory_id: string }>(
      `INSERT INTO memory_facts (tenant_id, scope, subject_type, subject_id, fact, source_reference, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING memory_id`,
      [tenantId, input.scope, input.subjectType, input.subjectId, input.fact, input.sourceReference ?? null, input.confidence ?? null],
    );
    return { memoryId: rows[0]!.memory_id };
  });
}

export interface RecallFactsInput {
  queryText: string;
  scope?: "AGENT" | "PROJECT" | "ORG";
  subjectId?: string;
  limit?: number;
}

export interface RecalledFact {
  memoryId: string;
  fact: string;
  confidence: number | null;
}

/** Tier 2 — durable structured memory, literal text match. Real semantic
 * ranking over this tier's content lives in semantic.ts (Tier 3), which
 * needs a real embedding provider — this tier deliberately doesn't
 * attempt to fake that (see embedding-provider.ts). */
export async function recallFacts(pool: Pool, tenantId: string, input: RecallFactsInput): Promise<RecalledFact[]> {
  return withTenantTransaction(pool, tenantId, async (client) => {
    const conditions: string[] = ["fact ILIKE $1"];
    const values: unknown[] = [`%${input.queryText}%`];
    if (input.scope) {
      values.push(input.scope);
      conditions.push(`scope = $${values.length}`);
    }
    if (input.subjectId) {
      values.push(input.subjectId);
      conditions.push(`subject_id = $${values.length}`);
    }
    values.push(Math.min(input.limit ?? 10, 100));

    const { rows } = await client.query<{ memory_id: string; fact: string; confidence: string | null }>(
      `SELECT memory_id, fact, confidence FROM memory_facts
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC LIMIT $${values.length}`,
      values,
    );
    return rows.map((r) => ({ memoryId: r.memory_id, fact: r.fact, confidence: r.confidence === null ? null : Number(r.confidence) }));
  });
}
