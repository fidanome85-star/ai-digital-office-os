import type { Server } from "node:http";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTVerifyGetKey,
} from "jose";
import { createTokenVerifier, type AuthConfig } from "@ai-office/auth";
import { Client } from "pg";
import { createApp } from "../src/app.js";
import { pool as appPool } from "../src/db.js";

export const ISSUER = "https://auth.ai-digital-office-os.local/";
export const AUDIENCE = "ai-digital-office-os-control-plane";

const authConfig: AuthConfig = {
  issuer: ISSUER,
  audience: AUDIENCE,
  jwksUri: "unused-in-tests",
  clockToleranceSeconds: 5,
};

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let keyResolver: JWTVerifyGetKey;

async function ensureKeys(): Promise<void> {
  if (privateKey) return;
  const { publicKey, privateKey: sk } = await generateKeyPair("RS256");
  privateKey = sk;
  const jwk: JWK = await exportJWK(publicKey);
  jwk.kid = "test-key-1";
  jwk.alg = "RS256";
  keyResolver = createLocalJWKSet({ keys: [jwk] });
}

export interface TokenClaims {
  tenantId: string;
  principalType?: "human" | "service";
  userId?: string;
  serviceId?: string;
  scopes?: string[];
  expiresInSeconds?: number;
}

export async function signTestToken(claims: TokenClaims): Promise<string> {
  await ensureKeys();
  const principalType = claims.principalType ?? "service";
  const payload: Record<string, unknown> = {
    tenant_id: claims.tenantId,
    principal_type: principalType,
    scope: (claims.scopes ?? []).join(" "),
  };
  if (principalType === "human") {
    payload["user_id"] = claims.userId ?? "test-user";
  } else {
    payload["service_id"] = claims.serviceId ?? "test-service";
  }

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setSubject(claims.userId ?? claims.serviceId ?? "test-subject")
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${claims.expiresInSeconds ?? 3600}s`)
    .sign(privateKey);
}

export async function startTestServer(): Promise<{ baseUrl: string; server: Server }> {
  await ensureKeys();
  const verifier = createTokenVerifier(authConfig, keyResolver);
  const app = createApp(authConfig, { verifier });

  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Failed to determine test server address.");
      }
      resolve({ baseUrl: `http://127.0.0.1:${address.port}`, server });
    });
  });
}

export function stopTestServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/** Direct owner-role connection for test fixtures — bypasses RLS deliberately, mirrors real seed-data scripts. */
export function createOwnerClient(): Client {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not set (owner role, for test fixture setup).");
  return new Client({ connectionString: url });
}

/** src/db.ts's pool is a module-level singleton with open sockets — without
 * closing it, `node --test` hangs after the last assertion instead of
 * exiting. Call this once per test file, after the HTTP server is stopped. */
export function closeAppDbPool(): Promise<void> {
  return appPool.end();
}
