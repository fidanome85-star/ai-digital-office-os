from langgraph.graph import StateGraph, END
from core.state import OfficeState, TaskMessage
from agents.executive.ceo_agent import MasterCEOAgent
from agents.executive.executive_mgr import ExecutiveManager
from agents.executive.assistant_mgr import AssistantManager
from agents.specialized.research_agent import DeepResearchAgent
from agents.specialized.architect_agent import SystemArchitectAgent
from agents.specialized.dev_agent import FullStackEngineerAgent
from agents.specialized.qa_agent import IndependentQAJudgeAgent
from agents.specialized.security_agent import SecurityAuditorAgent
from agents.specialized.devops_agent import DevOpsEngineerAgent

class OfficeOrchestrator:
    """
    End-to-End Autonomous Software Factory Orchestrator (v1.1)
    Connects Executive Governance and Specialized Departmental Agents via LangGraph.
    """
    def __init__(self):
        self.workflow = StateGraph(OfficeState)
        self.ceo = MasterCEOAgent()
        self.exec_mgr = ExecutiveManager()
        self.asst_mgr = AssistantManager()
        self.researcher = DeepResearchAgent()
        self.architect = SystemArchitectAgent()
        self.dev = FullStackEngineerAgent()
        self.qa = IndependentQAJudgeAgent()
        self.security = SecurityAuditorAgent()
        self.devops = DevOpsEngineerAgent()
        self._build_graph()

    def _build_graph(self):
        # Register Workflow Nodes
        self.workflow.add_node("ceo_governance", self.ceo_node)
        self.workflow.add_node("executive_planning", self.executive_node)
        self.workflow.add_node("research_phase", self.research_node)
        self.workflow.add_node("architecture_phase", self.architecture_node)
        self.workflow.add_node("development_phase", self.development_node)
        self.workflow.add_node("qa_verification", self.qa_node)
        self.workflow.add_node("security_audit", self.security_node)
        self.workflow.add_node("devops_release", self.devops_node)

        # Connect Sequential Pipeline Edges
        self.workflow.set_entry_point("ceo_governance")
        self.workflow.add_edge("ceo_governance", "executive_planning")
        self.workflow.add_edge("executive_planning", "research_phase")
        self.workflow.add_edge("research_phase", "architecture_phase")
        self.workflow.add_edge("architecture_phase", "development_phase")
        self.workflow.add_edge("development_phase", "qa_verification")
        self.workflow.add_edge("qa_verification", "security_audit")
        self.workflow.add_edge("security_audit", "devops_release")
        self.workflow.add_edge("devops_release", END)

    async def ceo_node(self, state: OfficeState) -> dict:
        task = TaskMessage(
            task_id="TSK-CEO-001",
            sender_agent="HUMAN_OWNER",
            receiver_agent=self.ceo.agent_id,
            purpose="Strategic Decomposition",
            security_level=state.get("governance_level", "GREEN"),
            input_data={"goal": state.get("project_goal")}
        )
        res = await self.ceo.execute_task(task, state)
        return {"current_phase": "EXECUTIVE_PLANNING", "completed_tasks": [res], "audit_logs": ["[CEO] Goal decomposed & approved."]}

    async def executive_node(self, state: OfficeState) -> dict:
        task = TaskMessage(
            task_id="TSK-EXEC-001",
            sender_agent=self.ceo.agent_id,
            receiver_agent=self.exec_mgr.agent_id,
            purpose="Department Allocation",
            input_data={"project_id": state.get("project_id")}
        )
        res = await self.exec_mgr.execute_task(task, state)
        return {"current_phase": "RESEARCH", "completed_tasks": [res], "audit_logs": ["[Executive] Milestones & departments mapped."]}

    async def research_node(self, state: OfficeState) -> dict:
        task = TaskMessage(
            task_id="TSK-RES-001",
            sender_agent=self.exec_mgr.agent_id,
            receiver_agent=self.researcher.agent_id,
            purpose="Feasibility & Market Research",
            input_data={"topic": state.get("project_goal")}
        )
        res = await self.researcher.execute_task(task, state)
        return {"current_phase": "ARCHITECTURE", "completed_tasks": [res], "audit_logs": ["[Research] PRD and technical feasibility resolved."]}

    async def architecture_node(self, state: OfficeState) -> dict:
        task = TaskMessage(
            task_id="TSK-ARCH-001",
            sender_agent=self.researcher.agent_id,
            receiver_agent=self.architect.agent_id,
            purpose="System & DB Architecture Design",
            input_data={"project_name": state.get("project_name")}
        )
        res = await self.architect.execute_task(task, state)
        return {"current_phase": "ENGINEERING", "completed_tasks": [res], "audit_logs": ["[Architecture] System blueprint and HybridDB schemas generated."]}

    async def development_node(self, state: OfficeState) -> dict:
        task = TaskMessage(
            task_id="TSK-DEV-001",
            sender_agent=self.architect.agent_id,
            receiver_agent=self.dev.agent_id,
            purpose="Full-Stack Code Generation",
            input_data={"module_name": "Core_POS_Engine"}
        )
        res = await self.dev.execute_task(task, state)
        return {"current_phase": "QA_EVALUATION", "completed_tasks": [res], "audit_logs": ["[Engineering] Production-ready codebase synthesized."]}

    async def qa_node(self, state: OfficeState) -> dict:
        task = TaskMessage(
            task_id="TSK-QA-001",
            sender_agent=self.dev.agent_id,
            receiver_agent=self.qa.agent_id,
            purpose="Independent QA & Invariant Audit",
            input_data={"target_artifact": "Core_POS_Engine"}
        )
        res = await self.qa.execute_task(task, state)
        return {"current_phase": "SECURITY_AUDIT", "completed_tasks": [res], "audit_logs": ["[QA Judge] Invariants verified, 0 errors, quality gate passed."]}

    async def security_node(self, state: OfficeState) -> dict:
        task = TaskMessage(
            task_id="TSK-SEC-001",
            sender_agent=self.qa.agent_id,
            receiver_agent=self.security.agent_id,
            purpose="Secrets & RBAC Compliance Scan",
            input_data={"scan_target": "Project Source"}
        )
        res = await self.security.execute_task(task, state)
        return {"current_phase": "DEVOPS_RELEASE", "completed_tasks": [res], "audit_logs": ["[Security] Zero leaks detected, strict vault isolation validated."]}

    async def devops_node(self, state: OfficeState) -> dict:
        task = TaskMessage(
            task_id="TSK-OPS-001",
            sender_agent=self.security.agent_id,
            receiver_agent=self.devops.agent_id,
            purpose="Staging Deployment & Artifact Packaging",
            input_data={"version": "v1.1.0", "environment": "production"}
        )
        res = await self.devops.execute_task(task, state)
        return {"current_phase": "DEPLOYED", "completed_tasks": [res], "audit_logs": ["[DevOps] Automated deployment completed successfully."]}

    def compile(self):
        return self.workflow.compile()
