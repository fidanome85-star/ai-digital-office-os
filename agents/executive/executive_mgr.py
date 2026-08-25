from agents.base_agent import BaseAgent
from core.state import TaskMessage
from typing import Dict, Any, List

class ExecutiveManager(BaseAgent):
    """
    Executive Manager Agent (Layer 2)
    Translates CEO vision into tactical departmental task breakdowns.
    """
    def __init__(self):
        super().__init__(
            agent_id="agt_exec_001",
            name="Executive Manager",
            department="Executive Management",
            capability="PROJECT_DECOMPOSITION"
        )

    async def execute_task(self, task: TaskMessage, state: Dict[str, Any]) -> TaskMessage:
        project_id = task.input_data.get("project_id", "PRJ-001")
        
        # Define the standard 8 departments
        departments: List[str] = [
            "Product", "Research", "Architecture", "Design",
            "Engineering", "QA", "Security", "DevOps"
        ]
        
        task.result = {
            "project_id": project_id,
            "assigned_departments": departments,
            "milestone_roadmap": "Stage 1 (Discovery) to Stage 6 (Release) mapped successfully",
            "status": "READY_FOR_EXECUTION"
        }
        task.status = "COMPLETED"
        return task
