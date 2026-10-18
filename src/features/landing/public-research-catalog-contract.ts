/**
 * Lane-local supplied-snapshot contract, not an approved producer/API contract.
 * No ID, route slug, commercial terms or publication authority is generated.
 * Existing Screen 01/02 DTOs remain presentation-only.
 */
export type ResearchProductKind =
  | 'equities' | 'equityDerivatives' | 'commodityDerivatives' | 'gold' | 'digitalAssets'
export type ResearchBenefitAvailability = Readonly<Partial<Record<
  'manual' | 'automated' | 'probability', 'available' | 'not_ready' | 'unconfirmed'
>>>

export type ResearchCatalogCandidateRecord = Readonly<{
  // Preserve a supplied identity; never derive one from kind, name or position.
  id: string
  publication: string // Untrusted input assertion, never copied into the output.
  kind: ResearchProductKind
  name: string
  description: string
  availability?: ResearchBenefitAvailability
}>

/**
 * Deliberately not either public presentation DTO, including at nested levels.
 * A future integration must verify publication authority and explicitly convert
 * these supplied facts; there is no such conversion in this revision.
 */
export type ResearchCatalogCandidateProduct = Readonly<{
  candidateTag: 'UNVERIFIED_SUPPLIED_SNAPSHOT'
  suppliedId: string
  suppliedKind: ResearchProductKind
  suppliedName: string
  suppliedDescription: string
  suppliedAvailability: Required<ResearchBenefitAvailability>
}>

export type ResearchCatalogCandidateProjection =
  | Readonly<{ status: 'INVALID_SNAPSHOT' }>
  | Readonly<{
      status: 'CANDIDATE_ONLY'
      publicationVerified: false
      products: readonly ResearchCatalogCandidateProduct[]
    }>

/**
 * No approved public publication source exists in this revision. In particular,
 * C01 staff data, selectable lists, client flags and synthetic snapshots cannot
 * satisfy this boundary. Adding a positive public result needs a separately
 * reviewed producer, publication provenance and server integration grant.
 */
export type PublicResearchCatalogProjection = Readonly<{
  status: 'PUBLICATION_SOURCE_UNAVAILABLE'
  products: readonly []
}>

// Defensive payload limits only; these do not set any commercial policy.
export const RESEARCH_CATALOG_INPUT_LIMITS = Object.freeze({
  products: 1000,
  id: 128,
  name: 200,
  description: 5000,
})
