from typing import Dict, Any, List
from core.state import TaskMessage

class AgentFactory:
    """
    Agent Factory Subsystem v1.1
    Creates, specializes, sandboxes, and registers AI Agents.
    """
    def __init__(self):
        self.registered_agents: Dict[str, Dict[str, Any]] = {}

    def create_specialist_agent(
        self,
        agent_id: str,
        name: str,
        department: str,
        capability: str,
        allowed_tools: List[str],
        security_level: str = "GREEN"
    ) -> Dict[str, Any]:
        
        agent_spec = {
            "agent_id": agent_id,
            "agent_name": name,
            "department": department,
            "capability": capability,
            "allowed_tools": allowed_tools,
            "security_level": security_level,
            "lifecycle_state": "ACTIVE",
            "evaluation_score": 95.0,
            "sandbox_policy": "STRICT"
        }
        
        self.registered_agents[agent_id] = agent_spec
        return agent_spec

    def clone_and_specialize(self, parent_agent_id: str, new_agent_id: str, specialized_domain: str) -> Dict[str, Any]:
        parent = self.registered_agents.get(parent_agent_id)
        if not parent:
            raise ValueError(f"Parent agent {parent_agent_id} not found.")
            
        specialized_agent = parent.copy()
        specialized_agent["agent_id"] = new_agent_id
        specialized_agent["agent_name"] = f"{parent['agent_name']} ({specialized_domain} Specialist)"
        specialized_agent["parent_agent_id"] = parent_agent_id
        specialized_agent["lifecycle_state"] = "SANDBOX"
        
        self.registered_agents[new_agent_id] = specialized_agent
        return specialized_agent
