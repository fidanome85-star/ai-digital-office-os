from typing import Dict, Any, List

class ToolGateway:
    """
    Tool Gateway (MCP Security Layer v1.1)
    Enforces Role-Based Access Control (RBAC) over tools execution.
    Agents can only execute tools explicitly permitted in their capability profile.
    """
    def __init__(self):
        self.allowed_tools: Dict[str, List[str]] = {
            "STANDARD": ["read_file", "search_docs", "format_output"],
            "ELEVATED": ["write_file", "run_tests", "query_database"],
            "ADMIN": ["git_commit", "execute_terminal", "deploy_staging"]
        }

    def validate_tool_permission(self, agent_security_level: str, tool_name: str) -> bool:
        permitted = self.allowed_tools.get(agent_security_level, [])
        return tool_name in permitted

    async def execute_tool(
        self,
        agent_id: str,
        security_level: str,
        tool_name: str,
        params: Dict[str, Any]
    ) -> Dict[str, Any]:
        if not self.validate_tool_permission(security_level, tool_name):
            return {
                "status": "DENIED",
                "error": f"Security violation: Agent '{agent_id}' is not authorized to use tool '{tool_name}'."
            }

        return {
            "status": "SUCCESS",
            "tool_name": tool_name,
            "result": f"Tool '{tool_name}' executed securely within sandbox."
        }
