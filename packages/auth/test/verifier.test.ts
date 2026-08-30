import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWTVerifyGetKey } from "jose";
import type { AuthConfig } from "../src/config.js";
import { createTokenVerifier } from "../src/verifier.js";
import { AuthError } from "../src/errors.js";

const ISSUER = "https://auth.ai-digital-office-os.local/";
const AUDIENCE = "ai-digital-office-os-control-plane";
const TENANT_ID = "11111111-1111-1111-1111-111111111111";

const config: AuthConfig = {
  issuer: ISSUER,
  audience: AUDIENCE,
  jwksUri: "unused-in-tests",
  clockToleranceSeconds: 5,
};

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let keyResolver: JWTVerifyGetKey;

before(async () => {
  const { publicKey, privateKey: sk } = await generateKeyPair("RS256");
  privateKey = sk;
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key-1";
  jwk.alg = "RS256";
  keyResolver = createLocalJWKSet({ keys: [jwk] });
});

async function signToken(claims: Record<string, unknown>, expiresIn = "1h"): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}

describe("createTokenVerifier", () => {
  it("verifies a valid human token and maps claims to a HumanPrincipal", async () => {
    const token = await signToken({
      sub: "user-42",
      tenant_id: TENANT_ID,
      principal_type: "human",
      user_id: "user-42",
      scope: "projects:read projects:write",
    });

    const verifier = createTokenVerifier(config, keyResolver);
    const principal = await verifier.verify(token);

    assert.equal(principal.principalType, "human");
    assert.equal(principal.tenantId, TENANT_ID);
    assert.deepEqual(principal.scopes, ["projects:read", "projects:write"]);
    if (principal.principalType === "human") {
      assert.equal(principal.userId, "user-42");
    }
  });

  it("verifies a valid service token and maps claims to a ServicePrincipal", async () => {
    const token = await signToken({
      sub: "svc-model-router",
      tenant_id: TENANT_ID,
      principal_type: "service",
      service_id: "model-router-gateway",
      scope: "routing:decide",
    });

    const verifier = createTokenVerifier(config, keyResolver);
    const principal = await verifier.verify(token);

    assert.equal(principal.principalType, "service");
    if (principal.principalType === "service") {
      assert.equal(principal.serviceId, "model-router-gateway");
    }
  });

  it("rejects an expired token with TOKEN_EXPIRED", async () => {
    const token = await signToken(
      { sub: "user-1", tenant_id: TENANT_ID, principal_type: "human", user_id: "user-1" },
      "-10s",
    );

    const verifier = createTokenVerifier(config, keyResolver);
    await assert.rejects(() => verifier.verify(token), (err: unknown) => {
      assert.ok(err instanceof AuthError);
      assert.equal(err.code, "TOKEN_EXPIRED");
      return true;
    });
  });

  it("rejects a token with the wrong audience with TOKEN_INVALID", async () => {
    const token = await new SignJWT({
      sub: "user-1",
      tenant_id: TENANT_ID,
      principal_type: "human",
      user_id: "user-1",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer(ISSUER)
      .setAudience("some-other-service")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const verifier = createTokenVerifier(config, keyResolver);
    await assert.rejects(() => verifier.verify(token), (err: unknown) => {
      assert.ok(err instanceof AuthError);
      assert.equal(err.code, "TOKEN_INVALID");
      return true;
    });
  });

  it("rejects a token missing tenant_id with CLAIMS_INVALID", async () => {
    const token = await signToken({ sub: "user-1", principal_type: "human", user_id: "user-1" });

    const verifier = createTokenVerifier(config, keyResolver);
    await assert.rejects(() => verifier.verify(token), (err: unknown) => {
      assert.ok(err instanceof AuthError);
      assert.equal(err.code, "CLAIMS_INVALID");
      return true;
    });
  });

  it("rejects a human token missing user_id with CLAIMS_INVALID", async () => {
    const token = await signToken({ sub: "user-1", tenant_id: TENANT_ID, principal_type: "human" });

    const verifier = createTokenVerifier(config, keyResolver);
    await assert.rejects(() => verifier.verify(token), (err: unknown) => {
      assert.ok(err instanceof AuthError);
      assert.equal(err.code, "CLAIMS_INVALID");
      return true;
    });
  });
});
