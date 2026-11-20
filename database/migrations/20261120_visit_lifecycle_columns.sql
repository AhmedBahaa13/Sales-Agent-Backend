-- Visit lifecycle fields. The migration runner checks INFORMATION_SCHEMA first,
-- so it works when an earlier deployment already created some or all columns.
ALTER TABLE `Visit` ADD COLUMN `startedAt` DATETIME(3) NULL;
ALTER TABLE `Visit` ADD COLUMN `endedAt` DATETIME(3) NULL;
ALTER TABLE `Visit` ADD COLUMN `startLatitude` DECIMAL(10,7) NULL;
ALTER TABLE `Visit` ADD COLUMN `startLongitude` DECIMAL(10,7) NULL;
ALTER TABLE `Visit` ADD COLUMN `endLatitude` DECIMAL(10,7) NULL;
ALTER TABLE `Visit` ADD COLUMN `endLongitude` DECIMAL(10,7) NULL;
