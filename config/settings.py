import os
from pydantic import BaseModel

class OfficeSettings(BaseModel):
    app_name: str = "AI DIGITAL OFFICE OS"
    version: str = "1.1.0"
    environment: str = os.getenv("ENV", "development")
    default_governance: str = "GREEN"
    max_budget_per_project_usd: float = 50.0
    auto_cost_throttling: bool = True
