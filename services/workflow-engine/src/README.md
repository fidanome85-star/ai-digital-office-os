# Durable Workflow Engine
Reads/writes workflow_registry + workflow_history (clause 43). On process
restart, reconstruct current_state by replaying workflow_history — never
trust only the mutable workflow_registry row.
