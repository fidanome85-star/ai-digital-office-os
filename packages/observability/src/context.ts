import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Deliberately its own AsyncLocalStorage, not a reuse of @ai-office/auth's
 * tenant-context — observability must not depend on auth's principal types
 * (a CLI worker like agent-factory's has no HTTP request or JWT at all,
 * but still wants correlated logs).
 */
export interface ObservabilityContext {
  correlationId: string;
  tenantId?: string;
}

const storage = new AsyncLocalStorage<ObservabilityContext>();

export function runWithContext<T>(context: ObservabilityContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): ObservabilityContext | undefined {
  return storage.getStore();
}
