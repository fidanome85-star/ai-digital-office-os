from abc import ABC, abstractmethod
from typing import Dict, Any
from core.state import TaskMessage

class BaseAgent(ABC):
    def __init__(self, agent_id: str, name: str, department: str, capability: str):
        self.agent_id = agent_id
        self.name = name
        self.department = department
        self.capability = capability

    @abstractmethod
    async def execute_task(self, task: TaskMessage, state: Dict[str, Any]) -> TaskMessage:
        """
        Subclasses must implement task execution logic.
        """
        pass

