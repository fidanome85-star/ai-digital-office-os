from agents.base_agent import BaseAgent
from core.state import TaskMessage
from typing import Dict, Any, List

class AssistantManager(BaseAgent):
    """
    Assistant Manager Agent (Layer 2)
    Coordinates real-time task dependencies, tracks pending items,
    and routes inputs/outputs between specialized agents.
    """
    def __init__(self):
        super().__init__(
            agent_id="agt_asst_001",
            name="Assistant Manager",
            department="Executive Management",
            capability="OPERATIONAL_COORDINATION"
        )

    async def execute_task(self, task: TaskMessage, state: Dict[str, Any]) -> TaskMessage:
        active_tasks = state.get("active_tasks", [])
        completed_tasks = state.get("completed_tasks", [])
        
        # Verify upstream dependencies before dispatching
        unresolved_dependencies: List[str] = [
            dep for dep in task.dependencies 
            if dep not in [t.task_id for t in completed_tasks]
        ]
        
        if unresolved_dependencies:
            task.status = "BLOCKED"
            task.result = {
                "error": "Unresolved upstream dependencies detected",
                "blocked_by": unresolved_dependencies
            }
            return task

        task.status = "READY_FOR_AGENT"
        task.result = {
            "dispatch_status": "APPROVED",
            "assigned_receiver": task.receiver_agent,
            "validation": "Prerequisites satisfied"
        }
        return task
