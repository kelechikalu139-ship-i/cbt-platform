CREATE TABLE IF NOT EXISTS `proctor_snapshots` (
  `id` CHAR(36) NOT NULL,
  `sessionId` CHAR(36) NOT NULL,
  `image` LONGBLOB NOT NULL,
  `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `source` VARCHAR(32) NOT NULL DEFAULT 'camera',

  PRIMARY KEY (`id`),
  INDEX `proctor_snapshots_sessionId_capturedAt_idx`(`sessionId`, `capturedAt`),
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @constraint_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'proctor_snapshots'
    AND CONSTRAINT_NAME = 'proctor_snapshots_sessionId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @add_constraint_sql = IF(
  @constraint_exists = 0,
  'ALTER TABLE `proctor_snapshots` ADD CONSTRAINT `proctor_snapshots_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `exam_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE add_constraint FROM @add_constraint_sql;
EXECUTE add_constraint;
DEALLOCATE PREPARE add_constraint;
