import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { ArticleStatus } from '@prisma/client'
import { APP_ROLES, ROLE_PERMISSIONS, hasPermission } from '../src/lib/roles.ts'

const accessUrl = new URL('../src/features/cms/access.ts', import.meta.url).href
const rolesUrl = new URL('../src/lib/roles.ts', import.meta.url).href
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === accessUrl && specifier === '@/lib/roles') return nextResolve(rolesUrl, context)
    return nextResolve(specifier, context)
  },
})
const {
  canAccessCms, canCreateArticle, canReadArticle, canUpdateArticle,
  canSubmitArticle, canReviewArticle, canApproveArticle, canPublishArticle,
  articleCmsScope,
} = await import(accessUrl)
hook.deregister()

const creator = { id: 'creator-a', role: 'CREATOR' }
const admin = { id: 'admin-a', role: 'ADMIN' }
const own = { id: 'article-a', authorId: creator.id, status: 'DRAFT' }
const another = { id: 'article-b', authorId: 'creator-b', status: 'DRAFT' }
const articlePolicies = [canReadArticle, canUpdateArticle, canSubmitArticle, canReviewArticle, canApproveArticle, canPublishArticle]
const cmsPermissions = [
  'cms:access', 'cms:article:create', 'cms:article:read:own', 'cms:article:read:any',
  'cms:article:update:own', 'cms:article:update:any', 'cms:article:submit',
  'cms:article:review', 'cms:article:approve', 'cms:article:publish', 'cms:admin',
]
const creatorPermissions = [
  'cms:access', 'cms:article:create', 'cms:article:read:own',
  'cms:article:update:own', 'cms:article:submit',
]
const deniedRoles = ['MANAGER', 'SALES_MANAGER', 'SALES', 'ANALYST', 'EMPLOYEE', 'CLIENT']

const scenarios = [
  ['RBAC-01', 'SUPER_ADMIN accesses CMS', () => canAccessCms({ id: 'super', role: 'SUPER_ADMIN' }), true],
  ['RBAC-02', 'ADMIN accesses CMS', () => canAccessCms(admin), true],
  ['RBAC-03', 'CREATOR accesses CMS', () => canAccessCms(creator), true],
  ['RBAC-04', 'MANAGER cannot access CMS', () => canAccessCms({ id: 'manager', role: 'MANAGER' }), false],
  ['RBAC-05', 'SALES_MANAGER cannot access CMS', () => canAccessCms({ id: 'sales-manager', role: 'SALES_MANAGER' }), false],
  ['RBAC-06', 'SALES cannot access CMS', () => canAccessCms({ id: 'sales', role: 'SALES' }), false],
  ['RBAC-07', 'ANALYST cannot access CMS', () => canAccessCms({ id: 'analyst', role: 'ANALYST' }), false],
  ['RBAC-08', 'EMPLOYEE cannot access CMS', () => canAccessCms({ id: 'employee', role: 'EMPLOYEE' }), false],
  ['RBAC-09', 'CLIENT cannot access CMS', () => canAccessCms({ id: 'client', role: 'CLIENT' }), false],
  ['RBAC-10', 'CREATOR reads own article', () => canReadArticle(creator, own), true],
  ['RBAC-11', 'CREATOR cannot read another article', () => canReadArticle(creator, another), false],
  ['RBAC-12', 'CREATOR updates own DRAFT', () => canUpdateArticle(creator, own), true],
  ['RBAC-13', 'CREATOR updates own CHANGES_REQUESTED', () => canUpdateArticle(creator, { ...own, status: 'CHANGES_REQUESTED' }), true],
  ['RBAC-14', 'CREATOR cannot update own SUBMITTED', () => canUpdateArticle(creator, { ...own, status: 'SUBMITTED' }), false],
  ['RBAC-15', 'CREATOR cannot update another DRAFT', () => canUpdateArticle(creator, another), false],
  ['RBAC-16', 'CREATOR submits own article', () => canSubmitArticle(creator, own), true],
  ['RBAC-17', 'CREATOR cannot submit another article', () => canSubmitArticle(creator, another), false],
  ['RBAC-18', 'CREATOR cannot review own article', () => canReviewArticle(creator, own), false],
  ['RBAC-19', 'CREATOR cannot approve own article', () => canApproveArticle(creator, own), false],
  ['RBAC-20', 'CREATOR cannot publish own article', () => canPublishArticle(creator, own), false],
  ['RBAC-21', 'ADMIN reads another article', () => canReadArticle(admin, another), true],
  ['RBAC-22', 'ADMIN updates another article', () => canUpdateArticle(admin, another), true],
  ['RBAC-23', 'ADMIN reviews an article', () => canReviewArticle(admin, another), true],
  ['RBAC-24', 'ADMIN approves an article', () => canApproveArticle(admin, another), true],
  ['RBAC-25', 'ADMIN publishes an article', () => canPublishArticle(admin, another), true],
]

for (const [id, description, check, expected] of scenarios) {
  test(`${id}: ${description}`, () => assert.equal(check(), expected))
}

test('CMS permission matrix grants exactly the specified permissions with no hard delete', () => {
  for (const role of APP_ROLES) {
    const expected = ['SUPER_ADMIN', 'ADMIN'].includes(role) ? cmsPermissions : role === 'CREATOR' ? creatorPermissions : []
    assert.deepEqual(ROLE_PERMISSIONS[role].filter(p => p.startsWith('cms:')), expected, role)
    for (const permission of cmsPermissions) assert.equal(hasPermission(role, permission), expected.includes(permission), `${role}: ${permission}`)
    assert.equal(hasPermission(role, 'cms:article:delete'), false)
    assert.equal(canCreateArticle({ id: 'viewer', role }), ['SUPER_ADMIN', 'ADMIN', 'CREATOR'].includes(role))
  }
})

test('all pre-CMS roles and non-CMS permission sets remain unchanged', () => {
  const all = ['admin:access', 'users:read', 'users:write', 'sales:read', 'sales:write', 'content:read', 'content:write', 'analysis:read', 'analysis:write', 'chart:use', 'learning:use', 'account:self']
  const previous = {
    SUPER_ADMIN: all,
    ADMIN: all,
    MANAGER: ['users:read', 'sales:read', 'content:read', 'analysis:read', 'chart:use', 'learning:use'],
    SALES_MANAGER: ['sales:read', 'sales:write', 'users:read', 'chart:use', 'learning:use'],
    SALES: ['sales:read', 'sales:write', 'chart:use', 'learning:use'],
    CREATOR: ['content:read', 'content:write', 'analysis:read', 'chart:use', 'learning:use'],
    ANALYST: ['analysis:read', 'analysis:write', 'content:read', 'chart:use', 'learning:use'],
    EMPLOYEE: ['content:read', 'chart:use', 'learning:use'],
    CLIENT: ['chart:use', 'learning:use', 'account:self'],
  }
  assert.deepEqual(APP_ROLES, Object.keys(previous))
  for (const [role, permissions] of Object.entries(previous)) {
    assert.deepEqual(ROLE_PERMISSIONS[role].filter(p => !p.startsWith('cms:')), permissions, role)
    for (const permission of all) assert.equal(hasPermission(role, permission), permissions.includes(permission), `${role}: ${permission}`)
  }
})

test('creator policies cover every schema status without introducing submit transitions', () => {
  for (const status of Object.values(ArticleStatus)) {
    const article = { ...own, status }
    assert.equal(canReadArticle(creator, article), true, status)
    assert.equal(canSubmitArticle(creator, article), true, status)
    assert.equal(canUpdateArticle(creator, article), ['DRAFT', 'CHANGES_REQUESTED'].includes(status), status)
    for (const policy of articlePolicies) assert.equal(policy(creator, { ...another, status }), false, `${policy.name}: ${status}`)
    for (const policy of [canReviewArticle, canApproveArticle, canPublishArticle]) assert.equal(policy(creator, article), false)
  }
  assert.equal(canUpdateArticle(creator, { ...own, status: 'UNKNOWN' }), false)
})

test('both admin roles can operate across owners at every workflow status', () => {
  for (const role of ['SUPER_ADMIN', 'ADMIN']) {
    const user = { id: 'admin-viewer', role }
    for (const status of Object.values(ArticleStatus)) {
      for (const authorId of [user.id, creator.id]) {
        for (const policy of articlePolicies) assert.equal(policy(user, { ...own, authorId, status }), true, `${role}: ${policy.name}: ${status}`)
      }
    }
  }
})

test('every non-CMS role is denied all article policies even if it owns the article', () => {
  for (const role of deniedRoles) {
    const user = { id: creator.id, role }
    for (const status of Object.values(ArticleStatus)) {
      for (const policy of articlePolicies) assert.equal(policy(user, { ...own, status }), false, `${role}: ${policy.name}: ${status}`)
    }
    assert.deepEqual(articleCmsScope(user), { id: { in: [] } })
  }
})

test('CMS query scope is unrestricted only for admins and isolates each creator identity', () => {
  for (const role of ['SUPER_ADMIN', 'ADMIN']) assert.deepEqual(articleCmsScope({ id: 'admin', role }), {})
  for (const id of ['creator-a', 'creator-b']) assert.deepEqual(articleCmsScope({ id, role: 'CREATOR' }), { authorId: id })
  const first = articleCmsScope({ id: 'client', role: 'CLIENT' })
  first.id.in.push(own.id)
  assert.deepEqual(articleCmsScope({ id: 'client', role: 'CLIENT' }), { id: { in: [] } })
})

test('missing identity and unknown roles fail closed across all policies and scopes', () => {
  const users = [null, undefined, ...APP_ROLES.flatMap(role => [{ id: '', role }, { id: '  ', role }]), ...['UNKNOWN', '__proto__', 'constructor', 'toString'].map(role => ({ id: creator.id, role }))]
  for (const user of users) {
    assert.equal(canAccessCms(user), false)
    assert.equal(canCreateArticle(user), false)
    for (const policy of articlePolicies) assert.equal(policy(user, own), false, policy.name)
    assert.deepEqual(articleCmsScope(user), { id: { in: [] } })
  }
})

test('missing articles never grant authority and policy checks do not mutate trusted inputs', () => {
  for (const role of ['SUPER_ADMIN', 'ADMIN', 'CREATOR']) {
    const user = Object.freeze({ id: creator.id, role })
    for (const article of [null, undefined, { ...own, id: '' }]) {
      for (const policy of articlePolicies) assert.equal(policy(user, article), false, policy.name)
    }
    const article = Object.freeze({ ...own })
    for (const policy of articlePolicies) policy(user, article)
    articleCmsScope(user)
    assert.deepEqual(article, own)
  }
})
