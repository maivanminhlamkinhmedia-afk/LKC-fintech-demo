import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Static schema/DDL regression only. No DB apply, rename execution or retention
// enforcement is proved here; the authoritative adapter belongs to checkpoint B.
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const sql = readFileSync(new URL('../prisma/migrations/20261009003458_product_catalog_foundation/migration.sql', import.meta.url), 'utf8')
const executableSql = sql.replace(/--[^\n]*/g, '').trim()
const productMatch = schema.match(/^model Product \{([\s\S]*?)^\}/m)
assert.ok(productMatch, 'Product model must exist')
const product = productMatch[1]
const fields = new Map(product.trim().split(/\r?\n/).map(line => {
  const [name, ...declaration] = line.trim().split(/\s+/)
  return [name, declaration.join(' ')]
}))
const columns = new Map([...executableSql.matchAll(/^\s*`(\w+)` ([^\r\n]+)/gm)]
  .map(([, name, declaration]) => [name, declaration.replace(/,$/, '')]))
const names = ['id', 'name', 'contentState', 'saleStopped', 'createdAt', 'updatedAt']

test('PERSIST-01: only the opaque ID is identity; names can be renamed or shared', () => {
  assert.equal(fields.get('id'), 'String @id @default(cuid()) @db.VarChar(191)')
  assert.equal(fields.get('name'), 'String @db.VarChar(191)')
  assert.equal(columns.get('id'), 'VARCHAR(191) NOT NULL')
  assert.equal(columns.get('name'), 'VARCHAR(191) NOT NULL')
  assert.match(executableSql, /PRIMARY KEY \(`id`\)/)
  assert.doesNotMatch(product, /@unique|@@(?:id|unique)|@map|@@map/)
  assert.doesNotMatch(executableSql, /\bUNIQUE\b|AUTO_INCREMENT/)
  // This permits rename without a name-derived key; writer immutability is a
  // future responsibility, not something a static schema test can execute.
})

test('PERSIST-02: the sole content state agrees between Prisma and SQL', () => {
  const state = schema.match(/^enum ProductContentState \{([\s\S]*?)^\}/m)
  assert.ok(state, 'ProductContentState must exist')
  const prismaValues = state[1].trim().split(/\s+/)
  assert.deepEqual(prismaValues, ['SELECTABLE', 'UNSELECTABLE', 'RETIRED'])
  const sqlValues = columns.get('contentState').match(/^ENUM\(([^)]+)\)/)
  assert.ok(sqlValues, 'SQL contentState must be an enum')
  assert.deepEqual([...sqlValues[1].matchAll(/'([^']+)'/g)].map(match => match[1]), prismaValues)
  assert.equal(fields.get('contentState'), 'ProductContentState @default(UNSELECTABLE)')
  assert.doesNotMatch(product, /\b(?:selectableForContent|retired|isSelectable|isRetired)\b/)
  // SELECTABLE -> true/false, UNSELECTABLE -> false/false, RETIRED -> false/true
  // for selectableForContent/retired will be implemented/tested by the adapter;
  // no adapter or pure-policy execution is claimed by this foundation test.
})

test('PERSIST-02: fail-closed defaults keep saleStopped independent of contentState', () => {
  assert.equal(fields.get('saleStopped'), 'Boolean @default(true)')
  assert.equal(columns.get('saleStopped'), 'BOOLEAN NOT NULL DEFAULT true')
  assert.equal(columns.get('contentState'), "ENUM('SELECTABLE', 'UNSELECTABLE', 'RETIRED') NOT NULL DEFAULT 'UNSELECTABLE'")
  assert.doesNotMatch(executableSql, /\bCHECK\b|\bGENERATED\b|\bTRIGGER\b/)
  // No constraint couples stopped sales to selectability or revokes access.
})

test('PERSIST-03: required scalar fields and timestamp precision match SQL', () => {
  assert.deepEqual([...fields.keys()], names)
  assert.deepEqual([...columns.keys()], names)
  assert.doesNotMatch(product, /\?|\[\]/)
  assert.equal(fields.get('createdAt'), 'DateTime @default(now()) @db.DateTime(3)')
  assert.equal(fields.get('updatedAt'), 'DateTime @updatedAt @db.DateTime(3)')
  assert.equal(columns.get('createdAt'), 'DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)')
  assert.equal(columns.get('updatedAt'), 'DATETIME(3) NOT NULL')
  for (const column of columns.values()) assert.match(column, /\bNOT NULL\b/)
})

test('PERSIST-03: migration is exactly one expand-only Product creation', () => {
  const statements = executableSql.split(';').map(statement => statement.trim()).filter(Boolean)
  assert.equal(statements.length, 1, 'no extra DDL/DML or seed statement')
  assert.match(statements[0], /^CREATE TABLE `Product` \([\s\S]*\) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci$/)
  assert.doesNotMatch(executableSql, /\b(?:ALTER|DROP|TRUNCATE|UPDATE|DELETE|INSERT|REPLACE|REFERENCES|FOREIGN|INDEX|CONSTRAINT)\b/)
  const constraints = executableSql.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(?:PRIMARY|UNIQUE|FOREIGN|INDEX|KEY|CONSTRAINT|CHECK)\b/.test(line))
  assert.deepEqual(constraints, ['PRIMARY KEY (`id`)'])
})

test('PERSIST-03: Product has no Plan, CMS, audience, entitlement or runtime binding', () => {
  assert.doesNotMatch(product, /@relation|@@index|\b(?:ProductPlan|Article|ArticleVersion|User|Subscription|price|productId|accessMode)\b/)
  assert.doesNotMatch(schema, /^model (?:ProductPlan|ArticleProduct|ArticleVersionProduct)\b/m)
  assert.doesNotMatch(executableSql, /`(?:Article|ArticleVersion|ProductPlan|Subscription|User|publishedVersionId|accessMode)`/)
})
