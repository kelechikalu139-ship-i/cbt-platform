-- Keep the existing local License rows and secrets intact. New hosted activations
-- store only the signed claims and a one-way digest of the activation key.
ALTER TABLE `licenses`
    MODIFY `licenseKey` VARCHAR(255) NULL,
    ADD COLUMN `signedLicense` JSON NULL,
    ADD COLUMN `lastValidatedAt` DATETIME(3) NULL,
    ADD COLUMN `offlineGraceUntil` DATETIME(3) NULL;

ALTER TABLE `licenses`
    MODIFY `status` ENUM('ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'TRIAL') NOT NULL DEFAULT 'TRIAL';
