/** node-pg returns columns exactly as named in SQL (snake_case); the API
 * contract and @ai-office/domain-model types are camelCase. This converts
 * one level of row keys — JSONB column *contents* are left untouched,
 * since those are opaque payloads owned by whichever caller wrote them. */
export function camelizeRow<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

export function camelizeRows<T = Record<string, unknown>>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => camelizeRow<T>(row));
}
