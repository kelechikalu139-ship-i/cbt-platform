CREATE TABLE `proctor_snapshots` (
  `id` CHAR(36) NOT NULL,
  `sessionId` CHAR(36) NOT NULL,
  `image` LONGBLOB NOT NULL,
  `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `source` VARCHAR(32) NOT NULL DEFAULT 'camera',

  PRIMARY KEY (`id`),
  INDEX `proctor_snapshots_sessionId_capturedAt_idx`(`sessionId`, `capturedAt`),
  CONSTRAINT `proctor_snapshots_sessionId_fkey`
    FOREIGN KEY (`sessionId`) REFERENCES `exam_sessions`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
