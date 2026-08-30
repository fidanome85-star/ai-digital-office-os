# AI DIGITAL OFFICE OS v1.4 Control Plane API Closure

Base path: /v1

## Required additional endpoints

POST   /projects
GET    /projects
GET    /projects/{project_id}
PATCH  /projects/{project_id}

POST   /workflows
POST   /workflows/{workflow_id}/cancel
POST   /workflows/{workflow_id}/retry
POST   /workflows/{workflow_id}/escalate

POST   /agents/{agent_id}/versions
GET    /agents/{agent_id}/versions
POST   /agents/{agent_id}/versions/{agent_version_id}/activate

POST   /agents/{agent_id}/messages
POST   /artifacts
GET    /artifacts/{artifact_id}/lineage

GET    /providers
GET    /models
POST   /models/evaluate
GET    /models/evaluations

GET    /tools
GET    /mcp/servers

GET    /usage
GET    /costs

POST   /deployments
GET    /deployments/{deployment_id}
POST   /deployments/{deployment_id}/rollback

GET    /policy-decisions
GET    /routing-decisions

## Contract rules

1. Every endpoint requires bearer JWT authentication.
2. Every tenant-scoped request is bound to tenant_id from the authenticated identity.
3. Human callers use user scopes; service/agent callers use service scopes.
4. Every state-changing endpoint requires an idempotency key.
5. Every non-2xx response uses the common ErrorResponse.
6. Every resource has a stable version or immutable revision where mutation could affect production.
7. API schemas must be generated or diff-checked against the canonical domain model.
8. No endpoint may expose raw secrets.
9. Production deployment and agent activation must use explicit approval state.
