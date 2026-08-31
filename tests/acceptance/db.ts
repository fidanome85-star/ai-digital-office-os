import { Client } from "pg";
import { createDbPool, type Pool } from "@ai-office/db";

/** Owner-role connection — bypasses RLS deliberately, for fixture setup
 * and schema/FK-level assertions that aren't about RLS itself. Mirrors
 * every other test directory's local `createOwnerClient` helper. */
export function createOwnerClient(): Client {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not set (owner role).");
  return new Client({ connectionString: url });
}

/** Application-role pool — the one every real service and RLS test uses,
 * so calling real service code (e.g. callTool) here exercises the same
 * RLS-enforced path production traffic does. */
export function createAppPool(): Pool {
  const url = process.env["APP_DATABASE_URL"];
  if (!url) throw new Error("APP_DATABASE_URL is not set (ai_office_app role).");
  return createDbPool(url);
}
