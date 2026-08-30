import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLogger } from "../src/logger.js";
import { runWithContext } from "../src/context.js";

function captureStdout(fn: () => void): string[] {
  const original = process.stdout.write.bind(process.stdout);
  const lines: string[] = [];
  process.stdout.write = ((chunk: string) => {
    lines.push(chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return lines;
}

function captureStderr(fn: () => void): string[] {
  const original = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  process.stderr.write = ((chunk: string) => {
    lines.push(chunk.toString());
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return lines;
}

describe("createLogger", () => {
  it("writes info/debug lines to stdout as JSON with service and message", () => {
    const logger = createLogger("test-service");
    const lines = captureStdout(() => logger.info("hello world", { foo: "bar" }));
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.level, "info");
    assert.equal(parsed.service, "test-service");
    assert.equal(parsed.message, "hello world");
    assert.equal(parsed.foo, "bar");
    assert.ok(parsed.timestamp);
  });

  it("writes warn/error lines to stderr, not stdout", () => {
    const logger = createLogger("test-service");
    const stdoutLines = captureStdout(() => {
      captureStderr(() => logger.error("boom"));
    });
    assert.equal(stdoutLines.length, 0);

    const stderrLines = captureStderr(() => logger.warn("careful"));
    assert.equal(stderrLines.length, 1);
    assert.equal(JSON.parse(stderrLines[0]!).level, "warn");
  });

  it("attaches correlationId and tenantId from the active context", () => {
    const logger = createLogger("test-service");
    const lines = runWithContext({ correlationId: "corr-1", tenantId: "tenant-1" }, () =>
      captureStdout(() => logger.info("in context")),
    );
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.correlationId, "corr-1");
    assert.equal(parsed.tenantId, "tenant-1");
  });

  it("omits correlationId/tenantId entirely when outside any context", () => {
    const logger = createLogger("test-service");
    const lines = captureStdout(() => logger.info("no context"));
    const parsed = JSON.parse(lines[0]!);
    assert.equal("correlationId" in parsed, false);
    assert.equal("tenantId" in parsed, false);
  });
});
