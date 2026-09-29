import assert from 'node:assert/strict'
import test from 'node:test'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { createFixturePlan, discoverFixtureGraph, fixtureArticle, fixtureCatalog, fixtureClassification,
  fixturePreflight, validateManifest } from '../scripts/cms-e2e/fixtures.mjs'
import { CATALOG_MODELS, MAPPING_MODELS, seedCatalogData } from '../scripts/cms-e2e/taxonomy-fixtures.mjs'

// Execute the production harness read/recovery functions against synthetic rows.
// No Prisma client, network, environment files, journal file or real fixture is used.
// Injected delay and serialization are explicit models, not staging measurements.
const env = { E2E_BASE_URL: 'http://127.0.0.1:3001', NEXTAUTH_URL: 'http://127.0.0.1:3001',
  DATABASE_URL: 'mysql://edpmjmha_lkcstg:TEST_ONLY_PASSWORD@127.0.0.1:3307/edpmjmha_lkcstage' }
const copy = value => structuredClone(value)
const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
  if (key === 'AND') return value.every(part => matches(row, part))
  if (key === 'OR') return value.some(part => matches(row, part))
  if (value && typeof value === 'object') {
    if ('in' in value) return value.in.includes(row[key])
    if ('not' in value) return row[key] !== value.not
  }
  return row[key] === value
})
function adapter({ delayMs = 0, serialize = false } = {}) {
  const manifest = createFixturePlan('1123456789abcdef01234567')
  const state = { user: manifest.users.map(row => ({ ...row, status: 'ACTIVE', customerProfile: null })),
    article: manifest.articles.map(row => ({ ...row, categoryId: null, editorId: null, coverMediaId: null })),
    authorProfile: [], auditLog: [], sourceReference: [],
    articleCategory: [], articleTopic: [], articleTag: [], financialInstrument: [],
    articleTopicMapping: [], articleTagMapping: [], articleInstrument: [] }
  for (const row of manifest.catalogs) state[CATALOG_MODELS[row.kind]].push(seedCatalogData(manifest, row))
  let tail = Promise.resolve(), inTransaction = false, maximumActive = 0, active = 0
  const calls = [], events = [], phases = [], journals = []
  const count = kind => calls.filter(call => call === kind).length
  const counts = () => ({ dbCalls: calls.filter(call => !['transaction', 'persist'].includes(call)).length,
    transactions: count('transaction'), persists: count('persist') })
  async function operation(kind, read) {
    calls.push(kind)
    async function execute() {
      active++; maximumActive = Math.max(maximumActive, active)
      events.push({ kind, event: 'start', ms: performance.now() })
      try { if (delayMs) await delay(delayMs); return copy(read()) }
      finally { events.push({ kind, event: 'settled', ms: performance.now() }); active-- }
    }
    if (!serialize || !inTransaction) return execute()
    const result = tail.then(execute); tail = result.catch(() => {}); return result
  }
  function counted(model, row) {
    if (model === 'article') return { ...row, _count: { sources: state.sourceReference.filter(source => source.articleId === row.id).length,
      topics: state.articleTopicMapping.filter(pair => pair.articleId === row.id).length,
      tags: state.articleTagMapping.filter(pair => pair.articleId === row.id).length,
      instruments: state.articleInstrument.filter(pair => pair.articleId === row.id).length, versions: 0 } }
    if (model === 'user') return { ...row, _count: { sourceReferencesCreated: state.sourceReference.filter(source => source.createdById === row.id).length,
      articlesAuthored: state.article.filter(article => article.authorId === row.id).length, auditLogs: 0 } }
    return row
  }
  const db = {
    $queryRaw: () => operation('identity', () => [{ databaseName: 'edpmjmha_lkcstage', databaseUser: 'edpmjmha_lkcstg@localhost' }]),
    async $transaction(work, options) {
      assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 })
      assert.equal(inTransaction, false); calls.push('transaction'); inTransaction = true
      try { return await work(db) } finally { inTransaction = false }
    },
  }
  for (const model of Object.keys(state)) {
    const read = args => state[model].filter(row => matches(row, args.where)).map(row => counted(model, row))
      .map(row => args.select ? Object.fromEntries(Object.keys(args.select).map(key => [key, row[key]])) : row)
    db[model] = {
      findMany: args => operation(`${model}.findMany`, () => read(args)),
      findFirst: args => operation(`${model}.findFirst`, () => read(args)[0] ?? null),
      findUnique: args => operation(`${model}.findUnique`, () => read(args)[0] ?? null),
    }
  }
  async function persist(value) {
    validateManifest(value); calls.push('persist')
    if (delayMs) await delay(delayMs)
    journals.push(copy(value)) // Memory-only journal; no filesystem I/O timing claim.
  }
  async function measure(phase, invoke) {
    const start = performance.now(), before = counts(); await invoke(); const after = counts()
    phases.push({ phase, elapsedMs: Number((performance.now() - start).toFixed(3)),
      ...Object.fromEntries(Object.keys(before).map(key => [key, after[key] - before[key]])) })
  }
  const recover = () => discoverFixtureGraph(db, env, manifest, persist)
  const id = manifest.articles[0].id
  const graph = async () => { await recover(); return fixtureClassification(db, manifest, id) }
  const seed = (kind, number) => manifest.catalogs.find(row => row.kind === kind && row.seedKey === `seed-${String(number).padStart(2, '0')}`)
  function attach(number = 1, instruments = [1]) {
    state.article[0].categoryId = seed('category', number).id
    state.articleTopicMapping = [{ articleId: id, topicId: seed('topic', number).id }]
    state.articleTagMapping = [{ articleId: id, tagId: seed('tag', number).id }]
    state.articleInstrument = instruments.map(n => ({ articleId: id, instrumentId: seed('instrument', n).id, isPrimary: false }))
  }
  return { db, manifest, state, calls, counts, events, phases, journals, recover, graph, seed, id, attach, measure,
    maximumActive: () => maximumActive }
}

test('recovery helper read counts and journal order include complete identity, graph and ownership checks', async () => {
  for (const [name, invoke, expected] of [
    ['preflight', f => fixturePreflight(f.db, f.manifest), { dbCalls: 14, transactions: 0, persists: 0 }],
    ['recover', f => f.recover(), { dbCalls: 16, transactions: 1, persists: 2 }],
    ['classification', f => fixtureClassification(f.db, f.manifest, f.id), { dbCalls: 18, transactions: 1, persists: 0 }],
    ['catalog', f => fixtureCatalog(f.db, f.manifest, 'instrument', f.seed('instrument', 1).id), { dbCalls: 15, transactions: 1, persists: 0 }],
    ['graph', f => f.graph(), { dbCalls: 34, transactions: 2, persists: 2 }],
  ]) {
    const f = adapter(); await invoke(f); assert.deepEqual(f.counts(), expected, name)
    if (['recover', 'graph'].includes(name)) {
      assert.deepEqual(f.calls.slice(0, 5), ['identity', 'article.findMany', 'persist', 'transaction', 'identity'])
      assert.equal(f.journals.length, 2)
    }
    assert.equal(f.calls.filter(call => call === 'identity').length, name === 'graph' ? 3 : name === 'recover' ? 2 : 1)
  }
  // The probe never bypasses foreign-edge checks to make a timing run succeed.
  const foreign = adapter(); foreign.state.articleTopicMapping.push({ articleId: 'foreign', topicId: foreign.seed('topic', 1).id })
  await assert.rejects(foreign.recover(), /TAXONOMY_ENDPOINT_OUTSIDE_FIXTURE/)
  assert.equal(foreign.journals.length, 1, 'article discovery journal precedes full graph; expanded relation journal was not written')
  assert.deepEqual(foreign.manifest.topicMappings, [])
})

for (const serialize of [false, true]) test(`TAX-08/10 actual recovery call sequences with synthetic 2ms operations; transaction serialization=${serialize}`, async t => {
  const tax08 = adapter({ delayMs: 2, serialize })
  await tax08.measure('TAX08_ARTICLE_RECOVERY', () => tax08.recover())
  tax08.attach(5, [5]); await tax08.measure('TAX08_INITIAL_GRAPH', () => tax08.graph())
  for (const kind of Object.keys(CATALOG_MODELS)) {
    await tax08.measure(`TAX08_USED_${kind}`, () => tax08.graph())
    // Synthetic successful unused deletion, not a DB write. Exact seed tombstone remains journaled.
    tax08.state[CATALOG_MODELS[kind]] = tax08.state[CATALOG_MODELS[kind]].filter(row => row.id !== tax08.seed(kind, 6).id)
    await tax08.measure(`TAX08_UNUSED_${kind}`, () => tax08.recover())
  }
  await tax08.measure('TAX08_FINAL_GRAPH', () => tax08.graph())
  assert.deepEqual(tax08.counts(), { dbCalls: 284, transactions: 17, persists: 22 })
  // No browser context is created here. This models only the finally recovery after context.close settles.
  await tax08.measure('TAX08_AFTER_EACH_RECOVERY', () => tax08.recover())
  assert.deepEqual(tax08.counts(), { dbCalls: 300, transactions: 18, persists: 24 })

  const tax10 = adapter({ delayMs: 2, serialize })
  await tax10.measure('TAX10_SETUP', async () => {
    await tax10.recover()
    tax10.state.sourceReference.push({ id: 'local-source', articleId: tax10.id, createdById: tax10.manifest.users[0].id })
    await tax10.recover(); await tax10.db.sourceReference.findFirst({ where: { articleId: tax10.id } })
    await fixtureArticle(tax10.db, tax10.manifest, tax10.id)
    await fixtureCatalog(tax10.db, tax10.manifest, 'instrument', tax10.seed('instrument', 7).id)
  })
  tax10.attach(1, [1, 7]); tax10.state.articleInstrument[1].isPrimary = true
  await tax10.measure('TAX10_INITIAL_SAVE', async () => { await tax10.graph(); await tax10.db.sourceReference.findUnique({ where: { id: 'local-source' } }) })
  await tax10.measure('TAX10_NOOP', () => tax10.graph())
  await tax10.measure('TAX10_PRIMARY_SWITCH', async () => {
    await fixtureCatalog(tax10.db, tax10.manifest, 'instrument', tax10.seed('instrument', 1).id)
    tax10.state.articleInstrument.forEach((row, index) => { row.isPrimary = index === 0 }); await tax10.graph()
  })
  tax10.state.articleInstrument.forEach(row => { row.isPrimary = false })
  await tax10.measure('TAX10_PRIMARY_CLEAR', () => tax10.graph())
  assert.deepEqual(tax10.counts(), { dbCalls: 201, transactions: 12, persists: 12 })
  tax10.attach(7, [7, 8])
  await tax10.measure('TAX10_REPLACE', async () => { await tax10.graph(); await tax10.db.sourceReference.findUnique({ where: { id: 'local-source' } }) })
  tax10.state.article[0].categoryId = null
  for (const [model] of Object.values(MAPPING_MODELS)) tax10.state[model] = []
  await tax10.measure('TAX10_CLEAR', () => tax10.graph())
  assert.deepEqual(tax10.counts(), { dbCalls: 270, transactions: 16, persists: 16 })
  await tax10.measure('TAX10_AFTER_EACH_RECOVERY', () => tax10.recover())
  assert.deepEqual(tax10.counts(), { dbCalls: 286, transactions: 17, persists: 18 })
  for (const [caseId, f] of [['TAX-08', tax08], ['TAX-10/11', tax10]]) {
    assert.equal(f.maximumActive(), serialize ? 1 : 5)
    assert.equal(f.events.filter(event => event.event === 'start').length, f.counts().dbCalls)
    assert.equal(f.events.filter(event => event.event === 'settled').length, f.counts().dbCalls)
    t.diagnostic(JSON.stringify({ caseId, synthetic: true, requestedPerOperationDelayMs: 2, serialize, maxActive: f.maximumActive(), phases: f.phases }))
  }
})
