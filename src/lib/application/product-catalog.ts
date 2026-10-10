import 'server-only'

import type { Prisma } from '@prisma/client'
import { APP_ROLES, hasPermission, type AppRole } from '../roles'
import type { CatalogError, CatalogResult, ProductCatalogPort } from '../contracts/product-catalog'
import { createProductCatalogProducer } from '../../features/products/product-catalog-producer'

/** Caller must supply a live CMS transaction, not request/form assertions.
 * Serializable must actually be configured on the caller's transaction.
 * This marker and structural checks do not prove database isolation/binding.
 * Check Article scope/CAS separately; never preload Product before this port.
 */
export type ProductCatalogServerContext = {
  readonly cmsTx: Prisma.TransactionClient
  readonly freshActor: { readonly id: string; readonly role: AppRole; readonly status: string }
  readonly purpose: 'display' | 'draft' | 'submit' | 'approve'
  readonly isolationLevel: 'Serializable'
}

export function bindProductCatalog(context: ProductCatalogServerContext): CatalogResult<ProductCatalogPort, 'FORBIDDEN' | 'INTERNAL_ERROR'> {
  // A context may still be malformed at an untyped server boundary. Only its
  // parsing is caught; logic outside this boundary is not hidden as bad input.
  let tx: Prisma.TransactionClient, actor: ProductCatalogServerContext['freshActor'], purpose: ProductCatalogServerContext['purpose']
  try {
    const value = context
    if (!value || typeof value !== 'object' || value.isolationLevel !== 'Serializable'
      || !['display', 'draft', 'submit', 'approve'].includes(value.purpose)) return { ok: false, error: 'INTERNAL_ERROR' }
    tx = value.cmsTx
    // Prisma 7 interactive clients may expose $transaction. Lifecycle methods
    // reject roots; this shape check is not proof of a trusted/live transaction.
    if (!tx || typeof tx !== 'object' || Reflect.has(tx, '$connect') || Reflect.has(tx, '$disconnect')
      || typeof tx.$queryRaw !== 'function' || typeof tx.user?.findUnique !== 'function') return { ok: false, error: 'INTERNAL_ERROR' }
    const supplied = value.freshActor
    if (!supplied || typeof supplied.id !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(supplied.id)
      || supplied.status !== 'ACTIVE' || !APP_ROLES.includes(supplied.role)
      || !hasPermission(supplied.role, 'cms:access')
      || !(hasPermission(supplied.role, 'cms:article:read:own') || hasPermission(supplied.role, 'cms:article:read:any'))) return { ok: false, error: 'FORBIDDEN' }
    actor = { id: supplied.id, role: supplied.role, status: supplied.status }
    purpose = value.purpose
  } catch { return { ok: false, error: 'INTERNAL_ERROR' } }
  return { ok: true, value: createProductCatalogProducer(tx, actor, purpose) }
}

const ERROR_CODES: readonly CatalogError[] = [
  'VALIDATION_ERROR', 'FORBIDDEN', 'PRODUCT_UNAVAILABLE', 'INTERNAL_ERROR',
  'CATALOG_CHANGED', 'PRODUCT_INVALID', 'POLICY_UNRESOLVED',
]
/** Allow this exception to escape the CMS transaction callback. Catch outside.
 * Returning an ordinary failed Result from that callback can COMMIT prior writes.
 * This helper does not commit/rollback or retry, and cannot resolve lost ACKs.
 */
export class ProductCatalogAbort extends Error {
  readonly code: CatalogError
  constructor(code: CatalogError) {
    const safe = ERROR_CODES.includes(code) ? code : 'INTERNAL_ERROR'
    super(safe)
    this.name = 'ProductCatalogAbort'
    this.code = safe
  }
}
export function requireCatalogSuccess<T>(result: CatalogResult<T, CatalogError>): T {
  if (!result.ok) throw new ProductCatalogAbort(result.error)
  return result.value
}
