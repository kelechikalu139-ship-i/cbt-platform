-- AlterTable
-- Student single-session enforcement: a candidate may hold exactly one
-- live sign-in session, so a second PC cannot sign in until the first
-- session is signed out, ended by an administrator, or expired.
ALTER TABLE `users` ADD COLUMN `sessionHash` CHAR(64) NULL;
ALTER TABLE `users` ADD COLUMN `sessionExpiresAt` DATETIME(3) NULL;
