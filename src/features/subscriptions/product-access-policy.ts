import type {
  ProductAccessDenyReason,
  SuppliedAccessActor,
  SuppliedAccessCatalog,
  SuppliedAccessEntitlements,
  SuppliedAccessPeriod,
  SuppliedAccessPolicy,
  SuppliedProductAccessDecision,
  SuppliedProductAccessInput,
} from './product-access-contract.ts'

// Technical parsing bounds, not commercial limits or production configuration.
const MAX_PRODUCTS = 1000
const MAX_AUDIENCE = 50
const MAX_PERIODS = 10000
const GROUPS = ['MANUAL_RECOMMENDATION', 'AUTOMATED_RECOMMENDATION', 'PROBABILITY_OUTLOOK'] as const
const ID = /^[A-Za-z0-9_-]{1,191}$/

function deny(reason: ProductAccessDenyReason): SuppliedProductAccessDecision {
  return Object.freeze({ basis: 'SUPPLIED_SNAPSHOTS_ONLY', runtimeAuthorized: false, allow: false, reason })
}

function allow(): SuppliedProductAccessDecision {
  return Object.freeze({ basis: 'SUPPLIED_SNAPSHOTS_ONLY', runtimeAuthorized: false, allow: true, reason: 'ALLOW' })
}

function deniedReasons(reasons: ReadonlySet<ProductAccessDenyReason>): SuppliedProductAccessDecision {
  const only = reasons.values().next().value
  return deny(reasons.size === 1 && only ? only : 'POLICY_UNRESOLVED')
}

// Read own data descriptors once; never invoke supplied accessors/iterators.
// Proxy reflection failures are caught only in the input parsing boundary below.
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null
  const own = Reflect.ownKeys(value)
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return null
  const copy: Record<string, unknown> = Object.create(null)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null
    copy[key] = descriptor.value
  }
  return copy
}

function list(value: unknown, cap: number): unknown[] | null {
  if (!Array.isArray(value)) return null
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  const length: unknown = lengthDescriptor?.value
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0 || length > cap) return null
  if (Reflect.ownKeys(value).length !== length + 1) return null
  const copy: unknown[] = []
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null
    copy.push(descriptor.value)
  }
  return copy
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && ID.test(value)
}

function instant(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 8640000000000000
}

function actor(value: unknown): SuppliedAccessActor | null {
  const guest = fields(value, ['state'])
  if (guest?.state === 'GUEST') return { state: 'GUEST' }
  const present = fields(value, ['state', 'subjectId', 'status'])
  if (!present || present.state !== 'PRESENT' || !validId(present.subjectId)
    || (present.status !== 'ACTIVE' && present.status !== 'INACTIVE')) return null
  return { state: 'PRESENT', subjectId: present.subjectId, status: present.status }
}

function catalog(value: unknown): SuppliedAccessCatalog | null {
  const unavailable = fields(value, ['state'])
  if (unavailable?.state === 'UNAVAILABLE') return { state: 'UNAVAILABLE' }
  const available = fields(value, ['state', 'products'])
  if (!available || available.state !== 'AVAILABLE') return null
  const products = list(available.products, MAX_PRODUCTS)
  if (!products) return null
  const seen = new Set<string>()
  const copy = []
  for (const item of products) {
    const product = fields(item, ['kind', 'id', 'saleStopped'])
    if (!product || product.kind !== 'PRODUCT' || !validId(product.id) || seen.has(product.id)
      || typeof product.saleStopped !== 'boolean') return null
    seen.add(product.id)
    copy.push({ kind: 'PRODUCT' as const, id: product.id, saleStopped: product.saleStopped })
  }
  return { state: 'AVAILABLE', products: copy }
}

function entitlements(value: unknown): SuppliedAccessEntitlements | null {
  const unavailable = fields(value, ['state'])
  if (unavailable?.state === 'UNAVAILABLE') return { state: 'UNAVAILABLE' }
  const available = fields(value, ['state', 'subjectId', 'periods'])
  if (!available || available.state !== 'AVAILABLE' || !validId(available.subjectId)) return null
  const periods = list(available.periods, MAX_PERIODS)
  if (!periods) return null
  const seen = new Set<string>()
  const copy: SuppliedAccessPeriod[] = []
  for (const item of periods) {
    const period = fields(item, ['periodId', 'productId', 'startsAt', 'endsAt', 'revoked'])
    if (!period || !validId(period.periodId) || seen.has(period.periodId) || !validId(period.productId)
      || !instant(period.startsAt) || !instant(period.endsAt) || period.endsAt <= period.startsAt
      || typeof period.revoked !== 'boolean') return null
    seen.add(period.periodId)
    copy.push({ periodId: period.periodId, productId: period.productId, startsAt: period.startsAt,
      endsAt: period.endsAt, revoked: period.revoked })
  }
  return { state: 'AVAILABLE', subjectId: available.subjectId, periods: copy }
}

function policy(value: unknown): SuppliedAccessPolicy | null {
  const unresolved = fields(value, ['kind'])
  if (unresolved?.kind === 'UNRESOLVED') return { kind: 'UNRESOLVED' }
  const synthetic = fields(value, ['kind', 'interval', 'revocationScope'])
  if (!synthetic || synthetic.kind !== 'SYNTHETIC'
    || (synthetic.interval !== 'START_INCLUSIVE_END_EXCLUSIVE' && synthetic.interval !== 'UNRESOLVED')
    || (synthetic.revocationScope !== 'PERIOD' && synthetic.revocationScope !== 'UNRESOLVED')) return null
  return { kind: 'SYNTHETIC', interval: synthetic.interval, revocationScope: synthetic.revocationScope }
}

function parse(value: unknown): SuppliedProductAccessInput | null {
  const input = fields(value, ['actor', 'audience', 'catalog', 'entitlements', 'at', 'policy'])
  if (!input || !instant(input.at)) return null
  const suppliedActor = actor(input.actor)
  const suppliedCatalog = catalog(input.catalog)
  const suppliedEntitlements = entitlements(input.entitlements)
  const suppliedPolicy = policy(input.policy)
  const audience = fields(input.audience, ['productIds', 'group', 'reading', 'revisionRequirement'])
  if (!suppliedActor || !suppliedCatalog || !suppliedEntitlements || !suppliedPolicy || !audience) return null
  const ids = list(audience.productIds, MAX_AUDIENCE)
  if (!ids || ids.length === 0 || !ids.every(validId) || new Set(ids).size !== ids.length
    || !GROUPS.some(group => group === audience.group)
    || (audience.reading !== 'CURRENT' && audience.reading !== 'HISTORICAL')
    || (audience.revisionRequirement !== 'NOT_REQUESTED' && audience.revisionRequirement !== 'REQUIRED')) return null
  return { actor: suppliedActor, catalog: suppliedCatalog, entitlements: suppliedEntitlements, at: input.at,
    policy: suppliedPolicy, audience: { productIds: ids, group: audience.group as SuppliedProductAccessInput['audience']['group'],
      reading: audience.reading, revisionRequirement: audience.revisionRequirement } }
}

/** Pure fixture/domain evaluation only. No DB, auth, clock, network or publication
 * checks occur here. Never use this result to authorize a production reader.
 */
export function evaluateSuppliedProductAccess(value: unknown): SuppliedProductAccessDecision {
  let input: SuppliedProductAccessInput | null
  try { input = parse(value) } catch { return deny('INVALID_INPUT') }
  if (!input) return deny('INVALID_INPUT')
  const failures = new Set<ProductAccessDenyReason>()
  if (input.actor.state === 'GUEST') failures.add('UNAUTHENTICATED')
  else if (input.actor.status !== 'ACTIVE') failures.add('FORBIDDEN')
  if (input.catalog.state !== 'AVAILABLE' || input.entitlements.state !== 'AVAILABLE') failures.add('PRODUCT_UNAVAILABLE')
  if (input.entitlements.state === 'AVAILABLE' && input.actor.state === 'PRESENT'
    && input.entitlements.subjectId !== input.actor.subjectId) failures.add('FORBIDDEN')
  // Validate the whole snapshot/audience before any OR success. Unknown IDs are
  // never silently dropped, including malformed unrelated grants.
  if (input.catalog.state === 'AVAILABLE') {
    const known = new Set(input.catalog.products.map(product => product.id))
    if (input.audience.productIds.some(id => !known.has(id))
      || (input.entitlements.state === 'AVAILABLE'
        && input.entitlements.periods.some(period => !known.has(period.productId)))) failures.add('INVALID_INPUT')
  }
  if (input.policy.kind === 'UNRESOLVED' || input.policy.interval === 'UNRESOLVED'
    || input.policy.revocationScope === 'UNRESOLVED' || input.audience.reading === 'HISTORICAL'
    || input.audience.revisionRequirement === 'REQUIRED') failures.add('POLICY_UNRESOLVED')
  // Do not choose a precedence among simultaneously failed preconditions either.
  // Invalid structure above is a parsing failure, not a commercial decision.
  if (failures.size > 0 || input.entitlements.state !== 'AVAILABLE') return deniedReasons(failures)

  const reasons = new Set<ProductAccessDenyReason>()
  for (const productId of input.audience.productIds) {
    const periods = input.entitlements.periods.filter(period => period.productId === productId)
    if (periods.length === 0) reasons.add('NO_ENTITLEMENT')
    for (const period of periods) {
      const started = input.at >= period.startsAt
      const expired = input.at >= period.endsAt
      if (!period.revoked && started && !expired) return allow()
      if (period.revoked) reasons.add('REVOKED')
      if (!started) reasons.add('NOT_STARTED')
      if (expired) reasons.add('EXPIRED')
    }
  }
  // No commercial deny precedence is invented, even within one revoked/expired
  // period. A valid alternative period above still wins under explicit OR.
  return deniedReasons(reasons)
}
