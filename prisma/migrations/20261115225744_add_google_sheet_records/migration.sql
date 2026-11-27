-- CreateTable
CREATE TABLE `google_sheet_record` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `serial` VARCHAR(100) NULL,
    `sourceId` VARCHAR(100) NULL,
    `team` VARCHAR(255) NULL,
    `team1` VARCHAR(255) NULL,
    `team2` VARCHAR(255) NULL,
    `team3` VARCHAR(255) NULL,
    `team4` VARCHAR(255) NULL,
    `team5` VARCHAR(255) NULL,
    `managers` TEXT NULL,
    `salesAgent` VARCHAR(255) NULL,
    `email` VARCHAR(255) NULL,
    `companyName` VARCHAR(255) NULL,
    `groupName` VARCHAR(255) NULL,
    `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `google_sheet_record_sourceId_idx`(`sourceId`),
    INDEX `google_sheet_record_email_idx`(`email`),
    INDEX `google_sheet_record_companyName_idx`(`companyName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
