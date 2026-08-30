import { randomUUID } from "node:crypto";

/** VARCHAR(64) app-assigned primary keys (task_id, agent_id, ...) have no
 * DB-side default — the API generates them. Readable prefix + UUID stays
 * comfortably under the 64-char column limit. */
export function generateId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
