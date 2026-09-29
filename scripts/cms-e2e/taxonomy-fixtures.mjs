import { demand } from './guard.mjs'

// Explicit delegates only. These helpers never derive a table from user input.
export const CATALOG_MODELS = Object.freeze({ category: 'articleCategory', topic: 'articleTopic', tag: 'articleTag', instrument: 'financialInstrument' })
export const MAPPING_MODELS = Object.freeze({ topicMappings: ['articleTopicMapping', 'topicId', 'topic'],
  tagMappings: ['articleTagMapping', 'tagId', 'tag'], articleInstruments: ['articleInstrument', 'instrumentId', 'instrument'] })
const keys = (value, fields) => value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === fields.length && fields.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
  })
const same = (one, two) => one && two && keys(one, Object.keys(two)) && keys(two, Object.keys(one))
  && Object.keys(one).every(key => one[key] === two[key])
const idValid = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,191}$/.test(id)
const kindValid = kind => typeof kind === 'string' && Object.hasOwn(CATALOG_MODELS, kind)
const naturalField = kind => kind === 'instrument' ? 'canonicalKey' : 'slug'
export const catalogIdentity = (kind, data) => kind === 'instrument'
  ? { canonicalKey: data.instrumentType === 'FX' || data.instrumentType === 'CRYPTO' ? `${data.instrumentType}:${data.symbol}`
    : data.exchange ? `${data.exchange}:${data.symbol}` : data.symbol,
  symbol: data.symbol, instrumentType: data.instrumentType, exchange: data.exchange }
  : { slug: data.slug }

export function catalogCreateData(manifest, kind, key, overrides = {}) {
  demand(kindValid(kind) && typeof key === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) && key.length <= 24, 'CATALOG_INTENT_KEY_INVALID')
  const base = { name: `${manifest.namespace} ${kind} ${key}` }
  if (kind === 'instrument') Object.assign(base, { symbol: `QA${manifest.runId.toUpperCase()}${key.replaceAll('-', '').toUpperCase()}`,
    instrumentType: 'INDEX', exchange: null, countryCode: 'VN', currency: 'VND', isActive: true })
  else {
    base.slug = `${manifest.namespace}-tax-${kind}-${key}`
    if (kind !== 'tag') Object.assign(base, { description: null, isActive: true })
    if (kind === 'category') base.sortOrder = 0
  }
  return { ...base, ...overrides }
}

export function seedCatalogPlan(manifest) {
  return Object.keys(CATALOG_MODELS).flatMap(kind => Array.from({ length: 27 }, (_, index) => {
    const seedKey = `seed-${String(index + 1).padStart(2, '0')}`
    return { kind, id: `${manifest.namespace}-tax-${kind}-${seedKey}`, identity: catalogIdentity(kind, catalogCreateData(manifest, kind, seedKey)), seedKey }
  }))
}
export function seedCatalogData(manifest, row) {
  const data = catalogCreateData(manifest, row.kind, row.seedKey)
  if (row.seedKey === 'seed-27' && row.kind !== 'tag') data.isActive = false
  if (row.kind === 'category') data.sortOrder = Number(row.seedKey.slice(-2))
  return { id: row.id, ...data, ...(row.kind === 'instrument' ? { canonicalKey: row.identity.canonicalKey } : {}) }
}

export function validateCatalogExpected(manifest, kind, key, expected) {
  const template = catalogCreateData(manifest, kind, key)
  demand(keys(expected, Object.keys(template)), 'CATALOG_EXPECTED_INVALID')
  demand(typeof expected.name === 'string' && expected.name.length > 0 && [...expected.name].length <= 180
    && expected.name === expected.name.trim().normalize('NFC')
    && !/[\x00-\x1f\x7f]/.test(expected.name), 'CATALOG_EXPECTED_INVALID')
  if (kind !== 'instrument') demand(expected.slug === template.slug, 'CATALOG_IDENTITY_OUTSIDE_RUN')
  else demand(typeof expected.symbol === 'string' && expected.symbol.startsWith(`QA${manifest.runId.toUpperCase()}`)
    && /^[A-Z0-9][A-Z0-9._/-]{0,47}$/.test(expected.symbol)
    && ['INDEX', 'EQUITY', 'FUTURE', 'ETF', 'FUND', 'BOND', 'COMMODITY', 'FX', 'CRYPTO', 'OTHER'].includes(expected.instrumentType)
    && (expected.exchange === null || typeof expected.exchange === 'string' && /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(expected.exchange))
    && (!['FX', 'CRYPTO'].includes(expected.instrumentType) ? !['FX', 'CRYPTO'].includes(expected.exchange) : expected.exchange === null)
    && (expected.countryCode === null || typeof expected.countryCode === 'string' && /^[A-Z]{2}$/.test(expected.countryCode))
    && (expected.currency === null || typeof expected.currency === 'string' && /^[A-Z]{3}$/.test(expected.currency)), 'CATALOG_EXPECTED_INVALID')
  if (kind !== 'tag') demand(typeof expected.isActive === 'boolean', 'CATALOG_EXPECTED_INVALID')
  if (kind === 'topic' || kind === 'category') demand(expected.description === null
    || typeof expected.description === 'string' && [...expected.description].length > 0 && [...expected.description].length <= 4000
      && expected.description === expected.description.trim().normalize('NFC'), 'CATALOG_EXPECTED_INVALID')
  if (kind === 'category') demand(Number.isInteger(expected.sortOrder) && Math.abs(expected.sortOrder) <= 10000, 'CATALOG_EXPECTED_INVALID')
}

export function validateTaxonomyManifest(manifest) {
  const fields = ['catalogs', 'catalogIntents', 'categoryLinks', ...Object.keys(MAPPING_MODELS)]
  if (manifest.version !== 3) {
    demand(fields.every(field => manifest[field] === undefined), 'LEGACY_TAXONOMY_NOT_AUTHORIZED')
    return
  }
  demand(keys(manifest, ['version', 'runId', 'namespace', 'createdAt', 'users', 'articles', 'profiles', 'sources', ...fields]), 'MANIFEST_V3_KEYS_INVALID')
  demand(fields.every(field => Array.isArray(manifest[field])), 'MANIFEST_TAXONOMY_INVALID')
  const seeds = seedCatalogPlan(manifest)
  const identities = new Set(), knownIds = new Set()
  for (const intent of manifest.catalogIntents) {
    demand(keys(intent, ['kind', 'key', 'identity', 'expected', 'absent']) && kindValid(intent.kind)
      && intent.absent === true && typeof intent.key === 'string' && !/^seed-/.test(intent.key), 'CATALOG_INTENT_INVALID')
    validateCatalogExpected(manifest, intent.kind, intent.key, intent.expected)
    demand(same(intent.identity, catalogIdentity(intent.kind, intent.expected)), 'CATALOG_INTENT_IDENTITY_INVALID')
    const identity = `${intent.kind}:${intent.identity[naturalField(intent.kind)]}`
    demand(!identities.has(identity), 'CATALOG_INTENT_DUPLICATE'); identities.add(identity)
  }
  identities.clear()
  for (const catalog of manifest.catalogs) {
    demand(keys(catalog, ['kind', 'id', 'identity', 'seedKey']) && kindValid(catalog.kind) && idValid(catalog.id), 'CATALOG_JOURNAL_INVALID')
    const seed = catalog.seedKey === null ? null : seeds.find(row => row.kind === catalog.kind && row.seedKey === catalog.seedKey)
    const intent = catalog.seedKey === null ? manifest.catalogIntents.find(row => row.kind === catalog.kind && same(row.identity, catalog.identity)) : null
    demand(seed ? seed.id === catalog.id && same(seed.identity, catalog.identity) : !!intent, 'CATALOG_JOURNAL_IDENTITY_INVALID')
    const identity = `${catalog.kind}:${catalog.identity[naturalField(catalog.kind)]}`
    demand(!identities.has(identity) && !knownIds.has(`${catalog.kind}:${catalog.id}`), 'CATALOG_JOURNAL_DUPLICATE')
    identities.add(identity); knownIds.add(`${catalog.kind}:${catalog.id}`)
  }
  demand(seeds.every(seed => manifest.catalogs.some(row => row.kind === seed.kind && row.id === seed.id)), 'CATALOG_SEED_PLAN_MISSING')
  for (const [field, termKey, kind] of [['categoryLinks', 'categoryId', 'category'],
    ...Object.entries(MAPPING_MODELS).map(([field, [, termKey, kind]]) => [field, termKey, kind])]) {
    const pairs = new Set()
    for (const row of manifest[field]) {
      demand(keys(row, ['articleId', termKey]) && manifest.articles.some(article => article.id === row.articleId)
        && manifest.catalogs.some(catalog => catalog.kind === kind && catalog.id === row[termKey]), 'MAPPING_JOURNAL_INVALID')
      const pair = `${row.articleId}:${row[termKey]}`
      demand(!pairs.has(pair), 'MAPPING_JOURNAL_DUPLICATE'); pairs.add(pair)
    }
  }
}

export function catalogWhere(manifest, kind) {
  return { OR: [{ id: { in: manifest.catalogs.filter(row => row.kind === kind).map(row => row.id) } },
    { [naturalField(kind)]: { in: [...manifest.catalogs.filter(row => row.kind === kind).map(row => row.identity[naturalField(kind)]),
      ...manifest.catalogIntents.filter(row => row.kind === kind).map(row => row.identity[naturalField(kind)])] } }] }
}
export function mappingWhere(manifest, termKey, kind) {
  return { OR: [{ articleId: { in: manifest.articles.map(row => row.id) } },
    { [termKey]: { in: manifest.catalogs.filter(row => row.kind === kind).map(row => row.id) } }] }
}
export function categoryLinksWhere(manifest) {
  return { OR: [{ AND: [{ id: { in: manifest.articles.map(row => row.id) } }, { categoryId: { not: null } }] },
    { categoryId: { in: manifest.catalogs.filter(row => row.kind === 'category').map(row => row.id) } }] }
}

export async function readTaxonomyGraph(db, manifest, recover = false) {
  const catalogs = []
  for (const [kind, model] of Object.entries(CATALOG_MODELS)) {
    const rows = await db[model].findMany({ where: catalogWhere(manifest, kind) })
    demand(new Set(rows.map(row => row.id)).size === rows.length, 'CATALOG_DUPLICATE_CANDIDATE')
    for (const row of rows) {
      const known = manifest.catalogs.find(entry => entry.kind === kind && entry.id === row.id)
      const identity = kind === 'instrument' ? { canonicalKey: row.canonicalKey, symbol: row.symbol, instrumentType: row.instrumentType, exchange: row.exchange } : { slug: row.slug }
      if (known) demand(same(known.identity, identity), 'CATALOG_KNOWN_IDENTITY_DRIFT')
      else {
        const occupied = manifest.catalogs.some(entry => entry.kind === kind && same(entry.identity, identity))
        demand(!occupied, 'CATALOG_KNOWN_KEY_REPLACED')
        const intent = manifest.catalogIntents.find(entry => entry.kind === kind && same(entry.identity, identity))
        demand(recover && intent && Object.keys(intent.expected).every(key => row[key] === intent.expected[key]), 'CATALOG_UNCONFIRMED_CREATE_MISMATCH')
      }
      catalogs.push({ kind, row, entry: known ?? { kind, id: row.id, identity, seedKey: null } })
    }
  }
  // Newly recovered catalog IDs must participate in reverse reference checks
  // before any ID can be journaled; recovery validates the entire batch.
  const expanded = { ...manifest, catalogs: [...manifest.catalogs] }
  for (const catalog of catalogs) if (!expanded.catalogs.some(row => row.kind === catalog.kind && row.id === catalog.row.id)) expanded.catalogs.push(catalog.entry)
  const graph = { catalogs, categoryLinks: [], topicMappings: [], tagMappings: [], articleInstruments: [] }
  const categories = await db.article.findMany({ where: categoryLinksWhere(expanded), select: { id: true, categoryId: true } })
  graph.categoryLinks = categories.filter(row => row.categoryId !== null).map(row => ({ articleId: row.id, categoryId: row.categoryId }))
  for (const [field, [model, termKey]] of Object.entries(MAPPING_MODELS)) graph[field] = await db[model].findMany({
    where: mappingWhere(expanded, termKey, MAPPING_MODELS[field][2]), select: { articleId: true, [termKey]: true },
  })
  for (const [field, termKey, kind] of [['categoryLinks', 'categoryId', 'category'],
    ...Object.entries(MAPPING_MODELS).map(([field, [, termKey, kind]]) => [field, termKey, kind])]) {
    const pairs = new Set()
    for (const row of graph[field]) {
      demand(manifest.articles.some(article => article.id === row.articleId)
        && catalogs.some(catalog => catalog.kind === kind && catalog.row.id === row[termKey]), 'TAXONOMY_ENDPOINT_OUTSIDE_FIXTURE')
      demand(recover || manifest[field].some(known => known.articleId === row.articleId && known[termKey] === row[termKey]), 'MAPPING_NOT_IN_MANIFEST')
      const pair = `${row.articleId}:${row[termKey]}`
      demand(!pairs.has(pair), 'DUPLICATE_MAPPING_IDENTITY'); pairs.add(pair)
    }
  }
  return graph
}

export async function taxonomyRemainingCounts(db, manifest) {
  const result = {}
  for (const [kind, model] of Object.entries(CATALOG_MODELS)) result[{ category: 'categories', topic: 'topics', tag: 'tags', instrument: 'instruments' }[kind]] = await db[model].count({ where: catalogWhere(manifest, kind) })
  result.categoryLinks = await db.article.count({ where: categoryLinksWhere(manifest) })
  for (const [field, [model, termKey, kind]] of Object.entries(MAPPING_MODELS)) result[field] = await db[model].count({ where: mappingWhere(manifest, termKey, kind) })
  return result
}

export async function deleteTaxonomyEdges(db, graph) {
  for (const [field, [model, termKey]] of Object.entries(MAPPING_MODELS)) for (const row of graph[field]) demand((await db[model].deleteMany({
    where: { articleId: row.articleId, [termKey]: row[termKey] },
  })).count === 1, 'MAPPING_DELETE_COUNT_MISMATCH')
  for (const row of graph.categoryLinks) demand((await db.article.updateMany({ where: { id: row.articleId, categoryId: row.categoryId }, data: { categoryId: null } })).count === 1, 'CATEGORY_CLEAR_COUNT_MISMATCH')
}
export async function deleteTaxonomyCatalogs(db, manifest, graph) {
  const remaining = await readTaxonomyGraph(db, manifest)
  demand(['categoryLinks', ...Object.keys(MAPPING_MODELS)].every(field => remaining[field].length === 0), 'CATALOG_STILL_REFERENCED')
  for (const [kind, model] of Object.entries(CATALOG_MODELS)) {
    const rows = graph.catalogs.filter(catalog => catalog.kind === kind)
    if (!rows.length) continue
    // Batch only a finite OR of already validated exact identities; this avoids
    // one tunnel round-trip per seed while retaining identity/count guarantees.
    demand((await db[model].deleteMany({ where: { OR: rows.map(({ row, entry }) => ({ id: row.id, ...entry.identity })) } })).count === rows.length, 'CATALOG_DELETE_COUNT_MISMATCH')
  }
}
