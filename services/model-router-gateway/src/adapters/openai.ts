import { ModelRouterError } from "../errors.js";
import { assertOk, fetchJson } from "../http.js";
import type { CompletionRequest, CompletionResult, ProviderAdapter } from "../types.js";

interface OpenAiResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** OpenAI Chat Completions API — https://platform.openai.com/docs/api-reference/chat */
export class OpenAiAdapter implements ProviderAdapter {
  readonly adapterType = "openai-chat";

  constructor(private readonly baseUrl: string = "https://api.openai.com/v1") {}

  async complete(request: CompletionRequest, apiKey: string): Promise<CompletionResult> {
    const messages = [
      ...(request.systemPrompt ? [{ role: "system" as const, content: request.systemPrompt }] : []),
      ...request.messages,
    ];

    const { status, body } = await fetchJson({
      url: `${this.baseUrl}/chat/completions`,
      headers: { authorization: `Bearer ${apiKey}` },
      body: {
        model: request.model,
        messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      },
    });
    assertOk(status, body, "OpenAI");

    const data = body as OpenAiResponse;
    const choice = data.choices?.[0];
    if (!choice?.message?.content) {
      throw new ModelRouterError("INVALID_RESPONSE", "OpenAI response missing choices[0].message.content.");
    }

    return {
      content: choice.message.content,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      finishReason: choice.finish_reason ?? "unknown",
      raw: body,
    };
  }
}
