import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { ServicePrincipal } from "../src/claims.js";
import { getCurrentPrincipal, getCurrentTenantId, requireCurrentPrincipal, runWithPrincipal } from "../src/tenant-context.js";

function servicePrincipal(tenantId: string): ServicePrincipal {
  return {
    principalType: "service",
    subject: "svc-test",
    tenantId,
    serviceId: "test-service",
    scopes: [],
    issuer: "https://auth.local/",
    audience: "control-plane",
    expiresAt: new Date(Date.now() + 3600_000),
    issuedAt: new Date(),
  };
}

describe("tenant-context", () => {
  it("returns undefined outside any context", () => {
    assert.equal(getCurrentPrincipal(), undefined);
    assert.equal(getCurrentTenantId(), undefined);
  });

  it("requireCurrentPrincipal throws outside any context", () => {
    assert.throws(() => requireCurrentPrincipal());
  });

  it("exposes the tenant id inside runWithPrincipal, even across an await", async () => {
    await runWithPrincipal(servicePrincipal("tenant-a"), async () => {
      assert.equal(getCurrentTenantId(), "tenant-a");
      await delay(5);
      assert.equal(getCurrentTenantId(), "tenant-a");
    });
  });

  it("keeps concurrent requests' tenant context isolated from each other", async () => {
    const results: string[] = [];

    async function simulateRequest(tenantId: string, delayMs: number): Promise<void> {
      await runWithPrincipal(servicePrincipal(tenantId), async () => {
        await delay(delayMs);
        // If context leaked between concurrent calls, this would read the
        // other request's tenant id instead of its own.
        results.push(`${tenantId}:${getCurrentTenantId()}`);
      });
    }

    await Promise.all([simulateRequest("tenant-a", 20), simulateRequest("tenant-b", 5)]);

    assert.deepEqual(new Set(results), new Set(["tenant-a:tenant-a", "tenant-b:tenant-b"]));
  });
});
