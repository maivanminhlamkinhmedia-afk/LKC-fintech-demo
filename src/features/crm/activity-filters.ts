import { CustomerActivityType, type Prisma } from '@prisma/client'
import { parseCustomerFilters, type CRMSearchParams } from './customer-filters'

export const ACTIVITY_TYPES = Object.values(CustomerActivityType)
export const ACTIVITY_PAGE_SIZE = 20

export type ActivityFilters = {
  activityType?: CustomerActivityType
  activityPage: number
}

export function parseActivityFilters(params: CRMSearchParams) {
  const paging = parseCustomerFilters({ page: params.activityPage })
  const invalidKeys = paging.invalidKeys.map(() => 'activityPage')
  let activityType: CustomerActivityType | undefined
  const value = params.activityType
  if (value !== undefined && value !== '') {
    if (typeof value !== 'string' || value.length > 32 || /[\u0000-\u001f\u007f]/.test(value)) {
      invalidKeys.push('activityType')
    } else {
      const trimmed = value.trim()
      if (trimmed) {
        if (ACTIVITY_TYPES.includes(trimmed as CustomerActivityType)) activityType = trimmed as CustomerActivityType
        else invalidKeys.push('activityType')
      }
    }
  }
  return { filters: { activityType, activityPage: paging.filters.page } satisfies ActivityFilters, invalidKeys }
}

export function activityWhere(customerId: string, scope: Prisma.CustomerProfileWhereInput, filters: ActivityFilters): Prisma.CustomerActivityWhereInput {
  // Customer identity, authorization, and the type filter must all hold. Actor
  // attribution is display data, never an alternate authorization boundary.
  return { AND: [
    { customerId },
    { customer: { is: scope } },
    ...(filters.activityType ? [{ type: filters.activityType }] : []),
  ] }
}

export function activityFiltersHref(path: string, filters: ActivityFilters, overrides: Partial<ActivityFilters> = {}) {
  const values = { ...filters, ...overrides }
  const params = new URLSearchParams()
  if (values.activityType) params.set('activityType', values.activityType)
  if (values.activityPage !== undefined && values.activityPage !== 1) params.set('activityPage', String(values.activityPage))
  return `${path}${params.size ? `?${params}` : ''}#activity-timeline`
}
