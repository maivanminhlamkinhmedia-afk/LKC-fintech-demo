/** SUB-004.0 lane-private domain hypotheses, not a shared C02 runtime port.
 * No shape/flag here proves actor, clock, policy approval or store provenance.
 * Consumers must not wire these supplied snapshots into a production reader.
 */
export type ProductAccessGroup =
  | 'MANUAL_RECOMMENDATION'
  | 'AUTOMATED_RECOMMENDATION'
  | 'PROBABILITY_OUTLOOK'

/** Opaque catalog identity, never a name, plan or FinancialInstrument identity. */
export type SuppliedAccessProduct = {
  readonly kind: 'PRODUCT'
  readonly id: string
  readonly saleStopped: boolean
}

export type SuppliedAccessActor =
  | { readonly state: 'GUEST' }
  | { readonly state: 'PRESENT'; readonly subjectId: string; readonly status: 'ACTIVE' | 'INACTIVE' }

export type SuppliedAccessCatalog =
  | { readonly state: 'UNAVAILABLE' }
  | { readonly state: 'AVAILABLE'; readonly products: readonly SuppliedAccessProduct[] }

/** An already supplied period, not an instruction to grant, renew or revoke. */
export type SuppliedAccessPeriod = {
  readonly periodId: string
  readonly productId: string
  /** Integer epoch milliseconds; no calendar/term/grace calculation is performed. */
  readonly startsAt: number
  readonly endsAt: number
  readonly revoked: boolean
}

export type SuppliedAccessEntitlements =
  | { readonly state: 'UNAVAILABLE' }
  | {
      readonly state: 'AVAILABLE'
      readonly subjectId: string
      readonly periods: readonly SuppliedAccessPeriod[]
    }

/** Explicit fixture hypotheses ONLY; SYNTHETIC is not an approval credential.
 * No live interval, revoke/refund/renewal/grace or history policy is selected.
 */
export type SuppliedAccessPolicy =
  | { readonly kind: 'UNRESOLVED' }
  | {
      readonly kind: 'SYNTHETIC'
      readonly interval: 'START_INCLUSIVE_END_EXCLUSIVE' | 'UNRESOLVED'
      readonly revocationScope: 'PERIOD' | 'UNRESOLVED'
    }

export type SuppliedProductAccessInput = {
  readonly actor: SuppliedAccessActor
  readonly audience: {
    readonly productIds: readonly string[]
    readonly group: ProductAccessGroup
    readonly reading: 'CURRENT' | 'HISTORICAL'
    /** REQUIRED fails unresolved until a real revision/cache contract exists. */
    readonly revisionRequirement: 'NOT_REQUESTED' | 'REQUIRED'
  }
  readonly catalog: SuppliedAccessCatalog
  readonly entitlements: SuppliedAccessEntitlements
  /** Supplied fixture instant, never described as a verified server clock. */
  readonly at: number
  readonly policy: SuppliedAccessPolicy
}

export type ProductAccessDenyReason =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NO_ENTITLEMENT'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'PRODUCT_UNAVAILABLE'
  | 'POLICY_UNRESOLVED'

/** Internal domain decision; never a cache token, published-content permission,
 * authenticated principal, grant receipt or public consumer response.
 * Even allow=true is hypothetical and always has runtimeAuthorized=false.
 */
export type SuppliedProductAccessDecision = Readonly<{
  basis: 'SUPPLIED_SNAPSHOTS_ONLY'
  runtimeAuthorized: false
} & (
  | { allow: true; reason: 'ALLOW' }
  | { allow: false; reason: ProductAccessDenyReason }
)>
