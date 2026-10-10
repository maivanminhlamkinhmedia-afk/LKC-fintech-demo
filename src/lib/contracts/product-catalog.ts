/** C01 server port. IDs are opaque; this DTO is neither content nor entitlement. */
export type ProductId = string
export type ProductContentState = 'SELECTABLE' | 'UNSELECTABLE' | 'RETIRED'
export type ListError = 'VALIDATION_ERROR' | 'FORBIDDEN' | 'PRODUCT_UNAVAILABLE' | 'INTERNAL_ERROR' | 'CATALOG_CHANGED'
export type ValidateError = 'VALIDATION_ERROR' | 'FORBIDDEN' | 'PRODUCT_INVALID' | 'POLICY_UNRESOLVED' | 'PRODUCT_UNAVAILABLE' | 'INTERNAL_ERROR'
export type ResolveError = 'VALIDATION_ERROR' | 'FORBIDDEN' | 'PRODUCT_INVALID' | 'PRODUCT_UNAVAILABLE' | 'INTERNAL_ERROR'
export type CatalogError = ListError | ValidateError | ResolveError
export type CatalogResult<T, E extends CatalogError = CatalogError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }
export type CatalogItem = { readonly id: ProductId; readonly name: string; readonly selectableForContent: true }
export type ProductReference = {
  readonly id: ProductId
  /** Current name, not the label captured by a historical ArticleVersion. */
  readonly name: string
  readonly contentState: ProductContentState
  readonly selectableForContent: boolean
}
export type ProductCatalogPort = {
  getSelectableProducts(input: unknown): Promise<CatalogResult<{
    readonly catalogVersion: string; readonly items: readonly CatalogItem[]; readonly nextCursor?: string
  }, ListError>>
  validateArticleProducts(input: unknown): Promise<CatalogResult<{
    readonly catalogVersion: string; readonly productIds: readonly ProductId[]
  }, ValidateError>>
  resolveProductReferences(input: unknown): Promise<CatalogResult<{
    readonly catalogVersion: string; readonly items: readonly ProductReference[]
  }, ResolveError>>
}
