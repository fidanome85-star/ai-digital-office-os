import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import { createTokenVerifier, type AuthConfig, type TokenVerifier } from "@ai-office/auth";
import { requireAuth } from "./auth-middleware.js";
import { errorHandler, sendError } from "./errors.js";
import { requireIdempotencyKey } from "./idempotency.js";
import { registerRoutes } from "./routes/index.js";

export interface CreateAppOptions {
  /** Tests inject a verifier built against a local JWKS instead of hitting a real JWKS endpoint. */
  verifier?: TokenVerifier;
}

export function createApp(authConfig: AuthConfig, options: CreateAppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  app.use((req, _res, next) => {
    const incoming = req.header("x-correlation-id");
    req.correlationId = incoming && incoming.length > 0 ? incoming : randomUUID();
    next();
  });

  const verifier = options.verifier ?? createTokenVerifier(authConfig);
  app.use(requireAuth(verifier));
  app.use(requireIdempotencyKey);

  registerRoutes(app);

  app.use((req, res) => {
    sendError(res, req, 404, "VALIDATION_ERROR", `No route for ${req.method} ${req.path}`);
  });

  app.use(errorHandler);

  return app;
}
