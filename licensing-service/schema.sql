-- PostgreSQL schema for the separately hosted licensing service.
-- This schema is independent of server/prisma/schema.prisma (local MariaDB).
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
