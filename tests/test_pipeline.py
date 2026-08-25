import asyncio
import unittest
from core.orchestrator import OfficeOrchestrator
from core.state import OfficeState
from gateway.adapters.math_engine import DeterministicMathEngine
from gateway.adapters.file_sandbox import FileSandboxAdapter
from core.artifact_manager import ArtifactManager

class TestAIDigitalOfficePipeline(unittest.TestCase):
    """
    Automated Test Suite for AI Digital Office OS Pipeline
    Validates mathematical invariants, directory sandboxing, and full agentic graph flow.
    """

    def test_deterministic_math_engine(self):
        result = DeterministicMathEngine.calculate_line_item(
            unit_price=100.0,
            quantity=5.0,
            tax_rate_percent=18.0,
            discount_percent=10.0
        )
        self.assertEqual(result["gross_amount"], 500.0)
        self.assertEqual(result["discount_amount"], 50.0)
        self.assertEqual(result["tax_amount"], 81.0)
        self.assertEqual(result["net_total"], 531.0)

    def test_file_sandbox_security(self):
        sandbox = FileSandboxAdapter(sandbox_root="artifacts/test_sandbox")
        write_res = sandbox.write_file("specs/test_spec.txt", "Invariant Test Spec")
        self.assertEqual(write_res["status"], "SUCCESS")

        # Test directory traversal prevention
        denied_res = sandbox.write_file("../../etc/passwd", "malicious_payload")
        self.assertEqual(denied_res["status"], "DENIED")

    def test_artifact_manager_hashing(self):
        manager = ArtifactManager()
        stored = manager.store_artifact(
            artifact_id="ART-001",
            name="schema.sql",
            category="database",
            content="CREATE TABLE test_table (id INT);",
            created_by_agent="agt_arch_001"
        )
        self.assertEqual(stored["status"], "STORED")
        self.assertIn("checksum_sha256", stored["metadata"])

    def test_full_pipeline_execution(self):
        async def run_flow():
            orchestrator = OfficeOrchestrator()
            app = orchestrator.compile()
            test_state: OfficeState = {
                "project_id": "TEST-001",
                "project_name": "TEST_AUTOMATION_PROJECT",
                "project_goal": "Validate entire agent pipeline execution",
                "current_phase": "INITIATED",
                "active_tasks": [],
                "completed_tasks": [],
                "artifacts": {},
                "budget_used_usd": 0.0,
                "governance_level": "GREEN",
                "audit_logs": [],
                "errors": []
            }
            return await app.ainvoke(test_state)

        final_state = asyncio.run(run_flow())
        self.assertEqual(final_state["current_phase"], "DEPLOYED")
        self.assertEqual(len(final_state["completed_tasks"]), 8)

if __name__ == "__main__":
    unittest.main()
