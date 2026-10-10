import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const sourceRoot = new URL('../src/', import.meta.url).href
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'server-only') return next('data:text/javascript,export {};', context)
  if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.')) {
    const candidate = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context)
  }
  return next(specifier, context)
} })
const { bindProductCatalog, requireCatalogSuccess } = await import('../src/lib/application/product-catalog.ts')
const fail = error => ({ ok: false, error })
const row = (id = 'fixture-a', extra = {}) => ({ id, name: 'Alpha', contentState: 'SELECTABLE', saleStopped: false, ...extra })
const baseRows = () => [row(), row('fixture-b', { name: 'Beta', contentState: 'RETIRED', saleStopped: true })]
const revision = rows => 'c01-v1:' + createHash('sha256').update(Buffer.from(JSON.stringify(rows), 'utf8')).digest('hex')
const cursor = (rev, id, filter = 'selectable') => Buffer.from(JSON.stringify([1, filter, rev, id])).toString('base64url')
function fixture(rows = baseRows(), { role = 'CREATOR', purpose = 'draft' } = {}) {
  const f = { rows, actor: { id: 'fixture-author', role, status: 'ACTIVE' }, calls: [], queryError: undefined, actorError: undefined }
  f.tx = {
    user: { async findUnique(input) {
      assert.equal(this, f.tx.user)
      f.calls.push({ type: 'actor', input })
      if (f.actorError) throw f.actorError
      return f.actor
    } },
    async $queryRaw(strings, ...params) {
      assert.equal(this, f.tx)
      assert.ok(Array.isArray(strings) && Array.isArray(strings.raw), 'real tagged template invocation')
      f.calls.push({ type: 'scan', sql: strings.join('?'), params })
      if (f.queryError) throw f.queryError
      return f.rows
    },
  }
  f.port = requireCatalogSuccess(bindProductCatalog({ cmsTx: f.tx, freshActor: { ...f.actor }, purpose, isolationLevel: 'Serializable' }))
  return f
}
const scanCount = f => f.calls.filter(c => c.type === 'scan').length

test('C01B-01/02: state mapping, stopped sales, retired and unknown sets use real policy outputs', async () => {
  const f = fixture([row('active'), row('stopped', { saleStopped: true }), row('hidden', { contentState: 'UNSELECTABLE' }), row('retired', { contentState: 'RETIRED' })])
  const listing = requireCatalogSuccess(await f.port.getSelectableProducts({}))
  assert.deepEqual(listing.items.map(x => x.id), ['active', 'stopped'])
  assert.deepEqual(listing.items.map(x => x.selectableForContent), [true, true])
  for (const id of ['active', 'stopped']) assert.deepEqual(requireCatalogSuccess(await f.port.validateArticleProducts({ ids: [id], usage: 'new-selection' })).productIds, [id])
  for (const id of ['hidden', 'retired']) {
    assert.deepEqual(await f.port.validateArticleProducts({ ids: ['active', id], usage: 'new-selection' }), fail('PRODUCT_INVALID'))
    assert.deepEqual(await f.port.validateArticleProducts({ ids: [id], usage: 'retained-reference' }), fail('POLICY_UNRESOLVED'))
  }
  for (const ids of [['active', 'unknown'], ['ACTIVE']]) {
    assert.deepEqual(await f.port.validateArticleProducts({ ids, usage: 'new-selection' }), fail('PRODUCT_INVALID'))
    assert.deepEqual(await f.port.resolveProductReferences({ ids }), fail('PRODUCT_INVALID'))
  }
  const refs = requireCatalogSuccess(await f.port.resolveProductReferences({ ids: ['retired', 'hidden', 'active'] }))
  assert.deepEqual(refs.items.map(x => [x.id, x.contentState, x.selectableForContent]), [['retired', 'RETIRED', false], ['hidden', 'UNSELECTABLE', false], ['active', 'SELECTABLE', true]])
})

test('C01B-01: five synthetic Products select independently; three included groups are not priced tabs', async () => {
  const f = fixture(Array.from({ length: 5 }, (_, i) => row('synthetic-' + i)))
  assert.equal(requireCatalogSuccess(await f.port.getSelectableProducts({})).items.length, 5)
  for (let i = 0; i < 5; i++) {
    const value = requireCatalogSuccess(await f.port.validateArticleProducts({ ids: ['synthetic-' + i], usage: 'new-selection' }))
    assert.deepEqual(value.productIds, ['synthetic-' + i])
  }
  const { validateProductBenefits } = await import('../src/features/products/product-catalog-policy.ts')
  assert.equal(validateProductBenefits(['MANUAL_RECOMMENDATION', 'AUTOMATED_RECOMMENDATION', 'PROBABILITY_OUTLOOK']).ok, true)
  assert.equal(validateProductBenefits(['MANUAL_RECOMMENDATION']).ok, false)
  // The producer invokes the existing policy with its included groups; this is
  // not an entitlement-runtime or production catalog/price test.
})

test('C01B-01/04: rename keeps identity; canonical bytes and reviewed vectors are stable', async () => {
  const f = fixture(baseRows().reverse())
  const known = 'c01-v1:74e5475f6fe5d6fa863185829c546631e930148a4733fd616c68787a9e238853'
  const json = '[["fixture-a","Alpha","SELECTABLE",false],["fixture-b","Beta","RETIRED",true]]'
  assert.equal(Buffer.from(json).toString('hex'), '5b5b22666978747572652d61222c22416c706861222c2253454c45435441424c45222c66616c73655d2c5b22666978747572652d62222c2242657461222c2252455449524544222c747275655d5d')
  assert.equal(revision(JSON.parse(json)), known)
  assert.equal(requireCatalogSuccess(await f.port.getSelectableProducts({})).catalogVersion, known)
  f.rows = baseRows()
  assert.equal(requireCatalogSuccess(await f.port.getSelectableProducts({})).catalogVersion, known)
  const changes = [
    [{ name: 'Alpha renamed' }, '11c37d1a1f3fc72cb3135b2da8d1016cf81840866d9884e10b8eb8ee40e7b399'],
    [{ contentState: 'UNSELECTABLE' }, 'd3bd109d836b1b2e20a02186db2e59c9eeffecd00edaf4793ef3749272cac1a5'],
    [{ saleStopped: true }, '72711c39be7011a827dc1c182da336c9b2138842f9310a83fdace9029fd7a3ef'],
  ]
  for (const [change, hash] of changes) {
    f.rows = [row('fixture-a', change), baseRows()[1]]
    const out = requireCatalogSuccess(await f.port.resolveProductReferences({ ids: ['fixture-a'] }))
    assert.equal(out.catalogVersion, 'c01-v1:' + hash)
    assert.equal(out.items[0].id, 'fixture-a')
  }
})

test('C01B-04: Unicode name bytes are preserved; ordering is byte-based, not locale or row order', async () => {
  const f = fixture([row('a', { name: '\u00e9' }), row('Z', { name: 'Other' })])
  const first = requireCatalogSuccess(await f.port.getSelectableProducts({}))
  assert.deepEqual(first.items.map(x => x.id), ['Z', 'a'])
  assert.equal(first.items[1].name, '\u00e9')
  assert.equal(first.catalogVersion, revision([['Z', 'Other', 'SELECTABLE', false], ['a', '\u00e9', 'SELECTABLE', false]]))
  f.rows[0].name = 'e\u0301'
  assert.notEqual(requireCatalogSuccess(await f.port.getSelectableProducts({})).catalogVersion, first.catalogVersion)
})

test('C01B-03: empty is success, unavailable is failure, no false empty/PUBLIC fallback', async () => {
  const f = fixture([])
  assert.deepEqual(await f.port.getSelectableProducts({}), { ok: true, value: { catalogVersion: 'c01-v1:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', items: [] } })
  assert.deepEqual(await f.port.validateArticleProducts({ ids: ['missing'], usage: 'new-selection' }), fail('PRODUCT_INVALID'))
  assert.deepEqual(await f.port.resolveProductReferences({ ids: ['missing'] }), fail('PRODUCT_INVALID'))
  f.queryError = { code: 'P1001', message: 'PRIVATE_SQL_OR_URL' }
  assert.deepEqual(await f.port.getSelectableProducts({}), fail('PRODUCT_UNAVAILABLE'))
})

test('C01B-03/04: cap 1000/1001 and ID cap 50/51 fail closed without partial results', async () => {
  const f = fixture(Array.from({ length: 1000 }, (_, i) => row('p' + String(i).padStart(4, '0'))))
  assert.equal(requireCatalogSuccess(await f.port.getSelectableProducts({ limit: 50 })).items.length, 50)
  const requested = f.rows.slice(0, 50).map(x => x.id)
  assert.deepEqual(requireCatalogSuccess(await f.port.validateArticleProducts({ ids: requested, usage: 'new-selection' })).productIds, requested)
  assert.equal(requireCatalogSuccess(await f.port.resolveProductReferences({ ids: requested })).items.length, 50)
  assert.deepEqual(await f.port.resolveProductReferences({ ids: [...requested, 'p0050'] }), fail('VALIDATION_ERROR'))
  assert.deepEqual(await f.port.validateArticleProducts({ ids: [...requested, 'p0050'], usage: 'new-selection' }), fail('VALIDATION_ERROR'))
  f.rows.push(row('overflow'))
  for (const result of [await f.port.getSelectableProducts({}), await f.port.resolveProductReferences({ ids: ['p0000'] }), await f.port.validateArticleProducts({ ids: ['p0000'], usage: 'new-selection' })]) assert.deepEqual(result, fail('PRODUCT_UNAVAILABLE'))
})

test('C01B-04: real pagination has default 25/cap 50, canonical cursor and no repeats', async () => {
  const f = fixture(Array.from({ length: 60 }, (_, i) => row('p' + String(i).padStart(3, '0'))).reverse())
  const first = requireCatalogSuccess(await f.port.getSelectableProducts({}))
  assert.equal(first.items.length, 25)
  assert.deepEqual(JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString()), [1, 'selectable', first.catalogVersion, 'p024'])
  const second = requireCatalogSuccess(await f.port.getSelectableProducts({ cursor: first.nextCursor, limit: 50 }))
  assert.equal(second.items.length, 35)
  assert.equal(second.nextCursor, undefined)
  assert.deepEqual([...first.items, ...second.items].map(x => x.id), [...f.rows].reverse().map(x => x.id))
  f.rows[0].name = 'Renamed'
  assert.deepEqual(await f.port.getSelectableProducts({ cursor: first.nextCursor }), fail('CATALOG_CHANGED'))
})

test('C01B-02/04: malformed IDs/input/getters/cursors fail safely before any storage access', async () => {
  const f = fixture()
  for (const input of [undefined, null, [], { extra: 1 }, { limit: 0 }, { limit: 51 }, { limit: 1.2 }, { limit: '25' }, { cursor: null }, { cursor: '' }, { cursor: 'x'.repeat(2049) }]) assert.deepEqual(await f.port.getSelectableProducts(input), fail('VALIDATION_ERROR'))
  for (const value of [undefined, [], [''], ['a', 'a'], [' space'], ['a.b'], ['x'.repeat(192)], ['\u00e9'], ['a', 2], new Array(1)]) {
    assert.deepEqual(await f.port.resolveProductReferences({ ids: value }), fail('VALIDATION_ERROR'))
    assert.deepEqual(await f.port.validateArticleProducts({ ids: value, usage: 'new-selection' }), fail('VALIDATION_ERROR'))
  }
  assert.deepEqual(await f.port.validateArticleProducts({ ids: ['fixture-a'], usage: 'approve' }), fail('VALIDATION_ERROR'))
  const throwing = Object.defineProperty({}, 'ids', { get() { throw Error('PRIVATE') } })
  assert.deepEqual(await f.port.resolveProductReferences(throwing), fail('VALIDATION_ERROR'))
  const badArray = ['fixture-a']; Object.defineProperty(badArray, 0, { get() { throw Error('PRIVATE') } })
  assert.deepEqual(await f.port.resolveProductReferences({ ids: badArray }), fail('VALIDATION_ERROR'))
  assert.deepEqual(await f.port.getSelectableProducts(Object.defineProperty({}, 'limit', { get() { throw Error('PRIVATE') } })), fail('VALIDATION_ERROR'))
  assert.equal(f.calls.length, 0)
})

test('C01B-04: cursor schema/filter/encoding/member checks and revision mismatch are distinct', async () => {
  const f = fixture(), rev = requireCatalogSuccess(await f.port.getSelectableProducts({})).catalogVersion
  const malformed = [
    ['wrong filter', cursor(rev, 'fixture-a', 'other')],
    ['wrong version', Buffer.from(JSON.stringify([2, 'selectable', rev, 'fixture-a'])).toString('base64url')],
    ['padding', cursor(rev, 'fixture-a') + '='],
    ['leading encoded whitespace', Buffer.from(' [1,"selectable","' + rev + '","fixture-a"]').toString('base64url')],
    ['leading cursor whitespace', ' ' + cursor(rev, 'fixture-a')],
    ['malformed tuple', Buffer.from('[1]').toString('base64url')],
    ['invalid UTF-8', Buffer.from([0xff]).toString('base64url')],
  ]
  for (const [label, c] of malformed) {
    const before = f.calls.length
    assert.deepEqual(await f.port.getSelectableProducts({ cursor: c }), fail('VALIDATION_ERROR'), label)
    assert.equal(f.calls.length, before, label + ' must fail before actor/Product reads')
  }
  assert.deepEqual(await f.port.getSelectableProducts({ cursor: cursor(rev, 'fixture-b') }), fail('VALIDATION_ERROR'))
  assert.deepEqual(await f.port.getSelectableProducts({ cursor: cursor(rev, 'unknown') }), fail('VALIDATION_ERROR'))
  assert.deepEqual(await f.port.getSelectableProducts({ cursor: cursor('c01-v1:' + '0'.repeat(64), 'fixture-a') }), fail('CATALOG_CHANGED'))
})

test('C01B-N2: copied iterator IDs must remain 1..50, valid and unique without mutating input', async () => {
  const f = fixture(Array.from({ length: 51 }, (_, i) => row('p' + i)))
  const cases = [
    ['empty iterator', function* () {}],
    ['overproducing iterator', function* () { for (let i = 0; i < 51; i++) yield 'p' + i }],
    ['duplicate iterator', function* () { yield 'p0'; yield 'p0' }],
    ['malformed iterator ID', function* () { yield 'bad.id' }],
    ['throwing iterator', function* () { yield 'p0'; throw Error('PRIVATE') }],
  ]
  for (const [label, iterate] of cases) {
    const input = ['p0']; Object.defineProperty(input, Symbol.iterator, { value: iterate }); Object.freeze(input)
    assert.deepEqual(await f.port.resolveProductReferences({ ids: input }), fail('VALIDATION_ERROR'), label + ' lookup')
    assert.deepEqual(await f.port.validateArticleProducts({ ids: input, usage: 'new-selection' }), fail('VALIDATION_ERROR'), label + ' validation')
    assert.equal(input.length, 1); assert.equal(input[0], 'p0')
  }
  const hostile = ['p0']; Object.defineProperty(hostile, Symbol.iterator, { get() { throw Error('PRIVATE') } }); Object.freeze(hostile)
  assert.deepEqual(await f.port.resolveProductReferences({ ids: hostile }), fail('VALIDATION_ERROR'))
  assert.deepEqual(await f.port.validateArticleProducts({ ids: hostile, usage: 'new-selection' }), fail('VALIDATION_ERROR'))
  assert.equal(f.calls.length, 0, 'invalid copied IDs must fail before all storage access')
  assert.equal(hostile[0], 'p0')
})

test('C01B-03: malformed rows/duplicates/throwing accessors cannot be dropped or leak raw exceptions', async () => {
  const bad = [null, {}, row('invalid.id'), row('a', { name: '' }), row('a', { contentState: 'ALIEN' }), row('a', { saleStopped: 'false' }), row('a', { saleStopped: 2 }), Object.defineProperty(row(), 'name', { get() { throw Error('PRIVATE') } })]
  for (const value of bad) assert.deepEqual(await fixture([value]).port.getSelectableProducts({}), fail('INTERNAL_ERROR'))
  assert.deepEqual(await fixture([row(), row()]).port.getSelectableProducts({}), fail('INTERNAL_ERROR'))
  assert.deepEqual(await fixture({ rows: [] }).port.getSelectableProducts({}), fail('INTERNAL_ERROR'))
  for (const saleStopped of [false, true, 0, 1, 0n, 1n]) assert.equal((await fixture([row('a', { saleStopped })]).port.getSelectableProducts({})).ok, true)
})

test('C01B-03: allowlisted outputs preserve input and exclude all body/price/user/private fields', async () => {
  const input = Object.freeze({ ids: Object.freeze(['fixture-a']), usage: 'new-selection' })
  const stored = Object.freeze(row('fixture-a', { body: 'PRIVATE', price: 99, user: { email: 'PRIVATE' }, privateNotes: 'PRIVATE', createdAt: 'ignored' }))
  const f = fixture(Object.freeze([stored]))
  const list = requireCatalogSuccess(await f.port.getSelectableProducts({}))
  assert.deepEqual(Object.keys(list).sort(), ['catalogVersion', 'items'])
  assert.deepEqual(Object.keys(list.items[0]).sort(), ['id', 'name', 'selectableForContent'])
  const refs = requireCatalogSuccess(await f.port.resolveProductReferences({ ids: ['fixture-a'] }))
  assert.deepEqual(Object.keys(refs.items[0]).sort(), ['contentState', 'id', 'name', 'selectableForContent'])
  assert.deepEqual(Object.keys(requireCatalogSuccess(await f.port.validateArticleProducts(input))).sort(), ['catalogVersion', 'productIds'])
  assert.equal(JSON.stringify([list, refs]).includes('PRIVATE'), false)
  assert.equal(stored.body, 'PRIVATE')
})

test('C01B-05/06: each operation revalidates actor and performs exactly one tagged full scan on the same tx', async () => {
  const f = fixture()
  await f.port.getSelectableProducts({})
  await f.port.resolveProductReferences({ ids: ['fixture-a'] })
  await f.port.validateArticleProducts({ ids: ['fixture-a'], usage: 'new-selection' })
  assert.deepEqual(f.calls.map(x => x.type), ['actor', 'scan', 'actor', 'scan', 'actor', 'scan'])
  for (const c of f.calls.filter(x => x.type === 'scan')) {
    assert.equal(c.sql, 'SELECT id, name, contentState, saleStopped FROM Product FORCE INDEX (PRIMARY) ORDER BY id ASC LIMIT 1001 FOR UPDATE')
    assert.deepEqual(c.params, [])
  }
  f.actor = { ...f.actor, status: 'SUSPENDED' }
  assert.deepEqual(await f.port.getSelectableProducts({}), fail('FORBIDDEN'))
  assert.equal(scanCount(f), 3)
})

test('C01B-05: purpose/role authorization is server-side and does not grant Article scope', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    for (const purpose of ['draft', 'submit', 'approve', 'display']) {
      const f = fixture(baseRows(), { role, purpose })
      const result = await f.port.validateArticleProducts({ ids: ['fixture-a'], usage: 'new-selection' })
      const allowed = purpose !== 'display' && (role !== 'CREATOR' || purpose !== 'approve')
      assert.equal(result.ok, allowed)
      if (!allowed) { assert.deepEqual(result, fail('FORBIDDEN')); assert.equal(scanCount(f), 0) }
      assert.equal((await f.port.resolveProductReferences({ ids: ['fixture-b'] })).ok, true)
    }
  }
  for (const changed of [null, { id: 'other', role: 'CREATOR', status: 'ACTIVE' }, { id: 'fixture-author', role: 'ADMIN', status: 'ACTIVE' }]) {
    const f = fixture(); f.actor = changed
    assert.deepEqual(await f.port.getSelectableProducts({}), fail('FORBIDDEN'))
    assert.equal(scanCount(f), 0)
  }
})

test('C01B-03/06: storage failures are safe and never retried; commit outcome is not certified', async () => {
  for (const code of ['P1001', 'P2028', 'P2034', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ETIMEDOUT']) {
    const f = fixture(); f.queryError = { code, message: 'PRIVATE SQL', cause: { url: 'PRIVATE' } }
    assert.deepEqual(await f.port.validateArticleProducts({ ids: ['fixture-a'], usage: 'new-selection' }), fail('PRODUCT_UNAVAILABLE'))
    assert.equal(scanCount(f), 1)
  }
  for (const queryError of [{ code: 'P2010', meta: { code: '1205', message: 'PRIVATE' } },
    { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '1213', kind: 'TransactionWriteConflict' } } } }]) {
    const wrapped = fixture(); wrapped.queryError = queryError
    assert.deepEqual(await wrapped.port.getSelectableProducts({}), fail('PRODUCT_UNAVAILABLE'))
    assert.equal(scanCount(wrapped), 1)
  }
  const f = fixture(); f.queryError = Object.defineProperty({}, 'code', { get() { throw Error('PRIVATE') } })
  assert.deepEqual(await f.port.getSelectableProducts({}), fail('INTERNAL_ERROR'))
  f.queryError = new Error('PRIVATE')
  assert.deepEqual(await f.port.resolveProductReferences({ ids: ['fixture-a'] }), fail('INTERNAL_ERROR'))
  f.queryError = undefined; f.actorError = { code: 'ECONNREFUSED' }
  assert.deepEqual(await f.port.getSelectableProducts({}), fail('PRODUCT_UNAVAILABLE'))
})

test('C01B-06: a subsequent call observes a newly supplied locking snapshot, never cached rows/hash', async () => {
  const f = fixture([row('a')]), before = requireCatalogSuccess(await f.port.getSelectableProducts({}))
  f.rows = [row('a', { name: 'New', contentState: 'RETIRED' }), row('b')]
  assert.deepEqual(await f.port.validateArticleProducts({ ids: ['a'], usage: 'new-selection' }), fail('PRODUCT_INVALID'))
  assert.equal(requireCatalogSuccess(await f.port.resolveProductReferences({ ids: ['a'] })).items[0].name, 'New')
  assert.notEqual(requireCatalogSuccess(await f.port.getSelectableProducts({})).catalogVersion, before.catalogVersion)
  assert.equal(scanCount(f), 4)
})

test('C01B-07: shared contract has no value imports; relative value boundary violations are detected', async () => {
  const { default: ts } = await import('typescript')
  const allowed = {
    'src/lib/contracts/product-catalog.ts': [],
    'src/lib/application/product-catalog.ts': ['server-only', '../roles', '../../features/products/product-catalog-producer'],
    'src/features/products/product-catalog-producer.ts': ['server-only', 'node:crypto', '../../lib/roles', './product-catalog-policy'],
  }
  const allowedTypes = {
    'src/lib/contracts/product-catalog.ts': [],
    'src/lib/application/product-catalog.ts': ['@prisma/client', '../roles', '../contracts/product-catalog'],
    'src/features/products/product-catalog-producer.ts': ['@prisma/client', '../../lib/roles', '../../lib/contracts/product-catalog', './product-catalog-contract'],
  }
  const compliant = (source, permitted, permittedTypes = []) => {
    const tree = ts.createSourceFile('boundary.ts', source, ts.ScriptTarget.Latest, true)
    return tree.statements.every(s => {
      if (ts.isExportDeclaration(s) && s.moduleSpecifier) return !!s.isTypeOnly && permittedTypes.includes(s.moduleSpecifier.text)
      if (!ts.isImportDeclaration(s)) return true
      const clause = s.importClause
      const typeOnly = clause?.isTypeOnly || (!clause?.name && clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(e => e.isTypeOnly))
      return typeOnly ? permittedTypes.includes(s.moduleSpecifier.text) : permitted.includes(s.moduleSpecifier.text)
    })
  }
  for (const [path, permitted] of Object.entries(allowed)) {
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    assert.equal(compliant(source, permitted, allowedTypes[path]), true, path)
    assert.doesNotMatch(source, /\$queryRawUnsafe|new PrismaClient|from ['"](?:@\/lib\/prisma|\.\.?\/.*prisma)['"]|\.(?:\$transaction|\$connect)\s*\(/)
  }
  for (const source of ["import {value} from './other'", "import './other'", "export {value} from './other'", "import {value} from '../../lib/prisma'"]) assert.equal(compliant(source, []), false)
  assert.equal(compliant("import type {T} from './types'", [], ['./types']), true)
  assert.equal(compliant("import {type T} from './types'", [], ['./types']), true)
  assert.equal(compliant("import type {T} from '../../features/products/private'", []), false)
  assert.equal(compliant("import type {Prisma} from '@prisma/client'", []), false)
})
