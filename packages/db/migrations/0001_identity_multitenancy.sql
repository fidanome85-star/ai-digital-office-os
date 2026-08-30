-- 1. IDENTITY & MULTI-TENANCY  (Blueprint clause 41)
-- =====================================================================

CREATE TABLE organizations (
  tenant_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_name VARCHAR(160) NOT NULL,
  org_slug VARCHAR(80) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',       -- ACTIVE | SUSPENDED | ARCHIVED
  plan_tier VARCHAR(32) DEFAULT 'STANDARD',
  data_residency VARCHAR(32),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(256) NOT NULL UNIQUE,
  display_name VARCHAR(160),
  auth_provider VARCHAR(64) NOT NULL DEFAULT 'PASSWORD', -- PASSWORD | SSO_OIDC | SSO_SAML
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- A user may belong to more than one tenant; each membership row is the
-- tenant-scoping anchor for every role assignment below.
CREATE TABLE user_organization_membership (
  membership_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  user_id UUID NOT NULL REFERENCES users(user_id),
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',        -- ACTIVE | INVITED | SUSPENDED | REMOVED
  invited_by UUID REFERENCES users(user_id),
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

-- Permissions are system-wide: they describe what the software CAN do,
-- independent of any tenant. Tenants compose them into roles.
CREATE TABLE permissions (
  permission_id VARCHAR(96) PRIMARY KEY,               -- e.g. 'agent:create', 'deployment:approve'
  resource VARCHAR(64) NOT NULL,
  action VARCHAR(32) NOT NULL,                          -- READ|WRITE|CREATE|UPDATE|DELETE|EXECUTE|DEPLOY|APPROVE|EXPORT|ADMINISTER
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Roles are tenant-scoped (NULL tenant_id = system template a tenant clones).
CREATE TABLE roles (
  role_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES organizations(tenant_id),   -- NULL = system template
  role_name VARCHAR(96) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,            -- default role granted on membership join
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, role_name),
  UNIQUE (tenant_id, role_id)
);

-- Composite FK on (tenant_id, role_id) prevents a role from tenant B
-- being attached under tenant A's scope.
CREATE TABLE role_permissions (
  tenant_id UUID,                                       -- mirrors roles.tenant_id (NULL for system roles)
  role_id UUID NOT NULL,
  permission_id VARCHAR(96) NOT NULL REFERENCES permissions(permission_id),
  granted_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, role_id)
);

CREATE TABLE user_roles (
  tenant_id UUID NOT NULL REFERENCES organizations(tenant_id),
  user_id UUID NOT NULL REFERENCES users(user_id),
  role_id UUID NOT NULL,
  assigned_by UUID REFERENCES users(user_id),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, role_id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, role_id)
);

-- =====================================================================
