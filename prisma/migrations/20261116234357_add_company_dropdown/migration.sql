-- CreateTable
CREATE TABLE `company_dropdown` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dropdownId` VARCHAR(100) NULL,
    `companyName` VARCHAR(255) NOT NULL,
    `salesAgent` VARCHAR(255) NULL,
    `email` VARCHAR(255) NOT NULL,
    `syncedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `company_dropdown_dropdownId_idx`(`dropdownId`),
    INDEX `company_dropdown_email_idx`(`email`),
    INDEX `company_dropdown_companyName_idx`(`companyName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
