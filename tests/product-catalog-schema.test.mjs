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

function modelFields(candidateSchema, modelName) {
  const match = candidateSchema.match(new RegExp(`^model ${modelName} \\{([\\s\\S]*?)^\\}`, 'm'))
  assert.ok(match, `${modelName} model must exist`)
  const entries = match[1].split(/\r?\n/).map(line => line.replace(/\/\/.*$/, '').trim())
    .filter(line => line && !line.startsWith('@@')).map(line => {
      const [name, ...declaration] = line.split(/\s+/)
      return [name, declaration.join(' ')]
    })
  assert.equal(new Set(entries.map(([name]) => name)).size, entries.length, 'no duplicate fields')
  return new Map(entries)
}

function assertProductBoundary(candidateSchema) {
  const candidateFields = modelFields(candidateSchema, 'Product')
  const scalarFields = [...candidateFields].filter(([, declaration]) => !declaration.includes('[]'))
  assert.deepEqual(scalarFields.map(([name]) => name), names, 'exactly six persisted Product scalars')
  for (const [, declaration] of scalarFields) assert.doesNotMatch(declaration, /\?/)
  const reverseTypes = [...candidateFields].filter(([, declaration]) => declaration.includes('[]'))
    .map(([, declaration]) => {
      assert.match(declaration, /^(?:ArticleProduct|ArticleVersionProduct)\[\]$/, 'only audience reverse lists')
      return declaration
    })
  assert.equal(new Set(reverseTypes).size, reverseTypes.length, 'at most one reverse list per edge type')
  assert.doesNotMatch(candidateSchema, /^model (?:ProductPlan|Subscription)\b/m)
  // Audience edges may reference Product; they must not become another catalog.
  // Exact FK/index/retention enforcement belongs to the audience schema tests.
  for (const [edge, ids, targets] of [
    ['ArticleProduct', ['articleId', 'productId'], ['Article', 'Product']],
    ['ArticleVersionProduct', ['articleId', 'productId', 'versionId'], ['ArticleVersion', 'Product']],
  ]) {
    if (!new RegExp(`^model ${edge} \\{`, 'm').test(candidateSchema)) continue
    const edgeFields = [...modelFields(candidateSchema, edge)]
    const edgeScalars = edgeFields.filter(([, declaration]) => !declaration.includes('@relation'))
    assert.deepEqual(edgeScalars.map(([name]) => name).sort(), ids, 'edge stores IDs, not catalog scalars')
    for (const [, declaration] of edgeScalars) assert.match(declaration, /^String(?: @db\.VarChar\(191\))?$/)
    const relations = edgeFields.filter(([, declaration]) => declaration.includes('@relation'))
    assert.deepEqual(relations.map(([, declaration]) => declaration.split(' ')[0]).sort(), targets)
    const productRelation = relations.find(([, declaration]) => declaration.startsWith('Product '))
    assert.match(productRelation[1], /fields:\s*\[productId\],\s*references:\s*\[id\]/)
  }
}

const audienceSchema = /^model ArticleProduct \{/m.test(schema) ? schema : schema.replace(/^model Product \{/m,
  'model Product {\n  articles ArticleProduct[]\n  versionArticles ArticleVersionProduct[]')
  .replace(/^model Article \{/m, 'model Article {\n  accessMode ArticleAccessMode?\n  products ArticleProduct[]')
  .replace(/^model ArticleVersion \{/m, 'model ArticleVersion {\n  accessMode ArticleAccessMode?\n  products ArticleVersionProduct[]') + `
enum ArticleAccessMode {
  PUBLIC
  PAID_PRODUCT
}
model ArticleProduct {
  articleId String
  productId String @db.VarChar(191)
  article Article @relation(fields: [articleId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  product Product @relation(fields: [productId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  @@id([articleId, productId])
  @@index([productId])
}
model ArticleVersionProduct {
  articleId String
  versionId String
  productId String @db.VarChar(191)
  version ArticleVersion @relation(fields: [articleId, versionId], references: [articleId, id], onDelete: Restrict, onUpdate: Restrict)
  product Product @relation(fields: [productId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  @@id([versionId, productId])
  @@index([articleId, versionId])
  @@index([productId])
}
`

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
  assertProductBoundary(schema)
  assert.deepEqual([...columns.keys()], names)
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

test('PERSIST-03: Product permits only audience reverse relations, not commercial or runtime binding', () => {
  assertProductBoundary(schema)
  assert.doesNotMatch(product, /@relation|@@index/)
  assert.doesNotMatch(executableSql, /`(?:Article|ArticleVersion|ProductPlan|Subscription|User|publishedVersionId|accessMode)`/)
})

test('PERSIST-03 compatibility: typed audience edges preserve the six Product scalars', () => {
  assertProductBoundary(audienceSchema)
})

test('PERSIST-03 negative controls: reject extra scalars, FK fields and unrelated relations', () => {
  for (const declaration of [
    'price Int', 'productId String', 'entitled Boolean', 'plan ProductPlan[]',
    'users User[]', 'subscription Subscription?', 'other ArticleProduct[]',
    'retained ArticleVersionProduct[]', 'article ArticleProduct?',
  ]) {
    const invalid = audienceSchema.replace(/^model Product \{/m, `model Product {\n  ${declaration}`)
    assert.throws(() => assertProductBoundary(invalid), assert.AssertionError, declaration)
  }
  for (const edge of ['ArticleProduct', 'ArticleVersionProduct']) {
    const invalid = audienceSchema.replace(`model ${edge} {`, `model ${edge} {\n  name String`)
    assert.throws(() => assertProductBoundary(invalid), assert.AssertionError, `${edge} is not a catalog`)
  }
  for (const model of ['ProductPlan', 'Subscription']) {
    assert.throws(() => assertProductBoundary(`${audienceSchema}\nmodel ${model} {\n  id String @id\n}\n`),
      assert.AssertionError, model)
  }
})
