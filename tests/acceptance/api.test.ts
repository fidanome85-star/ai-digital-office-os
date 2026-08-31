/**
 * One test per bullet in the "API" section of
 * docs/blueprint/implementation_acceptance_checklist_v1.4.md. Each test
 * maps its bullet to the *specific* OpenAPI path(s) that satisfy it — a
 * traceability check on top of, not a duplicate of,
 * services/control-plane-api/test/openapi-coverage.test.ts, which already
 * proves exhaustively (48/48) that every declared operation has a real
 * bound Express route. That means a path found present here is not just
 * spec text — it's a route control-plane-api actually serves.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { load as loadYaml } from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const OPENAPI_PATH = join(
  REPO_ROOT,
  "services/control-plane-api/openapi/control_plane_openapi_v1.4.yaml",
);

interface OpenApiDoc {
  paths: Record<string, Record<string, unknown>>;
}

const doc = loadYaml(readFileSync(OPENAPI_PATH, "utf8")) as OpenApiDoc;
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

function operationsFor(path: string): string[] {
  const ops = doc.paths[path];
  if (!ops) return [];
  return Object.keys(ops).filter((m) => HTTP_METHODS.includes(m)).map((m) => m.toUpperCase());
}

function assertPathExists(path: string, expectedMethods: string[]): void {
  const actual = operationsFor(path);
  assert.ok(actual.length > 0, `expected OpenAPI path ${path} to exist`);
  for (const method of expectedMethods) {
    assert.ok(actual.includes(method), `expected ${method} ${path} to exist, found methods: ${actual.join(", ")}`);
  }
}

describe("API", () => {
  it("Project lifecycle endpoints exist", () => {
    assertPathExists("/projects", ["POST", "GET"]);
    assertPathExists("/projects/{project_id}", ["GET", "PATCH"]);
  });

  it("Workflow cancel/retry/escalate exists", () => {
    assertPathExists("/workflows/{workflow_id}/cancel", ["POST"]);
    assertPathExists("/workflows/{workflow_id}/retry", ["POST"]);
    assertPathExists("/workflows/{workflow_id}/escalate", ["POST"]);
  });

  it("Agent version activation exists", () => {
    assertPathExists("/agents/{agent_id}/versions", ["POST", "GET"]);
    assertPathExists("/agents/{agent_id}/versions/{agent_version_id}/activate", ["POST"]);
  });

  it("Agent message send exists", () => {
    assertPathExists("/agents/{agent_id}/messages", ["POST", "GET"]);
  });

  it("Artifact creation and lineage endpoint exists", () => {
    assertPathExists("/artifacts", ["POST", "GET"]);
    assertPathExists("/artifacts/{artifact_id}/lineage", ["GET"]);
  });

  it("Provider/model/evaluation endpoints exist", () => {
    assertPathExists("/providers", ["GET"]);
    assertPathExists("/models", ["GET"]);
    assertPathExists("/models/evaluate", ["POST"]);
    assertPathExists("/models/evaluations", ["GET"]);
  });

  it("Usage/cost endpoints exist", () => {
    assertPathExists("/usage", ["GET"]);
    assertPathExists("/costs", ["GET"]);
  });

  it("Deployment/release endpoints exist", () => {
    assertPathExists("/deployments", ["POST"]);
    assertPathExists("/deployments/{deployment_id}", ["GET"]);
    assertPathExists("/deployments/{deployment_id}/rollback", ["POST"]);
    // release_registry itself has no creation endpoint in the v1.4
    // contract — a documented spec gap (ADR 0002 §5), not something this
    // implementation can silently invent. POST /deployments requires a
    // release to already exist.
  });

  it("Policy/routing decision endpoints exist", () => {
    assertPathExists("/policy-decisions", ["GET"]);
    assertPathExists("/routing-decisions", ["GET"]);
  });

  it("SQL/OpenAPI/domain-model diff test passes", () => {
    // The exact same gate CI runs (.github/workflows/ci.yml): regenerate
    // packages/domain-model/src/generated from the live schema, then
    // require zero diff against what's committed. Requires
    // DATABASE_URL to point at a Postgres instance with every migration
    // already applied.
    execFileSync("pnpm", ["--filter", "@ai-office/domain-model", "run", "generate"], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
    assert.doesNotThrow(() => {
      execFileSync("git", ["diff", "--exit-code", "--", "packages/domain-model/src/generated"], {
        cwd: REPO_ROOT,
        stdio: "pipe",
      });
    }, "packages/domain-model/src/generated/tables.ts is stale relative to the live schema — run 'pnpm domain-model:generate' and commit the result");
  });
});
