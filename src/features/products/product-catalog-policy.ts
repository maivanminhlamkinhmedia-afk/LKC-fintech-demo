import type {
  CatalogPolicyError,
  CatalogPolicyResult,
  CmsProductCatalog,
  ProductId,
  ProductIdentity,
  RecommendationGroup,
  SuppliedCatalogProduct,
  ValidatedProductSelection,
} from './product-catalog-contract.ts'

// These are benefit categories, not a catalog of production Products or prices.
const INCLUDED_GROUPS: readonly RecommendationGroup[] = [
  'MANUAL_RECOMMENDATION',
  'AUTOMATED_RECOMMENDATION',
  'PROBABILITY_OUTLOOK',
]

type AvailableSnapshot = {
  catalogVersion: string
  items: SuppliedCatalogProduct[]
}

function failure(error: CatalogPolicyError): { ok: false; error: CatalogPolicyError } {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

// Only unknown input reads are caught. Policy logic works on fresh plain values
// outside these boundaries, so a logic error is not disguised as bad input.
function readFields(input: unknown, keys: readonly string[]): CatalogPolicyResult<Record<string, unknown>> {
  try {
    if (!isRecord(input)) return failure('VALIDATION_ERROR')
    const fields: Record<string, unknown> = {}
    for (const key of keys) fields[key] = input[key]
    return { ok: true, value: fields }
  } catch {
    return failure('VALIDATION_ERROR')
  }
}

function readArray(input: unknown): CatalogPolicyResult<unknown[]> {
  try {
    if (!Array.isArray(input)) return failure('VALIDATION_ERROR')
    return { ok: true, value: Array.from(input) }
  } catch {
    return failure('VALIDATION_ERROR')
  }
}

/** Structural identity validation only; no generation, lookup or persistence. */
export function validateProductIdentity(input: unknown): CatalogPolicyResult<ProductIdentity> {
  const fields = readFields(input, ['kind', 'id'])
  if (!fields.ok) return fields
  if (fields.value.kind !== 'product' || !isOpaqueId(fields.value.id)) {
    return failure('VALIDATION_ERROR')
  }
  return { ok: true, value: { kind: 'product', id: fields.value.id as ProductId } }
}

/** Every Product benefit set includes all three groups; no per-tab charge here. */
export function validateProductBenefits(input: unknown): CatalogPolicyResult<readonly RecommendationGroup[]> {
  const values = readArray(input)
  if (!values.ok) return values
  if (values.value.length !== INCLUDED_GROUPS.length) {
    return failure('VALIDATION_ERROR')
  }
  const groups = new Set(values.value)
  if (groups.size !== INCLUDED_GROUPS.length || !INCLUDED_GROUPS.every(group => groups.has(group))) {
    return failure('VALIDATION_ERROR')
  }
  return { ok: true, value: [...INCLUDED_GROUPS] }
}

function parseSnapshot(input: unknown): CatalogPolicyResult<AvailableSnapshot> {
  const state = readFields(input, ['state'])
  if (!state.ok) return state
  if (state.value.state === 'UNAVAILABLE') return failure('PRODUCT_UNAVAILABLE')
  if (state.value.state !== 'AVAILABLE') return failure('VALIDATION_ERROR')
  const snapshot = readFields(input, ['catalogVersion', 'items'])
  if (!snapshot.ok) return snapshot
  if (!isOpaqueId(snapshot.value.catalogVersion)) {
    return failure('VALIDATION_ERROR')
  }
  const suppliedItems = readArray(snapshot.value.items)
  if (!suppliedItems.ok) return suppliedItems
  const items: SuppliedCatalogProduct[] = []
  const seenIds = new Set<string>()
  for (const suppliedItem of suppliedItems.value) {
    const fields = readFields(suppliedItem, ['kind', 'id', 'name', 'selectableForContent', 'saleStopped', 'retired', 'benefitGroups'])
    if (!fields.ok) return fields
    const item = fields.value
    const identity = validateProductIdentity(item)
    if (!identity.ok || typeof item.name !== 'string' || item.name.trim().length === 0
      || typeof item.selectableForContent !== 'boolean' || typeof item.saleStopped !== 'boolean'
      || typeof item.retired !== 'boolean') {
      return failure('VALIDATION_ERROR')
    }
    const benefits = validateProductBenefits(item.benefitGroups)
    if (!benefits.ok || seenIds.has(identity.value.id)) return failure('VALIDATION_ERROR')
    seenIds.add(identity.value.id)
    // Rebuild, never spread unknown fields (body/price/user/payment/etc.).
    items.push({
      ...identity.value,
      name: item.name,
      selectableForContent: item.selectableForContent,
      saleStopped: item.saleStopped,
      retired: item.retired,
      benefitGroups: benefits.value,
    })
  }
  return { ok: true, value: { catalogVersion: snapshot.value.catalogVersion, items } }
}

/**
 * Project a supplied snapshot, not getSelectableProducts or a paginated producer.
 * Retained names/API remain OPEN; non-selectable/retired records are excluded.
 */
export function projectSelectableCatalog(input: unknown): CatalogPolicyResult<CmsProductCatalog> {
  const snapshot = parseSnapshot(input)
  if (!snapshot.ok) return snapshot
  return {
    ok: true,
    value: {
      catalogVersion: snapshot.value.catalogVersion,
      items: snapshot.value.items.filter(item => item.selectableForContent && !item.retired).map(item => ({
        id: item.id,
        name: item.name,
        selectableForContent: item.selectableForContent,
      })),
    },
  }
}

/**
 * Validate against supplied records only, not authoritative Product revalidation.
 * No permission to submit/approve/publish or read content is returned.
 * saleStopped does not determine selectability or revoke existing rights.
 */
export function validateProductSelection(
  ids: unknown,
  suppliedSnapshot: unknown,
  options: unknown,
): CatalogPolicyResult<ValidatedProductSelection> {
  const suppliedOptions = readFields(options, ['usage', 'maxProductIds'])
  if (!suppliedOptions.ok) return suppliedOptions
  const { usage, maxProductIds } = suppliedOptions.value
  if ((usage !== 'new-selection' && usage !== 'retained-reference')
    || typeof maxProductIds !== 'number' || !Number.isSafeInteger(maxProductIds) || maxProductIds <= 0) {
    return failure('VALIDATION_ERROR')
  }
  const suppliedIds = readArray(ids)
  if (!suppliedIds.ok) return suppliedIds
  const productIds = suppliedIds.value
  if (productIds.length === 0 || productIds.length > maxProductIds || !productIds.every(isOpaqueId)
    || new Set(productIds).size !== productIds.length) {
    return failure('VALIDATION_ERROR')
  }
  const snapshot = parseSnapshot(suppliedSnapshot)
  if (!snapshot.ok) return snapshot
  const records = new Map(snapshot.value.items.map(item => [item.id as string, item]))
  // Check the complete set before deciding, so unknown IDs are never dropped.
  const selected: SuppliedCatalogProduct[] = []
  for (const id of productIds) {
    const item = records.get(id)
    if (!item) return failure('PRODUCT_INVALID')
    selected.push(item)
  }
  if (usage === 'retained-reference' && selected.some(item => item.retired || !item.selectableForContent)) {
    return failure('POLICY_UNRESOLVED')
  }
  if (selected.some(item => item.retired || !item.selectableForContent)) return failure('PRODUCT_INVALID')
  return {
    ok: true,
    value: { productIds: selected.map(item => item.id), catalogVersion: snapshot.value.catalogVersion },
  }
}
