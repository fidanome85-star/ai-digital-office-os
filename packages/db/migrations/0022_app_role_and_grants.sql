-- 22. APPLICATION ROLE — required for RLS to actually take effect.
-- Postgres exempts table owners and superusers from Row-Level Security
-- unless FORCE ROW LEVEL SECURITY is set. Migrations run as the owning
-- role, so every application service and every RLS test MUST connect as
-- a separate, non-owning, non-superuser role for the policies in
-- 0021_row_level_security_full.sql to be enforced at all.
--
-- Local/dev password matches infra/docker/docker-compose.yml and
-- .env.example. Production deployments must rotate this via secrets
-- management (packages/auth + secrets_vault_references), not this file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_office_app') THEN
    CREATE ROLE ai_office_app LOGIN PASSWORD 'ai_office_app_dev_password';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ai_office_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ai_office_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ai_office_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ai_office_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ai_office_app;
