import { ModelRouterError } from "./errors.js";

export interface HttpJsonOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/** Shared transport for every adapter — one place that maps network
 * failures/timeouts to typed, retryable-flagged errors, so each adapter
 * only has to know its own vendor's request/response shape. */
export async function fetchJson(options: HttpJsonOptions): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

  try {
    const res = await fetch(options.url, {
      method: options.method ?? "POST",
      headers: { "content-type": "application/json", ...options.headers },
      signal: controller.signal,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      throw new ModelRouterError(
        "INVALID_RESPONSE",
        `Provider returned non-JSON response (status ${res.status}): ${text.slice(0, 200)}`,
      );
    }
    return { status: res.status, body: parsed };
  } catch (err) {
    if (err instanceof ModelRouterError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ModelRouterError("TIMEOUT", `Request to ${options.url} timed out.`, true);
    }
    throw new ModelRouterError(
      "PROVIDER_UNREACHABLE",
      `Failed to reach ${options.url}: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function assertOk(status: number, body: unknown, providerName: string): void {
  if (status === 429) {
    throw new ModelRouterError("RATE_LIMITED", `${providerName} rate-limited the request.`, true);
  }
  if (status >= 500) {
    throw new ModelRouterError("PROVIDER_ERROR", `${providerName} returned ${status}.`, true);
  }
  if (status >= 400) {
    throw new ModelRouterError(
      "PROVIDER_ERROR",
      `${providerName} returned ${status}: ${JSON.stringify(body).slice(0, 300)}`,
      false,
    );
  }
}
