-- Persist Orientation and Workshop submissions made by authenticated sales agents.
CREATE TABLE IF NOT EXISTS `broker_activity` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `activityType` VARCHAR(32) NOT NULL,
    `brokerType` VARCHAR(32) NULL,
    `companyName` VARCHAR(255) NOT NULL,
    `brokerAdmin` VARCHAR(150) NOT NULL,
    `requestNumber` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `broker_activity_user_type_created_idx` (`userId`, `activityType`, `createdAt`),
    INDEX `broker_activity_company_idx` (`companyName`),
    CONSTRAINT `broker_activity_userId_fkey`
        FOREIGN KEY (`userId`) REFERENCES `User` (`id`)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
