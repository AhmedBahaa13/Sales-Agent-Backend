-- Rebuild the application domain while preserving User accounts and company_dropdown data.
-- Legacy application records are intentionally removed; CompanyDropdown is untouched.
-- User ID column metadata is copied from INFORMATION_SCHEMA before foreign keys are created,
-- because the existing User table may use a different charset or collation than the database default.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `VisitAssignment`;
DROP TABLE IF EXISTS `CompanyMember`;
DROP TABLE IF EXISTS `TeamMember`;
DROP TABLE IF EXISTS `Visit`;
DROP TABLE IF EXISTS `broker_activity`;
DROP TABLE IF EXISTS `google_sheet_record`;
DROP TABLE IF EXISTS `Team`;
DROP TABLE IF EXISTS `Company`;
SET FOREIGN_KEY_CHECKS = 1;

ALTER TABLE `User` ADD COLUMN `role` ENUM('OPERATION_DIRECTOR','SALES_MANAGER','SALES_MAN') NOT NULL DEFAULT 'SALES_MAN';
ALTER TABLE `User` ADD COLUMN `teamId` VARCHAR(191) NULL;
CREATE INDEX `User_teamId_role_idx` ON `User` (`teamId`, `role`);

CREATE TABLE IF NOT EXISTS `team` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `managerId` VARCHAR(191) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `team_managerId_name_key` (`managerId`, `name`),
  KEY `team_managerId_isActive_idx` (`managerId`, `isActive`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Match User.id exactly, including length, character set and collation.
SET @user_id_column_type = (
  SELECT CONCAT(
    COLUMN_TYPE,
    IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET ', CHARACTER_SET_NAME)),
    IF(COLLATION_NAME IS NULL, '', CONCAT(' COLLATE ', COLLATION_NAME))
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'User'
    AND COLUMN_NAME = 'id'
  LIMIT 1
);

SET @sql = CONCAT('ALTER TABLE `team` MODIFY COLUMN `id` ', @user_id_column_type, ' NOT NULL');
PREPARE brokerflow_stmt FROM @sql;
EXECUTE brokerflow_stmt;
DEALLOCATE PREPARE brokerflow_stmt;

SET @sql = CONCAT('ALTER TABLE `team` MODIFY COLUMN `managerId` ', @user_id_column_type, ' NOT NULL');
PREPARE brokerflow_stmt FROM @sql;
EXECUTE brokerflow_stmt;
DEALLOCATE PREPARE brokerflow_stmt;

SET @sql = CONCAT('ALTER TABLE `User` MODIFY COLUMN `teamId` ', @user_id_column_type, ' NULL');
PREPARE brokerflow_stmt FROM @sql;
EXECUTE brokerflow_stmt;
DEALLOCATE PREPARE brokerflow_stmt;

ALTER TABLE `team`
  ADD CONSTRAINT `team_managerId_fkey`
  FOREIGN KEY (`managerId`) REFERENCES `User` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `User`
  ADD CONSTRAINT `User_teamId_fkey`
  FOREIGN KEY (`teamId`) REFERENCES `team` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS `company` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `normalizedName` VARCHAR(255) NOT NULL,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `company_normalizedName_key` (`normalizedName`),
  KEY `company_createdById_idx` (`createdById`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `client` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `phone` VARCHAR(40) NULL,
  `email` VARCHAR(255) NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `client_createdById_phone_idx` (`createdById`, `phone`),
  KEY `client_name_idx` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `client_source` (
  `id` VARCHAR(191) NOT NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `sourceType` VARCHAR(80) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `phone` VARCHAR(40) NULL,
  `details` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `client_source_createdById_sourceType_idx` (`createdById`, `sourceType`),
  KEY `client_source_name_idx` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `visit` (
  `id` VARCHAR(191) NOT NULL,
  `salesId` VARCHAR(191) NOT NULL,
  `clientId` VARCHAR(191) NOT NULL,
  `source` ENUM('DIRECT','INDIRECT') NOT NULL,
  `clientSourceId` VARCHAR(191) NOT NULL,
  `startedAt` DATETIME(3) NOT NULL,
  `endedAt` DATETIME(3) NULL,
  `startLatitude` DECIMAL(10,7) NOT NULL,
  `startLongitude` DECIMAL(10,7) NOT NULL,
  `endLatitude` DECIMAL(10,7) NULL,
  `endLongitude` DECIMAL(10,7) NULL,
  `status` ENUM('IN_PROGRESS','COMPLETED') NOT NULL DEFAULT 'IN_PROGRESS',
  `notes` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `visit_salesId_status_startedAt_idx` (`salesId`, `status`, `startedAt`),
  KEY `visit_clientId_startedAt_idx` (`clientId`, `startedAt`),
  KEY `visit_clientSourceId_idx` (`clientSourceId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `orientation` (
  `id` VARCHAR(191) NOT NULL,
  `salesId` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `activityType` ENUM('ORIENTATION','WORKSHOP') NOT NULL,
  `brokerAdmin` VARCHAR(150) NOT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `endedAt` DATETIME(3) NULL,
  `status` ENUM('IN_PROGRESS','COMPLETED') NOT NULL DEFAULT 'IN_PROGRESS',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `orientation_salesId_activityType_status_createdAt_idx` (`salesId`, `activityType`, `status`, `createdAt`),
  KEY `orientation_companyId_activityType_status_idx` (`companyId`, `activityType`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `ad` (
  `id` VARCHAR(191) NOT NULL,
  `salesId` VARCHAR(191) NOT NULL,
  `link` VARCHAR(2048) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ad_salesId_createdAt_idx` (`salesId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `auth_session` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `refreshTokenHash` VARCHAR(128) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL,
  `lastUsedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `auth_session_refreshTokenHash_key` (`refreshTokenHash`),
  KEY `auth_session_userId_revokedAt_expiresAt_idx` (`userId`, `revokedAt`, `expiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Align every foreign-key column that points to the existing User.id column.
SET @sql = CONCAT('ALTER TABLE `company` MODIFY COLUMN `createdById` ', @user_id_column_type, ' NULL');
PREPARE brokerflow_stmt FROM @sql;
EXECUTE brokerflow_stmt;
DEALLOCATE PREPARE brokerflow_stmt;

SET @sql = CONCAT('ALTER TABLE `client` MODIFY COLUMN `createdById` ', @user_id_column_type, ' NOT NULL');
PREPARE brokerflow_stmt FROM @sql;
EXECUTE brokerflow_stmt;
DEALLOCATE PREPARE brokerflow_stmt;

SET @sql = CONCAT('ALTER TABLE `client_source` MODIFY COLUMN `createdById` ', @user_id_column_type, ' NOT NULL');
PREPARE brokerflow_stmt FROM @sql;
EXECUTE brokerflow_stmt;
DEALLOCATE PREPARE brokerflow_stmt;

SET @sql = CONCAT('ALTER TABLE `visit` MODIFY COLUMN `salesId` ', @user_id_column_type, ' NOT NULL');
PREPARE brokerflow_stmt FROM @sql;
EXECUTE brokerflow_stmt;
DEALLOCATE PREPARE brokerflow_stmt;

SET @sql = CONCAT('ALTER TABLE `orientation` MODIFY COLUMN `salesId` ', @user_id_column_type, ' NOT NULL');
PREPARE brokerflow_stmt FROM @sql;
EXECUTE brokerflow_stmt;
DEALLOCATE PREPARE brokerflow_stmt;

SET @sql = CONCAT('ALTER TABLE `ad` MODIFY COLUMN `salesId` ', @user_id_column_type, ' NOT NULL');
PREPARE brokerflow_stmt FROM @sql;
EXECUTE brokerflow_stmt;
DEALLOCATE PREPARE brokerflow_stmt;

SET @sql = CONCAT('ALTER TABLE `auth_session` MODIFY COLUMN `userId` ', @user_id_column_type, ' NOT NULL');
PREPARE brokerflow_stmt FROM @sql;
EXECUTE brokerflow_stmt;
DEALLOCATE PREPARE brokerflow_stmt;

ALTER TABLE `company`
  ADD CONSTRAINT `company_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `client`
  ADD CONSTRAINT `client_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `client_source`
  ADD CONSTRAINT `client_source_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `visit`
  ADD CONSTRAINT `visit_salesId_fkey`
  FOREIGN KEY (`salesId`) REFERENCES `User` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `visit`
  ADD CONSTRAINT `visit_clientId_fkey`
  FOREIGN KEY (`clientId`) REFERENCES `client` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `visit`
  ADD CONSTRAINT `visit_clientSourceId_fkey`
  FOREIGN KEY (`clientSourceId`) REFERENCES `client_source` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `orientation`
  ADD CONSTRAINT `orientation_salesId_fkey`
  FOREIGN KEY (`salesId`) REFERENCES `User` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `orientation`
  ADD CONSTRAINT `orientation_companyId_fkey`
  FOREIGN KEY (`companyId`) REFERENCES `company` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ad`
  ADD CONSTRAINT `ad_salesId_fkey`
  FOREIGN KEY (`salesId`) REFERENCES `User` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `auth_session`
  ADD CONSTRAINT `auth_session_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
