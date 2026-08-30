import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";
import { getWorkingMemory, purgeExpiredWorkingMemory, setWorkingMemory } from "../src/working-memory.js";

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
    "Memory Service Test Tenant (working)",
    `mem-wm-test-${runTag}`,
  ]);
});

after(async () => {
  await appPool.end();
  await owner.query("DELETE FROM working_memory_cache WHERE tenant_id = $1", [tenantId]);
  await owner.query("DELETE FROM organizations WHERE tenant_id = $1", [tenantId]);
  await owner.end();
});

describe("working memory (Tier 1)", () => {
  it("stores and reads back a value before expiry", async () => {
    const key = `${runTag}:greeting`;
    await setWorkingMemory(appPool, tenantId, { cacheKey: key, payload: { text: "hello" }, ttlSeconds: 60 });
    const value = await getWorkingMemory<{ text: string }>(appPool, tenantId, key);
    assert.deepEqual(value, { text: "hello" });
  });

  it("returns null once the TTL has elapsed, without any cleanup job running", async () => {
    const key = `${runTag}:short-lived`;
    await setWorkingMemory(appPool, tenantId, { cacheKey: key, payload: "will expire", ttlSeconds: -1 });
    const value = await getWorkingMemory(appPool, tenantId, key);
    assert.equal(value, null, "a TTL in the past must already be invisible, purely from the WHERE clause");
  });

  it("upserts on the same cache_key, replacing the payload and TTL", async () => {
    const key = `${runTag}:counter`;
    await setWorkingMemory(appPool, tenantId, { cacheKey: key, payload: 1, ttlSeconds: 60 });
    await setWorkingMemory(appPool, tenantId, { cacheKey: key, payload: 2, ttlSeconds: 60 });
    const value = await getWorkingMemory<number>(appPool, tenantId, key);
    assert.equal(value, 2);
  });

  it("purgeExpiredWorkingMemory deletes only rows past their TTL", async () => {
    const liveKey = `${runTag}:live`;
    const deadKey = `${runTag}:dead`;
    await setWorkingMemory(appPool, tenantId, { cacheKey: liveKey, payload: "alive", ttlSeconds: 3600 });
    await setWorkingMemory(appPool, tenantId, { cacheKey: deadKey, payload: "gone", ttlSeconds: -5 });

    const purged = await purgeExpiredWorkingMemory(appPool, tenantId);
    assert.ok(purged >= 1);

    assert.notEqual(await getWorkingMemory(appPool, tenantId, liveKey), null);
    const { rows } = await owner.query("SELECT 1 FROM working_memory_cache WHERE cache_key = $1", [deadKey]);
    assert.equal(rows.length, 0);
  });
});
