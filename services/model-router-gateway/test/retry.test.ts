import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withRetry } from "../src/retry.js";

describe("withRetry", () => {
  it("returns the result on the first success without retrying", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return "ok";
      },
      () => true,
    );
    assert.equal(result, "ok");
    assert.equal(calls, 1);
  });

  it("retries on a retryable error and eventually succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return "ok";
      },
      () => true,
      { maxAttempts: 5, baseDelayMs: 2 },
    );
    assert.equal(result, "ok");
    assert.equal(calls, 3);
  });

  it("stops after maxAttempts and throws the last error", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++;
            throw new Error(`attempt ${calls}`);
          },
          () => true,
          { maxAttempts: 3, baseDelayMs: 2 },
        ),
      /attempt 3/,
    );
    assert.equal(calls, 3);
  });

  it("does not retry an error the predicate marks non-retryable", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++;
            throw new Error("permanent");
          },
          () => false,
          { maxAttempts: 5, baseDelayMs: 2 },
        ),
      /permanent/,
    );
    assert.equal(calls, 1);
  });
});
