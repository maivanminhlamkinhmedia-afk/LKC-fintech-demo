import 'server-only'

import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { APP_ROLES, hasPermission, type AppRole } from '../../lib/roles'
import type { CatalogResult, ListError, ProductCatalogPort, ProductContentState, ResolveError, ValidateError } from '../../lib/contracts/product-catalog'
import type { SuppliedCatalogProduct } from './product-catalog-contract'
import { projectSelectableCatalog, validateProductSelection } from './product-catalog-policy'

type Purpose = 'display' | 'draft' | 'submit' | 'approve'
type Actor = { readonly id: string; readonly role: AppRole; readonly status: string }
type Row = { id: string; name: string; contentState: ProductContentState; saleStopped: boolean }
type Snapshot = { rows: Row[]; policy: { state: 'AVAILABLE'; catalogVersion: string; items: SuppliedCatalogProduct[] } }
type ReadError = 'FORBIDDEN' | 'PRODUCT_UNAVAILABLE' | 'INTERNAL_ERROR'
const ID = /^[A-Za-z0-9_-]{1,191}$/
const REVISION = /^c01-v1:[a-f0-9]{64}$/
const GROUPS = ['MANUAL_RECOMMENDATION', 'AUTOMATED_RECOMMENDATION', 'PROBABILITY_OUTLOOK'] as const
const denied = <E extends ListError | ValidateError | ResolveError>(error: E): { ok: false; error: E } => ({ ok: false, error })
const byteOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
const validId = (id: unknown): id is string => typeof id === 'string' && ID.test(id)
const record = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input)

// Copy unknown input inside a narrow parse boundary (including proxies/getters).
function fields(input: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  try {
    if (!record(input) || Reflect.ownKeys(input).some(key => typeof key !== 'string' || !allowed.includes(key))) return null
    const out: Record<string, unknown> = {}
    for (const key of allowed) out[key] = Object.hasOwn(input, key) ? input[key] : undefined
    return out
  } catch { return null }
}
function ids(input: unknown): string[] | null {
  try {
    if (!Array.isArray(input) || input.length < 1 || input.length > 50) return null
    const copy: unknown[] = Array.from(input)
    if (copy.length < 1 || copy.length > 50 || !copy.every(validId) || new Set(copy).size !== copy.length) return null
    return copy as string[]
  } catch { return null }
}
type Cursor = { revision: string; lastId: string }
function parseCursor(input: unknown): Cursor | null {
  try {
    if (typeof input !== 'string' || input.length < 1 || input.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(input)) return null
    const bytes = Buffer.from(input, 'base64url')
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const value: unknown = JSON.parse(json)
    if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1 || value[1] !== 'selectable'
      || typeof value[2] !== 'string' || !REVISION.test(value[2]) || !validId(value[3])
      || Buffer.from(JSON.stringify(value), 'utf8').toString('base64url') !== input) return null
    return { revision: value[2], lastId: value[3] }
  } catch { return null }
}

// Only errors from the injected storage boundary are classified. Nothing raw
// (including cause/SQL/message/stack) is copied into a Result; no automatic retry.
function storageError(error: unknown): 'PRODUCT_UNAVAILABLE' | 'INTERNAL_ERROR' {
  try {
    if (record(error) && typeof error.code === 'string'
      && ['P1000', 'P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034',
        'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code)) return 'PRODUCT_UNAVAILABLE'
    // Prisma raw-query errors can wrap MariaDB 1205/1213 in P2010 metadata.
    // Inspect only bounded adapter metadata, never infer from a message string.
    if (record(error)) {
      const meta = record(error.meta) ? error.meta : undefined
      const adapter = meta && record(meta.driverAdapterError) ? meta.driverAdapterError : undefined
      const candidates = [error, meta, adapter, adapter && record(adapter.cause) ? adapter.cause : undefined,
        record(error.cause) ? error.cause : undefined]
      for (const value of candidates) {
        if (value && (value.kind === 'TransactionWriteConflict'
          || [1205, 1213, '1205', '1213'].some(code => value.code === code || value.originalCode === code || value.errno === code))) return 'PRODUCT_UNAVAILABLE'
      }
    }
  } catch { /* A hostile error accessor must not escape the safe boundary. */ }
  return 'INTERNAL_ERROR'
}
function parseRows(input: unknown): Row[] | null {
  try {
    if (!Array.isArray(input)) return null
    const rows: Row[] = [], seen = new Set<string>()
    for (const value of input) {
      if (!record(value)) return null
      const { id, name, contentState, saleStopped } = value
      // MariaDB raw BOOLEAN/TINYINT can be decoded as 0/1; never truthy-coerce.
      const stopped = saleStopped === true || saleStopped === 1 || saleStopped === BigInt(1)
      const validSale = stopped || saleStopped === false || saleStopped === 0 || saleStopped === BigInt(0)
      if (!validId(id) || seen.has(id) || typeof name !== 'string' || name.trim().length === 0
        || (contentState !== 'SELECTABLE' && contentState !== 'UNSELECTABLE' && contentState !== 'RETIRED')
        || !validSale) return null
      seen.add(id)
      rows.push({ id, name, contentState, saleStopped: stopped })
    }
    return rows.sort((a, b) => byteOrder(a.id, b.id))
  } catch { return null }
}

/** Internal assembly target, not a cross-feature API. All reads use caller tx.
 * Caller owns Serializable, Article scope/CAS, failure abort and commit outcome.
 * One scan per operation intentionally contends across the bounded catalog.
 * SQL/ORDER BY/mock traces do not prove MariaDB locks, gaps or rollback.
 */
export function createProductCatalogProducer(tx: Prisma.TransactionClient, actor: Actor, purpose: Purpose): ProductCatalogPort {
  async function snapshot(mutation: boolean): Promise<CatalogResult<Snapshot, ReadError>> {
    let current: unknown
    try {
      current = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true, role: true, status: true } })
    } catch (error) { return denied(storageError(error)) }
    // Parse only storage data here, not the policy logic below.
    let fresh: Actor
    try {
      if (!record(current) || current.id !== actor.id || current.role !== actor.role || current.status !== 'ACTIVE'
        || !APP_ROLES.includes(current.role as AppRole)) return denied('FORBIDDEN')
      fresh = { id: current.id as string, role: current.role as AppRole, status: current.status }
    } catch { return denied('INTERNAL_ERROR') }
    if (!hasPermission(fresh.role, 'cms:access')
      || !(hasPermission(fresh.role, 'cms:article:read:own') || hasPermission(fresh.role, 'cms:article:read:any'))) return denied('FORBIDDEN')
    if (mutation && !(purpose === 'draft'
      ? hasPermission(fresh.role, 'cms:article:update:own') || hasPermission(fresh.role, 'cms:article:update:any')
      : purpose === 'submit' ? hasPermission(fresh.role, 'cms:article:submit')
        : purpose === 'approve' && hasPermission(fresh.role, 'cms:article:approve'))) return denied('FORBIDDEN')
    let raw: unknown
    try {
      raw = await tx.$queryRaw`SELECT id, name, contentState, saleStopped FROM Product FORCE INDEX (PRIMARY) ORDER BY id ASC LIMIT 1001 FOR UPDATE`
    } catch (error) { return denied(storageError(error)) }
    try { if (Array.isArray(raw) && raw.length > 1000) return denied('PRODUCT_UNAVAILABLE') }
    catch { return denied('INTERNAL_ERROR') }
    const rows = parseRows(raw)
    if (!rows) return denied('INTERNAL_ERROR')
    const tuples = rows.map(row => [row.id, row.name, row.contentState, row.saleStopped])
    const catalogVersion = 'c01-v1:' + createHash('sha256').update(Buffer.from(JSON.stringify(tuples), 'utf8')).digest('hex')
    const items: SuppliedCatalogProduct[] = rows.map(row => ({
      kind: 'product', id: row.id as SuppliedCatalogProduct['id'], name: row.name,
      selectableForContent: row.contentState === 'SELECTABLE', retired: row.contentState === 'RETIRED',
      saleStopped: row.saleStopped, benefitGroups: [...GROUPS],
    }))
    return { ok: true, value: { rows, policy: { state: 'AVAILABLE', catalogVersion, items } } }
  }
  return {
    async getSelectableProducts(input) {
      const parsed = fields(input, ['cursor', 'limit'])
      if (!parsed) return denied('VALIDATION_ERROR')
      const limit = parsed.limit === undefined ? 25 : parsed.limit
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 50) return denied('VALIDATION_ERROR')
      const cursor = parsed.cursor === undefined ? undefined : parseCursor(parsed.cursor)
      if (cursor === null) return denied('VALIDATION_ERROR')
      const source = await snapshot(false)
      if (!source.ok) return source
      const projection = projectSelectableCatalog(source.value.policy)
      if (!projection.ok) return denied('INTERNAL_ERROR')
      const { catalogVersion } = projection.value
      if (cursor && cursor.revision !== catalogVersion) return denied('CATALOG_CHANGED')
      if (cursor && !projection.value.items.some(row => row.id === cursor.lastId)) return denied('VALIDATION_ERROR')
      const available = projection.value.items.filter(row => !cursor || byteOrder(row.id, cursor.lastId) > 0)
      const items = available.slice(0, limit).map(row => ({ id: row.id as string, name: row.name, selectableForContent: true as const }))
      const nextCursor = available.length > limit
        ? Buffer.from(JSON.stringify([1, 'selectable', catalogVersion, items[items.length - 1].id]), 'utf8').toString('base64url') : undefined
      return { ok: true, value: { catalogVersion, items, ...(nextCursor === undefined ? {} : { nextCursor }) } }
    },
    async validateArticleProducts(input) {
      const parsed = fields(input, ['ids', 'usage'])
      if (!parsed || (parsed.usage !== 'new-selection' && parsed.usage !== 'retained-reference')) return denied('VALIDATION_ERROR')
      const requested = ids(parsed.ids)
      if (!requested) return denied('VALIDATION_ERROR')
      const source = await snapshot(true)
      if (!source.ok) return source
      const selection = validateProductSelection(requested, source.value.policy, { usage: parsed.usage, maxProductIds: 50 })
      if (!selection.ok) return selection
      return { ok: true, value: { catalogVersion: selection.value.catalogVersion, productIds: [...selection.value.productIds] } }
    },
    async resolveProductReferences(input) {
      const parsed = fields(input, ['ids']), requested = parsed && ids(parsed.ids)
      if (!requested) return denied('VALIDATION_ERROR')
      const source = await snapshot(false)
      if (!source.ok) return source
      const byId = new Map(source.value.rows.map(row => [row.id, row]))
      if (requested.some(id => !byId.has(id))) return denied('PRODUCT_INVALID')
      const items = requested.map(id => {
        const row = byId.get(id)!
        return { id: row.id, name: row.name, contentState: row.contentState, selectableForContent: row.contentState === 'SELECTABLE' }
      })
      return { ok: true, value: { catalogVersion: source.value.policy.catalogVersion, items } }
    },
  }
}
