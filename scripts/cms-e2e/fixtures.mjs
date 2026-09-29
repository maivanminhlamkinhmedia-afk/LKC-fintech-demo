import { randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { resolve, dirname, relative, isAbsolute } from 'node:path'
import { assertDatabaseIdentity, demand, validateStagingEnvironment } from './guard.mjs'
import { CATALOG_MODELS, MAPPING_MODELS, catalogIdentity, seedCatalogPlan, seedCatalogData,
  validateTaxonomyManifest, validateCatalogExpected, readTaxonomyGraph, taxonomyRemainingCounts, deleteTaxonomyEdges, deleteTaxonomyCatalogs } from './taxonomy-fixtures.mjs'
export { catalogCreateData } from './taxonomy-fixtures.mjs'

export const ACTOR_ROLES = { creator: 'CREATOR', other: 'CREATOR', admin: 'ADMIN', super: 'SUPER_ADMIN', analyst: 'ANALYST', client: 'CLIENT' }
export const FIXTURE_STATUSES = ['DRAFT', 'CHANGES_REQUESTED', 'SUBMITTED', 'EDITORIAL_REVIEW', 'FACT_CHECK', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'CORRECTED', 'ARCHIVED']
const EMPTY_DOCUMENT = { type: 'doc', content: [{ type: 'paragraph' }] }
const transactionOptions = { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 }

export function createFixturePlan(runId = randomBytes(12).toString('hex'), version = 3) {
  demand(/^[a-f0-9]{24}$/.test(runId), 'RUN_ID_INVALID')
  demand([1, 2, 3].includes(version), 'MANIFEST_INVALID')
  const namespace = `cms005-e2e-${runId}`
  const users = Object.entries(ACTOR_ROLES).map(([key, role]) => ({ key, role, id: `${namespace}-${key}`, email: `${namespace}-${key}@example.invalid` }))
  const creator = users.find(user => user.key === 'creator')
  const articles = FIXTURE_STATUSES.map(status => ({
    key: status, id: `${namespace}-${status.toLowerCase().replaceAll('_', '-')}`,
    slug: `${namespace}-${status.toLowerCase().replaceAll('_', '-')}`, authorId: creator.id,
    allowedOwnerIds: [creator.id], status,
  }))
  for (const key of ['other', 'super']) {
    const user = users.find(user => user.key === key)
    articles.push({ key: `${key}-draft`, id: `${namespace}-${key}-draft`, slug: `${namespace}-${key}-draft`,
      authorId: user.id, allowedOwnerIds: [user.id], status: 'DRAFT' })
  }
  const manifest = { version, runId, namespace, createdAt: new Date().toISOString(), users, articles, profiles: [] }
  if (version >= 2) manifest.sources = []
  if (version === 3) Object.assign(manifest, { catalogs: seedCatalogPlan(manifest), catalogIntents: [],
    categoryLinks: [], topicMappings: [], tagMappings: [], articleInstruments: [] })
  return manifest
}

export function validateManifest(manifest) {
  demand([1, 2, 3].includes(manifest?.version) && /^[a-f0-9]{24}$/.test(manifest.runId), 'MANIFEST_INVALID')
  const expected = createFixturePlan(manifest.runId)
  demand(manifest.namespace === expected.namespace && Array.isArray(manifest.users)
    && manifest.users.length === 6 && Array.isArray(manifest.articles)
    && Array.isArray(manifest.profiles) && manifest.profiles.length === 0, 'MANIFEST_INVALID')
  for (const fixture of expected.users) {
    const actual = manifest.users.find(user => user.key === fixture.key)
    demand(actual && ['key', 'role', 'id', 'email'].every(field => actual[field] === fixture[field]), 'MANIFEST_USER_MISMATCH')
  }
  const ids = manifest.users.map(user => user.id)
  for (const article of manifest.articles) {
    demand(typeof article.id === 'string' && article.id.length > 0 && article.id.length <= 191
      && typeof article.slug === 'string' && article.slug.startsWith(`${manifest.namespace}-`)
      && Array.isArray(article.allowedOwnerIds) && article.allowedOwnerIds.length > 0
      && article.allowedOwnerIds.every(id => ids.includes(id)), 'MANIFEST_ARTICLE_MISMATCH')
  }
  demand(new Set(manifest.articles.map(article => article.id)).size === manifest.articles.length, 'MANIFEST_DUPLICATE_IDS')
  // A legacy journal never grants permission to delete sources, even if someone
  // adds a sources property to it. No implicit manifest upgrade takes place.
  if (manifest.version === 1) demand(manifest.sources === undefined, 'MANIFEST_V1_HAS_SOURCES')
  else {
    demand(Array.isArray(manifest.sources), 'MANIFEST_SOURCES_INVALID')
    for (const source of manifest.sources) demand(source && Object.keys(source).length === 3
      && Object.keys(source).every(key => ['id', 'articleId', 'createdById'].includes(key))
      && typeof source.id === 'string' && source.id.length > 0 && source.id.length <= 191
      && manifest.articles.some(article => article.id === source.articleId)
      && ids.includes(source.createdById), 'MANIFEST_SOURCE_MISMATCH')
    demand(new Set(manifest.sources.map(source => source.id)).size === manifest.sources.length, 'MANIFEST_DUPLICATE_SOURCE_IDS')
  }
  validateTaxonomyManifest(manifest)
  return manifest
}

export function manifestPath(runId, cwd = process.cwd()) {
  demand(/^[a-f0-9]{24}$/.test(runId), 'RUN_ID_INVALID')
  return resolve(cwd, 'playwright', '.cms-e2e', `${runId}.json`)
}
export function validateManifestPath(path, cwd = process.cwd()) {
  const base = resolve(cwd, 'playwright', '.cms-e2e')
  const target = resolve(path)
  const rel = relative(base, target)
  demand(rel && !rel.startsWith('..') && !isAbsolute(rel) && /^[a-f0-9]{24}\.json$/.test(rel), 'MANIFEST_PATH_INVALID')
  return target
}
export async function saveManifest(path, manifest) {
  validateManifestPath(path)
  validateManifest(manifest)
  await mkdir(dirname(path), { recursive: true })
  // No passwords, hashes, cookies, state, DB URLs or auth secrets are persisted.
  await writeFile(`${path}.tmp`, JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(`${path}.tmp`, path)
}
export async function loadManifest(path) {
  const checked = validateManifestPath(path)
  const manifest = validateManifest(JSON.parse(await readFile(checked, 'utf8')))
  demand(manifestPath(manifest.runId) === checked, 'MANIFEST_PATH_INVALID')
  return manifest
}

export async function createFixtures(db, env, manifest, hashPassword) {
  validateStagingEnvironment(env)
  validateManifest(manifest)
  // New runs start empty; source scenarios create through the real UI and then
  // journal identities. A populated journal is recovery state, not a seed plan.
  demand(!manifest.sources?.length, 'FIXTURE_SOURCE_CREATE_REQUIRES_EMPTY_PLAN')
  if (manifest.version === 3) demand(manifest.catalogIntents.length === 0
    && manifest.catalogs.every(row => row.seedKey !== null)
    && ['categoryLinks', ...Object.keys(MAPPING_MODELS)].every(field => manifest[field].length === 0), 'FIXTURE_TAXONOMY_CREATE_REQUIRES_SEED_PLAN')
  const credentials = Object.fromEntries(manifest.users.map(user => [user.key, { email: user.email, password: randomBytes(24).toString('base64url') }]))
  const users = await Promise.all(manifest.users.map(async user => ({
    id: user.id, email: user.email, name: `${manifest.namespace} ${user.key}`, role: user.role,
    status: 'ACTIVE', password: await hashPassword(credentials[user.key].password),
  })))
  await db.$transaction(async tx => {
    await assertDatabaseIdentity(tx)
    demand(await tx.user.count({ where: { OR: [{ id: { in: users.map(user => user.id) } }, { email: { in: users.map(user => user.email) } }] } }) === 0, 'FIXTURE_ALREADY_EXISTS')
    demand(await tx.article.count({ where: { OR: [{ id: { in: manifest.articles.map(article => article.id) } }, { slug: { in: manifest.articles.map(article => article.slug) } }] } }) === 0, 'FIXTURE_ALREADY_EXISTS')
    if (manifest.version === 3) for (const [kind, model] of Object.entries(CATALOG_MODELS)) {
      const rows = manifest.catalogs.filter(row => row.kind === kind)
      const key = kind === 'instrument' ? 'canonicalKey' : 'slug'
      demand(await tx[model].count({ where: { OR: [{ id: { in: rows.map(row => row.id) } },
        { [key]: { in: rows.map(row => row.identity[key]) } }] } }) === 0, 'FIXTURE_CATALOG_ALREADY_EXISTS')
    }
    if (manifest.version === 3) for (const [kind, model] of Object.entries(CATALOG_MODELS)) {
      const data = manifest.catalogs.filter(row => row.kind === kind).map(row => seedCatalogData(manifest, row))
      demand((await tx[model].createMany({ data })).count === data.length, 'FIXTURE_CATALOG_CREATE_COUNT_MISMATCH')
    }
    demand((await tx.user.createMany({ data: users })).count === 6, 'FIXTURE_CREATE_COUNT_MISMATCH')
    const data = manifest.articles.map(article => ({
      id: article.id, slug: article.slug, authorId: article.authorId, title: `${manifest.namespace} ${article.key}`,
      excerpt: '', contentJson: EMPTY_DOCUMENT, contentText: '', articleType: 'NEWS', status: article.status,
      editorSchemaVersion: 1,
    }))
    demand((await tx.article.createMany({ data })).count === data.length, 'FIXTURE_CREATE_COUNT_MISMATCH')
  }, transactionOptions)
  return credentials
}

const userIds = manifest => manifest.users.map(user => user.id)
const articleWhere = manifest => ({ OR: [
  { id: { in: manifest.articles.map(article => article.id) } }, { authorId: { in: userIds(manifest) } },
] })
const auditWhere = manifest => ({ OR: [
  { actorId: { in: userIds(manifest) } }, { entityType: 'User', entityId: { in: userIds(manifest) } },
] })
const sourceWhere = manifest => ({ OR: [
  { articleId: { in: manifest.articles.map(article => article.id) } },
  { createdById: { in: userIds(manifest) } },
  // Known IDs also detect identity drift that moved BOTH endpoints outside.
  { id: { in: (manifest.sources ?? []).map(source => source.id) } },
] })
export async function remainingCounts(db, manifest) {
  const [articles, profiles, users, logs, sources] = await Promise.all([
    db.article.count({ where: articleWhere(manifest) }),
    db.authorProfile.count({ where: { userId: { in: userIds(manifest) } } }),
    db.user.count({ where: { id: { in: userIds(manifest) } } }),
    db.auditLog.count({ where: auditWhere(manifest) }),
    db.sourceReference.count({ where: sourceWhere(manifest) }),
  ])
  return { articles, profiles, users, logs, sources, ...(manifest.version === 3 ? await taxonomyRemainingCounts(db, manifest) : {}) }
}

// After a lost browser response/runner interruption, discover only articles owned
// by the six exact manifest users. Verify run namespace before recording exact IDs.
// This is never a prefix-wide database query or prefix-wide delete.
export async function discoverCreatedArticles(db, env, manifest, persist) {
  validateStagingEnvironment(env)
  validateManifest(manifest)
  await assertDatabaseIdentity(db)
  const rows = await db.article.findMany({ where: { authorId: { in: userIds(manifest) } }, select: { id: true, slug: true, authorId: true, status: true } })
  for (const row of rows) {
    demand(row.slug.startsWith(`${manifest.namespace}-`) && userIds(manifest).includes(row.authorId), 'UNEXPECTED_FIXTURE_ARTICLE')
    const known = manifest.articles.find(article => article.id === row.id)
    if (!known) manifest.articles.push({ ...row, key: 'ui-created', allowedOwnerIds: [row.authorId] })
    else { demand(known.allowedOwnerIds.includes(row.authorId), 'ARTICLE_OWNER_MISMATCH'); known.slug = row.slug }
  }
  await persist(manifest)
  return manifest
}

async function readFixtureSnapshot(db, manifest, recoverSources = false) {
  validateManifest(manifest)
  await assertDatabaseIdentity(db)
  const taxonomy = manifest.version === 3 ? await readTaxonomyGraph(db, manifest, recoverSources) : null
  const [articles, profiles, users, logs, sources] = await Promise.all([
    db.article.findMany({ where: articleWhere(manifest), select: { id: true, slug: true, authorId: true, editorId: true, categoryId: true, coverMediaId: true, _count: true } }),
    db.authorProfile.findMany({ where: { userId: { in: userIds(manifest) } }, select: { id: true, userId: true } }),
    db.user.findMany({ where: { id: { in: userIds(manifest) } }, select: { id: true, email: true, role: true, status: true, customerProfile: { select: { id: true } }, _count: true } }),
    db.auditLog.findMany({ where: auditWhere(manifest), select: { id: true, actorId: true, action: true, entityType: true, entityId: true } }),
    db.sourceReference.findMany({ where: sourceWhere(manifest), select: { id: true, articleId: true, createdById: true } }),
  ])
  demand(profiles.length === 0, 'UNEXPECTED_AUTHOR_PROFILE')
  demand(manifest.version >= 2 || sources.length === 0, 'MANIFEST_V1_SOURCE_NOT_AUTHORIZED')
  demand(new Set(sources.map(source => source.id)).size === sources.length, 'DUPLICATE_SOURCE_IDENTITY')
  for (const source of sources) {
    demand(typeof source.id === 'string' && source.id.length > 0 && source.id.length <= 191
      && articles.some(article => article.id === source.articleId)
      && users.some(user => user.id === source.createdById), 'SOURCE_ENDPOINT_OUTSIDE_FIXTURE')
    const known = manifest.sources?.find(fixture => fixture.id === source.id)
    demand(known || recoverSources, 'SOURCE_NOT_IN_MANIFEST')
    if (known) demand(known.articleId === source.articleId && known.createdById === source.createdById, 'SOURCE_IDENTITY_MISMATCH')
  }
  for (const article of articles) {
    const known = manifest.articles.find(fixture => fixture.id === article.id)
    demand(known && known.allowedOwnerIds.includes(article.authorId) && article.slug.startsWith(`${manifest.namespace}-`), 'ARTICLE_FIXTURE_MISMATCH')
    const sourceCount = sources.filter(source => source.articleId === article.id).length
    const related = { sources: sourceCount }
    if (taxonomy) for (const [relation, field] of [['topics', 'topicMappings'], ['tags', 'tagMappings'], ['instruments', 'articleInstruments']]) {
      related[relation] = taxonomy[field].filter(row => row.articleId === article.id).length
    }
    demand(!article.editorId && (!article.categoryId || taxonomy?.categoryLinks.some(row => row.articleId === article.id && row.categoryId === article.categoryId)) && !article.coverMediaId
      && article._count && (article._count.sources ?? 0) === sourceCount
      && Object.entries(related).every(([relation, count]) => (article._count[relation] ?? 0) === count)
      && Object.entries(article._count).every(([relation, count]) => Object.hasOwn(related, relation) || count === 0), 'ARTICLE_HAS_UNEXPECTED_RELATIONS')
  }
  for (const user of users) {
    const expected = manifest.users.find(fixture => fixture.id === user.id)
    demand(expected && user.email === expected.email
      && (user.role === expected.role || (expected.role === 'CREATOR' || manifest.version === 3 && ['ADMIN', 'SUPER_ADMIN'].includes(expected.role)) && user.role === 'CLIENT')
      && ['ACTIVE', 'SUSPENDED'].includes(user.status), 'USER_FIXTURE_MISMATCH')
    const sourceCount = sources.filter(source => source.createdById === user.id).length
    demand(!user.customerProfile && user._count && (user._count.sourceReferencesCreated ?? 0) === sourceCount
      && Object.entries(user._count).every(([relation, count]) =>
        ['articlesAuthored', 'auditLogs', 'sourceReferencesCreated'].includes(relation) || count === 0), 'USER_HAS_UNEXPECTED_RELATIONS')
  }
  for (const log of logs) demand(userIds(manifest).includes(log.actorId) && log.action === 'AUTH_LOGIN'
    && log.entityType === 'User' && log.entityId === log.actorId, 'UNEXPECTED_FIXTURE_AUDIT')
  return { articles, profiles, users, logs, sources, taxonomy }
}

export async function fixturePreflight(db, manifest) {
  return readFixtureSnapshot(db, manifest)
}

// Both candidate directions are required: a fixture creator on a foreign parent
// must stop cleanup just like a foreign creator on a fixture parent. Validate ALL
// candidates and existing identities before journaling any newly discovered ID.
export async function discoverCreatedSources(db, env, manifest, persist) {
  validateStagingEnvironment(env)
  validateManifest(manifest)
  if (manifest.version === 3) return discoverFixtureGraph(db, env, manifest, persist)
  if (manifest.version === 1) {
    await fixturePreflight(db, manifest)
    return manifest
  }
  await discoverCreatedArticles(db, env, manifest, persist)
  const fixture = await db.$transaction(tx => readFixtureSnapshot(tx, manifest, true), transactionOptions)
  const sources = [...manifest.sources]
  for (const source of fixture.sources) if (!sources.some(known => known.id === source.id)) sources.push(source)
  const updated = { ...manifest, sources }
  validateManifest(updated)
  await persist(updated)
  manifest.sources = sources
  return manifest
}

// v3 recovery validates the whole catalog/relation/source batch before extending
// any identity journal. An unconfirmed CREATE must still match its initial data.
export async function discoverFixtureGraph(db, env, manifest, persist) {
  validateStagingEnvironment(env); validateManifest(manifest)
  if (manifest.version !== 3) return discoverCreatedSources(db, env, manifest, persist)
  await discoverCreatedArticles(db, env, manifest, persist)
  const fixture = await db.$transaction(tx => readFixtureSnapshot(tx, manifest, true), transactionOptions)
  const updated = { ...manifest, sources: [...manifest.sources], catalogs: [...manifest.catalogs] }
  for (const source of fixture.sources) if (!updated.sources.some(row => row.id === source.id)) updated.sources.push(source)
  for (const { entry } of fixture.taxonomy.catalogs) if (!updated.catalogs.some(row => row.kind === entry.kind && row.id === entry.id)) updated.catalogs.push(entry)
  for (const [field, termKey] of [['categoryLinks', 'categoryId'], ...Object.entries(MAPPING_MODELS).map(([field, [, termKey]]) => [field, termKey])]) {
    updated[field] = [...manifest[field]]
    for (const pair of fixture.taxonomy[field]) if (!updated[field].some(row => row.articleId === pair.articleId && row[termKey] === pair[termKey])) updated[field].push(pair)
  }
  validateManifest(updated)
  await persist(updated)
  for (const field of ['sources', 'catalogs', 'categoryLinks', ...Object.keys(MAPPING_MODELS)]) manifest[field] = updated[field]
  return manifest
}

// Must be called BEFORE UI CREATE. A prefix or a successful-looking UI message
// alone never authorizes adoption of a global catalog row without this journal.
export async function reserveCatalogIntent(db, env, manifest, kind, key, expected, persist) {
  validateStagingEnvironment(env); validateManifest(manifest)
  demand(manifest.version === 3 && Object.hasOwn(CATALOG_MODELS, kind), 'CATALOG_INTENT_NOT_AUTHORIZED')
  validateCatalogExpected(manifest, kind, key, expected)
  const intent = { kind, key, identity: catalogIdentity(kind, expected), expected: { ...expected }, absent: true }
  const updated = { ...manifest, catalogIntents: [...manifest.catalogIntents, intent] }
  validateManifest(updated)
  demand(!manifest.catalogs.some(row => row.kind === kind && Object.keys(row.identity).every(field => row.identity[field] === intent.identity[field])), 'CATALOG_INTENT_KEY_REUSED')
  await db.$transaction(async tx => {
    await fixturePreflight(tx, manifest)
    const field = kind === 'instrument' ? 'canonicalKey' : 'slug'
    demand(await tx[CATALOG_MODELS[kind]].count({ where: { [field]: intent.identity[field] } }) === 0, 'CATALOG_INTENT_COLLISION')
  }, transactionOptions)
  await persist(updated)
  manifest.catalogIntents = updated.catalogIntents
  return intent
}

export async function fixtureCatalog(db, manifest, kind, id) {
  validateManifest(manifest)
  demand(manifest.version === 3 && Object.hasOwn(CATALOG_MODELS, kind), 'CATALOG_NOT_IN_MANIFEST')
  const known = manifest.catalogs.find(row => row.kind === kind && row.id === id)
  demand(known, 'CATALOG_NOT_IN_MANIFEST')
  return db.$transaction(async tx => {
    await fixturePreflight(tx, manifest)
    const row = await tx[CATALOG_MODELS[kind]].findFirst({ where: { id, ...known.identity } })
    demand(row, 'CATALOG_IDENTITY_MISMATCH'); return row
  }, transactionOptions)
}

export async function fixtureClassification(db, manifest, id) {
  validateManifest(manifest)
  demand(manifest.version === 3 && manifest.articles.some(row => row.id === id), 'ARTICLE_NOT_IN_MANIFEST')
  return db.$transaction(async tx => {
    await fixturePreflight(tx, manifest)
    return { article: await fixtureArticle(tx, manifest, id),
      topicMappings: await tx.articleTopicMapping.findMany({ where: { articleId: id }, orderBy: { topicId: 'asc' } }),
      tagMappings: await tx.articleTagMapping.findMany({ where: { articleId: id }, orderBy: { tagId: 'asc' } }),
      articleInstruments: await tx.articleInstrument.findMany({ where: { articleId: id }, orderBy: { instrumentId: 'asc' } }) }
  }, transactionOptions)
}

export async function cleanupFixtures(db, env, manifest, { apply = false } = {}) {
  validateStagingEnvironment(env)
  validateManifest(manifest)
  await db.$transaction(async tx => {
    const fixture = await fixturePreflight(tx, manifest)
    if (!apply) return
    for (const source of fixture.sources) demand((await tx.sourceReference.deleteMany({ where: {
      id: source.id, articleId: source.articleId, createdById: source.createdById,
    } })).count === 1, 'SOURCE_DELETE_COUNT_MISMATCH')
    if (fixture.taxonomy) await deleteTaxonomyEdges(tx, fixture.taxonomy)
    if (fixture.logs.length) demand((await tx.auditLog.deleteMany({ where: {
      id: { in: fixture.logs.map(log => log.id) }, actorId: { in: userIds(manifest) }, action: 'AUTH_LOGIN', entityType: 'User', entityId: { in: userIds(manifest) },
    } })).count === fixture.logs.length, 'AUDIT_DELETE_COUNT_MISMATCH')
    if (fixture.articles.length) demand((await tx.article.deleteMany({ where: { AND: [
      { id: { in: fixture.articles.map(article => article.id) } }, { authorId: { in: userIds(manifest) } },
    ] } })).count === fixture.articles.length, 'ARTICLE_DELETE_COUNT_MISMATCH')
    if (fixture.users.length) demand((await tx.user.deleteMany({ where: {
      id: { in: fixture.users.map(user => user.id) }, email: { in: fixture.users.map(user => user.email) },
    } })).count === fixture.users.length, 'USER_DELETE_COUNT_MISMATCH')
    if (fixture.taxonomy) await deleteTaxonomyCatalogs(tx, manifest, fixture.taxonomy)
    demand(Object.values(await remainingCounts(tx, manifest)).every(count => count === 0), 'FIXTURES_REMAIN_IN_TRANSACTION')
  }, transactionOptions)
  await assertDatabaseIdentity(db)
  const counts = await remainingCounts(db, manifest)
  if (apply) demand(Object.values(counts).every(count => count === 0), 'FIXTURES_REMAIN_AFTER_COMMIT')
  return counts
}

export async function fixtureArticle(db, manifest, id) {
  validateManifest(manifest)
  demand(manifest.articles.some(article => article.id === id), 'ARTICLE_NOT_IN_MANIFEST')
  const row = await db.article.findUnique({ where: { id } })
  demand(row && manifest.articles.find(article => article.id === id).allowedOwnerIds.includes(row.authorId), 'ARTICLE_OWNER_MISMATCH')
  return row
}

export async function fixtureSource(db, manifest, id) {
  validateManifest(manifest)
  const known = manifest.sources?.find(source => source.id === id)
  demand(manifest.version >= 2 && known, 'SOURCE_NOT_IN_MANIFEST')
  await fixturePreflight(db, manifest)
  const row = await db.sourceReference.findFirst({ where: { id, articleId: known.articleId, createdById: known.createdById } })
  demand(row && row.id === known.id && row.articleId === known.articleId && row.createdById === known.createdById, 'SOURCE_IDENTITY_MISMATCH')
  return row
}

// Test-only staging operations for race/revocation checks, not application APIs.
export async function alterFixture(db, env, manifest, kind, id, data, persist) {
  validateStagingEnvironment(env)
  validateManifest(manifest)
  if (kind === 'user') {
    const user = manifest.users.find(user => user.id === id)
    demand(user && Object.keys(data).every(key => ['role', 'status'].includes(key))
      && (data.role === undefined || data.role === user.role || (user.role === 'CREATOR' || manifest.version === 3 && ['ADMIN', 'SUPER_ADMIN'].includes(user.role)) && data.role === 'CLIENT')
      && (data.status === undefined || ['ACTIVE', 'SUSPENDED'].includes(data.status)), 'FIXTURE_MUTATION_REJECTED')
  } else if (kind === 'source') {
    demand(manifest.version >= 2 && manifest.sources.some(source => source.id === id)
      && Object.keys(data).length > 0 && Object.keys(data).every(key => ['title', 'publisher', 'url', 'note'].includes(key))
      && Object.entries(data).every(([key, value]) => key === 'title' ? typeof value === 'string' && value.length <= 180
        : value === null || typeof value === 'string' && value.length <= (key === 'publisher' ? 180 : 4000)), 'FIXTURE_MUTATION_REJECTED')
  } else if (Object.hasOwn(CATALOG_MODELS, kind)) {
    const allowed = ['name', 'updatedAt', ...(kind === 'tag' ? [] : ['isActive']), ...(['category', 'topic'].includes(kind) ? ['description'] : []), ...(kind === 'category' ? ['sortOrder'] : [])]
    demand(manifest.version === 3 && manifest.catalogs.some(row => row.kind === kind && row.id === id)
      && Object.keys(data).length > 0 && Object.keys(data).every(key => allowed.includes(key))
      && (data.updatedAt === undefined || data.updatedAt instanceof Date && Number.isFinite(data.updatedAt.getTime()))
      && (data.name === undefined || typeof data.name === 'string' && data.name.length <= 180)
      && (data.description === undefined || data.description === null || typeof data.description === 'string' && data.description.length <= 4000)
      && (data.isActive === undefined || typeof data.isActive === 'boolean')
      && (data.sortOrder === undefined || Number.isInteger(data.sortOrder) && Math.abs(data.sortOrder) <= 10000), 'FIXTURE_MUTATION_REJECTED')
  } else {
    const article = manifest.articles.find(article => article.id === id)
    demand(kind === 'article' && article && Object.keys(data).every(key => ['status', 'authorId', 'updatedAt', 'editorSchemaVersion'].includes(key))
      && (data.status === undefined || FIXTURE_STATUSES.includes(data.status))
      && (data.authorId === undefined || manifest.users.some(user => user.id === data.authorId && user.role === 'CREATOR'))
      && (data.updatedAt === undefined || data.updatedAt instanceof Date && Number.isFinite(data.updatedAt.getTime()))
      && (data.editorSchemaVersion === undefined || [1, 2].includes(data.editorSchemaVersion)), 'FIXTURE_MUTATION_REJECTED')
  }
  return db.$transaction(async tx => {
    await assertDatabaseIdentity(tx)
    if (kind === 'user') {
      const expected = manifest.users.find(user => user.id === id)
      const current = await tx.user.findUnique({ where: { id }, select: { id: true, email: true, role: true, status: true } })
      demand(current && current.id === expected.id && current.email === expected.email
        && (current.role === expected.role || (expected.role === 'CREATOR' || manifest.version === 3 && ['ADMIN', 'SUPER_ADMIN'].includes(expected.role)) && current.role === 'CLIENT')
        && ['ACTIVE', 'SUSPENDED'].includes(current.status), 'USER_FIXTURE_MISMATCH')
      demand((await tx.user.updateMany({ where: { AND: [
        { id, email: expected.email }, { role: current.role, status: current.status },
      ] }, data })).count === 1, 'FIXTURE_MUTATION_COUNT_MISMATCH')
    } else if (kind === 'source') {
      await fixturePreflight(tx, manifest)
      const expected = manifest.sources.find(source => source.id === id)
      demand((await tx.sourceReference.updateMany({ where: {
        id, articleId: expected.articleId, createdById: expected.createdById,
      }, data })).count === 1, 'FIXTURE_MUTATION_COUNT_MISMATCH')
    } else if (Object.hasOwn(CATALOG_MODELS, kind)) {
      await fixturePreflight(tx, manifest)
      const expected = manifest.catalogs.find(row => row.kind === kind && row.id === id)
      const current = await tx[CATALOG_MODELS[kind]].findFirst({ where: { id, ...expected.identity } })
      demand(current, 'CATALOG_IDENTITY_MISMATCH')
      demand((await tx[CATALOG_MODELS[kind]].updateMany({ where: { id, ...expected.identity, updatedAt: current.updatedAt }, data })).count === 1, 'FIXTURE_MUTATION_COUNT_MISMATCH')
    } else {
      const expected = manifest.articles.find(article => article.id === id)
      const current = await tx.article.findUnique({ where: { id }, select: {
        id: true, authorId: true, slug: true, status: true, updatedAt: true,
        editorId: true, categoryId: true, coverMediaId: true, _count: true,
      } })
      demand(current && expected.allowedOwnerIds.includes(current.authorId)
        && current.slug.startsWith(`${manifest.namespace}-`), 'ARTICLE_FIXTURE_MISMATCH')
      // The same graph checks as cleanup permit only exact journaled sources;
      // all other relations remain forbidden during status/owner race setup.
      await fixturePreflight(tx, manifest)
      // Journal the exact intended fixture owner before commit, so recovery after
      // an interrupted response accepts only the previous or planned owner.
      if (data.authorId && !expected.allowedOwnerIds.includes(data.authorId)) expected.allowedOwnerIds.push(data.authorId)
      await persist(manifest)
      demand((await tx.article.updateMany({ where: { AND: [
        { id, authorId: current.authorId, slug: current.slug }, { status: current.status, updatedAt: current.updatedAt },
      ] }, data })).count === 1, 'FIXTURE_MUTATION_COUNT_MISMATCH')
    }
  }, transactionOptions)
}
