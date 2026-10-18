import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const sql = readFileSync(new URL('../prisma/migrations/20261008155242_cms011_review_foundation/migration.sql', import.meta.url), 'utf8')
const model = name => {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))
  assert.ok(match, `missing model ${name}`)
  return match[1]
}

test('legacy rows remain nullable; migration does not fabricate approval, audience or timestamps', () => {
  for (const [name, fields] of [
    ['Article', ['activeReviewVersionId', 'activeApprovalVersionId']],
    ['ArticleVersion', ['snapshotFormatVersion', 'basisUpdatedAt', 'slug', 'articleType', 'seoTitle', 'seoDescription', 'featured']],
    ['ArticleReview', ['versionId']],
  ]) {
    const body = model(name)
    for (const field of fields) {
      assert.match(body, new RegExp(`\\b${field}\\s+\\w+\\?`))
      assert.match(sql, new RegExp('ADD COLUMN `'+field+'` [^\\n;]* NULL'))
    }
  }
  assert.match(model('ArticleVersion'), /basisUpdatedAt\s+DateTime\?\s+@db\.DateTime\(3\)/)
  assert.match(sql, /`basisUpdatedAt` DATETIME\(3\) NULL/)
  assert.doesNotMatch(sql, /^\s*(?:UPDATE|DELETE FROM|INSERT|DROP|TRUNCATE)\b/im)
  assert.doesNotMatch(sql, /ADD COLUMN `(?:accessMode|publishedVersionId|productId)`/)
})

test('review and both active pointers bind to versions of the same Article', () => {
  assert.match(model('ArticleVersion'), /@@unique\(\[articleId, id\]\)/)
  assert.match(model('ArticleVersion'), /@@unique\(\[articleId, versionNumber\]\)/)
  assert.match(sql, /UNIQUE INDEX `ArticleVersion_articleId_id_key` ON `ArticleVersion`\(`articleId`, `id`\)/)
  for (const field of ['activeReviewVersionId', 'activeApprovalVersionId']) {
    assert.match(sql, new RegExp('FOREIGN KEY \\(`id`, `'+field+'`\\) REFERENCES `ArticleVersion`\\(`articleId`, `id`\\) ON DELETE RESTRICT ON UPDATE RESTRICT'))
  }
  assert.match(sql, /FOREIGN KEY \(`articleId`, `versionId`\) REFERENCES `ArticleVersion`\(`articleId`, `id`\) ON DELETE RESTRICT ON UPDATE RESTRICT/)
  assert.match(model('ArticleReview'), /versionId\s+String\?/)
})

test('typed source/classification/media/history relations retain identities with Restrict FKs', () => {
  for (const name of ['ArticleVersionCategory', 'ArticleVersionTopic', 'ArticleVersionTag',
    'ArticleVersionInstrument', 'ArticleVersionSource', 'ArticleVersionDisclosure',
    'ArticleVersionMedia', 'ArticleReviewEvent']) {
    const body = model(name)
    assert.match(body, /articleId\s+String/)
    assert.match(body, /versionId\s+String/)
    assert.match(body, /references: \[articleId, id\], onDelete: Restrict, onUpdate: Restrict/)
    assert.match(sql, new RegExp('CREATE TABLE `'+name+'`'))
    assert.match(sql, new RegExp('ALTER TABLE `'+name+'` ADD CONSTRAINT `'+name+'_articleId_versionId_fkey`'))
  }
  assert.match(model('ArticleVersionMedia'), /@@id\(\[versionId, assetId, context\]\)/)
  assert.match(model('ArticleVersionMedia'), /@@index\(\[assetId\]\)/)
  assert.match(sql, /FOREIGN KEY \(`assetId`\) REFERENCES `MediaAsset`\(`id`\) ON DELETE RESTRICT ON UPDATE RESTRICT/)
  assert.match(model('ArticleReviewEvent'), /@@unique\(\[articleId, operationId\]\)/)
})

test('no product, published pointer, writer or media guard is activated by this migration', () => {
  assert.doesNotMatch(sql, /`(?:Product|ProductPlan|ArticleProduct|ArticleVersionProduct)`/)
  assert.doesNotMatch(sql, /`publishedVersionId`|`accessMode`/)
  assert.doesNotMatch(sql, /ON DELETE (?:CASCADE|SET NULL)|ON UPDATE (?:CASCADE|SET NULL)/)
  const snapshot = readFileSync(new URL('../src/features/cms/article-review-snapshot.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(snapshot, /from ['"](?:@\/lib\/prisma|.*media-actions|.*article-draft-actions)['"]|\bprisma\./)
})
