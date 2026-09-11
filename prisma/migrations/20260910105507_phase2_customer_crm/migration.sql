-- AlterTable
ALTER TABLE `customerprofile` ADD COLUMN `lastContactAt` DATETIME(3) NULL,
    ADD COLUMN `nextContactAt` DATETIME(3) NULL,
    ADD COLUMN `priority` ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'MEDIUM';

-- CreateTable
CREATE TABLE `CustomerActivity` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `type` ENUM('NOTE', 'CALL', 'EMAIL', 'MEETING', 'MESSAGE', 'STATUS_CHANGE', 'ASSIGNMENT') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CustomerActivity_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `CustomerActivity_actorId_createdAt_idx`(`actorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerTask` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `assignedToId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'TODO',
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    `dueAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CustomerTask_customerId_status_idx`(`customerId`, `status`),
    INDEX `CustomerTask_assignedToId_status_dueAt_idx`(`assignedToId`, `status`, `dueAt`),
    INDEX `CustomerTask_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `CustomerProfile_priority_status_idx` ON `CustomerProfile`(`priority`, `status`);

-- CreateIndex
CREATE INDEX `CustomerProfile_nextContactAt_idx` ON `CustomerProfile`(`nextContactAt`);

-- AddForeignKey
ALTER TABLE `CustomerActivity` ADD CONSTRAINT `CustomerActivity_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerActivity` ADD CONSTRAINT `CustomerActivity_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerTask` ADD CONSTRAINT `CustomerTask_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `CustomerProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerTask` ADD CONSTRAINT `CustomerTask_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerTask` ADD CONSTRAINT `CustomerTask_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
