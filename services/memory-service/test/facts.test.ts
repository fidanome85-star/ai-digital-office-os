import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { recallFacts, rememberFact } from "../src/facts.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const APP_DATABASE_URL = process.env["APP_DATABASE_URL"];
if (!DATABASE_URL || !APP_DATABASE_URL) {
  throw new Error("DATABASE_URL and APP_DATABASE_URL must both be set to run this test.");
}

let owner: Client;
let appPool: Pool;
const tenantId = randomUUID();
const runTag = tenantId.slice(0, 8);

before(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  appPool = createDbPool(APP_DATABASE_URL);
  await owner.query("INSERT INTO organizations (tenant_id, org_name, org_slug) VALUES ($1, $2, $3)", [
    tenantId,
    "Memory Service Test Tenant (facts)",
    `mem-facts-test-${runTag}`,
  ]);
});

after(async () => {
  await appPool.end();
  await owner.query("DELETE FROM memory_facts WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  await owner.end();
});

describe("memory facts (Tier 2)", () => {
  it("remembers a fact and recalls it by text match", async () => {
    await rememberFact(appPool, tenantId, {
      scope: "PROJECT",
      subjectType: "project",
      subjectId: `proj-${runTag}`,
      fact: "The project uses TypeScript and pnpm workspaces.",
      confidence: 0.9,
    });

    const results = await recallFacts(appPool, tenantId, { queryText: "TypeScript" });
    assert.ok(results.some((r) => r.fact.includes("TypeScript")));
  });

  it("filters recall by scope and subjectId", async () => {
    const subjectA = `agent-a-${runTag}`;
    const subjectB = `agent-b-${runTag}`;
    await rememberFact(appPool, tenantId, { scope: "AGENT", subjectType: "agent", subjectId: subjectA, fact: "Agent A prefers concise answers." });
    await rememberFact(appPool, tenantId, { scope: "AGENT", subjectType: "agent", subjectId: subjectB, fact: "Agent B prefers concise summaries." });

    const results = await recallFacts(appPool, tenantId, { queryText: "concise", subjectId: subjectA });
    assert.equal(results.length, 1);
    assert.match(results[0]!.fact, /Agent A/);
  });

  it("finds nothing for a query that matches no fact", async () => {
    const results = await recallFacts(appPool, tenantId, { queryText: "a-string-that-matches-nothing-xyz" });
    assert.equal(results.length, 0);
  });
});
