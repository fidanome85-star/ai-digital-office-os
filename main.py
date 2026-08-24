import asyncio
from core.orchestrator import OfficeOrchestrator
from core.state import OfficeState

async def run_ai_digital_office():
    print("==================================================")
    print("      AI DIGITAL OFFICE OS — TEST RUN (v1.1)     ")
    print("==================================================")
    
    # آرکیسٹریٹر کا آغاز
    orchestrator = OfficeOrchestrator()
    app = orchestrator.compile()
    
    # ابتدائی اسٹیٹ / صارف کا ہدف
    initial_state: OfficeState = {
        "project_id": "PRJ-POS-001",
        "project_name": "AL FATAH SMART POS SYSTEM",
        "project_goal": "Build an enterprise offline-first POS with HybridDB & Tile Advisor",
        "current_phase": "INITIATED",
        "active_tasks": [],
        "completed_tasks": [],
        "artifacts": {},
        "budget_used_usd": 0.0,
        "governance_level": "GREEN",
        "audit_logs": [],
        "errors": []
    }
    
    # ورک فلو ایگزیکیوشن
    print("\n[>] Starting Master CEO & Executive Orchestration...")
    final_state = await app.ainvoke(initial_state)
    
    print("\n--- EXECUTION AUDIT LOGS ---")
    for log in final_state.get("audit_logs", []):
        print(f"✔ {log}")
        
    print(f"\nCurrent Phase: {final_state.get('current_phase')}")
    print(f"Governance Status: {final_state.get('governance_level')}")
    print("\nOffice Control Plane is ONLINE and ready for Phase 2!")
    print("==================================================")

if __name__ == "__main__":
    asyncio.run(run_ai_digital_office())
