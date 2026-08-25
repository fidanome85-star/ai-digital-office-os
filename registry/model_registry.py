from typing import Dict, Any, List

class ModelRegistry:
    """
    Model Registry & Capability Mapping v1.1
    Maintains dynamic mapping of model capability classes to active backends.
    """
    CAPABILITY_CLASSES: Dict[str, List[str]] = {
        "HEAVY_CODING": ["claude-3-7-sonnet", "gpt-4.5", "deepseek-coder"],
        "DEEP_RESEARCH": ["perplexity-pro", "gpt-4.5-search", "kimi-moonshot"],
        "REASONING": ["o1", "o3-mini", "claude-3-7-thinking", "deepseek-r1"],
        "VISION_UI": ["gemini-2.5-pro", "gemini-2.5-flash", "gpt-4o"],
        "FAST_ROUTINE": ["gpt-4o-mini", "claude-3-5-haiku", "gemini-2.5-flash"],
        "LOCAL_OFFLINE": ["ollama/llama3.3", "ollama/qwen2.5", "ollama/mistral"]
    }

    @classmethod
    def get_models_for_capability(cls, capability: str) -> List[str]:
        return cls.CAPABILITY_CLASSES.get(capability, ["ollama/llama3.3"])

    @classmethod
    def get_fallback_chain(cls, primary_model: str) -> List[str]:
        return [primary_model, "gpt-4o-mini", "ollama/llama3.3", "HUMAN_ESCALATION"]
