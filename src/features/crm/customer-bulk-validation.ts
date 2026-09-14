import { CustomerPriority } from '@prisma/client'

export const MAX_BULK_CUSTOMERS = 100
type BulkInput = { customerIds: string[]; priority: CustomerPriority }
type BulkValidation = { ok: true; data: BulkInput } | { ok: false; message: string }

export function parseCustomerBulkForm(form: unknown): BulkValidation {
  if (!(form instanceof FormData)) return { ok: false, message: 'Dữ liệu cập nhật không hợp lệ.' }
  const ids = form.getAll('customerIds')
  // Bound submitted occurrences as well as unique IDs; never truncate a batch.
  if (!ids.length || ids.length > MAX_BULK_CUSTOMERS) {
    return { ok: false, message: `Chọn từ 1 đến ${MAX_BULK_CUSTOMERS} khách hàng trong một lần gửi.` }
  }
  if (!ids.every((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,191}$/.test(id))) {
    return { ok: false, message: 'Danh sách khách hàng không hợp lệ.' }
  }
  const values = form.getAll('priority')
  const priority = Object.values(CustomerPriority).find((value) => values.length === 1 && values[0] === value)
  if (!priority) return { ok: false, message: 'Mức ưu tiên khách hàng không hợp lệ.' }
  return { ok: true, data: { customerIds: [...new Set(ids)].sort(), priority } }
}
