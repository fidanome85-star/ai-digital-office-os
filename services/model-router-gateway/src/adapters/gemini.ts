import { ModelRouterError } from "../errors.js";
import { assertOk, fetchJson } from "../http.js";
import type { CompletionRequest, CompletionResult, ProviderAdapter } from "../types.js";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/** Google Gemini generateContent API — https://ai.google.dev/api/generate-content */
export class GeminiAdapter implements ProviderAdapter {
  readonly adapterType = "google-gemini";

  constructor(private readonly baseUrl: string = "https://generativelanguage.googleapis.com/v1beta") {}

  async complete(request: CompletionRequest, apiKey: string): Promise<CompletionResult> {
    const { status, body } = await fetchJson({
      url: `${this.baseUrl}/models/${request.model}:generateContent`,
      headers: { "x-goog-api-key": apiKey },
      body: {
        contents: request.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        ...(request.systemPrompt ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } } : {}),
        generationConfig: { maxOutputTokens: request.maxTokens, temperature: request.temperature },
      },
    });
    assertOk(status, body, "Gemini");

    const data = body as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) {
      throw new ModelRouterError("INVALID_RESPONSE", "Gemini response missing candidates[0].content.parts text.");
    }

    return {
      content: text,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      finishReason: data.candidates?.[0]?.finishReason ?? "unknown",
      raw: body,
    };
  }
}
