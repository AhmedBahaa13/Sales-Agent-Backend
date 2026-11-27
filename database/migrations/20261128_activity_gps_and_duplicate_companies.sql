-- Permit separate Company rows with the same normalized name, and persist GPS for Orientation/Workshop check-in/out.
ALTER TABLE `company` DROP INDEX `company_normalizedName_key`;
CREATE INDEX `company_normalizedName_idx` ON `company` (`normalizedName`);
ALTER TABLE `orientation` ADD COLUMN `startLatitude` DECIMAL(10, 7) NULL;
ALTER TABLE `orientation` ADD COLUMN `startLongitude` DECIMAL(10, 7) NULL;
ALTER TABLE `orientation` ADD COLUMN `endLatitude` DECIMAL(10, 7) NULL;
ALTER TABLE `orientation` ADD COLUMN `endLongitude` DECIMAL(10, 7) NULL;
