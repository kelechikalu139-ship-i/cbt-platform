-- PostgreSQL schema for the separately hosted licensing service.
-- This schema is independent of server/prisma/schema.prisma (local MariaDB).
CREATE TABLE IF NOT EXISTS licensing_admins (
  id UUID PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ADMIN')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMPTZ
);

ALTER TABLE licensing_admins ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE licensing_admins ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT;
ALTER TABLE licensing_admins ADD COLUMN IF NOT EXISTS mfa_pending_secret_enc TEXT;
ALTER TABLE licensing_admins ADD COLUMN IF NOT EXISTS mfa_enabled_at TIMESTAMPTZ;
ALTER TABLE licensing_admins ADD COLUMN IF NOT EXISTS mfa_last_used_step BIGINT NOT NULL DEFAULT 0;
ALTER TABLE licensing_admins ADD COLUMN IF NOT EXISTS mfa_recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS licensing_admin_invitations (
  id UUID PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES licensing_admins(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS licensing_admin_bootstrap (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  email VARCHAR(190) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_licensing_admin_invitation_pending_email
  ON licensing_admin_invitations(email) WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS licenses (
  id UUID PRIMARY KEY,
  institution_id VARCHAR(64) NOT NULL,
  institution_name VARCHAR(190) NOT NULL,
  contact_email VARCHAR(190),
  plan TEXT NOT NULL CHECK (plan IN ('TRIAL', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED')),
  activation_key_hash CHAR(64) NOT NULL UNIQUE,
  installation_id VARCHAR(64) UNIQUE,
  max_candidates INTEGER NOT NULL DEFAULT 100 CHECK (max_candidates > 0),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  features JSONB NOT NULL,
  signed_license JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_institution ON licenses(institution_id);
CREATE INDEX IF NOT EXISTS idx_licenses_expiry ON licenses(expires_at);
-- Application-level checks provide readable errors; this index closes the
-- concurrent-create race when two admins issue a licence for one institution.
CREATE UNIQUE INDEX IF NOT EXISTS uq_licenses_one_open_per_institution
  ON licenses(institution_id) WHERE status IN ('PENDING', 'ACTIVE');

CREATE TABLE IF NOT EXISTS license_events (
  id UUID PRIMARY KEY,
  license_id UUID REFERENCES licenses(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_email VARCHAR(190),
  installation_id VARCHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_license_events_license_created
  ON license_events(license_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_events_created
  ON license_events(created_at DESC);
