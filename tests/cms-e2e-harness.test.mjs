import assert from 'node:assert/strict'
import test from 'node:test'
import { validateStagingEnvironment, validateBrowserArtifactSafety, assertDatabaseIdentity, assertPortAvailable, safeFailure, HarnessError, withCleanup } from '../scripts/cms-e2e/guard.mjs'
import { createFixturePlan, validateManifest, validateManifestPath, createFixtures, cleanupFixtures, discoverCreatedArticles, alterFixture } from '../scripts/cms-e2e/fixtures.mjs'

// Pure/mock verification only. No socket probe, Prisma client, DB connection,
// fixture script CLI, browser, app process, env file or credential lookup runs.
const env = { E2E_BASE_URL: 'http://127.0.0.1:3001', NEXTAUTH_URL: 'http://127.0.0.1:3001',
  DATABASE_URL: 'mysql://edpmjmha_lkcstg:TEST_ONLY_PASSWORD@127.0.0.1:3307/edpmjmha_lkcstage' }
const runId = '0123456789abcdef01234567'
const clone = value => structuredClone(value)
const identity = { databaseName: 'edpmjmha_lkcstage', databaseUser: 'edpmjmha_lkcstg@localhost' }

function setup(options = {}) {
  const manifest = createFixturePlan(runId)
  const state = {
    users: manifest.users.map(user => ({ ...user, status: 'ACTIVE', customerProfile: null, _count: { articlesAuthored: 0, auditLogs: 0, salesMemberships: 0 } })),
    articles: manifest.articles.map(article => ({ ...article, updatedAt: new Date('2026-09-24T00:00:00Z'), editorId: null, categoryId: null, coverMediaId: null, _count: { versions: 0, topics: 0, publicationEvents: 0 } })),
    profiles: [], logs: [{ id: 'fixture-login', actorId: manifest.users[0].id, entityType: 'User', entityId: manifest.users[0].id, action: 'AUTH_LOGIN' }],
    untouched: { id: 'existing-customer-data', value: 'preserve' },
  }
  if (options.empty) Object.assign(state, { users: [], articles: [], profiles: [], logs: [] })
  const calls = []
  let committed = false
  const record = (kind, args) => calls.push({ kind, args: clone(args) })
  const makeModel = (name, key) => ({
    async findUnique(args) { record(`${name}.findUnique`, args); return clone(state[key].find(row => row.id === args.where.id) ?? null) },
    async findMany(args) { record(`${name}.findMany`, args); return clone(state[key]) },
    async count(args) { record(`${name}.count`, args); return committed && options.postCommitRemaining && key === 'articles' ? 1 : state[key].length },
    async createMany(args) { record(`${name}.createMany`, args); state[key].push(...clone(args.data)); return { count: args.data.length } },
    async updateMany(args) {
      record(`${name}.updateMany`, args)
      const rows = state[key].filter(row => (args.where.AND ?? [args.where]).every(part => Object.entries(part)
        .every(([field, value]) => value instanceof Date ? row[field]?.getTime() === value.getTime() : row[field] === value)))
      rows.forEach(row => Object.assign(row, clone(args.data)))
      return { count: rows.length }
    },
    async deleteMany(args) {
      record(`${name}.deleteMany`, args)
      if (options.deleteError === name) throw new Error('PRIVATE DB failure')
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
    authorProfile: makeModel('authorProfile', 'profiles'), auditLog: makeModel('auditLog', 'logs'),
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
  assert.deepEqual(await cleanupFixtures(db, env, manifest), { articles: manifest.articles.length, profiles: 0, users: 6, logs: 1 })
  assert.deepEqual(state, before)
  assert.deepEqual(deletes(calls), [])
})

test('EDIT-24 cleanup removes only exact fixture IDs and verifies zero after commit', async () => {
  const { db, manifest, state, calls } = setup()
  assert.deepEqual(await cleanupFixtures(db, env, manifest, { apply: true }), { articles: 0, profiles: 0, users: 0, logs: 0 })
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
  assert.deepEqual(await cleanupFixtures(db, env, manifest, { apply: true }), { articles: 0, profiles: 0, users: 0, logs: 0 })
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
