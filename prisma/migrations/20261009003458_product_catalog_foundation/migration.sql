-- SUB-002.1.A expand-only Product foundation, stacked on CMS-011.1.
-- No production seed, CMS binding, application writer or producer activation.
-- Verify target MariaDB and Prisma/adapter compatibility before any separately
-- authorized apply. DDL may commit independently; DB execution is not verified.
-- Cuid and updatedAt are supplied by Prisma, not SQL-generated identity/history.

-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `contentState` ENUM('SELECTABLE', 'UNSELECTABLE', 'RETIRED') NOT NULL DEFAULT 'UNSELECTABLE',
    `saleStopped` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
