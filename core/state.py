from typing import Annotated, Dict, List, Optional, Any
from typing_extensions import TypedDict
from pydantic import BaseModel, Field
import operator

class TaskMessage(BaseModel):
    task_id: str
    sender_agent: str
    receiver_agent: str
    purpose: str
    priority: str = "NORMAL"  # LOW, NORMAL, HIGH, CRITICAL
    security_level: str = "GREEN"  # GREEN, YELLOW, RED
    input_data: Dict[str, Any] = Field(default_factory=dict)
    expected_output_schema: Optional[str] = None
    dependencies: List[str] = Field(default_factory=list)
    status: str = "PENDING"  # PENDING, IN_PROGRESS, COMPLETED, FAILED
    result: Optional[Dict[str, Any]] = None
    artifact_reference: Optional[str] = None

class OfficeState(TypedDict):
    project_id: str
    project_name: str
    project_goal: str
    current_phase: str
    active_tasks: List[TaskMessage]
    completed_tasks: Annotated[List[TaskMessage], operator.add]
    artifacts: Annotated[Dict[str, str], operator.or_]
    budget_used_usd: float
    governance_level: str
    audit_logs: Annotated[List[str], operator.add]
    errors: Annotated[List[str], operator.add]

