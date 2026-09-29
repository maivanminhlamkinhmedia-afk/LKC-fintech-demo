import assert from 'node:assert/strict'
import test from 'node:test'
import { validateStagingEnvironment, validateBrowserArtifactSafety, assertDatabaseIdentity, assertPortAvailable, safeFailure, HarnessError, withCleanup } from '../scripts/cms-e2e/guard.mjs'
import { createFixturePlan, validateManifest, validateManifestPath, createFixtures, cleanupFixtures, discoverCreatedArticles, discoverCreatedSources, fixturePreflight, fixtureSource, remainingCounts, alterFixture } from '../scripts/cms-e2e/fixtures.mjs'

// Pure/mock verification only. No socket probe, Prisma client, DB connection,
// fixture script CLI, browser, app process, env file or credential lookup runs.
const env = { E2E_BASE_URL: 'http://127.0.0.1:3001', NEXTAUTH_URL: 'http://127.0.0.1:3001',
  DATABASE_URL: 'mysql://edpmjmha_lkcstg:TEST_ONLY_PASSWORD@127.0.0.1:3307/edpmjmha_lkcstage' }
const runId = '0123456789abcdef01234567'
const clone = value => structuredClone(value)
const identity = { databaseName: 'edpmjmha_lkcstage', databaseUser: 'edpmjmha_lkcstg@localhost' }
const matches = (row, where) => Object.entries(where).every(([key, value]) => {
  if (key === 'AND') return value.every(part => matches(row, part))
  if (key === 'OR') return value.some(part => matches(row, part))
  if (value instanceof Date) return row[key]?.getTime() === value.getTime()
  if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key])
  return row[key] === value
})

function setup(options = {}) {
  // Keep the historical v2 fixture graph explicit: new v3 permissions must not
  // silently broaden any of the EDIT/SRC recovery/cleanup regression assertions.
  const manifest = createFixturePlan(runId, 2)
  const state = {
    users: manifest.users.map(user => ({ ...user, status: 'ACTIVE', customerProfile: null, _count: { articlesAuthored: 0, auditLogs: 0, salesMemberships: 0 } })),
    articles: manifest.articles.map(article => ({ ...article, updatedAt: new Date('2026-09-24T00:00:00Z'), editorId: null, categoryId: null, coverMediaId: null, _count: { versions: 0, topics: 0, publicationEvents: 0 } })),
    profiles: [], sources: [], logs: [{ id: 'fixture-login', actorId: manifest.users[0].id, entityType: 'User', entityId: manifest.users[0].id, action: 'AUTH_LOGIN' }],
    untouched: { id: 'existing-customer-data', value: 'preserve' },
  }
  if (options.empty) Object.assign(state, { users: [], articles: [], profiles: [], logs: [], sources: [] })
  const calls = []
  let committed = false
  const record = (kind, args) => calls.push({ kind, args: clone(args) })
  const makeModel = (name, key) => ({
    async findUnique(args) { record(`${name}.findUnique`, args); return clone(state[key].find(row => row.id === args.where.id) ?? null) },
    async findFirst(args) { record(`${name}.findFirst`, args); return clone(state[key].find(row => matches(row, args.where)) ?? null) },
    async findMany(args) {
      record(`${name}.findMany`, args)
      const rows = key === 'sources' ? state[key].filter(row => matches(row, args.where)) : state[key]
      return clone(key === 'sources' && args.select ? rows.map(row => Object.fromEntries(Object.keys(args.select).map(field => [field, row[field]]))) : rows)
    },
    async count(args) {
      record(`${name}.count`, args)
      if (committed && options.postCommitRemaining && key === 'articles') return 1
      if (options.remainingSources && key === 'sources' && (!options.afterCommitOnly || committed)) return 1
      return key === 'sources' ? state[key].filter(row => matches(row, args.where)).length : state[key].length
    },
    async createMany(args) { record(`${name}.createMany`, args); state[key].push(...clone(args.data)); return { count: args.data.length } },
    async updateMany(args) {
      record(`${name}.updateMany`, args)
      const rows = state[key].filter(row => matches(row, args.where))
      rows.forEach(row => Object.assign(row, clone(args.data)))
      return { count: rows.length }
    },
    async deleteMany(args) {
      record(`${name}.deleteMany`, args)
      if (options.deleteError === name) throw new Error('PRIVATE DB failure')
      if (key === 'sources') {
        assert.equal(typeof args.where.id, 'string', 'source deletion specifies one exact ID')
        assert.equal(typeof args.where.articleId, 'string')
        assert.equal(typeof args.where.createdById, 'string')
        const removed = state[key].filter(row => matches(row, args.where))
        state[key] = state[key].filter(row => !matches(row, args.where))
        for (const row of removed) {
          const article = state.articles.find(article => article.id === row.articleId)
          const user = state.users.find(user => user.id === row.createdById)
          if (article) article._count.sources--
          if (user) user._count.sourceReferencesCreated--
        }
        return { count: options.sourceDeleteCount ?? removed.length }
      }
      const ids = args.where.AND?.find(part => part.id)?.id.in ?? args.where.id?.in
      assert.ok(Array.isArray(ids), 'every deletion must specify exact IDs')
      const before = state[key].length
      state[key] = state[key].filter(row => !ids.includes(row.id))
      return { count: before - state[key].length }
    },
  })
  const db = {
    async $queryRaw(query) { record('identity', Array.from(query)); return [options.identity ?? identity] },
    user: makeModel('user', 'users'), article: makeModel('article', 'articles'),
    authorProfile: makeModel('authorProfile', 'profiles'), auditLog: makeModel('auditLog', 'logs'), sourceReference: makeModel('sourceReference', 'sources'),
    async $transaction(work, transactionOptions) {
      record('transaction', transactionOptions)
      const before = clone(state)
      try { const result = await work(db); committed = true; record('commit', null); return result }
      catch (error) { Object.assign(state, before); record('rollback', null); throw error }
    },
  }
  return { db, manifest, state, calls }
}
const deletes = calls => calls.filter(call => call.kind.endsWith('.deleteMany'))
function addSource(fixture, { id = 'cfixture-source', articleId = fixture.manifest.articles[0].id,
  createdById = fixture.manifest.users[0].id, known = true } = {}) {
  const source = { id, articleId, createdById }
  fixture.state.sources.push({ ...source, title: 'Synthetic source', sourceType: 'REPORT', url: null })
  const article = fixture.state.articles.find(article => article.id === articleId)
  const user = fixture.state.users.find(user => user.id === createdById)
  if (article) article._count.sources = (article._count.sources ?? 0) + 1
  if (user) user._count.sourceReferencesCreated = (user._count.sourceReferencesCreated ?? 0) + 1
  if (known) fixture.manifest.sources.push(source)
  return source
}

test('EDIT-23 exact staging environment accepts only the approved target without leaking password', () => {
  const target = validateStagingEnvironment(env)
  assert.equal(target.port, 3307)
  assert.equal(target.database, 'edpmjmha_lkcstage')
  for (const replacement of [
    { E2E_BASE_URL: 'https://lkcfintech.com.vn' }, { NEXTAUTH_URL: 'http://localhost:3001' },
    { E2E_BASE_URL: 'http://127.0.0.1:3001/' }, { DATABASE_URL: 'not-a-url' },
    { DATABASE_URL: env.DATABASE_URL.replace('3307', '3306') },
    { DATABASE_URL: env.DATABASE_URL.replace('127.0.0.1', 'localhost') },
    { DATABASE_URL: env.DATABASE_URL.replace('edpmjmha_lkcstage', 'production') },
    { DATABASE_URL: env.DATABASE_URL.replace('edpmjmha_lkcstg:', 'root:') },
    { DATABASE_URL: `${env.DATABASE_URL}?socket=/production` },
    { DATABASE_URL: `${env.DATABASE_URL}#fragment` },
    { DATABASE_URL: env.DATABASE_URL.replace('TEST_ONLY_PASSWORD', '') },
  ]) {
    assert.throws(() => validateStagingEnvironment({ ...env, ...replacement }), error =>
      error instanceof HarnessError && !error.message.includes('TEST_ONLY_PASSWORD'))
  }
})

test('EDIT-23 wrong real server identity is rejected before fixture writes', async () => {
  for (const row of [{ ...identity, databaseName: 'production' }, { ...identity, databaseUser: 'root@localhost' }]) {
    const { db, manifest, calls } = setup({ empty: true, identity: row })
    await assert.rejects(createFixtures(db, env, manifest, async () => 'hashed'), /STAGING_SERVER_IDENTITY_MISMATCH/)
    assert.equal(calls.some(call => /\.(createMany|updateMany|deleteMany)$/.test(call.kind)), false)
  }
  await assert.rejects(assertDatabaseIdentity({ async $queryRaw() { return [] } }), /STAGING_SERVER_IDENTITY_MISMATCH/)
})

test('EDIT-23 a busy port fails before a runner can create fixtures or reuse a server', async () => {
  let probes = 0
  await assertPortAvailable(async () => { probes++ })
  await assert.rejects(assertPortAvailable(async () => { probes++; throw new Error('busy') }), /PORT_3001_OCCUPIED_OR_UNAVAILABLE/)
  assert.equal(probes, 2)
})

test('browser artifact guard rejects missing/disabled suppression of credential-bearing error context', () => {
  validateBrowserArtifactSafety({ PLAYWRIGHT_NO_COPY_PROMPT: '1' })
  for (const value of [undefined, '', '0', 'true']) {
    assert.throws(() => validateBrowserArtifactSafety({ PLAYWRIGHT_NO_COPY_PROMPT: value }), /BROWSER_CREDENTIAL_ARTIFACT_GUARD_REQUIRED/)
  }
})

test('invalid staging target prevents even starting a fixture/cleanup transaction', async () => {
  const { db, manifest, calls } = setup()
  await assert.rejects(cleanupFixtures(db, { ...env, E2E_BASE_URL: 'https://example.test' }, manifest, { apply: true }))
  await assert.rejects(createFixtures(db, { ...env, NEXTAUTH_URL: 'https://example.test' }, manifest, async () => 'hash'))
  assert.deepEqual(calls, [])
})

test('run manifests have six unique scoped actors, no passwords, and reject path/identity expansion', () => {
  const manifest = createFixturePlan(runId)
  assert.equal(new Set(manifest.users.map(user => user.id)).size, 6)
  assert.equal(manifest.users.filter(user => user.role === 'CREATOR').length, 2)
  assert.equal(JSON.stringify(manifest).includes('password'), false)
  assert.equal(JSON.stringify(manifest).includes('cms004'), false)
  assert.throws(() => createFixturePlan('../escape'), /RUN_ID_INVALID/)
  assert.throws(() => validateManifestPath('prisma/schema.prisma'), /MANIFEST_PATH_INVALID/)
  assert.throws(() => validateManifestPath('playwright/.cms-e2e/../outside.json'), /MANIFEST_PATH_INVALID/)
  for (const mutate of [m => { m.users[0].id = 'existing-user' }, m => { m.users[0].email = 'existing@example.test' },
    m => { m.articles[0].allowedOwnerIds = ['existing-user'] }, m => { m.namespace = 'cms004-qa' },
    m => { m.articles.push(m.articles[0]) }]) {
    const invalid = clone(manifest); mutate(invalid)
    assert.throws(() => validateManifest(invalid))
  }
})

test('fixture create writes only password hashes, six users and exact manifest articles atomically', async () => {
  const { db, manifest, state, calls } = setup({ empty: true })
  const credentials = await createFixtures(db, env, manifest, async password => `hash:${password}`)
  assert.equal(state.users.length, 6)
  assert.equal(state.articles.length, manifest.articles.length)
  assert.equal(calls.find(call => call.kind === 'transaction').args.isolationLevel, 'Serializable')
  const firstWrite = calls.findIndex(call => call.kind.endsWith('.createMany'))
  assert.ok(calls.findIndex(call => call.kind === 'identity') < firstWrite)
  for (const user of state.users) {
    const account = Object.values(credentials).find(account => account.email === user.email)
    assert.ok(account.password.length >= 24)
    assert.equal(user.password, `hash:${account.password}`)
    assert.equal(user.status, 'ACTIVE')
  }
  assert.equal(new Set(Object.values(credentials).map(account => account.password)).size, 6)
  assert.equal(JSON.stringify(manifest).includes('hash:'), false)
})

test('existing fixture identities stop create without overwriting rows', async () => {
  const { db, manifest, state, calls } = setup()
  const before = clone(state)
  await assert.rejects(createFixtures(db, env, manifest, async () => 'hash'), /FIXTURE_ALREADY_EXISTS/)
  assert.deepEqual(state, before)
  assert.equal(calls.some(call => call.kind.endsWith('.createMany')), false)
})

test('cleanup defaults to read-only preflight and exact fixture counts', async () => {
  const { db, manifest, state, calls } = setup()
  const before = clone(state)
  assert.deepEqual(await cleanupFixtures(db, env, manifest), { articles: manifest.articles.length, profiles: 0, users: 6, logs: 1, sources: 0 })
  assert.deepEqual(state, before)
  assert.deepEqual(deletes(calls), [])
})

test('EDIT-24 cleanup removes only exact fixture IDs and verifies zero after commit', async () => {
  const { db, manifest, state, calls } = setup()
  assert.deepEqual(await cleanupFixtures(db, env, manifest, { apply: true }), { articles: 0, profiles: 0, users: 0, logs: 0, sources: 0 })
  assert.deepEqual(state.untouched, { id: 'existing-customer-data', value: 'preserve' })
  assert.deepEqual(deletes(calls).map(call => call.kind), ['auditLog.deleteMany', 'article.deleteMany', 'user.deleteMany'])
  const articleDelete = calls.find(call => call.kind === 'article.deleteMany').args.where
  assert.deepEqual(articleDelete.AND, [
    { id: { in: manifest.articles.map(article => article.id) } }, { authorId: { in: manifest.users.map(user => user.id) } },
  ])
  const userDelete = calls.find(call => call.kind === 'user.deleteMany').args.where
  assert.deepEqual(userDelete.id.in, manifest.users.map(user => user.id))
  assert.equal(calls.filter(call => call.kind === 'identity').length, 2)
  assert.ok(calls.findIndex(call => call.kind === 'commit') < calls.findLastIndex(call => call.kind === 'identity'))
})

test('cleanup rejects altered ownership, linked content, private profile, unexpected user relations or non-login audit', async () => {
  for (const mutate of [
    state => { state.articles[0].authorId = 'foreign-user' },
    state => { state.articles[0]._count.versions = 1 },
    state => { state.articles[0].coverMediaId = 'existing-media' },
    state => { state.articles[0].slug = 'non-fixture-article' },
    state => { state.users[0].email = 'existing@example.test' },
    state => { state.users[0].customerProfile = { id: 'existing-customer' } },
    state => { state.users[0]._count.salesMemberships = 1 },
    state => { state.logs[0].action = 'ARTICLE_UPDATE' },
    state => { state.logs[0].actorId = 'outside-admin' },
    state => { state.profiles.push({ id: 'unplanned-profile', userId: state.users[0].id }) },
  ]) {
    const { db, manifest, state, calls } = setup(); mutate(state)
    const before = clone(state)
    await assert.rejects(cleanupFixtures(db, env, manifest, { apply: true }))
    assert.deepEqual(state, before)
    assert.deepEqual(deletes(calls), [])
  }
})

test('cleanup failure rolls back tentative deletion, while post-commit verification failure is not called rollback', async () => {
  const failing = setup({ deleteError: 'article' })
  const before = clone(failing.state)
  await assert.rejects(cleanupFixtures(failing.db, env, failing.manifest, { apply: true }))
  assert.deepEqual(failing.state, before)
  assert.equal(failing.calls.some(call => call.kind === 'rollback'), true)
  const postCommit = setup({ postCommitRemaining: true })
  await assert.rejects(cleanupFixtures(postCommit.db, env, postCommit.manifest, { apply: true }), /FIXTURES_REMAIN_AFTER_COMMIT/)
  assert.equal(postCommit.state.articles.length, 0)
  assert.equal(postCommit.calls.some(call => call.kind === 'commit'), true)
  assert.equal(postCommit.calls.some(call => call.kind === 'rollback'), false)
})

test('already-clean manifest cleanup safely verifies zero with no delete calls', async () => {
  const { db, manifest, calls } = setup({ empty: true })
  assert.deepEqual(await cleanupFixtures(db, env, manifest, { apply: true }), { articles: 0, profiles: 0, users: 0, logs: 0, sources: 0 })
  assert.deepEqual(deletes(calls), [])
})

test('UI article recovery records exact IDs after a slug change and never discovers unrelated owners by prefix', async () => {
  const { db, manifest, state, calls } = setup()
  state.articles[0].slug = `${manifest.namespace}-renamed`
  state.articles.push({ id: 'cuid-created-by-ui', slug: `${manifest.namespace}-from-ui`, authorId: manifest.users[0].id, status: 'DRAFT' })
  let persisted
  await discoverCreatedArticles(db, env, manifest, value => { persisted = clone(value) })
  assert.equal(persisted.articles[0].slug, `${manifest.namespace}-renamed`)
  assert.equal(persisted.articles.some(article => article.id === 'cuid-created-by-ui'), true)
  assert.deepEqual(calls.find(call => call.kind === 'article.findMany').args.where, { authorId: { in: manifest.users.map(user => user.id) } })
  state.articles.push({ id: 'unexpected', slug: 'somebody-elses-content', authorId: manifest.users[0].id })
  await assert.rejects(discoverCreatedArticles(db, env, manifest, async () => {}), /UNEXPECTED_FIXTURE_ARTICLE/)
})

test('staging mutation helpers reject existing-user targets, arbitrary fields and non-fixture owners', async () => {
  const { db, manifest, calls } = setup()
  for (const [kind, id, data] of [
    ['user', 'existing-user', { status: 'SUSPENDED' }],
    ['user', manifest.users[0].id, { password: 'forged' }],
    ['user', manifest.users[0].id, { role: 'SUPER_ADMIN' }],
    ['article', manifest.articles[0].id, { authorId: 'existing-user' }],
    ['article', manifest.articles[0].id, { contentText: 'overwrite' }],
  ]) await assert.rejects(alterFixture(db, env, manifest, kind, id, data, async () => {}), /FIXTURE_MUTATION_REJECTED/)
  assert.deepEqual(calls, [])
})

test('staging mutation helpers verify current database identities and retain them in conditional writes', async () => {
  for (const [kind, mutate, data] of [
    ['user', state => { state.users[0].email = 'existing-user@example.test' }, { status: 'SUSPENDED' }],
    ['article', state => { state.articles[0].authorId = 'outside-owner' }, { status: 'PUBLISHED' }],
    ['article', state => { state.articles[0].slug = 'outside-fixture' }, { status: 'PUBLISHED' }],
    ['article', state => { state.articles[0]._count.versions = 1 }, { status: 'PUBLISHED' }],
  ]) {
    const { db, manifest, state, calls } = setup(); mutate(state)
    const before = clone(state)
    const id = kind === 'user' ? manifest.users[0].id : manifest.articles[0].id
    await assert.rejects(alterFixture(db, env, manifest, kind, id, data, async () => {}))
    assert.deepEqual(state, before)
    assert.equal(calls.some(call => call.kind.endsWith('.updateMany')), false)
  }
  const { db, manifest, calls } = setup()
  await alterFixture(db, env, manifest, 'user', manifest.users[0].id, { status: 'SUSPENDED' }, async () => {})
  assert.deepEqual(calls.find(call => call.kind === 'user.updateMany').args.where, { AND: [
    { id: manifest.users[0].id, email: manifest.users[0].email }, { role: 'CREATOR', status: 'ACTIVE' },
  ] })
  await alterFixture(db, env, manifest, 'article', manifest.articles[0].id, { authorId: manifest.users[1].id }, async () => {})
  const where = calls.find(call => call.kind === 'article.updateMany').args.where
  assert.deepEqual(where.AND[0], { id: manifest.articles[0].id, authorId: manifest.users[0].id, slug: manifest.articles[0].slug })
  assert.deepEqual(where.AND[1], { status: 'DRAFT', updatedAt: new Date('2026-09-24T00:00:00Z') })
})

test('EDIT-24 teardown runs after PASS and FAIL and cleanup failure always prevents PASS', async () => {
  const events = []
  assert.equal(await withCleanup(async () => { events.push('pass'); return 7 }, async () => { events.push('cleanup') }), 7)
  const failure = new Error('test failed')
  await assert.rejects(withCleanup(async () => { events.push('fail'); throw failure }, async () => { events.push('cleanup') }), error => error === failure)
  await assert.rejects(withCleanup(async () => 'passed', async () => { throw new Error('PRIVATE SQL') }), /CLEANUP_NOT_VERIFIED/)
  assert.deepEqual(events, ['pass', 'cleanup', 'fail', 'cleanup'])
  assert.equal(safeFailure(new Error('PRIVATE connection credentials')), 'HARNESS_FAILED_DETAILS_REDACTED')
  assert.equal(safeFailure(new HarnessError('CLEANUP_NOT_VERIFIED')), 'CLEANUP_NOT_VERIFIED')
})

test('SRC-24 manifest v2 requires exact source identities and rejects duplicates or either foreign endpoint', () => {
  const fixture = setup()
  assert.equal(fixture.manifest.version, 2)
  assert.deepEqual(fixture.manifest.sources, [])
  addSource(fixture)
  assert.equal(validateManifest(fixture.manifest), fixture.manifest)
  for (const mutate of [
    m => { delete m.sources }, m => { m.sources = {} }, m => { m.sources[0].id = '' },
    m => { m.sources[0].articleId = 'foreign-article' }, m => { m.sources[0].createdById = 'foreign-creator' },
    m => { m.sources.push({ ...m.sources[0] }) }, m => { m.sources[0].url = 'https://example.invalid/' },
  ]) {
    const invalid = clone(fixture.manifest); mutate(invalid)
    assert.throws(() => validateManifest(invalid))
  }
})

test('SRC-24 v1 remains readable and never gains source cleanup/recovery permission', async () => {
  const fixture = setup()
  fixture.manifest.version = 1
  delete fixture.manifest.sources
  const original = clone(fixture.manifest)
  validateManifest(fixture.manifest)
  let writes = 0
  await discoverCreatedSources(fixture.db, env, fixture.manifest, async () => { writes++ })
  assert.equal(writes, 0)
  assert.deepEqual(fixture.manifest, original)
  assert.deepEqual(await cleanupFixtures(fixture.db, env, fixture.manifest, { apply: true }),
    { articles: 0, profiles: 0, users: 0, logs: 0, sources: 0 })
  for (const operation of ['cleanup', 'recover']) {
    const old = setup()
    addSource(old, { known: false })
    old.manifest.version = 1; delete old.manifest.sources
    const before = clone(old.state)
    const work = operation === 'cleanup'
      ? cleanupFixtures(old.db, env, old.manifest, { apply: true })
      : discoverCreatedSources(old.db, env, old.manifest, async () => { throw new Error('must not journal') })
    await assert.rejects(work, /MANIFEST_V1_SOURCE_NOT_AUTHORIZED/)
    assert.deepEqual(old.state, before)
    assert.deepEqual(deletes(old.calls), [])
  }
  assert.throws(() => validateManifest({ ...original, sources: [] }), /MANIFEST_V1_HAS_SOURCES/)
})

test('SRC-24 source lost ACK recovery checks parent and creator, journals exact IDs, and is idempotent', async () => {
  const fixture = setup()
  const createdArticle = { id: 'cui-created-source-parent', slug: `${fixture.manifest.namespace}-source-parent`,
    authorId: fixture.manifest.users[0].id, status: 'DRAFT', editorId: null, categoryId: null, coverMediaId: null, _count: { sources: 0 } }
  fixture.state.articles.push(createdArticle)
  const source = addSource(fixture, { articleId: createdArticle.id, createdById: fixture.manifest.users[2].id, known: false })
  const journals = []
  await discoverCreatedSources(fixture.db, env, fixture.manifest, async value => journals.push(clone(value)))
  assert.deepEqual(fixture.manifest.sources, [source])
  assert.equal(journals[0].articles.some(article => article.id === createdArticle.id), true)
  assert.deepEqual(journals[0].sources, [])
  assert.deepEqual(journals.at(-1).sources, [source])
  await discoverCreatedSources(fixture.db, env, fixture.manifest, async () => {})
  assert.deepEqual(fixture.manifest.sources, [source])
  const where = fixture.calls.find(call => call.kind === 'sourceReference.findMany').args.where
  assert.equal(where.OR.some(part => part.articleId?.in.includes(createdArticle.id)), true)
  assert.equal(where.OR.some(part => part.createdById?.in.includes(source.createdById)), true)
  assert.equal(JSON.stringify(where).includes('startsWith'), false)
  assert.deepEqual(await cleanupFixtures(fixture.db, env, fixture.manifest, { apply: true }),
    { articles: 0, profiles: 0, users: 0, logs: 0, sources: 0 })
})

test('SRC-24 a foreign endpoint blocks recovery and deletion before any source ID is journaled', async () => {
  for (const outside of ['articleId', 'createdById']) {
    const fixture = setup()
    addSource(fixture, { id: 'legitimate-unrecorded', known: false })
    addSource(fixture, { id: 'foreign-relation', [outside]: 'outside-fixture', known: false })
    const journals = []
    await assert.rejects(discoverCreatedSources(fixture.db, env, fixture.manifest,
      async value => journals.push(clone(value))), /SOURCE_ENDPOINT_OUTSIDE_FIXTURE/)
    assert.deepEqual(fixture.manifest.sources, [])
    assert.equal(journals.every(value => value.sources.length === 0), true)
    await assert.rejects(cleanupFixtures(fixture.db, env, fixture.manifest, { apply: true }))
    assert.deepEqual(deletes(fixture.calls), [])
  }
})

test('SRC-24 recovery rejects known source identity drift within fixture and outside both endpoints', async () => {
  for (const change of ['parent', 'creator', 'both-outside']) {
    const fixture = setup()
    addSource(fixture)
    const beforeManifest = clone(fixture.manifest)
    if (change === 'parent') fixture.state.sources[0].articleId = fixture.manifest.articles[1].id
    if (change === 'creator') fixture.state.sources[0].createdById = fixture.manifest.users[1].id
    if (change === 'both-outside') Object.assign(fixture.state.sources[0], { articleId: 'foreign-parent', createdById: 'foreign-creator' })
    await assert.rejects(discoverCreatedSources(fixture.db, env, fixture.manifest, async () => {}),
      /SOURCE_IDENTITY_MISMATCH|SOURCE_ENDPOINT_OUTSIDE_FIXTURE/)
    assert.deepEqual(fixture.manifest.sources, beforeManifest.sources)
    await assert.rejects(cleanupFixtures(fixture.db, env, fixture.manifest, { apply: true }))
    assert.deepEqual(deletes(fixture.calls), [])
  }
})

test('SRC-24 invalid parent/creator identity and duplicate source query IDs cannot be recovered', async () => {
  for (const mutate of [
    f => { f.state.articles[0].slug = 'foreign-slug' },
    f => { f.state.articles[0].authorId = 'foreign-owner' },
    f => { f.state.users[0].email = 'foreign@example.invalid' },
    f => { f.state.sources.push(clone(f.state.sources[0])) },
  ]) {
    const fixture = setup(); addSource(fixture, { known: false }); mutate(fixture)
    await assert.rejects(discoverCreatedSources(fixture.db, env, fixture.manifest, async () => {}))
    assert.deepEqual(fixture.manifest.sources, [])
  }
})

test('SRC-24 preflight does not implicitly register valid but unknown sources', async () => {
  const fixture = setup(); addSource(fixture, { known: false })
  await assert.rejects(fixturePreflight(fixture.db, fixture.manifest), /SOURCE_NOT_IN_MANIFEST/)
  assert.deepEqual(fixture.manifest.sources, [])
  assert.deepEqual(deletes(fixture.calls), [])
})

test('SRC-24 relation counts must equal verified exact sources on both parent and creator', async () => {
  for (const mutate of [
    f => { f.state.articles[0]._count.sources = 0 },
    f => { f.state.articles[0]._count.sources = 2 },
    f => { f.state.users[0]._count.sourceReferencesCreated = 0 },
    f => { f.state.users[0]._count.sourceReferencesCreated = 2 },
    f => { f.state.articles[0]._count.versions = 1 },
    f => { f.state.users[0]._count.mediaAssets = 1 },
  ]) {
    const fixture = setup(); addSource(fixture); mutate(fixture)
    const before = clone(fixture.state)
    await assert.rejects(cleanupFixtures(fixture.db, env, fixture.manifest, { apply: true }), /UNEXPECTED_RELATIONS/)
    assert.deepEqual(fixture.state, before)
    assert.deepEqual(deletes(fixture.calls), [])
  }
})

test('SRC-24 cleanup deletes exact source triples before parents and verifies five zero counters twice', async () => {
  const fixture = setup()
  const first = addSource(fixture)
  const second = addSource(fixture, { id: 'cadmin-created-source', createdById: fixture.manifest.users[2].id })
  fixture.state.sources.push({ id: 'unrelated-source', articleId: 'outside-article', createdById: 'outside-user', title: 'Untouched' })
  const unrelated = clone(fixture.state.sources.at(-1))
  const readonly = await cleanupFixtures(fixture.db, env, fixture.manifest)
  assert.equal(readonly.sources, 2)
  assert.deepEqual(deletes(fixture.calls), [])
  fixture.calls.length = 0
  assert.deepEqual(await cleanupFixtures(fixture.db, env, fixture.manifest, { apply: true }),
    { articles: 0, profiles: 0, users: 0, logs: 0, sources: 0 })
  assert.deepEqual(deletes(fixture.calls).map(call => call.kind),
    ['sourceReference.deleteMany', 'sourceReference.deleteMany', 'auditLog.deleteMany', 'article.deleteMany', 'user.deleteMany'])
  assert.deepEqual(deletes(fixture.calls).slice(0, 2).map(call => call.args.where), [first, second])
  assert.deepEqual(fixture.state.sources, [unrelated])
  assert.equal(fixture.calls.filter(call => call.kind === 'sourceReference.count').length, 2)
  assert.equal(fixture.calls.find(call => call.kind === 'transaction').args.isolationLevel, 'Serializable')
})

test('SRC-24 source delete failure/count mismatch or later parent failure rolls back every tentative deletion', async () => {
  for (const options of [{ deleteError: 'sourceReference' }, { sourceDeleteCount: 0 }, { sourceDeleteCount: 2 },
    { deleteError: 'article' }, { deleteError: 'user' }]) {
    const fixture = setup(options); addSource(fixture)
    const before = clone(fixture.state)
    await assert.rejects(cleanupFixtures(fixture.db, env, fixture.manifest, { apply: true }))
    assert.deepEqual(fixture.state, before)
    assert.equal(fixture.calls.some(call => call.kind === 'rollback'), true)
    assert.equal(fixture.calls.some(call => call.kind === 'commit'), false)
  }
})

test('SRC-24 source leftovers prevent verification both inside transaction and after commit', async () => {
  for (const afterCommitOnly of [false, true]) {
    const fixture = setup({ remainingSources: true, afterCommitOnly }); addSource(fixture)
    const before = clone(fixture.state)
    await assert.rejects(cleanupFixtures(fixture.db, env, fixture.manifest, { apply: true }),
      afterCommitOnly ? /FIXTURES_REMAIN_AFTER_COMMIT/ : /FIXTURES_REMAIN_IN_TRANSACTION/)
    if (!afterCommitOnly) assert.deepEqual(fixture.state, before)
    assert.equal(fixture.calls.some(call => call.kind === 'commit'), afterCommitOnly)
    assert.equal(fixture.calls.some(call => call.kind === 'rollback'), !afterCommitOnly)
  }
})

test('SRC-24 partial and already-clean journals retain missing IDs but delete only rows still present', async () => {
  const fixture = setup(); addSource(fixture)
  fixture.manifest.sources.push({ id: 'deleted-by-ui', articleId: fixture.manifest.articles[0].id, createdById: fixture.manifest.users[0].id })
  await cleanupFixtures(fixture.db, env, fixture.manifest, { apply: true })
  assert.equal(deletes(fixture.calls).filter(call => call.kind === 'sourceReference.deleteMany').length, 1)
  fixture.calls.length = 0
  await cleanupFixtures(fixture.db, env, fixture.manifest, { apply: true })
  assert.deepEqual(deletes(fixture.calls), [])
  assert.equal(fixture.manifest.sources.length, 2)
})

test('SRC-24 remaining source verification covers parent and creator directions, not only journal IDs', async () => {
  for (const outside of ['articleId', 'createdById']) {
    const fixture = setup(); addSource(fixture, { [outside]: 'foreign', known: false })
    const counts = await remainingCounts(fixture.db, fixture.manifest)
    assert.equal(counts.sources, 1)
  }
})

test('SRC-24 status/owner/unsupported-schema setup permits only fully verified source fixtures', async () => {
  const fixture = setup(); addSource(fixture, { createdById: fixture.manifest.users[2].id })
  const id = fixture.manifest.articles[0].id
  await alterFixture(fixture.db, env, fixture.manifest, 'article', id,
    { authorId: fixture.manifest.users[1].id, status: 'SUBMITTED', editorSchemaVersion: 2 }, async () => {})
  assert.equal(fixture.state.articles[0].authorId, fixture.manifest.users[1].id)
  assert.equal(fixture.state.sources[0].createdById, fixture.manifest.users[2].id)
  const invalid = setup(); addSource(invalid, { createdById: 'foreign', known: false })
  await assert.rejects(alterFixture(invalid.db, env, invalid.manifest, 'article', invalid.manifest.articles[0].id,
    { status: 'PUBLISHED' }, async () => {}))
  assert.equal(invalid.calls.some(call => call.kind.endsWith('.updateMany')), false)
})

test('SRC-24 unsafe legacy metadata mutation is exact scoped and cannot change source identity', async () => {
  const fixture = setup(); const source = addSource(fixture)
  await alterFixture(fixture.db, env, fixture.manifest, 'source', source.id,
    { url: 'javascript:synthetic()', title: '<b>literal</b>', publisher: '<script>literal</script>', note: 'Synthetic only' }, async () => {})
  assert.deepEqual(fixture.calls.find(call => call.kind === 'sourceReference.updateMany').args.where, source)
  const row = await fixtureSource(fixture.db, fixture.manifest, source.id)
  assert.equal(row.url, 'javascript:synthetic()')
  for (const data of [{ id: 'other' }, { articleId: source.articleId }, { createdById: source.createdById },
    { createdAt: new Date() }, { updatedAt: new Date() }, { sourceType: 'OTHER' }, {}, { url: () => 'unsafe' }]) {
    await assert.rejects(alterFixture(fixture.db, env, fixture.manifest, 'source', source.id, data, async () => {}), /FIXTURE_MUTATION_REJECTED/)
  }
  await assert.rejects(alterFixture(fixture.db, env, fixture.manifest, 'source', 'outside-source', { title: 'Synthetic' }, async () => {}), /FIXTURE_MUTATION_REJECTED/)
  fixture.state.sources[0].createdById = 'foreign'
  await assert.rejects(alterFixture(fixture.db, env, fixture.manifest, 'source', source.id, { title: 'Synthetic' }, async () => {}), /SOURCE_ENDPOINT_OUTSIDE_FIXTURE/)
})

test('SRC-24 unsafe ownership/cleanup failure blocks success even after browser pass or browser failure', async () => {
  for (const browserFails of [false, true]) {
    const fixture = setup(); addSource(fixture, { articleId: 'foreign-article', known: false })
    let verified = false
    await assert.rejects((async () => {
      await withCleanup(async () => { if (browserFails) throw new Error('synthetic browser failure') },
        () => cleanupFixtures(fixture.db, env, fixture.manifest, { apply: true }))
      verified = true
    })(), /CLEANUP_NOT_VERIFIED/)
    assert.equal(verified, false)
    assert.deepEqual(deletes(fixture.calls), [])
  }
})

test('SRC-24 recovery journal failure cannot authorize unrecorded sources or proceed to deletion', async () => {
  const fixture = setup(); addSource(fixture, { known: false })
  await assert.rejects(discoverCreatedSources(fixture.db, env, fixture.manifest, async value => {
    if (value.sources.length) throw new Error('synthetic journal write failure')
  }), /synthetic journal write failure/)
  assert.deepEqual(fixture.manifest.sources, [])
  await assert.rejects(cleanupFixtures(fixture.db, env, fixture.manifest, { apply: true }), /SOURCE_NOT_IN_MANIFEST/)
  assert.deepEqual(deletes(fixture.calls), [])
})

test('SRC-24 populated source recovery journal is never reused as a new fixture seed plan', async () => {
  const fixture = setup(); addSource(fixture)
  await assert.rejects(createFixtures(fixture.db, env, fixture.manifest, async () => 'hash'), /FIXTURE_SOURCE_CREATE_REQUIRES_EMPTY_PLAN/)
  assert.deepEqual(fixture.calls, [])
})
