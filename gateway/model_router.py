from typing import Dict, Any, List
from registry.model_registry import ModelRegistry

class ModelRouter:
    """
    Intelligent Multi-Model Router (v1.1)
    Dynamically routes agent requests to optimal models based on capability classes,
    budget limits, latency profile, and offline/local fallback policies.
    """
    def __init__(self):
        self.registry = ModelRegistry()

    def select_model(
        self,
        requested_capability: str,
        cost_limit_usd: float = 0.05,
        prefer_local: bool = False,
        owner_override_model: str = None
    ) -> Dict[str, Any]:
        
        # Check for direct human override
        if owner_override_model:
            return {
                "selected_model": owner_override_model,
                "routing_reason": "Owner explicit override",
                "fallback_chain": ModelRegistry.get_fallback_chain(owner_override_model)
            }

        # Check for local offline preference
        if prefer_local:
            local_model = ModelRegistry.get_models_for_capability("LOCAL_OFFLINE")[0]
            return {
                "selected_model": local_model,
                "routing_reason": "Local air-gapped execution requested",
                "fallback_chain": ["ollama/llama3.3", "HUMAN_ESCALATION"]
            }

        # Dynamic routing based on capability class
        available_models = ModelRegistry.get_models_for_capability(requested_capability)
        primary_choice = available_models[0]

        return {
            "selected_model": primary_choice,
            "capability_class": requested_capability,
            "routing_reason": f"Optimal backend for capability '{requested_capability}'",
            "fallback_chain": ModelRegistry.get_fallback_chain(primary_choice)
        }
