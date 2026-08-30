export interface CompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  model: string;
  systemPrompt?: string;
  messages: CompletionMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
  /** Raw provider response, for debugging/audit — never logged wholesale (may contain user content). */
  raw: unknown;
}

export interface ProviderAdapter {
  readonly adapterType: string;
  complete(request: CompletionRequest, apiKey: string): Promise<CompletionResult>;
}
