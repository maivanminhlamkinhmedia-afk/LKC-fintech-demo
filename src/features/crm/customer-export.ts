import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/roles'
import { customerSalesScope } from '@/features/crm/access'
import { customerFilterWhere } from '@/features/crm/customer-filters'
import { CUSTOMER_EXPORT_FILTER_KEYS, MAX_CUSTOMER_EXPORT_ROWS, parseCustomerExportFilters } from '@/features/crm/customer-export-filters'
import { serializeCSV } from '@/features/crm/csv'

const exportSelect = {
  customerCode: true, status: true, priority: true, lastContactAt: true, nextContactAt: true, createdAt: true,
  user: { select: { name: true, email: true } }, assignedSales: { select: { name: true } },
} satisfies Prisma.CustomerProfileSelect

class ExportError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

// Internal DAL, not a Server Action. Route authenticates independently; the
// transaction refreshes actor and scope before any count or customer query.
export async function customerExportResponse(actorId: string, params: URLSearchParams): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  const parsed = parseCustomerExportFilters(params)
  if (parsed.invalidKeys.length) return new Response('Bộ lọc không hợp lệ. Vui lòng sửa bộ lọc trước khi xuất CSV.', { status: 400, headers })
  try {
    const csv = await prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, status: true } })
      if (!actor || actor.status !== 'ACTIVE' || !hasPermission(actor.role, 'sales:read')) {
        throw new ExportError(403, 'Không có quyền xuất khách hàng.')
      }
      const where = { AND: [customerSalesScope(actor), customerFilterWhere(parsed.filters, new Date())] }
      const count = await tx.customerProfile.count({ where })
      if (count > MAX_CUSTOMER_EXPORT_ROWS) {
        throw new ExportError(413, `Kết quả vượt giới hạn ${MAX_CUSTOMER_EXPORT_ROWS} khách hàng. Vui lòng thu hẹp bộ lọc.`)
      }
      const customers = await tx.customerProfile.findMany({
        where, select: exportSelect, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: MAX_CUSTOMER_EXPORT_ROWS,
      })
      if (customers.length !== count) throw new ExportError(409, 'Dữ liệu đã thay đổi. Vui lòng thử xuất lại.')
      const result = serializeCSV([
        ['customerCode', 'name', 'email', 'status', 'priority', 'assignedSalesName', 'lastContactAt', 'nextContactAt', 'createdAt'],
        ...customers.map((customer) => [
          customer.customerCode, customer.user.name, customer.user.email, customer.status, customer.priority,
          customer.assignedSales?.name ?? null, customer.lastContactAt?.toISOString() ?? null,
          customer.nextContactAt?.toISOString() ?? null, customer.createdAt.toISOString(),
        ]),
      ])
      await tx.auditLog.create({ data: {
        actorId: actor.id, action: 'CUSTOMER_CSV_EXPORT', entityType: 'CustomerProfile', entityId: null,
        metadata: { rowCount: count, filtersActive: CUSTOMER_EXPORT_FILTER_KEYS.some((key) => Boolean(parsed.filters[key])), format: 'csv' },
      } })
      return result
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 })
    return new Response(csv, { headers: {
      ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="lkc-customers.csv"',
    } })
  } catch (error) {
    return new Response(error instanceof ExportError ? error.message : 'Không thể xuất dữ liệu lúc này. Vui lòng thử lại.', {
      status: error instanceof ExportError ? error.status : 503, headers,
    })
  }
}
