/**
 * SUB-002.0 feature-local pure shapes, not a shared producer port or DB model.
 * Supplied snapshots are test/caller data, not evidence of authoritative lookup.
 * Consumers must not import this feature implementation across feature boundaries.
 */
declare const productIdBrand: unique symbol
declare const productPlanIdBrand: unique symbol
declare const instrumentIdBrand: unique symbol

export type ProductId = string & { readonly [productIdBrand]: true }
export type ProductPlanId = string & { readonly [productPlanIdBrand]: true }
export type FinancialInstrumentId = string & { readonly [instrumentIdBrand]: true }

export type ProductIdentity = { readonly kind: 'product'; readonly id: ProductId }
export type ProductPlanIdentity = {
  readonly kind: 'product-plan'
  readonly id: ProductPlanId
  readonly productId: ProductId
}
export type FinancialInstrumentIdentity = {
  readonly kind: 'financial-instrument'
  readonly id: FinancialInstrumentId
}

// Groups are included benefits of a Product, never independently priced products.
// Origin (STAFF/WEBHOOK/etc.) and publication/context authorization are separate.
export type RecommendationGroup =
  | 'MANUAL_RECOMMENDATION'
  | 'AUTOMATED_RECOMMENDATION'
  | 'PROBABILITY_OUTLOOK'

export type CatalogPolicyError =
  | 'VALIDATION_ERROR'
  | 'PRODUCT_INVALID'
  | 'PRODUCT_UNAVAILABLE'
  | 'POLICY_UNRESOLVED'

export type CatalogPolicyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CatalogPolicyError }

export type CmsProductCatalogItem = {
  readonly id: ProductId
  readonly name: string
  readonly selectableForContent: boolean
}

export type CmsProductCatalog = {
  readonly catalogVersion: string
  readonly items: readonly CmsProductCatalogItem[]
}

/** Flags supplied by the caller; names do not prescribe physical schema. */
export type SuppliedCatalogProduct = ProductIdentity & {
  readonly name: string
  readonly selectableForContent: boolean
  // Stopped sale alone neither retires a Product nor denies content selection.
  readonly saleStopped: boolean
  // Excluded from new selection; retained-reference policy remains unresolved.
  readonly retired: boolean
  readonly benefitGroups: readonly RecommendationGroup[]
}

export type SuppliedCatalogSnapshot =
  | { readonly state: 'UNAVAILABLE' }
  | {
      readonly state: 'AVAILABLE'
      readonly catalogVersion: string
      readonly items: readonly SuppliedCatalogProduct[]
    }

export type ProductSelectionOptions = {
  readonly usage: 'new-selection' | 'retained-reference'
  // Explicit caller limit: no unapproved production cap is hard-coded here.
  readonly maxProductIds: number
}

export type ValidatedProductSelection = {
  readonly productIds: readonly ProductId[]
  readonly catalogVersion: string
}
