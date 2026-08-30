export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

/** Exponential backoff (baseDelayMs * 2^(attempt-1)) — real delays, not a
 * no-op stub, but small enough in tests (baseDelayMs overridden to ~5ms)
 * that the retry test suite runs in milliseconds, not seconds. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !isRetryable(err)) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
