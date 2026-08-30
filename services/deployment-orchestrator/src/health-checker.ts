export interface HealthCheckResult {
  healthy: boolean;
  detail: string;
}

export interface HealthChecker {
  check(url: string): Promise<HealthCheckResult>;
}

/**
 * Real HTTP health probe — a GET to the given URL, 2xx means healthy.
 * There is no real infrastructure to check in this environment (no
 * deployed service has a health endpoint), so every test points this at
 * a local mock server, same pattern as every network-touching adapter
 * since Phase 4. Deliberately never throws — a network failure IS an
 * unhealthy result, not an exception the caller has to catch separately.
 */
export class HttpHealthChecker implements HealthChecker {
  constructor(private readonly timeoutMs: number = 10_000) {}

  async check(url: string): Promise<HealthCheckResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { method: "GET", signal: controller.signal });
      return { healthy: res.status >= 200 && res.status < 300, detail: `HTTP ${res.status}` };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { healthy: false, detail: `timed out after ${this.timeoutMs}ms` };
      }
      return { healthy: false, detail: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timeout);
    }
  }
}
