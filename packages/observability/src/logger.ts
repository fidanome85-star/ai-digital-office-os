import { getContext } from "./context.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * One JSON line per call to stdout (debug/info) or stderr (warn/error) —
 * no network call, no external telemetry backend, nothing that can fail if
 * offline. A real deployment ships these lines to a log aggregator at the
 * infrastructure layer (out of scope here, same as blueprint clause 74),
 * not by this package reaching out over the network itself.
 */
function write(level: LogLevel, service: string, message: string, fields?: Record<string, unknown>): void {
  const context = getContext();
  const line = {
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
    ...(context?.tenantId ? { tenantId: context.tenantId } : {}),
    ...fields,
  };
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(line)}\n`);
}

export function createLogger(service: string): Logger {
  return {
    debug: (message, fields) => write("debug", service, message, fields),
    info: (message, fields) => write("info", service, message, fields),
    warn: (message, fields) => write("warn", service, message, fields),
    error: (message, fields) => write("error", service, message, fields),
  };
}
