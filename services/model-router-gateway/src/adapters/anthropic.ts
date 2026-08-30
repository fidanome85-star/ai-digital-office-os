import { ModelRouterError } from "../errors.js";
import { assertOk, fetchJson } from "../http.js";
import type { CompletionRequest, CompletionResult, ProviderAdapter } from "../types.js";

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Anthropic Messages API — https://docs.anthropic.com/en/api/messages */
export class AnthropicAdapter implements ProviderAdapter {
  readonly adapterType = "anthropic-messages";

  constructor(private readonly baseUrl: string = "https://api.anthropic.com/v1") {}

  async complete(request: CompletionRequest, apiKey: string): Promise<CompletionResult> {
    const { status, body } = await fetchJson({
      url: `${this.baseUrl}/messages`,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: {
        model: request.model,
        system: request.systemPrompt,
        messages: request.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature,
      },
    });
    assertOk(status, body, "Anthropic");

    const data = body as AnthropicResponse;
    const textBlock = data.content?.find((block) => block.type === "text");
    if (!textBlock?.text) {
      throw new ModelRouterError("INVALID_RESPONSE", "Anthropic response missing a text content block.");
    }

    return {
      content: textBlock.text,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      finishReason: data.stop_reason ?? "unknown",
      raw: body,
    };
  }
}
