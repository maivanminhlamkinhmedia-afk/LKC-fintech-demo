import { Prisma } from '@prisma/client'
import { hasPermission, type AppRole } from '../../lib/roles'
import type { ReportFilters } from './report-filters'

export type ReportUser = { id: string; role: AppRole }

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const ownKeys = Reflect.ownKeys(value)
  return ownKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

// This intentionally is NOT a general Prisma-to-SQL converter. It recognizes only
// the current customerSalesScope shapes and fails closed if that helper changes.
// Every fragment targets the static CustomerProfile alias `c` in report queries.
export function customerScopeSql(user: ReportUser, scope: Prisma.CustomerProfileWhereInput): Prisma.Sql {
  if (!user.id || !hasPermission(user.role, 'sales:read')) throw new Error('CRM report access denied')
  if (['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user.role) && exactKeys(scope, [])) {
    return Prisma.sql`1 = 1`
  }
  if (user.role === 'SALES' && exactKeys(scope, ['assignedSalesId']) && scope.assignedSalesId === user.id) {
    return Prisma.sql`c.assignedSalesId = ${scope.assignedSalesId}`
  }
  if (user.role === 'SALES_MANAGER' && exactKeys(scope, ['assignedSales'])) {
    const sales = scope.assignedSales
    if (exactKeys(sales, ['salesMemberships']) && exactKeys(sales.salesMemberships, ['some'])) {
      const membership = sales.salesMemberships.some
      if (exactKeys(membership, ['team']) && exactKeys(membership.team, ['managerId'])
        && membership.team.managerId === user.id) {
        return Prisma.sql`EXISTS (
          SELECT 1 FROM SalesTeamMember scope_member
          INNER JOIN SalesTeam scope_team ON scope_team.id = scope_member.teamId
          WHERE scope_member.userId = c.assignedSalesId AND scope_team.managerId = ${membership.team.managerId}
        )`
      }
    }
  }
  throw new Error('Unsupported CRM customer scope; report query refused')
}

export function reportCustomerSql(user: ReportUser, scope: Prisma.CustomerProfileWhereInput, filters: ReportFilters): Prisma.Sql {
  const authorization = customerScopeSql(user, scope)
  const filtersSql: Prisma.Sql[] = [Prisma.sql`1 = 1`]
  if (filters.salesId) filtersSql.push(Prisma.sql`c.assignedSalesId = ${filters.salesId}`)
  if (filters.teamId) filtersSql.push(Prisma.sql`EXISTS (
    SELECT 1 FROM SalesTeamMember filter_member
    WHERE filter_member.userId = c.assignedSalesId AND filter_member.teamId = ${filters.teamId}
  )`)
  if (filters.status) filtersSql.push(Prisma.sql`c.status = ${filters.status}`)
  if (filters.priority) filtersSql.push(Prisma.sql`c.priority = ${filters.priority}`)
  // Period dates apply only to period metrics, never the current customer portfolio.
  return Prisma.sql`(${authorization}) AND (${Prisma.join(filtersSql, ' AND ')})`
}
