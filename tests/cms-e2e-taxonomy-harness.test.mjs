import assert from 'node:assert/strict'
import test from 'node:test'
import { createFixturePlan, validateManifest, createFixtures, catalogCreateData, reserveCatalogIntent,
  discoverFixtureGraph, discoverCreatedSources, fixturePreflight, fixtureCatalog, fixtureClassification,
  cleanupFixtures, remainingCounts, alterFixture } from '../scripts/cms-e2e/fixtures.mjs'
import { CATALOG_MODELS, MAPPING_MODELS, seedCatalogData } from '../scripts/cms-e2e/taxonomy-fixtures.mjs'
import { cleanupConfirmedFixtures } from '../scripts/cms-e2e/run.mjs'

// In-memory transaction/query adapters only. No Prisma/socket/DB/browser/fixtures
// CLI or environment file is used. Real13-counter cleanup remains staging work.
const env = { E2E_BASE_URL: 'http://127.0.0.1:3001', NEXTAUTH_URL: 'http://127.0.0.1:3001',
  DATABASE_URL: 'mysql://edpmjmha_lkcstg:TEST_ONLY_PASSWORD@127.0.0.1:3307/edpmjmha_lkcstage' }
const runId = '0123456789abcdef01234567', date = new Date('2026-09-28T00:00:00.001Z')
const clone = value => structuredClone(value)
const zero = { articles: 0, profiles: 0, users: 0, logs: 0, sources: 0, categories: 0, topics: 0, tags: 0,
  instruments: 0, categoryLinks: 0, topicMappings: 0, tagMappings: 0, articleInstruments: 0 }
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(part => matches(row, part))
    if (key === 'OR') return value.some(part => matches(row, part))
    if (value instanceof Date) return row[key]?.getTime() === value.getTime()
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key])
      if ('not' in value) return row[key] !== value.not
    }
    return row[key] === value
  })
}
function setup(options = {}) {
  const manifest = createFixturePlan(runId, options.version ?? 3)
  const state = { user: manifest.users.map(row => ({ ...row, status: 'ACTIVE', customerProfile: null, extraCounts: {} })),
    article: manifest.articles.map(row => ({ ...row, title: 'Synthetic body owner', categoryId: null, editorId: null, coverMediaId: null,
      updatedAt: date, editorSchemaVersion: 1, extraCounts: {} })), sourceReference: [], authorProfile: [], auditLog: [],
    articleCategory: [], articleTopic: [], articleTag: [], financialInstrument: [], articleTopicMapping: [], articleTagMapping: [], articleInstrument: [] }
  for (const row of manifest.catalogs ?? []) state[CATALOG_MODELS[row.kind]].push({ ...seedCatalogData(manifest, row), createdAt: date, updatedAt: date })
  if (options.empty) for (const key of Object.keys(state)) state[key] = []
  const calls = []; let committed = false
  function rowWithCounts(model, row) {
    if (model === 'article') return { ...row, _count: { sources: state.sourceReference.filter(source => source.articleId === row.id).length,
      topics: state.articleTopicMapping.filter(pair => pair.articleId === row.id).length,
      tags: state.articleTagMapping.filter(pair => pair.articleId === row.id).length,
      instruments: state.articleInstrument.filter(pair => pair.articleId === row.id).length,
      versions: 0, ...row.extraCounts } }
    if (model === 'user') return { ...row, _count: { sourceReferencesCreated: state.sourceReference.filter(source => source.createdById === row.id).length,
      articlesAuthored: state.article.filter(article => article.authorId === row.id).length, auditLogs: 0, ...row.extraCounts } }
    return row
  }
  const db = { async $queryRaw() { calls.push(['identity']); return [{ databaseName: 'edpmjmha_lkcstage', databaseUser: 'edpmjmha_lkcstg@localhost' }] },
    async $transaction(work, opts) {
      calls.push(['transaction', opts]); const before = clone(state)
      try { const result = await work(db); committed = true; calls.push(['commit']); return result }
      catch (error) { Object.assign(state, before); calls.push(['rollback']); throw error }
    } }
  for (const model of Object.keys(state)) db[model] = {
    async findMany(args) {
      calls.push([`${model}.findMany`, clone(args)])
      const rows = state[model].filter(row => matches(row, args.where)).map(row => rowWithCounts(model, row))
      if (args.orderBy) rows.sort((a, b) => {
        for (const field of Object.keys(args.orderBy)) { const cmp = String(a[field]).localeCompare(String(b[field])); if (cmp) return cmp }
        return 0
      })
      return clone(args.select ? rows.map(row => Object.fromEntries(Object.keys(args.select).map(key => [key, row[key]]))) : rows)
    },
    async findFirst(args) { return (await this.findMany(args))[0] ?? null },
    async findUnique(args) { return (await this.findMany(args))[0] ?? null },
    async count(args) {
      calls.push([`${model}.count`, clone(args)])
      const counter = model === 'article' && JSON.stringify(args.where).includes('categoryId') ? 'categoryLinks'
        : { article: 'articles', user: 'users', authorProfile: 'profiles', auditLog: 'logs', sourceReference: 'sources',
          articleCategory: 'categories', articleTopic: 'topics', articleTag: 'tags', financialInstrument: 'instruments',
          articleTopicMapping: 'topicMappings', articleTagMapping: 'tagMappings', articleInstrument: 'articleInstruments' }[model]
      if (options.leftover === counter && (!options.postOnly || committed)) return 1
      return state[model].filter(row => matches(row, args.where)).length
    },
    async createMany(args) { calls.push([`${model}.createMany`, clone(args)]); state[model].push(...clone(args.data)); return { count: args.data.length } },
    async updateMany(args) {
      calls.push([`${model}.updateMany`, clone(args)])
      const rows = state[model].filter(row => matches(row, args.where)); for (const row of rows) Object.assign(row, clone(args.data))
      return { count: options.badCount === model ? 0 : rows.length }
    },
    async deleteMany(args) {
      assert.ok(args.where && Object.keys(args.where).length, 'deletions must have exact conditions')
      calls.push([`${model}.deleteMany`, clone(args)])
      if (options.deleteFailure === model) throw new Error('Synthetic delete failure')
      const rows = state[model].filter(row => matches(row, args.where)); state[model] = state[model].filter(row => !matches(row, args.where))
      return { count: options.badCount === model ? 0 : rows.length }
    },
  }
  return { manifest, state, calls, db }
}
const writes = fixture => fixture.calls.filter(([name]) => /\.(createMany|updateMany|deleteMany)$/.test(name))
const seed = (fixture, kind, seedKey = 'seed-01') => fixture.manifest.catalogs.find(row => row.kind === kind && row.seedKey === seedKey)
async function attach(fixture, { journal = true } = {}) {
  const { manifest, state } = fixture, articleId = manifest.articles[0].id
  const categoryId = seed(fixture, 'category').id
  state.article[0].categoryId = categoryId
  if (journal) manifest.categoryLinks.push({ articleId, categoryId })
  for (const [field, [model, termKey, kind]] of Object.entries(MAPPING_MODELS)) {
    const pair = { articleId, [termKey]: seed(fixture, kind).id }
    state[model].push({ ...pair, ...(kind === 'instrument' ? { isPrimary: true } : {}) })
    if (journal) manifest[field].push(pair)
  }
}
async function reserve(fixture, kind = 'category', key = 'ui-create', overrides = {}) {
  const expected = catalogCreateData(fixture.manifest, kind, key, overrides)
  await reserveCatalogIntent(fixture.db, env, fixture.manifest, kind, key, expected, async () => {})
  return expected
}
function created(fixture, kind, expected, id = 'cui-created-catalog') {
  const row = { ...expected, id, createdAt: date, updatedAt: date }
  if (kind === 'instrument') row.canonicalKey = ['FX', 'CRYPTO'].includes(row.instrumentType) ? `${row.instrumentType}:${row.symbol}` : row.exchange ? `${row.exchange}:${row.symbol}` : row.symbol
  fixture.state[CATALOG_MODELS[kind]].push(row); return row
}

test('TAX-32 v3 seeds exact run identities and strict journals cannot expand into production catalogs', () => {
  const fixture = setup(), { manifest } = fixture
  assert.equal(manifest.version, 3); assert.equal(manifest.catalogs.length, 108)
  for (const [kind, model] of Object.entries(CATALOG_MODELS)) {
    assert.equal(fixture.state[model].length, 27)
    if (kind !== 'tag') assert.equal(fixture.state[model].filter(row => !row.isActive).length, 1)
  }
  for (const mutate of [m => { m.unknown = true }, m => { m.catalogs[0].id = 'production-id' },
    m => { m.catalogs[0].identity.slug = 'production-slug' }, m => { m.catalogs.push(m.catalogs[0]) },
    m => { m.catalogs.pop() }, m => { m.topicMappings.push({ articleId: m.articles[0].id, topicId: 'foreign' }) }]) {
    const invalid = clone(manifest); mutate(invalid); assert.throws(() => validateManifest(invalid))
  }
})

test('TAX-32 seed creates precheck all identities and commit catalogs users and articles atomically', async () => {
  const f = setup({ empty: true }); await createFixtures(f.db, env, f.manifest, async () => 'synthetic-hash')
  assert.equal(f.state.user.length, 6); assert.equal(f.state.article.length, 12)
  for (const model of Object.values(CATALOG_MODELS)) assert.equal(f.state[model].length, 27)
  const firstWrite = f.calls.findIndex(([name]) => name.endsWith('.createMany'))
  for (const model of Object.values(CATALOG_MODELS)) assert.ok(f.calls.findIndex(([name]) => name === `${model}.count`) < firstWrite)
  assert.equal(f.calls[0][1].isolationLevel, 'Serializable')
  for (const kind of Object.keys(CATALOG_MODELS)) {
    const collision = setup({ empty: true }); collision.state[CATALOG_MODELS[kind]].push(seedCatalogData(collision.manifest, seed(collision, kind)))
    const before = clone(collision.state)
    await assert.rejects(createFixtures(collision.db, env, collision.manifest, async () => 'hash'), /FIXTURE_CATALOG_ALREADY_EXISTS/)
    assert.deepEqual(collision.state, before); assert.deepEqual(writes(collision), [])
  }
})

test('TAX-32 reservation proves exact absence and persists before assigning an intent in memory', async () => {
  const f = setup(), expected = catalogCreateData(f.manifest, 'category', 'ui-new')
  let persisted
  await reserveCatalogIntent(f.db, env, f.manifest, 'category', 'ui-new', expected, async value => {
    assert.equal(f.manifest.catalogIntents.length, 0); persisted = clone(value)
  })
  assert.equal(persisted.catalogIntents[0].absent, true); assert.deepEqual(writes(f), [])
  assert.deepEqual(f.calls.filter(([name]) => name === 'articleCategory.count').at(-1)[1].where, { slug: expected.slug })
  await assert.rejects(reserveCatalogIntent(f.db, env, f.manifest, 'category', 'ui-new', expected, async () => {}), /CATALOG_INTENT_DUPLICATE/)
  const blocked = setup(), collision = catalogCreateData(blocked.manifest, 'topic', 'ui-collision')
  created(blocked, 'topic', collision, 'preexisting-id')
  await assert.rejects(reserveCatalogIntent(blocked.db, env, blocked.manifest, 'topic', 'ui-collision', collision, async () => {}), /CATALOG_INTENT_COLLISION/)
  assert.equal(blocked.manifest.catalogIntents.length, 0)
})

test('TAX-22/32 lost ACK recovers all kinds only from pre-reserved exact identities and initial metadata', async () => {
  for (const kind of Object.keys(CATALOG_MODELS)) {
    const f = setup(), expected = await reserve(f, kind)
    const row = created(f, kind, expected)
    await discoverFixtureGraph(f.db, env, f.manifest, async () => {})
    assert.equal(f.manifest.catalogs.some(entry => entry.id === row.id && entry.kind === kind), true)
    row.name = 'Legitimate subsequent UI rename'
    await discoverFixtureGraph(f.db, env, f.manifest, async () => {})
    assert.equal((await fixtureCatalog(f.db, f.manifest, kind, row.id)).name, row.name)
    assert.equal(f.manifest.catalogs.filter(entry => entry.id === row.id).length, 1)
    const queries = f.calls.filter(([name]) => name === `${CATALOG_MODELS[kind]}.findMany`)
    assert.ok(queries.some(([, args]) => JSON.stringify(args.where).includes(row.id)))
    assert.ok(queries.every(([, args]) => !JSON.stringify(args.where).includes('startsWith')))
  }
})

test('TAX-32 unconfirmed metadata mismatch and known key or tuple drift stop adoption/deletion', async () => {
  for (const mode of ['initial-metadata', 'known-key', 'known-id-replaced', 'instrument-tuple']) {
    const f = setup(), kind = mode === 'instrument-tuple' ? 'instrument' : 'category'
    const expected = await reserve(f, kind), row = created(f, kind, expected)
    if (mode !== 'initial-metadata') await discoverFixtureGraph(f.db, env, f.manifest, async () => {})
    if (mode === 'initial-metadata') row.name = 'Other initial writer'
    if (mode === 'known-key') row.slug = 'unrelated-key'
    if (mode === 'known-id-replaced') row.id = 'replacement-row'
    if (mode === 'instrument-tuple') row.exchange = 'OTHER'
    const journal = clone(f.manifest)
    await assert.rejects(discoverFixtureGraph(f.db, env, f.manifest, async () => {}))
    assert.deepEqual(f.manifest.catalogs, journal.catalogs)
    await assert.rejects(cleanupFixtures(f.db, env, f.manifest, { apply: true }))
    assert.deepEqual(writes(f), [])
  }
})

test('TAX-32 journal failures leave reservations and recovered IDs unchanged and block cleanup', async () => {
  const f = setup(), expected = catalogCreateData(f.manifest, 'tag', 'ui-persist')
  await assert.rejects(reserveCatalogIntent(f.db, env, f.manifest, 'tag', 'ui-persist', expected, async () => { throw new Error('journal') }), /journal/)
  assert.deepEqual(f.manifest.catalogIntents, [])
  await reserve(f, 'tag', 'ui-persist'); created(f, 'tag', expected)
  await assert.rejects(discoverFixtureGraph(f.db, env, f.manifest, async value => {
    if (value.catalogs.some(row => row.seedKey === null)) throw new Error('journal')
  }), /journal/)
  assert.equal(f.manifest.catalogs.some(row => row.seedKey === null), false)
  await assert.rejects(cleanupFixtures(f.db, env, f.manifest, { apply: true }))
  assert.deepEqual(writes(f), [])
})

test('TAX-32 reserved tombstones cannot reuse a key or adopt its replacement ID', async () => {
  const f = setup(), expected = await reserve(f, 'tag'), row = created(f, 'tag', expected)
  await discoverFixtureGraph(f.db, env, f.manifest, async () => {})
  f.state.articleTag = f.state.articleTag.filter(entry => entry.id !== row.id)
  await discoverFixtureGraph(f.db, env, f.manifest, async () => {})
  assert.ok(f.manifest.catalogs.some(entry => entry.id === row.id))
  await assert.rejects(reserveCatalogIntent(f.db, env, f.manifest, 'tag', 'ui-create', expected, async () => {}))
  created(f, 'tag', expected, 'new-id-for-old-key')
  await assert.rejects(discoverFixtureGraph(f.db, env, f.manifest, async () => {}), /CATALOG_KNOWN_KEY_REPLACED/)
})

test('TAX-32 assignment lost ACK recovers exact composite/category edges without changing isPrimary identity', async () => {
  const f = setup(); await attach(f, { journal: false })
  await assert.rejects(fixturePreflight(f.db, f.manifest), /MAPPING_NOT_IN_MANIFEST/)
  await discoverCreatedSources(f.db, env, f.manifest, async () => {})
  for (const field of ['categoryLinks', ...Object.keys(MAPPING_MODELS)]) assert.equal(f.manifest[field].length, 1)
  f.state.articleInstrument[0].isPrimary = false
  await discoverFixtureGraph(f.db, env, f.manifest, async () => {})
  const snapshot = await fixtureClassification(f.db, f.manifest, f.manifest.articles[0].id)
  assert.equal(snapshot.articleInstruments[0].isPrimary, false)
  assert.deepEqual(f.manifest.articleInstruments[0], { articleId: f.manifest.articles[0].id, instrumentId: seed(f, 'instrument').id })
})

test('TAX-32 category reverse edges and all mapping directions reject foreign endpoints before journal or write', async () => {
  for (const kind of Object.keys(CATALOG_MODELS)) for (const direction of ['foreign-article', 'foreign-catalog']) {
    const f = setup(), articleId = f.manifest.articles[0].id, catalogId = seed(f, kind).id
    const actualArticle = direction === 'foreign-article' ? 'outside-article' : articleId
    const actualCatalog = direction === 'foreign-catalog' ? 'outside-catalog' : catalogId
    if (kind === 'category') {
      if (direction === 'foreign-article') f.state.article.push({ id: actualArticle, authorId: 'outside-owner', categoryId: actualCatalog })
      else f.state.article[0].categoryId = actualCatalog
    } else {
      const [, [model, key]] = Object.entries(MAPPING_MODELS).find(([, [, , modelKind]]) => kind === modelKind)
      f.state[model].push({ articleId: actualArticle, [key]: actualCatalog })
    }
    await assert.rejects(discoverFixtureGraph(f.db, env, f.manifest, async () => {}), /TAXONOMY_ENDPOINT_OUTSIDE_FIXTURE/)
    await assert.rejects(cleanupFixtures(f.db, env, f.manifest, { apply: true }))
    assert.equal(f.manifest.categoryLinks.length + f.manifest.topicMappings.length + f.manifest.tagMappings.length + f.manifest.articleInstruments.length, 0)
    assert.deepEqual(writes(f), [])
  }
})

test('TAX-32 a single invalid recovery graph prevents journaling any valid catalog in the same batch', async () => {
  const f = setup(), expected = await reserve(f), row = created(f, 'category', expected)
  f.state.article.push({ id: 'foreign-article', authorId: 'foreign-owner', categoryId: row.id })
  await assert.rejects(discoverFixtureGraph(f.db, env, f.manifest, async () => {}), /TAXONOMY_ENDPOINT_OUTSIDE_FIXTURE/)
  assert.equal(f.manifest.catalogs.length, 108)
})

test('TAX-32 article counts must match exact approved mappings and unrelated relations remain forbidden', async () => {
  for (const extra of [{ topics: 2 }, { tags: 0 }, { instruments: 0 }, { versions: 1 }]) {
    const f = setup(); await attach(f); f.state.article[0].extraCounts = extra
    await assert.rejects(cleanupFixtures(f.db, env, f.manifest, { apply: true }), /ARTICLE_HAS_UNEXPECTED_RELATIONS/)
    assert.deepEqual(writes(f), [])
  }
})

test('TAX-32 cleanup deletes exact edges before parents then catalogs and verifies all13 counters twice', async () => {
  const f = setup(); await attach(f)
  f.state.sourceReference.push({ id: 'source-a', articleId: f.manifest.articles[0].id, createdById: f.manifest.users[0].id })
  f.manifest.sources.push(clone(f.state.sourceReference[0]))
  f.state.articleCategory.push({ id: 'outside-category', slug: 'outside-slug', name: 'Leave this alone' })
  const untouched = clone(f.state.articleCategory.at(-1))
  const before = clone(f.state); const counts = await cleanupFixtures(f.db, env, f.manifest)
  assert.equal(counts.categoryLinks, 1); assert.equal(counts.categories, 27); assert.deepEqual(f.state, before); assert.deepEqual(writes(f), [])
  f.calls.length = 0
  assert.deepEqual(await cleanupFixtures(f.db, env, f.manifest, { apply: true }), zero)
  const work = writes(f)
  assert.equal(work[0][0], 'sourceReference.deleteMany')
  assert.ok(work.findIndex(([name]) => name === 'articleInstrument.deleteMany') < work.findIndex(([name]) => name === 'article.deleteMany'))
  assert.ok(work.findIndex(([name]) => name === 'article.updateMany') < work.findIndex(([name]) => name === 'article.deleteMany'))
  assert.ok(work.findIndex(([name]) => name === 'user.deleteMany') < work.findIndex(([name]) => name === 'articleCategory.deleteMany'))
  assert.deepEqual(f.state.articleCategory, [untouched])
  for (const model of ['sourceReference', ...Object.values(CATALOG_MODELS), ...Object.values(MAPPING_MODELS).map(row => row[0])]) {
    assert.equal(f.calls.filter(([name]) => name === `${model}.count`).length, 2)
  }
  for (const [name, args] of work.filter(([name]) => Object.values(CATALOG_MODELS).some(model => name === `${model}.deleteMany`))) {
    for (const identity of args.where.OR) {
      assert.equal(typeof identity.id, 'string')
      assert.ok(name === 'financialInstrument.deleteMany' ? identity.canonicalKey && identity.symbol : identity.slug)
    }
  }
})

test('TAX-32 partial/already-clean v3 journals keep tombstones and never delete unrelated catalogs', async () => {
  const f = setup(); await attach(f)
  await cleanupFixtures(f.db, env, f.manifest, { apply: true })
  f.calls.length = 0
  assert.deepEqual(await cleanupFixtures(f.db, env, f.manifest, { apply: true }), zero)
  assert.deepEqual(writes(f), []); assert.equal(f.manifest.catalogs.length, 108); assert.equal(f.manifest.categoryLinks.length, 1)
})

test('TAX-32 deletion or conditional count failures roll back mappings parent and every catalog', async () => {
  for (const model of ['articleTopicMapping', 'articleTagMapping', 'articleInstrument', 'articleCategory', 'articleTopic', 'articleTag', 'financialInstrument', 'article', 'user']) {
    const f = setup({ deleteFailure: model }); await attach(f); const before = clone(f.state)
    await assert.rejects(cleanupFixtures(f.db, env, f.manifest, { apply: true }), /Synthetic delete failure/)
    assert.deepEqual(f.state, before); assert.equal(f.calls.some(([name]) => name === 'commit'), false)
  }
  for (const model of ['article', 'articleTopicMapping', 'financialInstrument']) {
    const f = setup({ badCount: model }); await attach(f); const before = clone(f.state)
    await assert.rejects(cleanupFixtures(f.db, env, f.manifest, { apply: true }), /COUNT_MISMATCH/)
    assert.deepEqual(f.state, before)
  }
})

test('TAX-32 every one of13 nonzero counters blocks verification inside TX and after commit', async () => {
  for (const leftover of Object.keys(zero)) for (const postOnly of [false, true]) {
    const f = setup({ leftover, postOnly }); await attach(f); const before = clone(f.state)
    await assert.rejects(cleanupFixtures(f.db, env, f.manifest, { apply: true }), postOnly ? /FIXTURES_REMAIN_AFTER_COMMIT/ : /FIXTURES_REMAIN_IN_TRANSACTION/)
    if (!postOnly) assert.deepEqual(f.state, before)
    assert.equal(f.calls.some(([name]) => name === 'commit'), postOnly)
  }
})

test('TAX-32 counters discover unjournaled reserved creates and both relation endpoints', async () => {
  const f = setup(), expected = await reserve(f, 'tag'); created(f, 'tag', expected)
  f.state.articleTagMapping.push({ articleId: 'outside-article', tagId: seed(f, 'tag').id })
  f.state.articleTopicMapping.push({ articleId: f.manifest.articles[0].id, topicId: 'outside-topic' })
  const counts = await remainingCounts(f.db, f.manifest)
  assert.equal(counts.tags, 28); assert.equal(counts.tagMappings, 1); assert.equal(counts.topicMappings, 1)
})

test('TAX-32 legacy v1/v2 retain five counters and cannot gain taxonomy recovery or link cleanup', async () => {
  for (const version of [1, 2]) {
    const f = setup({ version })
    assert.throws(() => validateManifest({ ...f.manifest, catalogs: [] }), /LEGACY_TAXONOMY_NOT_AUTHORIZED/)
    assert.throws(() => validateManifest({ ...f.manifest, categoryLinks: [] }), /LEGACY_TAXONOMY_NOT_AUTHORIZED/)
    assert.equal(Object.keys(await cleanupFixtures(f.db, env, f.manifest)).length, 5)
    f.state.article[0].categoryId = 'not-authorized'
    await assert.rejects(discoverFixtureGraph(f.db, env, f.manifest, async () => {}), /ARTICLE_HAS_UNEXPECTED_RELATIONS/)
    await assert.rejects(cleanupFixtures(f.db, env, f.manifest, { apply: true }))
    assert.deepEqual(writes(f), [])
    await assert.rejects(reserveCatalogIntent(f.db, env, f.manifest, 'tag', 'ui-no', {}, async () => {}), /CATALOG_INTENT_NOT_AUTHORIZED/)
  }
})

test('TAX-32 v3 keeps source endpoint/known-ID protection across the expanded taxonomy graph', async () => {
  const f = setup(); await attach(f)
  f.manifest.sources.push({ id: 'source-old', articleId: f.manifest.articles[0].id, createdById: f.manifest.users[0].id })
  f.state.sourceReference.push({ id: 'source-old', articleId: 'outside-parent', createdById: 'outside-creator' })
  await assert.rejects(discoverFixtureGraph(f.db, env, f.manifest, async () => {}), /SOURCE_ENDPOINT_OUTSIDE_FIXTURE/)
  await assert.rejects(cleanupFixtures(f.db, env, f.manifest, { apply: true }))
  assert.deepEqual(writes(f), [])
})

test('TAX-06/20 exact catalog helper permits race metadata tokens and fixture admin revocation only', async () => {
  const f = setup(), row = seed(f, 'category'), next = new Date(date.getTime() + 1)
  await alterFixture(f.db, env, f.manifest, 'category', row.id, { name: 'Synthetic rename', isActive: false, updatedAt: next }, async () => {})
  const stored = await fixtureCatalog(f.db, f.manifest, 'category', row.id)
  assert.equal(stored.name, 'Synthetic rename'); assert.equal(stored.slug, row.identity.slug); assert.equal(stored.updatedAt.getTime(), next.getTime())
  for (const data of [{ slug: 'replace' }, { id: 'replace' }, { categoryId: null }, { isActive: 'false' }]) await assert.rejects(alterFixture(f.db, env, f.manifest, 'category', row.id, data, async () => {}), /FIXTURE_MUTATION_REJECTED/)
  const admin = f.manifest.users.find(user => user.key === 'admin')
  await alterFixture(f.db, env, f.manifest, 'user', admin.id, { role: 'CLIENT' }, async () => {})
  await fixturePreflight(f.db, f.manifest)
  await alterFixture(f.db, env, f.manifest, 'user', admin.id, { role: 'ADMIN' }, async () => {})
  assert.equal(f.state.user.find(row => row.id === admin.id).role, 'ADMIN')
})

test('TAX-32 recovery journal never becomes a fresh seed plan', async () => {
  const f = setup(); await reserve(f)
  f.calls.length = 0
  await assert.rejects(createFixtures(f.db, env, f.manifest, async () => 'hash'), /FIXTURE_TAXONOMY_CREATE_REQUIRES_SEED_PLAN/)
  assert.deepEqual(f.calls, [])
})

test('TAX-32 real runner gate never calls recovery or deletion after a collision or uncertain setup', async () => {
  for (const committed of [false, undefined, null, 'true']) {
    const f = setup(), before = clone(f.state)
    await assert.rejects(cleanupConfirmedFixtures(committed, async () => {
      await discoverFixtureGraph(f.db, env, f.manifest, async () => {})
      await cleanupFixtures(f.db, env, f.manifest, { apply: true })
    }), /FIXTURE_SETUP_UNCONFIRMED_NO_AUTOMATIC_DELETE/)
    assert.deepEqual(f.state, before); assert.deepEqual(f.calls, [])
  }
  const f = setup()
  assert.deepEqual(await cleanupConfirmedFixtures(true, () => cleanupFixtures(f.db, env, f.manifest, { apply: true })), zero)
})

test('TAX-32 malformed intent descriptors and foreign keys are rejected without invoking accessors', async () => {
  const f = setup(), good = catalogCreateData(f.manifest, 'tag', 'ui-hostile')
  let reads = 0
  const accessor = { ...good }
  Object.defineProperty(accessor, 'name', { enumerable: true, get() { reads++; return good.name } })
  for (const expected of [accessor, { ...good, slug: 'outside-run' }, { ...good, extra: true },
    Object.defineProperty({ ...good }, 'hidden', { value: true }), { ...good, [Symbol('secret')]: true }]) {
    await assert.rejects(reserveCatalogIntent(f.db, env, f.manifest, 'tag', 'ui-hostile', expected, async () => {}))
  }
  assert.equal(reads, 0); assert.deepEqual(f.calls, []); assert.deepEqual(f.manifest.catalogIntents, [])
})
