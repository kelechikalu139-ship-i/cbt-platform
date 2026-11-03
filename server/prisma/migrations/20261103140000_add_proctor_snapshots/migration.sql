CREATE TABLE `ProctorSnapshot` (
  `id` CHAR(36) NOT NULL,
  `sessionId` CHAR(36) NOT NULL,
  `image` LONGBLOB NOT NULL,
  `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `source` VARCHAR(32) NOT NULL DEFAULT 'camera',

  PRIMARY KEY (`id`),
  INDEX `ProctorSnapshot_sessionId_capturedAt_idx`(`sessionId`, `capturedAt`),
  CONSTRAINT `ProctorSnapshot_sessionId_fkey`
    FOREIGN KEY (`sessionId`) REFERENCES `ExamSession`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
