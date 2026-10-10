import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const sourceRoot = new URL('../src/', import.meta.url).href
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return next('data:text/javascript,export {};', context)
  if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.')) {
    const candidate = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context)
  }
  return next(specifier, context)
} })
const { bindProductCatalog, requireCatalogSuccess, ProductCatalogAbort } = await import('../src/lib/application/product-catalog.ts')
const actor = () => ({ id: 'fixture-author', role: 'CREATOR', status: 'ACTIVE' })
const row = id => ({ id, name: id, contentState: 'SELECTABLE', saleStopped: false })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const context = (tx, overrides = {}) => ({ cmsTx: tx, freshActor: actor(), purpose: 'submit', isolationLevel: 'Serializable', ...overrides })
const tx = () => ({ user: { async findUnique() { return actor() } }, async $queryRaw() { return [row('a'), row('b')] } })

test('C01B-05: malformed/root/inactive/non-CMS context fails closed without any Product query', () => {
  for (const value of [null, {}, context({}), context({ ...tx(), $disconnect() { throw Error('must not run') } }), context({ ...tx(), $connect() { throw Error('must not run') } }), context({ ...tx(), $queryRaw: null }), context({ ...tx(), user: {} }), context(tx(), { isolationLevel: 'ReadCommitted' }), context(tx(), { purpose: 'publish' })]) assert.deepEqual(bindProductCatalog(value), { ok: false, error: 'INTERNAL_ERROR' })
  for (const supplied of [null, { ...actor(), id: '' }, { ...actor(), status: 'INACTIVE' }, { ...actor(), role: 'CLIENT' }, { ...actor(), role: 'MANAGER' }, { ...actor(), role: 'ALIEN' }]) assert.deepEqual(bindProductCatalog(context(tx(), { freshActor: supplied })), { ok: false, error: 'FORBIDDEN' })
  assert.deepEqual(bindProductCatalog(Object.defineProperty({}, 'isolationLevel', { get() { throw Error('PRIVATE') } })), { ok: false, error: 'INTERNAL_ERROR' })
})

test('C01B-B1: interactive transaction shape may expose $transaction without invoking it', async () => {
  const database = tx(), trace = []
  database.$transaction = () => { throw Error('nested transaction forbidden') }
  database.user.findUnique = async function () { assert.equal(this, database.user); trace.push('actor'); return actor() }
  database.$queryRaw = async function (strings, ...params) {
    assert.equal(this, database)
    assert.equal(strings.join(''), 'SELECT id, name, contentState, saleStopped FROM Product FORCE INDEX (PRIMARY) ORDER BY id ASC LIMIT 1001 FOR UPDATE')
    assert.deepEqual(params, [])
    trace.push('scan')
    return [row('a')]
  }
  const port = requireCatalogSuccess(bindProductCatalog(context(database)))
  assert.equal((await port.getSelectableProducts({})).ok, true)
  assert.deepEqual(requireCatalogSuccess(await port.validateArticleProducts({ ids: ['a'], usage: 'new-selection' })).productIds, ['a'])
  assert.equal((await port.resolveProductReferences({ ids: ['a'] })).ok, true)
  assert.deepEqual(trace, ['actor', 'scan', 'actor', 'scan', 'actor', 'scan'])
})

test('C01B-B1: installed Prisma client constructs accepted transaction shape without a DB connection', async () => {
  const { PrismaClient } = await import('@prisma/client')
  let connects = 0
  const root = new PrismaClient({ adapter: {
    provider: 'mysql', adapterName: 'shape-only-no-db',
    async connect() { connects++; throw Error('DB access forbidden in shape probe') },
  } })
  // Version-specific internal factory probe, not an opened interactive transaction.
  // Never execute delegates/queries or infer isolation/rollback from this shape.
  assert.equal(typeof root._createItxClient, 'function')
  const interactive = root._createItxClient({ kind: 'itx', id: 'shape-only' }, 'scope-only', { active: true })
  assert.equal(typeof root.$connect, 'function')
  assert.equal(typeof root.$disconnect, 'function')
  assert.equal(typeof interactive.$transaction, 'function')
  assert.equal(Reflect.has(interactive, '$connect'), false)
  assert.equal(Reflect.has(interactive, '$disconnect'), false)
  assert.equal(typeof interactive.$queryRaw, 'function')
  assert.equal(typeof interactive.user.findUnique, 'function')
  assert.deepEqual(bindProductCatalog(context(root)), { ok: false, error: 'INTERNAL_ERROR' })
  assert.equal(bindProductCatalog(context(interactive)).ok, true)
  assert.equal(connects, 0)
})

test('C01B-05: context is copied and actor is revalidated each operation, not browser asserted', async () => {
  const supplied = context(tx()), port = requireCatalogSuccess(bindProductCatalog(supplied))
  supplied.purpose = 'approve'; supplied.freshActor.role = 'ADMIN'
  assert.equal((await port.validateArticleProducts({ ids: ['a'], usage: 'new-selection' })).ok, true)
  supplied.cmsTx.user.findUnique = async () => ({ ...actor(), role: 'ADMIN' })
  assert.deepEqual(await port.getSelectableProducts({}), { ok: false, error: 'FORBIDDEN' })
})

// These are transaction CONTROL-FLOW doubles, never MariaDB rollback evidence.
function transactionDouble() {
  const state = { committed: [], pending: [], calls: 0 }
  state.run = async callback => {
    state.calls++
    state.pending = []
    try { const result = await callback(); state.committed.push(...state.pending); return result }
    catch (error) { state.pending = []; throw error }
  }
  return state
}
test('C01B-06: negative ordinary Result commits prior writes; requireCatalogSuccess aborts all modeled writes', async () => {
  const port = requireCatalogSuccess(bindProductCatalog(context(tx())))
  const ordinary = transactionDouble()
  const denied = await ordinary.run(async () => {
    ordinary.pending.push('Article', 'ArticleVersion', 'ArticleReviewEvent')
    return port.validateArticleProducts({ ids: ['unknown'], usage: 'new-selection' })
  })
  assert.equal(denied.ok, false)
  assert.equal(ordinary.committed.length, 3, 'demonstrate the caller footgun, not a valid integration')
  const safe = transactionDouble()
  await assert.rejects(safe.run(async () => {
    safe.pending.push('Article', 'ArticleVersion', 'ArticleReviewEvent')
    requireCatalogSuccess(await port.validateArticleProducts({ ids: ['a', 'unknown'], usage: 'new-selection' }))
  }), error => error instanceof ProductCatalogAbort && error.code === 'PRODUCT_INVALID')
  assert.deepEqual(safe.committed, [])
  assert.deepEqual(safe.pending, [])
})

test('C01B-06: timeout/deadlock safe Result must escape callback as abort, with no retry', async () => {
  for (const code of ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'P2034', 'P2028']) {
    const database = tx(); let scans = 0
    database.$queryRaw = async () => { scans++; throw { code, message: 'PRIVATE' } }
    const port = requireCatalogSuccess(bindProductCatalog(context(database))), model = transactionDouble()
    await assert.rejects(model.run(async () => {
      model.pending.push('Article', 'ArticleVersion', 'ArticleReviewEvent')
      requireCatalogSuccess(await port.validateArticleProducts({ ids: ['a'], usage: 'new-selection' }))
    }), error => error instanceof ProductCatalogAbort && error.code === 'PRODUCT_UNAVAILABLE' && error.message === 'PRODUCT_UNAVAILABLE')
    assert.equal(scans, 1)
    assert.equal(model.calls, 1)
    assert.deepEqual(model.committed, [])
  }
})

test('C01B-06: later CMS CAS/version/event failure must abort; successful producer is not successful commit', async () => {
  const port = requireCatalogSuccess(bindProductCatalog(context(tx())))
  for (const step of ['CAS_CONFLICT', 'VERSION_FAILURE', 'EVENT_FAILURE']) {
    const model = transactionDouble()
    await assert.rejects(model.run(async () => {
      requireCatalogSuccess(await port.validateArticleProducts({ ids: ['a'], usage: 'new-selection' }))
      model.pending.push('Article', 'ArticleVersion', 'ArticleReviewEvent')
      throw Error(step)
    }), new RegExp(step))
    assert.deepEqual(model.committed, [])
  }
})

test('C01B-06: commit lost-ACK UNKNOWN_OUTCOME does not trigger producer/mutation replay or claim rollback', async () => {
  let scans = 0, callbacks = 0
  const database = tx(); database.$queryRaw = async () => { scans++; return [row('a')] }
  const port = requireCatalogSuccess(bindProductCatalog(context(database)))
  const committed = []
  async function lostAckTransaction(callback) { callbacks++; const value = await callback(); committed.push(value); throw Error('UNKNOWN_OUTCOME') }
  await assert.rejects(lostAckTransaction(async () => requireCatalogSuccess(await port.validateArticleProducts({ ids: ['a'], usage: 'new-selection' }))), /UNKNOWN_OUTCOME/)
  assert.equal(callbacks, 1)
  assert.equal(scans, 1)
  assert.equal(committed.length, 1, 'modeled commit happened: never claim rollback merely from ACK loss')
})

for (const [label, ids] of [['disjoint', [['a'], ['b']]], ['overlapping', [['a', 'b'], ['b']]]]) {
  test('C01B-06: ' + label + ' selections follow one common scan protocol (scheduler double only)', async () => {
    const release = deferred(), secondWaiting = deferred(), trace = []
    const firstTx = tx(), secondTx = tx()
    firstTx.$queryRaw = async strings => { trace.push(['first', strings.join('')]); return [row('a'), row('b')] }
    secondTx.$queryRaw = async strings => { secondWaiting.resolve(); await release.promise; trace.push(['second', strings.join('')]); return [row('a'), row('b')] }
    const first = requireCatalogSuccess(bindProductCatalog(context(firstTx))), second = requireCatalogSuccess(bindProductCatalog(context(secondTx)))
    const initial = requireCatalogSuccess(await first.validateArticleProducts({ ids: ids[0], usage: 'new-selection' }))
    const pending = second.validateArticleProducts({ ids: ids[1], usage: 'new-selection' })
    await secondWaiting.promise
    assert.equal(trace.length, 1)
    release.resolve()
    const final = requireCatalogSuccess(await pending)
    assert.deepEqual(initial.productIds, ids[0]); assert.deepEqual(final.productIds, ids[1])
    assert.equal(trace.length, 2); assert.equal(trace[0][1], trace[1][1])
    assert.match(trace[0][1], /FORCE INDEX \(PRIMARY\).*LIMIT 1001 FOR UPDATE/)
    // This proves wiring/control flow only. The scheduler supplies serialization;
    // it cannot prove real InnoDB acquisition order, contention or deadlock freedom.
  })
}

test('C01B-06: concurrent update/insert scheduling double validates only rows acquired by its scan', async () => {
  const committed = deferred(), database = tx()
  let rows = [row('a')]
  let writerFinished = false
  database.$queryRaw = async () => structuredClone(rows)
  const port = requireCatalogSuccess(bindProductCatalog(context(database)))
  // Simulate a writer scheduled for after the modeled transaction boundary.
  const update = committed.promise.then(() => { rows = [{ ...row('a'), name: 'Renamed', contentState: 'RETIRED' }, row('b')]; writerFinished = true })
  assert.deepEqual(requireCatalogSuccess(await port.validateArticleProducts({ ids: ['a'], usage: 'new-selection' })).productIds, ['a'])
  assert.equal(writerFinished, false)
  committed.resolve()
  await update
  assert.deepEqual(await port.validateArticleProducts({ ids: ['a'], usage: 'new-selection' }), { ok: false, error: 'PRODUCT_INVALID' })
  const references = requireCatalogSuccess(await port.resolveProductReferences({ ids: ['a', 'b'] }))
  assert.equal(references.items[0].name, 'Renamed'); assert.equal(references.items[1].id, 'b')
  // Snapshot mutation/insert is modeled; actual blocking of updates/inserts,
  // range/supremum locks and commit atomicity remain matched-MariaDB NOT_RUN.
})

test('C01B-06: abort error exposes only allowlisted code, never arbitrary storage detail', () => {
  assert.throws(() => requireCatalogSuccess({ ok: false, error: 'POLICY_UNRESOLVED' }), error => error instanceof ProductCatalogAbort && error.code === 'POLICY_UNRESOLVED')
  const error = new ProductCatalogAbort('PRIVATE SQL')
  assert.equal(error.code, 'INTERNAL_ERROR'); assert.equal(error.message, 'INTERNAL_ERROR')
  assert.equal(error.cause, undefined)
})
