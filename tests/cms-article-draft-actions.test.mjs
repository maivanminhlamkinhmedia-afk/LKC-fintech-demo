import assert from 'node:assert/strict'
import { after } from 'node:test'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { Prisma } from '@prisma/client'
import { APP_ROLES, hasPermission } from '../src/lib/roles.ts'

// Import real actions, query policies and document validation. Only framework,
// authentication and Prisma I/O are adapted. These argument/rollback fixtures
// do not claim to prove MariaDB isolation, timestamp precision or SQL filtering.
const sourceRoot = new URL('../src/', import.meta.url)
const actionUrl = new URL('features/cms/article-draft-actions.ts', sourceRoot).href
const queryUrl = new URL('features/cms/article-draft-query.ts', sourceRoot).href
const bridge = Symbol.for('cms-draft-actions-test-adapter')
const clone = value => structuredClone(value)
let current
const record = (kind, args) => current.calls.push({ kind, ...(args === undefined ? {} : { args: clone(args) }) })
const denied = new Error('Authentication redirect sentinel')
const originalConsoleError = console.error
console.error = (...args) => current?.logs.push(args)
after(() => { console.error = originalConsoleError })

const adapter = {
  async requirePermission(permission) {
    record('auth', permission)
    if (current.authError) throw current.authError
    if (!current.bypassGuard && (!current.session?.user?.id || !hasPermission(current.session.user.role, permission))) throw denied
    return clone(current.session)
  },
  revalidatePath(path) {
    assert.equal(current.inTransaction, false, 'Cache work must run only after commit')
    record('revalidate', path)
    if (current.revalidationError) throw current.revalidationError
  },
  prisma: {
    async $transaction(callback, options) {
      record('transaction', options)
      const before = clone(current.article)
      current.inTransaction = true
      const tx = {
        user: { async findUnique(args) {
          record('actor', args)
          if (current.actorError) throw current.actorError
          return clone(current.freshActor)
        } },
        article: {
          async create(args) {
            record('create', args)
            if (current.writeError) throw current.writeError
            current.article = { ...article({ id: 'created-article' }), ...clone(args.data) }
            return clone(current.article)
          },
          async findFirst(args) {
            const kind = args.select.contentJson ? 'lookup' : 'version'
            record(kind, args)
            if (current[`${kind}Error`]) throw current[`${kind}Error`]
            if (kind === 'lookup' && current.lookupMissing) return null
            if (kind === 'version' && current.versionMissing) return null
            return clone(current.article)
          },
          async updateMany(args) {
            record('update', args)
            if (current.writeError) throw current.writeError
            const count = current.updateCount ?? 1
            if (count === 1) {
              current.article = { ...current.article, ...clone(args.data),
                ...(current.persistedUpdatedAt ? { updatedAt: clone(current.persistedUpdatedAt) } : {}) }
            }
            return { count }
          },
        },
      }
      try {
        if (current.transactionError) throw current.transactionError
        const result = await callback(tx)
        if (current.commitError) throw current.commitError
        record('commit')
        return result
      } catch (error) {
        current.article = before
        record('rollback')
        throw error
      } finally { current.inTransaction = false }
    },
    article: {
      async findFirst(args) {
        record('queryEditor', args)
        if (current.queryError) throw current.queryError
        return clone(current.queryArticle)
      },
      async count(args) {
        record('count', args)
        if (current.queryError) throw current.queryError
        return current.total
      },
      async findMany(args) {
        record('list', args)
        if (current.queryError) throw current.queryError
        return clone(current.rows)
      },
    },
  },
}
globalThis[bridge] = adapter
const adapterModule = exports => `data:text/javascript,${encodeURIComponent(
  `const adapter = globalThis[Symbol.for('cms-draft-actions-test-adapter')]; ${exports}`,
)}`
const replacements = new Map([
  ['@/lib/authz', adapterModule('export const requirePermission = adapter.requirePermission;')],
  ['@/lib/prisma', adapterModule('export const prisma = adapter.prisma;')],
  ['next/cache', adapterModule('export const revalidatePath = adapter.revalidatePath;')],
  ['server-only', 'data:text/javascript,export {};'],
])
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (replacements.has(specifier)) return nextResolve(replacements.get(specifier), context)
    if (specifier.startsWith('@/')) return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context)
    if (context.parentURL?.startsWith(sourceRoot.href) && specifier.startsWith('./') && !/\.[mc]?ts$/.test(specifier)) {
      return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
    }
    return nextResolve(specifier, context)
  },
})
let actions, queries
try {
  actions = await import(actionUrl)
  queries = await import(queryUrl)
} finally { hook.deregister(); delete globalThis[bridge] }
const { createArticleDraft, updateArticleDraft } = actions
const { getArticleDraftForEdit, getArticleDraftList } = queries

const creator = { id: 'creator-a', role: 'CREATOR', status: 'ACTIVE' }
const timestamp = new Date('2026-09-24T01:02:03.456Z')
const document = text => ({ type: 'doc', content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }] })
const input = overrides => ({ title: '  Bài viết mới  ', slug: '  Đầu tư Việt Nam  ', excerpt: '  Tóm tắt  ', articleType: 'NEWS', contentJson: document('Nội dung tiếng Việt'), ...overrides })
const updateInput = overrides => input({ expectedUpdatedAt: timestamp.toISOString(), ...overrides })
function article(overrides = {}) {
  return { id: 'article-a', title: 'Original title', slug: 'original-slug', excerpt: '', articleType: 'NEWS',
    authorId: creator.id, status: 'DRAFT', editorSchemaVersion: 1, contentJson: document('Nội dung cũ'), contentText: 'Nội dung cũ',
    updatedAt: new Date(timestamp), createdAt: new Date('2026-09-01T00:00:00Z'), editorId: 'editor-a', categoryId: 'category-a',
    featured: true, publishedAt: null, scheduledAt: null, approvedAt: null, submittedAt: null, ...overrides }
}
function scenario(actor = creator, overrides = {}) {
  current = {
    session: { user: { id: actor.id, role: actor.role } }, freshActor: clone(actor), article: article(),
    queryArticle: article(), total: 41, rows: [], calls: [], logs: [], inTransaction: false, ...overrides,
  }
  return current
}
const calls = kind => current.calls.filter(call => call.kind === kind)
function errorCode(result, expected) {
  assert.equal(result.ok, false)
  assert.equal(result.error.code, expected)
  assert.equal(typeof result.error.message, 'string')
  for (const field of ['stack', 'meta', 'cause', 'query']) assert.equal(Object.hasOwn(result.error, field), false)
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
}
function noWrite() { assert.equal(calls('create').length + calls('update').length, 0) }
function knownError(code, target, modelName = 'Article') {
  return new Prisma.PrismaClientKnownRequestError('PRIVATE database diagnostics', {
    code, clientVersion: 'test', meta: { modelName, ...(target === undefined ? {} : { target }) },
  })
}
const expectedScope = actor => actor.role === 'CREATOR' ? { authorId: actor.id } : {}

test('EDIT-01/02: authentication precedes validation/DB, and framework redirects escape unchanged', async () => {
  for (const run of [() => createArticleDraft(null), () => updateArticleDraft(null, null)]) {
    scenario(creator, { authError: denied })
    await assert.rejects(run(), error => error === denied)
    assert.deepEqual(current.calls, [{ kind: 'auth', args: 'cms:access' }])
  }
  for (const role of APP_ROLES.filter(role => !['CREATOR', 'ADMIN', 'SUPER_ADMIN'].includes(role))) {
    for (const run of [() => createArticleDraft(input()), () => updateArticleDraft('article-a', updateInput())]) {
      scenario({ ...creator, role })
      await assert.rejects(run(), error => error === denied)
      assert.equal(current.calls.length, 1)
    }
  }
})

test('EDIT-03: untrusted ownership/lifecycle/schema/text/relation fields are rejected, never stripped into a write', async () => {
  for (const field of ['authorId', 'editorId', 'status', 'contentText', 'editorSchemaVersion', 'publishedAt', 'submittedAt',
    'approvedAt', 'scheduledAt', 'featured', 'categoryId', 'coverMediaId', 'seoTitle', 'user', 'author', 'id']) {
    scenario()
    errorCode(await createArticleDraft(input({ [field]: 'forged' })), 'VALIDATION_ERROR')
    noWrite()
    scenario()
    errorCode(await updateArticleDraft('article-a', updateInput({ [field]: 'forged' })), 'VALIDATION_ERROR')
    noWrite()
  }
})

test('EDIT-04/16: each eligible role creates only its own DRAFT, with server-derived text and no AuthorProfile lookup', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    const actor = { id: `${role.toLowerCase()}-a`, role, status: 'ACTIVE' }
    scenario(actor, { article: null })
    const result = await createArticleDraft(input())
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, { id: 'created-article', slug: 'dau-tu-viet-nam', updatedAt: timestamp.toISOString() })
    assert.deepEqual(calls('actor')[0].args, { where: { id: actor.id }, select: { id: true, role: true, status: true } })
    assert.deepEqual(calls('create')[0].args, { data: {
      title: 'Bài viết mới', slug: 'dau-tu-viet-nam', excerpt: 'Tóm tắt', articleType: 'NEWS',
      contentJson: document('Nội dung tiếng Việt'), contentText: 'Nội dung tiếng Việt', authorId: actor.id, status: 'DRAFT', editorSchemaVersion: 1,
    }, select: { id: true, slug: true, updatedAt: true } })
    assert.deepEqual(calls('transaction')[0].args, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    assert.deepEqual(calls('revalidate').map(call => call.args), ['/creator', '/creator/articles', '/creator/articles/created-article/edit'])
    assert.ok(current.calls.findIndex(call => call.kind === 'commit') < current.calls.findIndex(call => call.kind === 'revalidate'))
  }
  scenario(creator, { article: null })
  assert.equal((await createArticleDraft(input({ contentJson: document('') }))).ok, true)
  assert.equal(current.article.contentText, '')
})

test('EDIT-07: missing and foreign article fixtures return identical NOT_FOUND and use a scoped lookup', async () => {
  let expected
  for (const id of ['missing-id', 'foreign-id']) {
    scenario(creator, { lookupMissing: true })
    const result = await updateArticleDraft(id, updateInput())
    errorCode(result, 'NOT_FOUND')
    assert.deepEqual(calls('lookup')[0].args.where, { AND: [{ id }, { authorId: creator.id }] })
    noWrite()
    if (expected) assert.deepEqual(result, expected)
    expected = result
  }
})

test('EDIT-08/09: creator own and admin cross-owner updates retain owner/status and all lifecycle fields', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    for (const status of ['DRAFT', 'CHANGES_REQUESTED']) {
      const actor = { ...creator, role }
      const original = article({ status, authorId: role === 'CREATOR' ? actor.id : 'super-admin-owner' })
      scenario(actor, { article: original })
      const result = await updateArticleDraft(original.id, updateInput())
      assert.equal(result.ok, true)
      const write = calls('update')[0].args
      assert.deepEqual(write.where, { AND: [
        { id: original.id }, expectedScope(actor), { status: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
        { updatedAt: timestamp }, { authorId: original.authorId, status, editorSchemaVersion: 1 },
      ] })
      assert.deepEqual(Object.keys(write.data).sort(), ['title', 'slug', 'excerpt', 'articleType', 'contentJson', 'contentText', 'updatedAt'].sort())
      for (const field of ['authorId', 'status', 'editorId', 'categoryId', 'featured', 'editorSchemaVersion', 'createdAt',
        'publishedAt', 'scheduledAt', 'approvedAt', 'submittedAt']) assert.deepEqual(current.article[field], original[field], field)
      assert.equal(current.article.contentText, 'Nội dung tiếng Việt')
      assert.equal(result.data.updatedAt, current.article.updatedAt.toISOString())
      assert.ok(current.article.updatedAt > original.updatedAt)
    }
  }
})

test('EDIT-10: all roles are denied every status outside DRAFT/CHANGES_REQUESTED', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    for (const status of ['SUBMITTED', 'EDITORIAL_REVIEW', 'FACT_CHECK', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED']) {
      scenario({ ...creator, role }, { article: article({ status }) })
      errorCode(await updateArticleDraft('article-a', updateInput()), 'NOT_EDITABLE')
      noWrite()
    }
  }
})

test('EDIT-11: transaction recheck rejects missing/inactive actors and any session-role mismatch before article access', async () => {
  const invalidActors = [null, ...['SUSPENDED', 'DISABLED', 'INVITED'].map(status => ({ ...creator, status })),
    ...APP_ROLES.filter(role => role !== 'CREATOR').map(role => ({ ...creator, role }))]
  for (const freshActor of invalidActors) {
    for (const run of [() => createArticleDraft(input()), () => updateArticleDraft('article-a', updateInput())]) {
      scenario(creator, { freshActor })
      errorCode(await run(), 'FORBIDDEN')
      assert.equal(calls('lookup').length, 0)
      noWrite()
    }
  }
})

test('EDIT-12: conditional-write mismatch rolls back and never reports a save or revalidates', async () => {
  for (const updateCount of [0, 2]) {
    scenario(creator, { updateCount })
    const before = clone(current.article)
    errorCode(await updateArticleDraft('article-a', updateInput()), 'EDIT_CONFLICT')
    assert.deepEqual(current.article, before)
    assert.equal(calls('rollback').length, 1)
    assert.equal(calls('version').length, 0)
    assert.equal(calls('revalidate').length, 0)
    assert.equal(calls('update')[0].args.where.AND.length, 5)
  }
})

test('EDIT-13: a second save with the old tab token conflicts without applying its content', async () => {
  scenario()
  const first = await updateArticleDraft('article-a', updateInput())
  assert.equal(first.ok, true)
  const saved = clone(current.article)
  const second = await updateArticleDraft('article-a', updateInput({ title: 'Stale second tab' }))
  errorCode(second, 'EDIT_CONFLICT')
  assert.deepEqual(current.article, saved)
  assert.equal(calls('update').length, 1)
})

test('EDIT-14: the action increments same-millisecond tokens and returns the persisted version', async context => {
  context.mock.method(Date, 'now', () => timestamp.getTime())
  scenario()
  const first = await updateArticleDraft('article-a', updateInput())
  assert.equal(first.ok, true)
  assert.equal(first.data.updatedAt, '2026-09-24T01:02:03.457Z')
  const second = await updateArticleDraft('article-a', updateInput({ expectedUpdatedAt: first.data.updatedAt }))
  assert.equal(second.ok, true)
  assert.equal(second.data.updatedAt, '2026-09-24T01:02:03.458Z')
  for (const persistedUpdatedAt of [timestamp, new Date(timestamp.getTime() - 1)]) {
    scenario(creator, { persistedUpdatedAt })
    const before = clone(current.article)
    errorCode(await updateArticleDraft('article-a', updateInput()), 'EDIT_CONFLICT')
    assert.deepEqual(current.article, before)
  }
})

test('EDIT-15: only Article slug constraints become SLUG_CONFLICT; no retry or diagnostics leak', async () => {
  const nested = new Prisma.PrismaClientKnownRequestError('PRIVATE SQL', { code: 'P2002', clientVersion: 'test',
    meta: { modelName: 'Article', driverAdapterError: { cause: { constraint: { index: 'Article_slug_key' } } } } })
  for (const failure of [knownError('P2002', ['slug']), knownError('P2002', 'Article_slug_key'), nested]) {
    for (const run of [() => createArticleDraft(input()), () => updateArticleDraft('article-a', updateInput())]) {
      scenario(creator, { writeError: failure })
      const before = clone(current.article)
      errorCode(await run(), 'SLUG_CONFLICT')
      assert.deepEqual(current.article, before)
      assert.equal(calls('transaction').length, 1)
      assert.equal(calls('revalidate').length, 0)
    }
  }
  for (const failure of [knownError('P2002', ['id']), knownError('P2002', ['slug'], 'AuthorProfile')]) {
    scenario(creator, { writeError: failure })
    errorCode(await createArticleDraft(input()), 'INTERNAL_ERROR')
  }
})

test('EDIT-17: unsupported persisted schema or invalid stored JSON cannot be replaced even by an admin', async () => {
  for (const stored of [article({ editorSchemaVersion: 2 }), article({ contentJson: { type: 'doc', content: [{ type: 'image' }] } })]) {
    scenario({ ...creator, role: 'ADMIN' }, { article: stored })
    errorCode(await updateArticleDraft('article-a', updateInput()), 'UNSUPPORTED_DOCUMENT')
    noWrite()
  }
})

test('EDIT-17/18/19: malformed, unsafe or over-limit content is rejected by the real validator before writing', async () => {
  const cases = [null, '<script>bad</script>', { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }] },
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unsafe', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] },
    document('a'.repeat(262145))]
  for (const contentJson of cases) {
    scenario()
    errorCode(await createArticleDraft(input({ contentJson })), 'VALIDATION_ERROR')
    noWrite()
  }
})

test('EDIT-20: transaction/version failures never fake success or leak body/diagnostics; conflicts are not replayed', async () => {
  for (const errorField of ['actorError', 'transactionError', 'commitError', 'lookupError', 'versionError']) {
    scenario(creator, { [errorField]: new Error('PRIVATE credentials and query') })
    const before = clone(current.article)
    errorCode(await updateArticleDraft('article-a', updateInput()), 'INTERNAL_ERROR')
    assert.deepEqual(current.article, before)
    assert.equal(calls('revalidate').length, 0)
    assert.equal(JSON.stringify(current.logs).includes('PRIVATE'), false)
  }
  scenario(creator, { writeError: knownError('P2034') })
  errorCode(await updateArticleDraft('article-a', updateInput()), 'EDIT_CONFLICT')
  assert.equal(calls('transaction').length, 1)
  scenario(creator, { versionMissing: true })
  errorCode(await updateArticleDraft('article-a', updateInput()), 'EDIT_CONFLICT')
})

test('a post-commit revalidation failure returns saved data and a safe warning, never a false rollback', async () => {
  for (const run of [() => createArticleDraft(input()), () => updateArticleDraft('article-a', updateInput())]) {
    scenario(creator, { revalidationError: new Error('PRIVATE refresh error') })
    const result = await run()
    assert.equal(result.ok, true)
    assert.equal(typeof result.warning, 'string')
    assert.equal(current.article.slug, 'dau-tu-viet-nam')
    assert.equal(calls('commit').length, 1)
    assert.equal(calls('rollback').length, 0)
    assert.equal(calls('revalidate').length, 3)
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
    assert.equal(JSON.stringify(current.logs).includes('PRIVATE'), false)
  }
})

test('action exports contain only the two async entry points', () => {
  assert.deepEqual(Object.keys(actions).sort(), ['createArticleDraft', 'updateArticleDraft'])
})

test('editor query preserves scope and returns only editable fields with an ISO token', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    const actor = { ...creator, role }
    scenario(actor)
    const result = await getArticleDraftForEdit(actor, 'article-a')
    assert.equal(result.ok, true)
    assert.deepEqual(Object.keys(result.data).sort(), ['id', 'title', 'slug', 'excerpt', 'articleType', 'contentJson', 'updatedAt'].sort())
    assert.equal(result.data.updatedAt, timestamp.toISOString())
    assert.deepEqual(calls('queryEditor')[0].args.where, { AND: [{ id: 'article-a' }, expectedScope(actor)] })
    assert.equal(Object.hasOwn(calls('queryEditor')[0].args.select, 'contentText'), false)
    assert.equal(Object.hasOwn(calls('queryEditor')[0].args, 'include'), false)
    noWrite()
  }
})

test('editor query safely handles missing/foreign/noneditable/unsupported and invalid actors', async () => {
  for (const [queryArticle, code] of [[null, 'NOT_FOUND'], [article({ status: 'PUBLISHED' }), 'NOT_EDITABLE'],
    [article({ editorSchemaVersion: 2 }), 'UNSUPPORTED_DOCUMENT'], [article({ contentJson: 'bad' }), 'UNSUPPORTED_DOCUMENT']]) {
    scenario(creator, { queryArticle })
    errorCode(await getArticleDraftForEdit(creator, 'article-a'), code)
  }
  for (const actor of [null, undefined, {}, { ...creator, role: 'CLIENT' }, { ...creator, id: '' }]) {
    scenario()
    errorCode(await getArticleDraftForEdit(actor, 'article-a'), 'FORBIDDEN')
    assert.equal(calls('queryEditor').length, 0)
  }
  for (const id of [null, undefined, [], {}, 123, '', 'a'.repeat(192)]) {
    scenario()
    errorCode(await getArticleDraftForEdit(creator, id), 'NOT_FOUND')
    assert.equal(calls('queryEditor').length, 0)
  }
})

test('list query scopes count and page, selects no body, and orders updatedAt then id with 20-row pagination', async () => {
  for (const role of ['CREATOR', 'ADMIN', 'SUPER_ADMIN']) {
    const actor = { ...creator, role }
    scenario(actor)
    const result = await getArticleDraftList(actor, '2')
    assert.deepEqual(result, { articles: [], page: 2, total: 41, pageCount: 3 })
    const where = { AND: [expectedScope(actor)] }
    assert.deepEqual(calls('count')[0].args, { where })
    assert.deepEqual(calls('list')[0].args, { where, select: {
      id: true, title: true, slug: true, authorId: true, status: true, articleType: true, updatedAt: true, publishedAt: true,
    }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: 20, take: 20 })
  }
})

test('list pagination defaults malformed values, clamps beyond the last page, and handles empty/denied scopes', async () => {
  for (const page of [undefined, null, '', '0', '-1', '1.5', '1e2', [], {}, '9007199254740992']) {
    scenario()
    assert.equal((await getArticleDraftList(creator, page)).page, 1)
  }
  scenario()
  assert.equal((await getArticleDraftList(creator, '9999')).page, 3)
  assert.equal(calls('list')[0].args.skip, 40)
  scenario(creator, { total: 0 })
  assert.deepEqual(await getArticleDraftList(creator, '20'), { articles: [], page: 1, total: 0, pageCount: 1 })
  scenario()
  assert.deepEqual(await getArticleDraftList({ ...creator, role: 'CLIENT' }, '1'), { articles: [], page: 1, total: 0, pageCount: 1 })
  assert.equal(current.calls.length, 0)
})

test('read/list storage errors cannot expose raw diagnostics', async () => {
  scenario(creator, { queryError: new Error('PRIVATE SQL credentials') })
  errorCode(await getArticleDraftForEdit(creator, 'article-a'), 'INTERNAL_ERROR')
  await assert.rejects(getArticleDraftList(creator, '1'), error => !error.message.includes('PRIVATE') && error.cause === undefined)
  assert.equal(JSON.stringify(current.logs).includes('PRIVATE'), false)
})
