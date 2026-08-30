import { ModelRouterError } from "../errors.js";
import type { ProviderAdapter } from "../types.js";
import { AnthropicAdapter } from "./anthropic.js";
import { GeminiAdapter } from "./gemini.js";
import { LocalEchoAdapter } from "./local.js";
import { OpenAiAdapter } from "./openai.js";

export { AnthropicAdapter, GeminiAdapter, LocalEchoAdapter, OpenAiAdapter };

/** Maps provider_registry.adapter_type to a concrete adapter — the whole
 * point of that column existing. `baseUrlOverride` exists purely for
 * tests to point an adapter at a local mock server instead of the real
 * vendor endpoint. */
export function createAdapter(adapterType: string, baseUrlOverride?: string): ProviderAdapter {
  switch (adapterType) {
    case "openai-chat":
      return new OpenAiAdapter(baseUrlOverride);
    case "anthropic-messages":
      return new AnthropicAdapter(baseUrlOverride);
    case "google-gemini":
      return new GeminiAdapter(baseUrlOverride);
    case "local-echo":
      return new LocalEchoAdapter();
    default:
      throw new ModelRouterError("UNSUPPORTED_ADAPTER_TYPE", `No adapter registered for adapter_type "${adapterType}".`);
  }
}
