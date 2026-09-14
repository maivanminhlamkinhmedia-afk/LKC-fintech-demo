import { filtersHref, parseCustomerFilters, type CRMSearchParams, type CustomerFilters } from './customer-filters'

export const MAX_CUSTOMER_EXPORT_ROWS = 5000
export const CUSTOMER_EXPORT_FILTER_KEYS = ['q', 'status', 'priority', 'salesId', 'teamId', 'followUp', 'task'] as const

export function parseCustomerExportFilters(params: URLSearchParams) {
  const input: CRMSearchParams = {}
  for (const key of CUSTOMER_EXPORT_FILTER_KEYS) {
    const values = params.getAll(key)
    if (values.length) input[key] = values.length === 1 ? values[0] : values
  }
  // Pagination and unknown keys have no dataset meaning. Canonical validation
  // still retains duplicate substantive parameters so they cannot broaden export.
  return parseCustomerFilters(input)
}

export function customerExportHref(filters: CustomerFilters) {
  return filtersHref('/sales/customers/export', filters, { page: 1 })
}
