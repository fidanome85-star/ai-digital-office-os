import { MemoryServiceError } from "./errors.js";

export interface EmbeddingProvider {
  embed(text: string, apiKey: string): Promise<number[]>;
}

interface OpenAiEmbeddingResponse {
  data?: { embedding?: number[] }[];
}

/**
 * OpenAI Embeddings API — https://platform.openai.com/docs/api-reference/embeddings
 * Real request/response shape, same mock-server-tested-not-live pattern as
 * every model-router-gateway adapter (ADR 0004): no live key configured in
 * this environment, but nothing about the code changes when one is added.
 * A hash-based "local" stand-in is deliberately NOT provided here — unlike
 * a chat completion, a fake embedding would produce similarity scores that
 * look real but mean nothing, which is worse than being explicit that
 * semantic search needs a real embedding provider (see docs/decisions/0006).
 */
export class OpenAiEmbeddingAdapter implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string = "https://api.openai.com/v1",
    private readonly model: string = "text-embedding-3-small",
  ) {}

  async embed(text: string, apiKey: string): Promise<number[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: this.model, input: text }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new MemoryServiceError("TIMEOUT", `Embedding request to ${this.baseUrl} timed out.`, true);
      }
      throw new MemoryServiceError(
        "PROVIDER_UNREACHABLE",
        `Failed to reach ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }

    const text_ = await res.text();
    let body: OpenAiEmbeddingResponse;
    try {
      body = JSON.parse(text_);
    } catch {
      throw new MemoryServiceError("INVALID_RESPONSE", `Non-JSON response (status ${res.status}): ${text_.slice(0, 200)}`);
    }

    if (res.status === 429) throw new MemoryServiceError("RATE_LIMITED", "OpenAI embeddings API rate-limited the request.", true);
    if (res.status >= 500) throw new MemoryServiceError("PROVIDER_ERROR", `OpenAI embeddings API returned ${res.status}.`, true);
    if (res.status >= 400) {
      throw new MemoryServiceError("PROVIDER_ERROR", `OpenAI embeddings API returned ${res.status}: ${text_.slice(0, 300)}`);
    }

    const embedding = body.data?.[0]?.embedding;
    if (!embedding) {
      throw new MemoryServiceError("INVALID_RESPONSE", "Embeddings response missing data[0].embedding.");
    }
    return embedding;
  }
}
