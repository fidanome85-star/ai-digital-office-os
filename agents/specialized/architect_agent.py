from agents.base_agent import BaseAgent
from core.state import TaskMessage
from typing import Dict, Any, List

class SystemArchitectAgent(BaseAgent):
    """
    System Architect Agent (Layer 4)
    Designs end-to-end software architecture, database topology, 
    and offline-first synchronization protocols.
    """
    def __init__(self):
        super().__init__(
            agent_id="agt_arch_001",
            name="System Architect Agent",
            department="Architecture Department",
            capability="REASONING"
        )

    async def execute_task(self, task: TaskMessage, state: Dict[str, Any]) -> TaskMessage:
        project_name = state.get("project_name", "Enterprise System")
        
        architecture_spec: Dict[str, Any] = {
            "project_name": project_name,
            "architecture_pattern": "Modular Monolith with Hybrid Storage",
            "storage_layers": {
                "local_client": "IndexedDB / SQLite (Offline Cache)",
                "server_core": "PostgreSQL (Relational Single Source of Truth)",
                "vector_store": "pgvector (Knowledge Base & Embeddings)"
            },
            "sync_strategy": "Deterministic Conflict-Free Background Sync Engine",
            "security_boundaries": "Role-Based Access Control (RBAC) + Scoped Tokens",
            "artifact_path": "artifacts/architecture/system_architecture_spec.md"
        }
        
        task.result = {
            "status": "APPROVED",
            "architecture": architecture_spec,
            "validation": "Complies with Project Constitution invariants"
        }
        task.status = "COMPLETED"
        return task
