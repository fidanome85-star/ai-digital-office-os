import type { CompletionRequest, CompletionResult, ProviderAdapter } from "../types.js";

/**
 * The "local models" branch the blueprint names alongside the hosted
 * providers — entirely offline, deterministic, no API key. This is the
 * only adapter this phase's default configuration actually calls live;
 * the hosted adapters are real, tested-against-a-mock-server code, ready
 * for real credentials whenever they're supplied (see ADR 0004).
 */
export class LocalEchoAdapter implements ProviderAdapter {
  readonly adapterType = "local-echo";

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const lastUserMessage = [...request.messages].reverse().find((m) => m.role === "user");
    const content = `[local-echo:${request.model}] ${lastUserMessage?.content ?? ""}`;
    return {
      content,
      inputTokens: request.messages.reduce((sum, m) => sum + m.content.length, 0),
      outputTokens: content.length,
      finishReason: "stop",
      raw: { echoed: true },
    };
  }
}
