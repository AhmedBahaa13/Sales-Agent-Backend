-- BrokerFlow migration: move Visit lifecycle DDL out of application startup.
-- IF NOT EXISTS makes the script safe for databases where earlier app versions
-- already created these columns during startup.
ALTER TABLE `Visit` ADD COLUMN IF NOT EXISTS `startedAt` DATETIME(3) NULL;
ALTER TABLE `Visit` ADD COLUMN IF NOT EXISTS `endedAt` DATETIME(3) NULL;
ALTER TABLE `Visit` ADD COLUMN IF NOT EXISTS `startLatitude` DECIMAL(10,7) NULL;
ALTER TABLE `Visit` ADD COLUMN IF NOT EXISTS `startLongitude` DECIMAL(10,7) NULL;
ALTER TABLE `Visit` ADD COLUMN IF NOT EXISTS `endLatitude` DECIMAL(10,7) NULL;
ALTER TABLE `Visit` ADD COLUMN IF NOT EXISTS `endLongitude` DECIMAL(10,7) NULL;
