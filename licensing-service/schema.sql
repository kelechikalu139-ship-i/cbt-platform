CREATE TABLE IF NOT EXISTS licenses (
 id CHAR(36) PRIMARY KEY, institution_id VARCHAR(64) NOT NULL,
 institution_name VARCHAR(190) NOT NULL, contact_email VARCHAR(190) NULL,
 plan ENUM('TRIAL','STANDARD','PROFESSIONAL','ENTERPRISE') NOT NULL DEFAULT 'STANDARD',
 status ENUM('PENDING','ACTIVE','EXPIRED','REVOKED') NOT NULL DEFAULT 'PENDING',
 activation_key_hash CHAR(64) NOT NULL UNIQUE, installation_id VARCHAR(64) NULL,
 max_candidates INT NOT NULL DEFAULT 100, issued_at DATETIME(3) NOT NULL,
 expires_at DATETIME(3) NULL, activated_at DATETIME(3) NULL,
 features JSON NOT NULL, signed_license JSON NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 INDEX idx_licenses_status(status), INDEX idx_licenses_institution(institution_id),
 INDEX idx_licenses_expiry(expires_at), UNIQUE KEY uq_licenses_installation(installation_id)
);
