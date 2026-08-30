/**
 * GENERATED FILE — do not edit by hand.
 * Source of truth: packages/db/migrations/*.sql
 * Regenerate with: pnpm domain-model:generate
 */

export interface A2aCapabilityCards {
  cardId: string; // primary key
  tenantId: string;
  agentId: string;
  cardPayload: unknown;
  enabled: boolean;
  publishedAt: string | null;
  createdAt: string | null;
}

export interface AgentMessages {
  messageId: string; // primary key
  tenantId: string;
  taskId: string | null;
  workflowId: string | null;
  senderAgentId: string;
  receiverAgentId: string;
  messageType: string;
  purpose: string | null;
  priority: string | null;
  securityLevel: string | null;
  inputPayload: unknown | null;
  expectedOutputSchema: unknown | null;
  dependencies: unknown | null;
  deadline: string | null;
  artifactReference: string | null;
  status: string | null;
  result: unknown | null;
  error: unknown | null;
  createdAt: string | null;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  idempotencyKey: string | null;
}

export interface AgentRegistry {
  agentId: string; // primary key
  tenantId: string | null;
  agentName: string;
  department: string;
  role: string;
  purpose: string | null;
  capabilities: unknown;
  allowedTools: unknown;
  permissions: unknown;
  dataAccess: unknown;
  preferredCapabilities: unknown;
  preferredProvider: string | null;
  preferredModel: string | null;
  fallbackModels: unknown;
  inputSchema: unknown | null;
  outputSchema: unknown | null;
  securityLevel: string | null;
  lifecycleState: string | null;
  status: string | null;
  version: string | null;
  parentAgentId: string | null;
  evaluationScore: number | null;
  successRate: number | null;
  averageLatencyMs: number | null;
  averageCost: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  activeAgentVersionId: string | null;
}

export interface AgentRuns {
  agentRunId: string; // primary key
  tenantId: string;
  taskId: string | null;
  agentId: string | null;
  agentVersionId: string | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  inputHash: string | null;
  outputHash: string | null;
  error: unknown | null;
}

export interface AgentToolBindings {
  tenantId: string; // primary key
  agentId: string; // primary key
  toolId: string; // primary key
  allowedActions: unknown;
}

export interface AgentVersions {
  agentVersionId: string; // primary key
  tenantId: string;
  agentId: string;
  version: string;
  specificationHash: string;
  promptVersion: string | null;
  modelPolicy: unknown | null;
  permissionsSnapshot: unknown | null;
  evaluationScore: number | null;
  lifecycleState: string;
  createdAt: string | null;
}

export interface ApiIdempotencyKeys {
  tenantId: string; // primary key
  idempotencyKey: string; // primary key
  method: string;
  path: string;
  responseStatus: number;
  responseBody: unknown;
  createdAt: string;
}

export interface ApprovalRequests {
  requestId: string; // primary key
  tenantId: string;
  taskId: string | null;
  requester: string | null;
  agentId: string | null;
  action: string;
  riskLevel: string;
  reason: string | null;
  approver: string | null;
  decision: string | null;
  expiresAt: string | null;
  executionResult: unknown | null;
  createdAt: string | null;
  decidedAt: string | null;
}

export interface ArtifactRegistry {
  artifactId: string; // primary key
  tenantId: string;
  projectId: string | null;
  taskId: string | null;
  agentRunId: string | null;
  modelRunId: string | null;
  artifactType: string;
  storageUri: string;
  contentHash: string;
  version: string;
  status: string | null;
  parentArtifactId: string | null;
  reviewedBy: string | null;
  approvedBy: string | null;
  gitCommitRef: string | null;
  deploymentRef: string | null;
  createdAt: string | null;
}

export interface AuditEvents {
  eventId: string; // primary key
  tenantId: string | null;
  correlationId: string | null;
  eventType: string;
  actorType: string | null;
  actorId: string | null;
  projectId: string | null;
  taskId: string | null;
  workflowId: string | null;
  payload: unknown | null;
  createdAt: string | null;
}

export interface ConfigurationVersions {
  configId: string; // primary key
  tenantId: string | null;
  environment: string;
  version: string;
  payload: unknown;
  validated: boolean;
  rollbackOf: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

export interface DecisionRecords {
  decisionId: string; // primary key
  tenantId: string;
  projectId: string | null;
  decision: string;
  reason: string | null;
  alternatives: unknown | null;
  evidence: unknown | null;
  agentId: string | null;
  modelId: string | null;
  author: string | null;
  approval: unknown | null;
  impact: string | null;
  status: string | null;
  createdAt: string | null;
}

export interface DeploymentRegistry {
  deploymentId: string; // primary key
  tenantId: string;
  projectId: string | null;
  releaseId: string | null;
  environment: string;
  strategy: string;
  status: string;
  artifactRefs: unknown | null;
  approvalRequestId: string | null;
  rollbackTarget: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface FeatureFlags {
  flagId: string; // primary key
  tenantId: string | null;
  flagKey: string;
  flagType: string;
  defaultValue: unknown;
  tenantOverrideValue: unknown | null;
  environment: string;
  status: string | null;
  createdBy: string | null;
  updatedAt: string | null;
}

export interface McpServerRegistry {
  mcpServerId: string; // primary key
  tenantId: string | null;
  serverName: string;
  endpoint: string;
  version: string | null;
  trustLevel: string;
  enabled: boolean;
  createdAt: string | null;
}

export interface MemoryEmbeddings {
  embeddingId: string; // primary key
  tenantId: string;
  memoryFactId: string | null;
  content: string;
  embedding: number[];
  embeddingModel: string;
  createdAt: string | null;
}

export interface MemoryFacts {
  memoryId: string; // primary key
  tenantId: string;
  scope: string;
  subjectType: string;
  subjectId: string;
  fact: string;
  sourceReference: string | null;
  confidence: number | null;
  createdAt: string | null;
  expiresAt: string | null;
}

export interface ModelEvaluationMetrics {
  metricId: string; // primary key
  evaluationId: string;
  metricName: string;
  metricValue: number;
  unit: string | null;
}

export interface ModelEvaluationRuns {
  evaluationId: string; // primary key
  providerId: string | null;
  modelId: string | null;
  modelVersion: string | null;
  benchmarkSuite: string;
  evaluatorVersion: string | null;
  score: number | null;
  results: unknown | null;
  executedAt: string | null;
}

export interface ModelRegistry {
  modelId: string; // primary key
  providerId: string;
  modelName: string;
  modelVersion: string | null;
  capabilities: unknown;
  contextWindow: number | null;
  inputTypes: unknown | null;
  outputTypes: unknown | null;
  toolCalling: boolean | null;
  structuredOutput: boolean | null;
  vision: boolean | null;
  coding: boolean | null;
  reasoning: boolean | null;
  research: boolean | null;
  latencyProfile: unknown | null;
  costProfile: unknown | null;
  privacyClassification: string | null;
  localCloud: string | null;
  availability: string | null;
  healthStatus: string | null;
  evaluationScore: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ModelRuns {
  modelRunId: string; // primary key
  tenantId: string;
  agentRunId: string | null;
  providerId: string | null;
  modelId: string | null;
  routingReason: string | null;
  inputTokens: string | null;
  outputTokens: string | null;
  estimatedCost: number | null;
  currency: string | null;
  startedAt: string | null;
  completedAt: string | null;
  status: string | null;
}

export interface Organizations {
  tenantId: string; // primary key
  orgName: string;
  orgSlug: string;
  status: string;
  planTier: string | null;
  dataResidency: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Permissions {
  permissionId: string; // primary key
  resource: string;
  action: string;
  description: string | null;
  createdAt: string | null;
}

export interface PolicyDecisionRecords {
  policyDecisionId: string; // primary key
  tenantId: string;
  taskId: string | null;
  agentId: string | null;
  toolId: string | null;
  modelId: string | null;
  providerId: string | null;
  decision: string;
  policyVersion: string;
  alternatives: unknown | null;
  rejectionReasons: unknown | null;
  createdAt: string | null;
}

export interface PolicyRegistry {
  policyId: string; // primary key
  tenantId: string | null;
  policyName: string;
  policyVersion: string;
  rules: unknown;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProjectRegistry {
  projectId: string; // primary key
  tenantId: string;
  projectName: string;
  projectType: string;
  constitutionVersion: string | null;
  lifecycleState: string;
  riskLevel: string;
  ownerUserId: string | null;
  repositoryRef: string | null;
  environmentPolicy: unknown | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PromptRegistry {
  promptId: string; // primary key
  tenantId: string | null;
  agentId: string;
  version: string;
  systemInstruction: string;
  variables: unknown | null;
  inputContract: unknown | null;
  outputContract: unknown | null;
  evaluationScore: number | null;
  securityClassification: string | null;
  changelog: string | null;
  rollbackVersion: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProviderRegistry {
  providerId: string; // primary key
  providerName: string;
  providerType: string;
  adapterType: string;
  protocol: string | null;
  baseEndpoint: string | null;
  authenticationMethod: string | null;
  supportedCapabilities: unknown;
  supportedModels: unknown;
  rateLimits: unknown | null;
  quotaRules: unknown | null;
  pricingRules: unknown | null;
  privacyClassification: string | null;
  dataResidency: unknown | null;
  availability: string | null;
  healthStatus: string | null;
  version: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ReleaseRegistry {
  releaseId: string; // primary key
  tenantId: string;
  projectId: string | null;
  version: string;
  artifactRefs: unknown;
  status: string;
  approvedBy: string | null;
  createdAt: string | null;
}

export interface RolePermissions {
  tenantId: string | null;
  roleId: string; // primary key
  permissionId: string; // primary key
  grantedAt: string | null;
}

export interface Roles {
  roleId: string; // primary key
  tenantId: string | null;
  roleName: string;
  isDefault: boolean;
  description: string | null;
  createdAt: string | null;
}

export interface RoutingDecisionRecords {
  routingDecisionId: string; // primary key
  tenantId: string;
  taskId: string | null;
  agentId: string | null;
  selectedProvider: string | null;
  selectedModel: string | null;
  candidateModels: unknown | null;
  reason: string | null;
  policyResult: string | null;
  createdAt: string | null;
}

export interface SecretsVaultReferences {
  referenceId: string; // primary key
  tenantId: string;
  secretName: string;
  vaultPath: string;
  scopeAgentId: string | null;
  scopeProviderId: string | null;
  scopeTool: string | null;
  rotationPolicy: string | null;
  lastRotatedAt: string | null;
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

export interface TaskRegistry {
  taskId: string; // primary key
  tenantId: string;
  projectId: string | null;
  workflowId: string | null;
  parentTaskId: string | null;
  assignedAgent: string | null;
  requiredCapability: string | null;
  priority: string | null;
  riskLevel: string | null;
  securityLevel: string | null;
  dependencies: unknown | null;
  input: unknown | null;
  expectedOutput: unknown | null;
  status: string | null;
  retryCount: number | null;
  idempotencyKey: string;
  deadline: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ToolRegistry {
  toolId: string; // primary key
  mcpServerId: string | null;
  toolName: string;
  version: string | null;
  inputSchema: unknown | null;
  outputSchema: unknown | null;
  riskLevel: string;
  enabled: boolean;
  createdAt: string | null;
}

export interface UsageEvents {
  usageEventId: string; // primary key
  tenantId: string;
  projectId: string | null;
  taskId: string | null;
  agentId: string | null;
  agentRunId: string | null;
  modelRunId: string | null;
  providerId: string | null;
  modelId: string | null;
  inputTokens: string | null;
  outputTokens: string | null;
  requestCount: number | null;
  actualCost: number | null;
  currency: string | null;
  billingStatus: string | null;
  eventTime: string | null;
}

export interface UserOrganizationMembership {
  membershipId: string; // primary key
  tenantId: string;
  userId: string;
  status: string;
  invitedBy: string | null;
  joinedAt: string | null;
}

export interface UserRoles {
  tenantId: string; // primary key
  userId: string; // primary key
  roleId: string; // primary key
  assignedBy: string | null;
  assignedAt: string | null;
}

export interface Users {
  userId: string; // primary key
  email: string;
  displayName: string | null;
  authProvider: string;
  status: string;
  mfaEnabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WorkflowHistory {
  eventId: string; // primary key
  tenantId: string;
  workflowId: string;
  sequenceNo: string;
  eventType: string;
  payload: unknown | null;
  createdAt: string | null;
}

export interface WorkflowRegistry {
  workflowId: string; // primary key
  tenantId: string;
  projectId: string | null;
  workflowType: string;
  definitionVersion: string;
  currentState: unknown | null;
  status: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

export interface WorkingMemoryCache {
  cacheKey: string; // primary key
  tenantId: string;
  taskId: string | null;
  payload: unknown;
  expiresAt: string;
  createdAt: string | null;
}

/** Every table name currently in the public schema. */
export type TableName = "a2a_capability_cards" | "agent_messages" | "agent_registry" | "agent_runs" | "agent_tool_bindings" | "agent_versions" | "api_idempotency_keys" | "approval_requests" | "artifact_registry" | "audit_events" | "configuration_versions" | "decision_records" | "deployment_registry" | "feature_flags" | "mcp_server_registry" | "memory_embeddings" | "memory_facts" | "model_evaluation_metrics" | "model_evaluation_runs" | "model_registry" | "model_runs" | "organizations" | "permissions" | "policy_decision_records" | "policy_registry" | "project_registry" | "prompt_registry" | "provider_registry" | "release_registry" | "role_permissions" | "roles" | "routing_decision_records" | "secrets_vault_references" | "task_registry" | "tool_registry" | "usage_events" | "user_organization_membership" | "user_roles" | "users" | "workflow_history" | "workflow_registry" | "working_memory_cache";

/** Maps a table name to its generated row type — for generic repository code. */
export interface TableRowByName {
  "a2a_capability_cards": A2aCapabilityCards;
  "agent_messages": AgentMessages;
  "agent_registry": AgentRegistry;
  "agent_runs": AgentRuns;
  "agent_tool_bindings": AgentToolBindings;
  "agent_versions": AgentVersions;
  "api_idempotency_keys": ApiIdempotencyKeys;
  "approval_requests": ApprovalRequests;
  "artifact_registry": ArtifactRegistry;
  "audit_events": AuditEvents;
  "configuration_versions": ConfigurationVersions;
  "decision_records": DecisionRecords;
  "deployment_registry": DeploymentRegistry;
  "feature_flags": FeatureFlags;
  "mcp_server_registry": McpServerRegistry;
  "memory_embeddings": MemoryEmbeddings;
  "memory_facts": MemoryFacts;
  "model_evaluation_metrics": ModelEvaluationMetrics;
  "model_evaluation_runs": ModelEvaluationRuns;
  "model_registry": ModelRegistry;
  "model_runs": ModelRuns;
  "organizations": Organizations;
  "permissions": Permissions;
  "policy_decision_records": PolicyDecisionRecords;
  "policy_registry": PolicyRegistry;
  "project_registry": ProjectRegistry;
  "prompt_registry": PromptRegistry;
  "provider_registry": ProviderRegistry;
  "release_registry": ReleaseRegistry;
  "role_permissions": RolePermissions;
  "roles": Roles;
  "routing_decision_records": RoutingDecisionRecords;
  "secrets_vault_references": SecretsVaultReferences;
  "task_registry": TaskRegistry;
  "tool_registry": ToolRegistry;
  "usage_events": UsageEvents;
  "user_organization_membership": UserOrganizationMembership;
  "user_roles": UserRoles;
  "users": Users;
  "workflow_history": WorkflowHistory;
  "workflow_registry": WorkflowRegistry;
  "working_memory_cache": WorkingMemoryCache;
}
