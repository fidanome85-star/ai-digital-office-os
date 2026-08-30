import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLogger } from "../src/logger.js";
import { withSpan } from "../src/tracing.js";

function captureStdout(fn: () => Promise<void>): Promise<string[]> {
  const original = process.stdout.write.bind(process.stdout);
  const lines: string[] = [];
  process.stdout.write = ((chunk: string) => {
    lines.push(chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  return fn().finally(() => {
    process.stdout.write = original;
  }).then(() => lines);
}

describe("withSpan", () => {
  it("returns the wrapped function's result and logs start/completion", async () => {
    const logger = createLogger("test-service");
    let result: number | undefined;
    const lines = await captureStdout(async () => {
      result = await withSpan(logger, "do-thing", async () => 42);
    });
    assert.equal(result, 42);
    const levels = lines.map((l) => JSON.parse(l).level);
    assert.deepEqual(levels, ["debug", "info"]);
    const completion = JSON.parse(lines[1]!);
    assert.equal(completion.message, "do-thing completed");
    assert.equal(typeof completion.durationMs, "number");
  });

  it("re-throws the original error and still logs it", async () => {
    const logger = createLogger("test-service");
    await assert.rejects(
      () =>
        withSpan(logger, "failing-thing", async () => {
          throw new Error("kaboom");
        }),
      /kaboom/,
    );
  });
});
