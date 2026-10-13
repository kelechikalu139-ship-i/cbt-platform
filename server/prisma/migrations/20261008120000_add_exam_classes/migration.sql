-- AlterTable
-- `classes` holds the class names a paper is set for, e.g. ["CSC 100 - A"].
ALTER TABLE `exams` ADD COLUMN `classes` JSON NULL;
