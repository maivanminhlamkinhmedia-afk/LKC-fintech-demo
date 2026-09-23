import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { Prisma } from '@prisma/client'

// Run the real policy, normalizer and server actions with only auth/Prisma mocked.
// Query assertions verify the production Prisma contract, not a copied SQL/filter
// engine. These tests do not prove MySQL uniqueness or transaction isolation;
// real concurrent writes and database filtering remain staging checks.
const actionUrl = new URL('../src/features/cms/author-profile-actions.ts', import.meta.url).href
const policyUrl = new URL('../src/features/cms/author-profile.ts', import.meta.url).href
const accessUrl = new URL('../src/features/cms/access.ts', import.meta.url).href
const rolesUrl = new URL('../src/lib/roles.ts', import.meta.url).href
const bridgeKey = Symbol.for('cms-author-profile-test-adapter')
const clone = value => structuredClone(value)
let current
const record = (kind, args) => current.calls.push({ kind, ...(args === undefined ? {} : { args: clone(args) }) })

const adapter = {
  async requirePermission(permission) {
    record('auth', permission)
    if (current.authError) throw current.authError
    return clone(current.session)
  },
  prisma: {
    async $transaction(callback, options) {
      record('transaction', options)
      const before = clone(current.profile)
      const tx = {
        user: { async findUnique(args) {
          record('user', args)
          if (current.userError) throw current.userError
          return clone(current.users.find(user => user.id === args.where.id) ?? null)
        } },
        authorProfile: { async upsert(args) {
          record('upsert', args)
          if (current.writeError) throw current.writeError
          // Minimal write fixture: inspect the real where/create/update arguments
          // below rather than simulate database constraints or Prisma filtering.
          const data = current.profile ? args.update : args.create
          current.profile = { ...(current.profile ?? profile()), ...clone(data) }
          return clone(current.profile)
        } },
      }
      try {
        if (current.transactionError) throw current.transactionError
        const result = await callback(tx)
        record('commit')
        return result
      } catch (error) {
        current.profile = before
        record('rollback')
        throw error
      }
    },
    authorProfile: { async findFirst(args) {
      record('public', args)
      if (current.publicError) throw current.publicError
      return clone(current.publicResult)
    } },
  },
}
globalThis[bridgeKey] = adapter
const adapterModule = exports => `data:text/javascript,${encodeURIComponent(
  `const adapter = globalThis[Symbol.for('cms-author-profile-test-adapter')]; ${exports}`,
)}`
const imports = new Map([
  ['@/lib/authz', adapterModule('export const requirePermission = adapter.requirePermission;')],
  ['@/lib/prisma', adapterModule('export const prisma = adapter.prisma;')],
  ['@/lib/roles', rolesUrl],
  ['@/features/cms/access', accessUrl],
  ['@/features/cms/author-profile', policyUrl],
  ['./author-profile', policyUrl],
  ['./access', accessUrl],
])
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if ([actionUrl, policyUrl, accessUrl].includes(context.parentURL) && imports.has(specifier)) {
      return nextResolve(imports.get(specifier), context)
    }
    return nextResolve(specifier, context)
  },
})
let actions, policy
try {
  policy = await import(policyUrl)
  actions = await import(actionUrl)
} finally { hook.deregister(); delete globalThis[bridgeKey] }
const {
  AUTHOR_ROLES, AUTHOR_PROFILE_PUBLIC_SELECT, AuthorProfileError,
  canReadAuthorProfile, canManageAuthorProfile, canonicalizeAuthorSlug,
  normalizeAuthorProfileInput, toPublicAuthorProfile, mapAuthorProfileError,
} = policy
const { upsertMyAuthorProfile, upsertAuthorProfileForUser, getPublicAuthorProfileBySlug } = actions

const creator = { id: 'creator-own', role: 'CREATOR', status: 'ACTIVE' }
const admin = { id: 'admin-own', role: 'ADMIN', status: 'ACTIVE' }
const superAdmin = { id: 'super-own', role: 'SUPER_ADMIN', status: 'ACTIVE' }
const otherCreator = { ...creator, id: 'creator-other' }
const otherAdmin = { ...admin, id: 'admin-other' }
const otherSuper = { ...superAdmin, id: 'super-other' }
const deniedRoles = ['MANAGER', 'SALES_MANAGER', 'SALES', 'ANALYST', 'EMPLOYEE', 'CLIENT']
const publicKeys = ['id', 'displayName', 'slug', 'jobTitle', 'bio', 'avatarUrl', 'expertise', 'publicEmail', 'isPublic', 'updatedAt']
const expectedSelect = Object.fromEntries(publicKeys.map(key => [key, true]))
const input = overrides => ({ displayName: '  Nguyễn Văn Minh  ', slug: '  Nguyễn Văn Minh  ', ...overrides })
function profile(overrides = {}) {
  return {
    id: 'profile-own', userId: creator.id, displayName: 'Original author', slug: 'original-author',
    jobTitle: null, bio: null, avatarUrl: null, expertise: null, publicEmail: null,
    isPublic: true, createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-25T00:00:00Z'),
    ...overrides,
  }
}
function scenario(actor = creator, overrides = {}) {
  current = {
    session: { user: { id: actor.id, role: actor.role } },
    users: clone([creator, otherCreator, admin, otherAdmin, superAdmin, otherSuper]),
    profile: null, publicResult: null, calls: [], ...overrides,
  }
  return current
}
const calls = kind => current.calls.filter(call => call.kind === kind)
function assertError(result, code) {
  assert.equal(result.ok, false)
  assert.equal(result.error.code, code)
  assert.equal(typeof result.error.message, 'string')
  assert.equal(result.error.message.length > 0, true)
  assert.equal(Object.hasOwn(result.error, 'stack'), false)
  assert.equal(Object.hasOwn(result.error, 'meta'), false)
}
function assertNoWrite() { assert.equal(calls('upsert').length, 0) }
function assertValidation(value, field) {
  assert.throws(() => normalizeAuthorProfileInput(value), error =>
    error instanceof AuthorProfileError && error.code === 'VALIDATION_ERROR' && (!field || error.field === field))
}
function assertPublicQuery(slug) {
  assert.equal(calls('public').length, 1)
  const args = calls('public')[0].args
  assert.equal(args.where.slug, slug)
  assert.equal(args.where.isPublic, true)
  const user = args.where.user.is ?? args.where.user
  assert.equal(user.status, 'ACTIVE')
  assert.deepEqual([...user.role.in].sort(), ['ADMIN', 'CREATOR', 'SUPER_ADMIN'])
  assert.deepEqual(args.select, expectedSelect)
  assert.equal(Object.hasOwn(args, 'include'), false)
  assert.equal(calls('auth').length, 0)
}
const knownError = (code, target) => new Prisma.PrismaClientKnownRequestError('PRIVATE database diagnostics must not escape', {
  code, clientVersion: 'test', ...(target === undefined ? {} : { meta: { modelName: 'AuthorProfile', target } }),
})

test('AP-01: CREATOR reads own profile through the real internal policy', () => {
  assert.equal(canReadAuthorProfile(creator, creator), true)
})

test('AP-02: CREATOR creates own profile with canonical server data and default public visibility', async () => {
  scenario()
  const result = await upsertMyAuthorProfile(input())
  assert.equal(result.ok, true)
  assert.deepEqual(calls('auth'), [{ kind: 'auth', args: 'cms:access' }])
  assert.deepEqual(calls('user')[0].args, { where: { id: creator.id }, select: { id: true, role: true, status: true } })
  const write = calls('upsert')[0].args
  assert.deepEqual(write.where, { userId: creator.id })
  assert.equal(write.create.userId, creator.id)
  assert.equal(write.create.isPublic, true)
  assert.equal(write.create.displayName, 'Nguyễn Văn Minh')
  assert.equal(write.create.slug, 'nguyen-van-minh')
  assert.deepEqual(write.select, expectedSelect)
  assert.deepEqual(Object.keys(result.profile).sort(), [...publicKeys].sort())
  assert.deepEqual(calls('transaction')[0].args, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
})

test('AP-03: CREATOR updates own slug and visibility, preserving false when isPublic is omitted', async () => {
  scenario(creator, { profile: profile({ isPublic: false }) })
  assert.equal((await upsertMyAuthorProfile(input({ slug: 'Đỗ Thị Hà' }))).ok, true)
  assert.equal(current.profile.isPublic, false)
  assert.equal(current.profile.slug, 'do-thi-ha')
  assert.equal(Object.hasOwn(calls('upsert')[0].args.update, 'isPublic'), false)
  assert.equal((await upsertMyAuthorProfile(input({ isPublic: true }))).ok, true)
  assert.equal(current.profile.isPublic, true)
  assert.equal((await upsertMyAuthorProfile(input({ isPublic: false }))).ok, true)
  assert.equal(current.profile.isPublic, false)
})

test('AP-04: CREATOR cannot read another private author profile', () => {
  assert.equal(canReadAuthorProfile(creator, otherCreator), false)
})

test('AP-05: CREATOR cannot manage another creator or use the admin boundary', async () => {
  assert.equal(canManageAuthorProfile(creator, otherCreator), false)
  scenario()
  assertError(await upsertAuthorProfileForUser(otherCreator.id, input()), 'FORBIDDEN')
  assert.equal(calls('auth')[0].args, 'cms:admin')
  assertNoWrite()
})

test('AP-06: forged client ownership, role and status never reach the self upsert', async () => {
  scenario()
  const result = await upsertMyAuthorProfile(input({ userId: otherCreator.id, role: 'SUPER_ADMIN', status: 'ACTIVE',
    id: 'forged-profile', user: { connect: { id: otherCreator.id } }, email: 'account-private@example.test' }))
  assert.equal(result.ok, true)
  const write = calls('upsert')[0].args
  assert.deepEqual(write.where, { userId: creator.id })
  assert.equal(write.create.userId, creator.id)
  assert.deepEqual(Object.keys(write.create).sort(), ['displayName', 'slug', 'jobTitle', 'bio', 'avatarUrl', 'expertise', 'publicEmail', 'isPublic', 'userId'].sort())
  assert.deepEqual(Object.keys(write.update).sort(), ['displayName', 'slug', 'jobTitle', 'bio', 'avatarUrl', 'expertise', 'publicEmail'].sort())
  assert.equal(write.create.publicEmail, null)
})

for (const [id, actor, target] of [
  ['AP-07', admin, otherCreator], ['AP-08', admin, otherAdmin],
  ['AP-10', superAdmin, otherSuper], ['AP-11', superAdmin, otherAdmin], ['AP-12', superAdmin, otherCreator],
]) {
  test(`${id}: ${actor.role} manages ${target.role} using the fresh target and scoped upsert`, async () => {
    assert.equal(canReadAuthorProfile(actor, target), true)
    assert.equal(canManageAuthorProfile(actor, target), true)
    scenario(actor)
    assert.equal((await upsertAuthorProfileForUser(target.id, input())).ok, true)
    assert.equal(calls('auth')[0].args, 'cms:admin')
    assert.deepEqual(calls('user').map(call => call.args.where.id), [actor.id, target.id])
    assert.deepEqual(calls('upsert')[0].args.where, { userId: target.id })
    assert.equal(calls('upsert')[0].args.create.userId, target.id)
  })
}

test('AP-09: ADMIN cannot read or manage another SUPER_ADMIN, including forged target role', async () => {
  assert.equal(canReadAuthorProfile(admin, otherSuper), false)
  assert.equal(canManageAuthorProfile(admin, otherSuper), false)
  scenario(admin)
  assertError(await upsertAuthorProfileForUser(otherSuper.id, input({ role: 'CREATOR', status: 'ACTIVE' })), 'FORBIDDEN')
  assertNoWrite()
})

test('AP-13: every non-CMS role is denied for self and other targets, at policies and boundaries', async () => {
  for (const role of deniedRoles) {
    const actor = { ...creator, role }
    for (const target of [actor, otherCreator]) {
      assert.equal(canReadAuthorProfile(actor, target), false, role)
      assert.equal(canManageAuthorProfile(actor, target), false, role)
    }
    for (const run of [() => upsertMyAuthorProfile(input()), () => upsertAuthorProfileForUser(otherCreator.id, input())]) {
      scenario(actor); current.users[0] = actor
      assertError(await run(), 'FORBIDDEN')
      assertNoWrite()
    }
  }
})

for (const [id, status] of [['AP-14', 'SUSPENDED'], ['AP-15', 'DISABLED'], ['AP-16', 'INVITED']]) {
  test(`${id}: ${status} users cannot write as self or as an admin's target`, async () => {
    const inactive = { ...creator, status }
    assert.equal(canManageAuthorProfile(creator, inactive), false)
    assert.equal(canManageAuthorProfile(admin, inactive), false)
    scenario(); current.users[0] = inactive
    assertError(await upsertMyAuthorProfile(input({ status: 'ACTIVE' })), 'FORBIDDEN')
    assertNoWrite()
    scenario(admin); current.users[0] = inactive
    assertError(await upsertAuthorProfileForUser(creator.id, input({ status: 'ACTIVE' })), 'FORBIDDEN')
    assertNoWrite()
  })
}

test('AP-17: public lookup canonicalizes input and requires isPublic=true in its Prisma query', async () => {
  scenario(creator, { publicResult: profile({ slug: 'nguyen-van-minh' }) })
  const result = await getPublicAuthorProfileBySlug(' Nguyễn Văn Minh ')
  assert.equal(result.slug, 'nguyen-van-minh')
  assertPublicQuery('nguyen-van-minh')
  scenario()
  assert.equal(await getPublicAuthorProfileBySlug('hidden-author'), null)
  assertPublicQuery('hidden-author')
})

test('AP-18: public query requires ACTIVE User and returns a database no-match as null', async () => {
  scenario()
  assert.equal(await getPublicAuthorProfileBySlug('inactive-author'), null)
  assertPublicQuery('inactive-author')
})

test('AP-19: public query limits User roles to current author roles and preserves no-match null', async () => {
  scenario()
  assert.equal(await getPublicAuthorProfileBySlug('former-author'), null)
  assertPublicQuery('former-author')
})

test('AP-20: exact ten-field select and explicit projection exclude all internal/user data', async () => {
  assert.deepEqual(AUTHOR_PROFILE_PUBLIC_SELECT, expectedSelect)
  const unsafe = profile({ password: 'private-hash', email: 'private@example.test', phone: 'private-phone', role: 'ADMIN', status: 'ACTIVE',
    lastLoginAt: new Date(), user: { password: 'private-hash', email: 'private@example.test', phone: 'private-phone', role: 'ADMIN', status: 'ACTIVE' },
    AuditLog: [{ action: 'private-audit' }] })
  const expected = Object.fromEntries(publicKeys.map(key => [key, unsafe[key]]))
  assert.deepEqual(toPublicAuthorProfile(unsafe), expected)
  scenario(creator, { publicResult: unsafe })
  assert.deepEqual(await getPublicAuthorProfileBySlug('original-author'), expected)
  assertPublicQuery('original-author')
  scenario(creator, { profile: unsafe })
  const result = await upsertMyAuthorProfile(input())
  assert.equal(result.ok, true)
  assert.deepEqual(Object.keys(result.profile).sort(), [...publicKeys].sort())
  assert.equal(JSON.stringify(result).includes('private-hash'), false)
})

test('AP-21: Vietnamese accents, đ/Đ, case and repeated separators canonicalize server-side', () => {
  for (const [value, expected] of [
    ['Nguyễn Văn Minh', 'nguyen-van-minh'], ['Đỗ Thị Hà', 'do-thi-ha'],
    ['  ĐẶNG__Văn / Minh---2026  ', 'dang-van-minh-2026'], ['nguye\u0302\u0303n-va\u0306n', 'nguyen-van'],
  ]) assert.equal(canonicalizeAuthorSlug(value), expected)
})

test('AP-22: empty/invalid canonical slugs and out-of-bounds lengths are rejected', async () => {
  for (const slug of ['', '   ', '---', '你好', '💥', 'a', 'a'.repeat(121), null, undefined, 123, {}, []]) {
    assertValidation(input({ slug }), 'slug')
    scenario()
    assert.equal(await getPublicAuthorProfileBySlug(slug), null)
    assert.equal(calls('public').length, 0)
  }
  for (const slug of ['ab', 'a'.repeat(120)]) assert.equal(canonicalizeAuthorSlug(slug), slug)
})

test('AP-23: realistic slug P2002 conflicts fail clearly without changing the slug or overwriting', async () => {
  for (const target of [['slug'], 'slug', 'AuthorProfile_slug_key']) {
    scenario(creator, { profile: profile(), writeError: knownError('P2002', target) })
    const before = clone(current.profile)
    const result = await upsertMyAuthorProfile(input())
    assertError(result, 'SLUG_CONFLICT')
    assert.equal(result.error.field, 'slug')
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
    assert.deepEqual(current.profile, before)
    assert.equal(calls('upsert').length, 1)
    assert.equal(calls('upsert')[0].args.update.slug, 'nguyen-van-minh')
  }
})

test('AP-24: avatar URLs accept absolute HTTP(S) only', () => {
  for (const avatarUrl of ['https://example.test/avatar.png', 'http://example.test/a']) {
    assert.equal(normalizeAuthorProfileInput(input({ avatarUrl: ` ${avatarUrl} ` })).avatarUrl, avatarUrl)
  }
  for (const avatarUrl of ['javascript:alert(1)', 'data:image/png;base64,abc', 'file:///tmp/avatar', '/avatar.png', '//example.test/a',
    'http:example.test/a', 'https:\\example.test/a', 'https://exam\nple.test/a', 'not a url', 5, {}]) {
    assertValidation(input({ avatarUrl }), 'avatarUrl')
  }
})

test('AP-25: publicEmail is explicitly provided, normalized and validated', () => {
  assert.equal(normalizeAuthorProfileInput(input({ publicEmail: ' AUTHOR@Example.Test ' })).publicEmail, 'author@example.test')
  assert.equal(normalizeAuthorProfileInput(input({ email: 'private@example.test', user: { email: 'private@example.test' } })).publicEmail, null)
  for (const publicEmail of ['invalid', '@example.test', 'a@', 'a b@example.test', 'a@example.test extra', `${'a'.repeat(180)}@example.test`, 123, {}]) {
    assertValidation(input({ publicEmail }), 'publicEmail')
  }
})

test('AP-26: action surface exposes only upserts and public lookup, with no hard-delete action', () => {
  assert.deepEqual(Object.keys(actions).sort(), ['getPublicAuthorProfileBySlug', 'upsertAuthorProfileForUser', 'upsertMyAuthorProfile'])
})

test('AP-27: existing userId uniqueness and userId upsert prevent a second ownership identity', async () => {
  const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
  const model = schema.match(/model AuthorProfile\s*\{([\s\S]*?)\n\}/)?.[1]
  assert.ok(model)
  assert.match(model, /\buserId\s+String\s+@unique\b/)
  scenario()
  assert.equal((await upsertMyAuthorProfile(input())).ok, true)
  assert.equal((await upsertMyAuthorProfile(input({ displayName: 'Updated author' }))).ok, true)
  assert.deepEqual(calls('upsert').map(call => call.args.where), [{ userId: creator.id }, { userId: creator.id }])
  for (const target of [['userId'], 'userId', 'AuthorProfile_userId_key']) {
    scenario(creator, { writeError: knownError('P2002', target) })
    assertError(await upsertMyAuthorProfile(input()), 'WRITE_CONFLICT')
    assert.equal(calls('upsert').length, 1)
  }
})

test('authentication always comes first and permission redirects/errors propagate unchanged', async () => {
  for (const [run, permission] of [
    [() => upsertMyAuthorProfile(null), 'cms:access'],
    [() => upsertAuthorProfileForUser(null, null), 'cms:admin'],
  ]) {
    const failure = new Error('Authentication redirect sentinel')
    scenario(creator, { authError: failure })
    await assert.rejects(run(), error => error === failure)
    assert.deepEqual(current.calls, [{ kind: 'auth', args: permission }])
  }
})

test('missing, malformed or stale session identities fail closed even after a mocked successful guard', async () => {
  for (const session of [{}, { user: null }, { user: {} }, { user: { id: '', role: 'CREATOR' } },
    { user: { id: '   ', role: 'CREATOR' } }, { user: { id: 123, role: 'CREATOR' } },
    { user: { id: creator.id, role: '__proto__' } }, { user: { id: creator.id, role: 'ADMIN' } },
  ]) {
    scenario(creator, { session })
    assertError(await upsertMyAuthorProfile(input()), 'FORBIDDEN')
    assertNoWrite()
  }
  for (const user of [null, { ...creator, role: 'CLIENT' }, { ...creator, role: 'ADMIN' }, { ...creator, status: 'UNKNOWN' }]) {
    scenario(); current.users = user ? [user] : []
    assertError(await upsertMyAuthorProfile(input()), 'FORBIDDEN')
    assertNoWrite()
  }
})

test('admin writes reject freshly revoked actor privilege/status before touching another profile', async () => {
  for (const fresh of [null, ...['SUSPENDED', 'DISABLED', 'INVITED'].map(status => ({ ...admin, status })),
    { ...admin, role: 'CREATOR' }, { ...admin, role: 'SUPER_ADMIN' },
  ]) {
    scenario(admin); current.users = current.users.filter(user => user.id !== admin.id)
    if (fresh) current.users.push(fresh)
    assertError(await upsertAuthorProfileForUser(otherCreator.id, input()), 'FORBIDDEN')
    assertNoWrite()
  }
})

test('admin writes reject invalid/missing/non-author targets before validating input or writing', async () => {
  for (const targetUserId of [null, undefined, 123, {}, [], '', '   ', 'missing-user']) {
    scenario(admin)
    assertError(await upsertAuthorProfileForUser(targetUserId, null), 'FORBIDDEN')
    assertNoWrite()
  }
  for (const role of deniedRoles) {
    scenario(admin); current.users[0].role = role
    assertError(await upsertAuthorProfileForUser(creator.id, input({ role: 'CREATOR' })), 'FORBIDDEN')
    assertNoWrite()
  }
})

test('ADMIN and SUPER_ADMIN self-upserts always remain bound to their own session id', async () => {
  for (const actor of [admin, superAdmin]) {
    scenario(actor)
    assert.equal((await upsertMyAuthorProfile(input({ userId: otherCreator.id }))).ok, true)
    assert.deepEqual(calls('upsert')[0].args.where, { userId: actor.id })
  }
})

test('policy guards reject malformed actors/targets and contradictory same-id roles', () => {
  assert.deepEqual([...AUTHOR_ROLES].sort(), ['ADMIN', 'CREATOR', 'SUPER_ADMIN'])
  for (const invalid of [null, undefined, {}, { id: '', role: 'CREATOR', status: 'ACTIVE' },
    { id: '  ', role: 'CREATOR', status: 'ACTIVE' }, { id: 5, role: 'CREATOR', status: 'ACTIVE' },
    { id: creator.id, role: '__proto__', status: 'ACTIVE' }, { ...creator, status: 'UNKNOWN' },
  ]) {
    assert.equal(canReadAuthorProfile(creator, invalid), false)
    assert.equal(canManageAuthorProfile(creator, invalid), false)
  }
  for (const invalid of [null, undefined, {}, { id: '', role: 'CREATOR' }, { id: ' ', role: 'ADMIN' }, { id: 5, role: 'ADMIN' },
    { id: creator.id, role: 'UNKNOWN' }, { id: creator.id, role: '__proto__' }, { id: creator.id, role: 'constructor' },
  ]) {
    assert.equal(canReadAuthorProfile(invalid, creator), false)
    assert.equal(canManageAuthorProfile(invalid, creator), false)
  }
  assert.equal(canManageAuthorProfile(admin, { ...admin, role: 'CREATOR' }), false)
  assert.equal(canReadAuthorProfile(admin, { ...admin, role: 'CREATOR' }), false)
})

test('inactive author profiles remain internally readable according to ownership/hierarchy', () => {
  for (const status of ['INVITED', 'SUSPENDED', 'DISABLED']) {
    const target = { ...creator, status }
    assert.equal(canReadAuthorProfile(creator, target), true)
    assert.equal(canReadAuthorProfile(admin, target), true)
    assert.equal(canReadAuthorProfile(superAdmin, target), true)
    assert.equal(canReadAuthorProfile(otherCreator, target), false)
  }
})

test('normalization trims optional fields, clears empty values and does not mutate input', () => {
  const original = Object.freeze(input({ jobTitle: ' Analyst ', bio: ' Biography ', expertise: ' Markets ',
    avatarUrl: ' https://example.test/a ', publicEmail: ' AUTHOR@Example.Test ', isPublic: false }))
  assert.deepEqual(normalizeAuthorProfileInput(original), {
    displayName: 'Nguyễn Văn Minh', slug: 'nguyen-van-minh', jobTitle: 'Analyst', bio: 'Biography',
    expertise: 'Markets', avatarUrl: 'https://example.test/a', publicEmail: 'author@example.test', isPublic: false,
  })
  for (const value of ['', ' \n\t ', null, undefined]) {
    const normalized = normalizeAuthorProfileInput(input(Object.fromEntries(['jobTitle', 'bio', 'expertise', 'avatarUrl', 'publicEmail'].map(key => [key, value]))))
    for (const field of ['jobTitle', 'bio', 'expertise', 'avatarUrl', 'publicEmail']) assert.equal(normalized[field], null)
    assert.equal(Object.hasOwn(normalized, 'isPublic'), false)
  }
})

test('all text length boundaries and strict data types are enforced without coercion', () => {
  for (const [field, maximum] of [['displayName', 120], ['jobTitle', 160], ['bio', 5000], ['expertise', 2000]]) {
    assert.equal(normalizeAuthorProfileInput(input({ [field]: 'a'.repeat(maximum) }))[field].length, maximum)
    assertValidation(input({ [field]: 'a'.repeat(maximum + 1) }), field)
    assert.equal(Array.from(normalizeAuthorProfileInput(input({ [field]: '💡'.repeat(maximum) }))[field]).length, maximum)
    assertValidation(input({ [field]: '💡'.repeat(maximum + 1) }), field)
  }
  assertValidation(input({ displayName: '  ' }), 'displayName')
  const maxEmail = `${'a'.repeat(179)}@example.com`
  assert.equal(maxEmail.length, 191)
  assert.equal(normalizeAuthorProfileInput(input({ publicEmail: maxEmail })).publicEmail, maxEmail)
  assertValidation(input({ publicEmail: `${'İ'.repeat(184)}@a.co` }), 'publicEmail')
  for (const field of ['displayName', 'slug', 'jobTitle', 'bio', 'expertise', 'avatarUrl', 'publicEmail']) {
    for (const value of [true, 1, [], {}]) assertValidation(input({ [field]: value }), field)
  }
  for (const value of [null, 'true', 'false', 'on', '', 1, 0, {}, []]) assertValidation(input({ isPublic: value }), 'isPublic')
  for (const value of [null, undefined, 'text', true, 1, []]) assertValidation(value)
})

test('invalid input is rejected at real write boundaries with no upsert', async () => {
  for (const value of [null, input({ displayName: '' }), input({ slug: '---' }), input({ avatarUrl: 'javascript:alert(1)' }), input({ isPublic: 'false' })]) {
    scenario()
    assertError(await upsertMyAuthorProfile(value), 'VALIDATION_ERROR')
    assertNoWrite()
    scenario(admin)
    assertError(await upsertAuthorProfileForUser(otherCreator.id, value), 'VALIDATION_ERROR')
    assertNoWrite()
  }
})

test('domain and persistence errors expose only safe fixed errors with no raw details or retries', async () => {
  assert.deepEqual(mapAuthorProfileError(new AuthorProfileError('VALIDATION_ERROR', 'slug')), {
    code: 'VALIDATION_ERROR', message: new AuthorProfileError('VALIDATION_ERROR', 'slug').message, field: 'slug',
  })
  for (const [failure, code] of [
    [knownError('P2034'), 'WRITE_CONFLICT'], [knownError('P2002', ['unknown_field']), 'WRITE_CONFLICT'],
    [knownError('P2003'), 'WRITE_FAILED'], [new Error('PRIVATE database connection details'), 'WRITE_FAILED'],
    [{ code: 'P2002', message: 'PRIVATE forged diagnostic' }, 'WRITE_CONFLICT'],
  ]) {
    scenario(creator, { writeError: failure })
    const result = await upsertMyAuthorProfile(input())
    assertError(result, code)
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
    assert.equal(calls('transaction').length, 1)
    assert.equal(calls('upsert').length, 1)
    assert.equal(current.profile, null)
  }
  for (const errorField of ['userError', 'transactionError']) {
    scenario(creator, { [errorField]: new Error('PRIVATE transaction details') })
    const result = await upsertMyAuthorProfile(input())
    assertError(result, 'WRITE_FAILED')
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
    assertNoWrite()
  }
})

test('Prisma 7 MariaDB structured slug indexes map safely without parsing diagnostic text', async () => {
  const failure = new Prisma.PrismaClientKnownRequestError('PRIVATE SQL and diagnostics', {
    code: 'P2002', clientVersion: 'test', meta: {
      driverAdapterError: { cause: { constraint: { index: 'AuthorProfile_slug_key' } } },
    },
  })
  scenario(creator, { writeError: failure })
  const result = await upsertMyAuthorProfile(input())
  assertError(result, 'SLUG_CONFLICT')
  assert.equal(result.error.field, 'slug')
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
})

test('payload accessors, custom prototypes and malformed errors cannot execute getters or leak details', () => {
  let getterCalls = 0
  const payload = input()
  Object.defineProperty(payload, 'bio', { get() { getterCalls++; throw new Error('PRIVATE getter'); } })
  assertValidation(payload, 'bio')
  assert.equal(getterCalls, 0)
  assertValidation(Object.create(input()))
  const nullPrototype = Object.assign(Object.create(null), input())
  assert.equal(normalizeAuthorProfileInput(nullPrototype).slug, 'nguyen-van-minh')
  const malformed = Object.defineProperty({}, 'code', { get() { getterCalls++; throw new Error('PRIVATE getter'); } })
  assert.equal(mapAuthorProfileError(malformed).code, 'WRITE_FAILED')
  assert.equal(getterCalls, 0)
  const domainError = new AuthorProfileError('FORBIDDEN')
  domainError.message = 'PRIVATE overwritten error message'
  assert.equal(mapAuthorProfileError(domainError).message.includes('PRIVATE'), false)
})

test('public storage failures throw a generic error without exposing raw database diagnostics', async () => {
  const failure = new Error('PRIVATE connection credentials and SQL')
  scenario(creator, { publicError: failure })
  await assert.rejects(getPublicAuthorProfileBySlug('public-author'), error => {
    assert.notEqual(error, failure)
    assert.equal(error.message.includes('PRIVATE'), false)
    assert.equal(error.cause, undefined)
    return true
  })
})
