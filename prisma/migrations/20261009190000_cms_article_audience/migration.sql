-- AlterTable
ALTER TABLE `Article` ADD COLUMN `accessMode` ENUM('PUBLIC', 'PAID_PRODUCT') NULL;

-- AlterTable
ALTER TABLE `ArticleVersion` ADD COLUMN `accessMode` ENUM('PUBLIC', 'PAID_PRODUCT') NULL;

-- CreateTable
CREATE TABLE `ArticleProduct` (
    `articleId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,

    INDEX `ArticleProduct_productId_idx`(`productId`),
    PRIMARY KEY (`articleId`, `productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ArticleVersionProduct` (
    `articleId` VARCHAR(191) NOT NULL,
    `versionId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,

    INDEX `ArticleVersionProduct_articleId_versionId_idx`(`articleId`, `versionId`),
    INDEX `ArticleVersionProduct_productId_idx`(`productId`),
    PRIMARY KEY (`versionId`, `productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ArticleProduct` ADD CONSTRAINT `ArticleProduct_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleProduct` ADD CONSTRAINT `ArticleProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionProduct` ADD CONSTRAINT `ArticleVersionProduct_articleId_versionId_fkey` FOREIGN KEY (`articleId`, `versionId`) REFERENCES `ArticleVersion`(`articleId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ArticleVersionProduct` ADD CONSTRAINT `ArticleVersionProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
