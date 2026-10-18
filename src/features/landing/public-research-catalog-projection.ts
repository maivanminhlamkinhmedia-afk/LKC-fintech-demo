import 'server-only'

import { RESEARCH_CATALOG_INPUT_LIMITS } from './public-research-catalog-contract'
import type {
  PublicResearchCatalogProjection,
  ResearchBenefitAvailability,
  ResearchCatalogCandidateProduct,
  ResearchCatalogCandidateProjection,
  ResearchProductKind,
} from './public-research-catalog-contract'

const kinds: readonly ResearchProductKind[] = Object.freeze([
  'equities', 'equityDerivatives', 'commodityDerivatives', 'gold', 'digitalAssets',
])
const groups = ['manual', 'automated', 'probability'] as const
const invalid = Object.freeze({ status: 'INVALID_SNAPSHOT' as const })
const unavailable: PublicResearchCatalogProjection = Object.freeze({
  status: 'PUBLICATION_SOURCE_UNAVAILABLE',
  products: Object.freeze([]) as readonly [],
})

/** Public boundary is deliberately closed; it accepts no caller-made approval. */
export function projectPublicResearchCatalog(): PublicResearchCatalogProjection {
  return unavailable
}

// Only own, plain data properties; no getters, class instances or inherited
// metadata. Unknown data fields are ignored, never spread into candidate output.
function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null
  const fields: Record<string, unknown> = Object.create(null)
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, 'value')) return null
    fields[key] = descriptor.value
  }
  return fields
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0
    && value.length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
}

function projectRecord(value: unknown): ResearchCatalogCandidateProduct | null {
  const input = record(value)
  if (!input || input.publication !== 'published'
    || !text(input.id, RESEARCH_CATALOG_INPUT_LIMITS.id)
    || input.id !== input.id.trim() || /\s/.test(input.id)
    || !text(input.name, RESEARCH_CATALOG_INPUT_LIMITS.name)
    || !text(input.description, RESEARCH_CATALOG_INPUT_LIMITS.description)
    || !kinds.includes(input.kind as ResearchProductKind)) return null

  const supplied = input.availability === undefined ? Object.create(null) : record(input.availability)
  if (!supplied) return null
  const availability: Record<typeof groups[number], NonNullable<ResearchBenefitAvailability['manual']>> = {
    manual: 'unconfirmed', automated: 'unconfirmed', probability: 'unconfirmed',
  }
  for (const group of groups) {
    const value = supplied[group]
    if (value === undefined) continue
    if (value !== 'available' && value !== 'not_ready' && value !== 'unconfirmed') return null
    availability[group] = value
  }

  // Preserve supplied text as candidate facts, not render-ready metadata.
  // Do not encode HTML, invent URLs, copy publication or infer feed readiness.
  return Object.freeze({
    candidateTag: 'UNVERIFIED_SUPPLIED_SNAPSHOT',
    suppliedId: input.id,
    suppliedKind: input.kind as ResearchProductKind,
    suppliedName: input.name,
    suppliedDescription: input.description,
    suppliedAvailability: Object.freeze(availability),
  })
}

/**
 * Pure validation/projection for review and isolated supplied-snapshot tests.
 * A positive result is CANDIDATE_ONLY, never a catalogue publication decision.
 * Even a supplied "published" record is only an assertion until an approved
 * server producer independently establishes publication and availability.
 * Do not wire candidate output to public routes. Use the closed public boundary
 * above until a separately reviewed integration supplies that missing authority.
 */
export function projectResearchCatalogCandidate(snapshot: unknown): ResearchCatalogCandidateProjection {
  try {
    if (!Array.isArray(snapshot)) return invalid
    // Avoid reading snapshot.length through a Proxy get trap. Descriptor and
    // other reflection operations can still invoke Proxy traps; failures below
    // are caught, not a claim that arbitrary Proxy code cannot execute.
    const lengthDescriptor = Object.getOwnPropertyDescriptor(snapshot, 'length')
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) return invalid
    const length: unknown = lengthDescriptor.value
    if (typeof length !== 'number' || !Number.isSafeInteger(length)
      || length < 0 || length > RESEARCH_CATALOG_INPUT_LIMITS.products) return invalid
    const descriptors = Object.getOwnPropertyDescriptors(snapshot)
    const products: ResearchCatalogCandidateProduct[] = []
    const ids = new Set<string>()
    for (let index = 0; index < length; index++) {
      const descriptor = descriptors[String(index)]
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return invalid
      const product = projectRecord(descriptor.value)
      if (!product || ids.has(product.suppliedId)) return invalid
      ids.add(product.suppliedId)
      products.push(product)
    }
    return Object.freeze({
      status: 'CANDIDATE_ONLY',
      publicationVerified: false,
      products: Object.freeze(products),
    })
  } catch {
    // Malformed/revoked proxies cannot leak exceptions or partial metadata.
    return invalid
  }
}
