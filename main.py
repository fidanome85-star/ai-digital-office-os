import asyncio
import sys
from core.orchestrator import OfficeOrchestrator
from core.state import OfficeState

async def run_ai_digital_office(project_name: str = None, project_goal: str = None, governance: str = "GREEN"):
    print("==================================================================")
    print("        AI DIGITAL OFFICE OS — AUTONOMOUS SOFTWARE FACTORY        ")
    print("==================================================================")
    
    # Fallback to dynamic prompt if parameters are not passed
    if not project_name:
        project_name = "AUTONOMOUS_ENTERPRISE_SYSTEM"
    if not project_goal:
        project_goal = "Build high-reliability modular software with full test coverage."
        
    print(f"\n[INIT] Target Project:    {project_name}")
    print(f"[INIT] Strategic Goal:    {project_goal}")
    print(f"[INIT] Governance Tier:   {governance}")
    
    # Initialize Core LangGraph Orchestrator
    orchestrator = OfficeOrchestrator()
    app = orchestrator.compile()
    
    # Dynamic Project State
    initial_state: OfficeState = {
        "project_id": "PRJ-AUTO-001",
        "project_name": project_name,
        "project_goal": project_goal,
        "current_phase": "INITIATED",
        "active_tasks": [],
        "completed_tasks": [],
        "artifacts": {},
        "budget_used_usd": 0.0,
        "governance_level": governance,
        "audit_logs": [],
        "errors": []
    }
    
    print("\n[>] Initiating Autonomous Departmental Pipeline...")
    final_state = await app.ainvoke(initial_state)
    
    print("\n--- COMPLETE AUDIT TRAIL (LAYERS 1-8) ---")
    for log in final_state.get("audit_logs", []):
        print(f"✔ {log}")
        
    print("\n--- EXECUTION SUMMARY ---")
    print(f"Project ID:        {final_state.get('project_id')}")
    print(f"Target System:     {final_state.get('project_name')}")
    print(f"Final State:       {final_state.get('current_phase')}")
    print(f"Completed Tasks:   {len(final_state.get('completed_tasks', []))}")
    print(f"Governance Tier:   {final_state.get('governance_level')}")
    print("==================================================================")
    print("Status: Autonomous Software Factory Pipeline Execution Complete!")
    print("==================================================================")

if __name__ == "__main__":
    # Allows passing dynamic arguments from CLI: python main.py "Project Name" "Project Goal"
    p_name = sys.argv[1] if len(sys.argv) > 1 else None
    p_goal = sys.argv[2] if len(sys.argv) > 2 else None
    asyncio.run(run_ai_digital_office(p_name, p_goal))
