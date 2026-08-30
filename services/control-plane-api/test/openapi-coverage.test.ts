/**
 * Route-completeness gate: every (method, path) the OpenAPI contract
 * declares must have a matching Express route registered. Catches the
 * class of bug the duplicate-key YAML issue (fixed in this same phase)
 * caused — an operation silently missing with no error anywhere.
 */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { load as loadYaml } from "js-yaml";
import type { Express } from "express";
import type { TokenVerifier } from "@ai-office/auth";
import { createApp } from "../src/app.js";
import { closeAppDbPool, ISSUER, AUDIENCE } from "./test-helpers.js";

after(async () => {
  await closeAppDbPool();
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = join(__dirname, "..", "openapi", "control_plane_openapi_v1.4.yaml");

interface OpenApiDoc {
  paths: Record<string, Record<string, unknown>>;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

function normalizePath(path: string): string {
  return path
    .split("/")
    .map((segment) => (segment.startsWith(":") || (segment.startsWith("{") && segment.endsWith("}")) ? "*" : segment))
    .join("/");
}

interface ExpressRouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  handle?: { stack?: ExpressRouteLayer[] };
}

function listExpressRoutes(app: Express): { method: string; path: string }[] {
  const routes: { method: string; path: string }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stack: ExpressRouteLayer[] = (app as any)._router?.stack ?? [];

  function walk(layers: ExpressRouteLayer[]): void {
    for (const layer of layers) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          if (layer.route.methods[method]) routes.push({ method: method.toUpperCase(), path: layer.route.path });
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  }
  walk(stack);
  return routes;
}

describe("OpenAPI path coverage", () => {
  it("has a registered Express route for every OpenAPI operation", async () => {
    const doc = loadYaml(readFileSync(OPENAPI_PATH, "utf8")) as OpenApiDoc;
    const specOperations = new Set<string>();
    for (const [path, operations] of Object.entries(doc.paths)) {
      for (const method of Object.keys(operations)) {
        if (HTTP_METHODS.includes(method)) {
          specOperations.add(`${method.toUpperCase()} ${normalizePath(path)}`);
        }
      }
    }

    // No request is made in this test — route registration happens at
    // createApp() time, before anything would hit requireAuth() — so this
    // verifier only needs to satisfy the type, never actually run.
    const verifier: TokenVerifier = {
      verify: () => Promise.reject(new Error("not used by this test")),
    };
    const app = createApp({ issuer: ISSUER, audience: AUDIENCE, jwksUri: "unused", clockToleranceSeconds: 5 }, { verifier });

    const expressOperations = new Set(
      listExpressRoutes(app).map(({ method, path }) => `${method} ${normalizePath(path)}`),
    );

    const missing = [...specOperations].filter((op) => !expressOperations.has(op));
    assert.deepEqual(missing, [], `OpenAPI operations with no matching Express route: ${missing.join(", ")}`);

    assert.equal(specOperations.size, 48, "expected exactly 48 operations across 40 paths in the v1.4 contract");
  });
});
