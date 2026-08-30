import type { AuthenticatedPrincipal } from "@ai-office/auth";

declare global {
  namespace Express {
    interface Request {
      principal?: AuthenticatedPrincipal;
      correlationId?: string;
      idempotencyKey?: string;
    }
  }
}

export {};
