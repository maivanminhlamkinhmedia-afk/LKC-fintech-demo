import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Static declaration checks only. No DB connection or simulated SQL execution:
// cross-Article inserts, duplicate enforcement and RESTRICT need real DB proof.
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const sql = readFileSync(new URL('../prisma/migrations/20261009190000_cms_article_audience/migration.sql', import.meta.url), 'utf8')
const compact = value => value.replace(/\s+/g, ' ').trim()
const q = name => '\x60' + name + '\x60'
const cols = names => names.map(q).join(', ')

function block(candidate, kind, name) {
  const matches = [...candidate.matchAll(new RegExp('^' + kind + ' ' + name + ' \\{([\\s\\S]*?)^\\}', 'gm'))]
  assert.equal(matches.length, 1, 'exactly one ' + kind + ' ' + name)
  return matches[0][1].split(/\r?\n/).map(line => compact(line.replace(/\/\/.*$/, ''))).filter(Boolean)
}
function fields(candidate, name) {
  const entries = block(candidate, 'model', name).filter(line => !line.startsWith('@@')).map(line => {
    const space = line.indexOf(' ')
    assert.ok(space > 0)
    return [line.slice(0, space), line.slice(space + 1)]
  })
  assert.equal(new Set(entries.map(([name]) => name)).size, entries.length, 'no repeated fields')
  return new Map(entries)
}
function statements(candidate) {
  return candidate.replace(/--[^\n]*/g, '').split(';').map(compact).filter(Boolean)
}
function table(candidate, name) {
  const matches = statements(candidate).filter(value => value.startsWith('CREATE TABLE ' + q(name) + ' '))
  assert.equal(matches.length, 1, 'one new table ' + name)
  const match = matches[0].match(new RegExp('^CREATE TABLE ' + q(name) + ' \\((.*)\\) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci$'))
  assert.ok(match, 'explicit matching character set/collation')
  const entries = []
  let start = 0, depth = 0
  for (let i = 0; i < match[1].length; i++) {
    const char = match[1][i]
    if (char === '(') depth++
    if (char === ')') depth--
    assert.ok(depth >= 0, 'balanced SQL definition')
    if (char === ',' && depth === 0) {
      entries.push(compact(match[1].slice(start, i)))
      start = i + 1
    }
  }
  assert.equal(depth, 0)
  entries.push(compact(match[1].slice(start)))
  return entries
}
function relation(target, local, remote) {
  return target + ' @relation(fields: [' + local.join(', ') + '], references: [' + remote.join(', ')
    + '], onDelete: Restrict, onUpdate: Restrict)'
}
function assertModes(candidate, ddl) {
  assert.deepEqual(block(candidate, 'enum', 'ArticleAccessMode'), ['PUBLIC', 'PAID_PRODUCT'])
  for (const name of ['Article', 'ArticleVersion']) {
    assert.equal(fields(candidate, name).get('accessMode'), 'ArticleAccessMode?')
    assert.deepEqual(statements(ddl).filter(value => value.startsWith('ALTER TABLE ' + q(name) + ' ')), [
      'ALTER TABLE ' + q(name) + ' ADD COLUMN ' + q('accessMode') + " ENUM('PUBLIC', 'PAID_PRODUCT') NULL",
    ])
  }
}
function assertWorking(candidate, ddl) {
  const edge = fields(candidate, 'ArticleProduct')
  assert.deepEqual([...edge.keys()], ['articleId', 'productId', 'article', 'product'])
  assert.equal(edge.get('articleId'), 'String')
  assert.equal(edge.get('productId'), 'String @db.VarChar(191)')
  assert.equal(edge.get('article'), relation('Article', ['articleId'], ['id']))
  assert.equal(edge.get('product'), relation('Product', ['productId'], ['id']))
  assert.deepEqual(block(candidate, 'model', 'ArticleProduct').filter(line => line.startsWith('@@')),
    ['@@id([articleId, productId])', '@@index([productId])'])
  assert.equal(fields(candidate, 'Article').get('products'), 'ArticleProduct[]')
  assert.deepEqual(table(ddl, 'ArticleProduct'), [
    q('articleId') + ' VARCHAR(191) NOT NULL', q('productId') + ' VARCHAR(191) NOT NULL',
    'INDEX ' + q('ArticleProduct_productId_idx') + '(' + cols(['productId']) + ')',
    'PRIMARY KEY (' + cols(['articleId', 'productId']) + ')',
  ])
}
function assertVersion(candidate, ddl) {
  const edge = fields(candidate, 'ArticleVersionProduct')
  assert.deepEqual([...edge.keys()], ['articleId', 'versionId', 'productId', 'version', 'product'])
  assert.equal(edge.get('articleId'), 'String')
  assert.equal(edge.get('versionId'), 'String')
  assert.equal(edge.get('productId'), 'String @db.VarChar(191)')
  assert.equal(edge.get('version'), relation('ArticleVersion', ['articleId', 'versionId'], ['articleId', 'id']))
  assert.equal(edge.get('product'), relation('Product', ['productId'], ['id']))
  assert.deepEqual(block(candidate, 'model', 'ArticleVersionProduct').filter(line => line.startsWith('@@')),
    ['@@id([versionId, productId])', '@@index([articleId, versionId])', '@@index([productId])'])
  assert.equal(fields(candidate, 'ArticleVersion').get('products'), 'ArticleVersionProduct[]')
  assert.ok(block(candidate, 'model', 'ArticleVersion').includes('@@unique([articleId, id])'))
  assert.ok(block(candidate, 'model', 'ArticleVersion').includes('@@unique([articleId, versionNumber])'))
  assert.deepEqual(table(ddl, 'ArticleVersionProduct'), [
    q('articleId') + ' VARCHAR(191) NOT NULL', q('versionId') + ' VARCHAR(191) NOT NULL',
    q('productId') + ' VARCHAR(191) NOT NULL',
    'INDEX ' + q('ArticleVersionProduct_articleId_versionId_idx') + '(' + cols(['articleId', 'versionId']) + ')',
    'INDEX ' + q('ArticleVersionProduct_productId_idx') + '(' + cols(['productId']) + ')',
    'PRIMARY KEY (' + cols(['versionId', 'productId']) + ')',
  ])
}
function assertForeignKeys(ddl) {
  const actual = statements(ddl).filter(value => value.includes(' ADD CONSTRAINT '))
  const expected = [
    ['ArticleProduct', ['articleId'], 'Article', ['id']],
    ['ArticleProduct', ['productId'], 'Product', ['id']],
    ['ArticleVersionProduct', ['articleId', 'versionId'], 'ArticleVersion', ['articleId', 'id']],
    ['ArticleVersionProduct', ['productId'], 'Product', ['id']],
  ].map(([owner, local, target, remote]) => 'ALTER TABLE ' + q(owner) + ' ADD CONSTRAINT '
    + q(owner + '_' + local.join('_') + '_fkey') + ' FOREIGN KEY (' + cols(local)
    + ') REFERENCES ' + q(target) + '(' + cols(remote) + ') ON DELETE RESTRICT ON UPDATE RESTRICT')
  assert.deepEqual(actual.sort(), expected.sort(), 'four exact identity/retention FKs')
}
function assertExpandOnly(ddl) {
  const parts = statements(ddl)
  assert.equal(parts.length, 8, 'two nullable additions, two tables, four FKs; no data rewrite')
  for (const part of parts) {
    assert.ok(
      /^ALTER TABLE \x60(?:Article|ArticleVersion)\x60 ADD COLUMN \x60accessMode\x60 /.test(part)
      || /^CREATE TABLE \x60(?:ArticleProduct|ArticleVersionProduct)\x60 /.test(part)
      || /^ALTER TABLE \x60(?:ArticleProduct|ArticleVersionProduct)\x60 ADD CONSTRAINT /.test(part),
      'no unrelated DDL, DML, seed or backfill')
  }
}
function assertProduct(candidate) {
  assert.deepEqual([...fields(candidate, 'Product')], [
    ['id', 'String @id @default(cuid()) @db.VarChar(191)'],
    ['name', 'String @db.VarChar(191)'],
    ['contentState', 'ProductContentState @default(UNSELECTABLE)'],
    ['saleStopped', 'Boolean @default(true)'],
    ['createdAt', 'DateTime @default(now()) @db.DateTime(3)'],
    ['updatedAt', 'DateTime @updatedAt @db.DateTime(3)'],
    ['articles', 'ArticleProduct[]'], ['versionArticles', 'ArticleVersionProduct[]'],
  ])
  assert.doesNotMatch(candidate, /^model (?:ProductPlan|Subscription|Entitlement)\b/m)
}
function changed(value, before, after) {
  assert.ok(value.includes(before), 'negative control must change an existing declaration')
  const result = value.replace(before, after)
  assert.notEqual(result, value)
  return result
}

function rejectsChange(check, candidate, before, after) {
  // Construct and verify the mutation outside assert.throws: a missing anchor
  // must fail this test, not masquerade as a successful negative control.
  const invalid = changed(candidate, before, after)
  assert.throws(() => check(invalid), assert.AssertionError)
}

test('AUDPHY-01: legacy audience is nullable without a PUBLIC default in Prisma and SQL', () => {
  assertModes(schema, sql)
})
test('AUDPHY-01 negative controls: defaulted/non-null mode and extra enum values are rejected', () => {
  for (const bad of ['ArticleAccessMode @default(PUBLIC)', 'ArticleAccessMode? @default(PUBLIC)', 'ArticleAccessMode']) {
    for (const name of ['Article', 'ArticleVersion']) {
      const start = schema.indexOf('model ' + name + ' {'), end = schema.indexOf('\n}', start)
      const original = schema.slice(start, end)
      const invalid = changed(original, 'ArticleAccessMode?', bad)
      assert.throws(() => assertModes(schema.replace(original, invalid), sql), assert.AssertionError)
    }
  }
  rejectsChange(value => assertModes(value, sql), schema, 'enum ArticleAccessMode {', 'enum ArticleAccessMode {\n  STAFF')
  for (const bad of ["ENUM('PUBLIC', 'PAID_PRODUCT') NOT NULL", "ENUM('PUBLIC', 'PAID_PRODUCT') NULL DEFAULT 'PUBLIC'"]) {
    rejectsChange(value => assertModes(schema, value), sql, "ENUM('PUBLIC', 'PAID_PRODUCT') NULL", bad)
  }
})
test('AUDPHY-02: working edges contain only required stable IDs, compound PK and Product index', () => {
  assertWorking(schema, sql)
})
test('AUDPHY-03: version edges retain same-Article binding, independent compound key and indexes', () => {
  assertVersion(schema, sql)
  assertForeignKeys(sql)
})
test('AUDPHY-02/03 negative controls: weakened keys, nullable IDs and missing indexes are rejected', () => {
  for (const [check, before, after] of [
    [assertWorking, '@@id([articleId, productId])', '@@id([articleId])'],
    [assertWorking, 'model ArticleProduct {\n  articleId String', 'model ArticleProduct {\n  articleId String?'],
    [assertVersion, '@@id([versionId, productId])', '@@id([versionId])'],
    [assertVersion, '@@unique([articleId, id])', '@@unique([id])'],
    [assertVersion, '@@index([articleId, versionId])\n  @@index([productId])', '@@index([productId])'],
  ]) rejectsChange(value => check(value, sql), schema, before, after)
  for (const [check, before, after] of [
    [assertWorking, 'PRIMARY KEY (' + cols(['articleId', 'productId']) + ')', 'PRIMARY KEY (' + q('articleId') + ')'],
    [assertVersion, 'PRIMARY KEY (' + cols(['versionId', 'productId']) + ')', 'PRIMARY KEY (' + q('versionId') + ')'],
    [assertVersion, 'INDEX ' + q('ArticleVersionProduct_articleId_versionId_idx'), 'INDEX ' + q('wrong_index')],
  ]) rejectsChange(value => check(schema, value), sql, before, after)
})
test('AUDPHY-03 negative controls: versionId-only or wrong-Article bindings are rejected statically', () => {
  const original = relation('ArticleVersion', ['articleId', 'versionId'], ['articleId', 'id'])
  const start = schema.indexOf('model ArticleVersionProduct {'), edge = schema.slice(start)
  for (const bad of [
    relation('ArticleVersion', ['versionId'], ['id']),
    relation('ArticleVersion', ['articleId', 'versionId'], ['id', 'articleId']),
    relation('Article', ['articleId', 'versionId'], ['articleId', 'id']),
  ]) {
    rejectsChange(value => assertVersion(schema.slice(0, start) + value, sql), edge, original, bad)
  }
  const binding = 'FOREIGN KEY (' + cols(['articleId', 'versionId']) + ') REFERENCES '
    + q('ArticleVersion') + '(' + cols(['articleId', 'id']) + ')'
  for (const bad of [
    'FOREIGN KEY (' + q('versionId') + ') REFERENCES ' + q('ArticleVersion') + '(' + q('id') + ')',
    'FOREIGN KEY (' + cols(['articleId', 'versionId']) + ') REFERENCES ' + q('ArticleVersion') + '(' + cols(['id', 'articleId']) + ')',
  ]) rejectsChange(assertForeignKeys, sql, binding, bad)
})
test('AUDPHY-03: all four FKs declare RESTRICT delete/update; weaker actions fail the static oracle', () => {
  assertForeignKeys(sql)
  for (const axis of ['DELETE', 'UPDATE']) {
    for (const action of ['CASCADE', 'SET NULL', 'NO ACTION']) {
      rejectsChange(assertForeignKeys, sql, 'ON ' + axis + ' RESTRICT', 'ON ' + axis + ' ' + action)
    }
  }
  for (const [name, check] of [['ArticleProduct', assertWorking], ['ArticleVersionProduct', assertVersion]]) {
    const start = schema.indexOf('model ' + name + ' {'), end = schema.indexOf('\n}', start)
    const original = schema.slice(start, end)
    for (const axis of ['onDelete', 'onUpdate']) {
      const invalid = changed(original, axis + ': Restrict', axis + ': Cascade')
      assert.throws(() => check(schema.replace(original, invalid), sql), assert.AssertionError)
    }
  }
})
test('AUDPHY-04: migration is expand-only and does not rewrite legacy content, tokens, status or approvals', () => {
  assertExpandOnly(sql)
  assertModes(schema, sql)
  assertWorking(schema, sql)
  assertVersion(schema, sql)
  assertForeignKeys(sql)
})
test('AUDPHY-04 negative controls: backfill, unrelated alteration or missing statements are rejected', () => {
  for (const extra of [
    'UPDATE ' + q('Article') + ' SET ' + q('accessMode') + " = 'PUBLIC';",
    'ALTER TABLE ' + q('Article') + ' DROP COLUMN ' + q('activeApprovalVersionId') + ';',
    'DELETE FROM ' + q('ArticleReview') + ';',
  ]) assert.throws(() => assertExpandOnly(sql + '\n' + extra), assert.AssertionError)
  const parts = statements(sql)
  assert.throws(() => assertExpandOnly(parts.slice(1).join(';') + ';'), assert.AssertionError)
  assert.throws(() => assertExpandOnly(parts.slice(0, -1).concat('UPDATE ' + q('Article') + ' SET ' + q('updatedAt') + ' = NOW()').join(';')), assert.AssertionError)
})
test('AUDPHY-05: Product retains six scalar fields and only two audience reverse relations', () => {
  assertProduct(schema)
  for (const extra of ['price Int', 'access Boolean', 'plans ProductPlan[]']) {
    rejectsChange(assertProduct, schema, 'model Product {', 'model Product {\n  ' + extra)
  }
  rejectsChange(assertProduct, schema, '@default(UNSELECTABLE)', '@default(SELECTABLE)')
})
