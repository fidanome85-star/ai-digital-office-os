-- =====================================================================
-- AI DIGITAL OFFICE OS v1.3 — Full Logical Schema
-- Closes all gaps identified in the v1.2 review: multi-tenancy, RBAC,
-- workflow durability, agent messaging, tiered memory, artifact lineage,
-- secrets references, feature flags. Every business table carries
-- tenant_id; every junction table carries tenant_id in its composite
-- foreign keys so referential integrity alone cannot create a
-- cross-tenant privilege escalation.
-- Target: PostgreSQL 15+ with the pgvector extension.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================================
