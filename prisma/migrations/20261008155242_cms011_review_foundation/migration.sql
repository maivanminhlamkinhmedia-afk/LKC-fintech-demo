-- CMS-011.1 expand-only foundation. No application writer or reader is activated here.
-- Before any separately authorized apply: verify target MariaDB version and
-- Prisma/adapter compatibility; inspect existing ArticleVersion/ArticleReview
-- rows and FK/index collisions. Legacy snapshot fields remain NULL by design.
-- MySQL/MariaDB DDL may commit each statement; this file is not an atomic rollback.

-- AlterTable
ALTER TABLE `Article` ADD COLUMN `activeApprovalVersionId` VARCHAR(191) NULL,
    ADD COLUMN `activeReviewVersionId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `ArticleVersion` ADD COLUMN `articleType` ENUM('NEWS', 'MARKET_UPDATE', 'ANALYSIS', 'EDUCATION', 'RESEARCH', 'OPINION') NULL,
    ADD COLUMN `basisUpdatedAt` DATETIME(3) NULL,
    ADD COLUMN `featured` BOOLEAN NULL,
    ADD COLUMN `seoDescription` TEXT NULL,
    ADD COLUMN `seoTitle` VARCHAR(191) NULL,
    ADD COLUMN `slug` VARCHAR(191) NULL,
    ADD COLUMN `snapshotFormatVersion` INTEGER NULL;

-- AlterTable
ALTER TABLE `ArticleReview` ADD COLUMN `versionId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ArticleVersionCategory` (
    `versionId` VARCHAR(191) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `nameAtCapture` VARCHAR(191) NOT NULL,

    INDEX `ArticleVersionCategory_articleId_versionId_idx`(`articleId`, `versionId`),
    INDEX `ArticleVersionCategory_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`versionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ArticleVersionTopic` (
    `versionId` VARCHAR(191) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `topicId` VARCHAR(191) NOT NULL,
    `nameAtCapture` VARCHAR(191) NOT NULL,

    INDEX `ArticleVersionTopic_articleId_versionId_idx`(`articleId`, `versionId`),
    INDEX `ArticleVersionTopic_topicId_idx`(`topicId`),
    PRIMARY KEY (`versionId`, `topicId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ArticleVersionTag` (
    `versionId` VARCHAR(191) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `tagId` VARCHAR(191) NOT NULL,
    `nameAtCapture` VARCHAR(191) NOT NULL,

    INDEX `ArticleVersionTag_articleId_versionId_idx`(`articleId`, `versionId`),
    INDEX `ArticleVersionTag_tagId_idx`(`tagId`),
    PRIMARY KEY (`versionId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ArticleVersionInstrument` (
    `versionId` VARCHAR(191) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `instrumentId` VARCHAR(191) NOT NULL,
    `nameAtCapture` VARCHAR(191) NOT NULL,
    `symbolAtCapture` VARCHAR(191) NOT NULL,
    `isPrimary` BOOLEAN NOT NULL,

    INDEX `ArticleVersionInstrument_articleId_versionId_idx`(`articleId`, `versionId`),
    INDEX `ArticleVersionInstrument_instrumentId_idx`(`instrumentId`),
    PRIMARY KEY (`versionId`, `instrumentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ArticleVersionSource` (
    `versionId` VARCHAR(191) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `sourceIdAtCapture` VARCHAR(191) NOT NULL,
    `sourceType` ENUM('WEBSITE', 'REPORT', 'EXCHANGE', 'REGULATOR', 'COMPANY', 'DATA_PROVIDER', 'INTERNAL', 'OTHER') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `publisher` VARCHAR(191) NULL,
    `url` TEXT NULL,
    `publishedAt` DATETIME(3) NULL,
    `accessedAt` DATETIME(3) NULL,
    `dataTimestamp` DATETIME(3) NULL,

    INDEX `ArticleVersionSource_articleId_versionId_idx`(`articleId`, `versionId`),
    PRIMARY KEY (`versionId`, `position`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ArticleVersionDisclosure` (
    `versionId` VARCHAR(191) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `disclosureIdAtCapture` VARCHAR(191) NOT NULL,
    `statement` TEXT NOT NULL,
    `conflictType` VARCHAR(191) NULL,

    INDEX `ArticleVersionDisclosure_articleId_versionId_idx`(`articleId`, `versionId`),
    PRIMARY KEY (`versionId`, `position`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ArticleVersionMedia` (
    `versionId` VARCHAR(191) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `context` ENUM('COVER') NOT NULL,
    `altTextAtCapture` TEXT NULL,
    `captionAtCapture` TEXT NULL,

    INDEX `ArticleVersionMedia_articleId_versionId_idx`(`articleId`, `versionId`),
    INDEX `ArticleVersionMedia_assetId_idx`(`assetId`),
    PRIMARY KEY (`versionId`, `assetId`, `context`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ArticleReviewEvent` (
    `id` VARCHAR(191) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `versionId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` ENUM('SUBMIT', 'TAKE', 'APPROVE') NOT NULL,
    `fromStatus` ENUM('DRAFT', 'SUBMITTED', 'EDITORIAL_REVIEW', 'CHANGES_REQUESTED', 'FACT_CHECK', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED') NOT NULL,
    `toStatus` ENUM('DRAFT', 'SUBMITTED', 'EDITORIAL_REVIEW', 'CHANGES_REQUESTED', 'FACT_CHECK', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED') NOT NULL,
    `operationId` VARCHAR(191) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ArticleReviewEvent_articleId_versionId_occurredAt_idx`(`articleId`, `versionId`, `occurredAt`),
    INDEX `ArticleReviewEvent_actorId_idx`(`actorId`),
    UNIQUE INDEX `ArticleReviewEvent_articleId_operationId_key`(`articleId`, `operationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Article_id_activeReviewVersionId_idx` ON `Article`(`id`, `activeReviewVersionId`);

-- CreateIndex
CREATE INDEX `Article_id_activeApprovalVersionId_idx` ON `Article`(`id`, `activeApprovalVersionId`);

-- CreateIndex
CREATE UNIQUE INDEX `ArticleVersion_articleId_id_key` ON `ArticleVersion`(`articleId`, `id`);

-- CreateIndex
CREATE INDEX `ArticleReview_articleId_versionId_idx` ON `ArticleReview`(`articleId`, `versionId`);

-- AddForeignKey
ALTER TABLE `Article` ADD CONSTRAINT `Article_id_activeReviewVersionId_fkey` FOREIGN KEY (`id`, `activeReviewVersionId`) REFERENCES `ArticleVersion`(`articleId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Article` ADD CONSTRAINT `Article_id_activeApprovalVersionId_fkey` FOREIGN KEY (`id`, `activeApprovalVersionId`) REFERENCES `ArticleVersion`(`articleId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionCategory` ADD CONSTRAINT `ArticleVersionCategory_articleId_versionId_fkey` FOREIGN KEY (`articleId`, `versionId`) REFERENCES `ArticleVersion`(`articleId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionCategory` ADD CONSTRAINT `ArticleVersionCategory_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ArticleCategory`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionTopic` ADD CONSTRAINT `ArticleVersionTopic_articleId_versionId_fkey` FOREIGN KEY (`articleId`, `versionId`) REFERENCES `ArticleVersion`(`articleId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionTopic` ADD CONSTRAINT `ArticleVersionTopic_topicId_fkey` FOREIGN KEY (`topicId`) REFERENCES `ArticleTopic`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionTag` ADD CONSTRAINT `ArticleVersionTag_articleId_versionId_fkey` FOREIGN KEY (`articleId`, `versionId`) REFERENCES `ArticleVersion`(`articleId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionTag` ADD CONSTRAINT `ArticleVersionTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `ArticleTag`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionInstrument` ADD CONSTRAINT `ArticleVersionInstrument_articleId_versionId_fkey` FOREIGN KEY (`articleId`, `versionId`) REFERENCES `ArticleVersion`(`articleId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionInstrument` ADD CONSTRAINT `ArticleVersionInstrument_instrumentId_fkey` FOREIGN KEY (`instrumentId`) REFERENCES `FinancialInstrument`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionSource` ADD CONSTRAINT `ArticleVersionSource_articleId_versionId_fkey` FOREIGN KEY (`articleId`, `versionId`) REFERENCES `ArticleVersion`(`articleId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionDisclosure` ADD CONSTRAINT `ArticleVersionDisclosure_articleId_versionId_fkey` FOREIGN KEY (`articleId`, `versionId`) REFERENCES `ArticleVersion`(`articleId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionMedia` ADD CONSTRAINT `ArticleVersionMedia_articleId_versionId_fkey` FOREIGN KEY (`articleId`, `versionId`) REFERENCES `ArticleVersion`(`articleId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionMedia` ADD CONSTRAINT `ArticleVersionMedia_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `MediaAsset`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleReviewEvent` ADD CONSTRAINT `ArticleReviewEvent_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleReviewEvent` ADD CONSTRAINT `ArticleReviewEvent_articleId_versionId_fkey` FOREIGN KEY (`articleId`, `versionId`) REFERENCES `ArticleVersion`(`articleId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleReviewEvent` ADD CONSTRAINT `ArticleReviewEvent_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleReview` ADD CONSTRAINT `ArticleReview_articleId_versionId_fkey` FOREIGN KEY (`articleId`, `versionId`) REFERENCES `ArticleVersion`(`articleId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
