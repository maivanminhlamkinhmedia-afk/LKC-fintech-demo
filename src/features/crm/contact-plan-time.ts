const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000
export const CONTACT_PLAN_MAX_DAYS = 1095
export const CONTACT_PLAN_TOLERANCE_MS = 60_000

// Strict minute precision, fixed UTC+7. Never pass an unzoned string to Date.
export function parseVietnamContactInput(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number)
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31
    || hour > 23 || minute > 59) return null
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute))
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day
    || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute) return null
  const utc = new Date(local.getTime() - VIETNAM_OFFSET_MS)
  // Keep the converted boundary within MySQL DATETIME's supported years too.
  return utc.getUTCFullYear() >= 1000 && utc.getUTCFullYear() <= 9999 ? utc : null
}

export function toVietnamContactInput(value: Date | null): string {
  return value ? new Date(value.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 16) : ''
}

type ContactPlanInput = { customerId: string; operation: 'SET' | 'CLEAR'; nextContactAt: Date | null }
type ContactPlanValidation = { ok: true; data: ContactPlanInput } | { ok: false; message: string }

function singleField(formData: FormData, key: string): string | null {
  const values = formData.getAll(key)
  return values.length === 1 && typeof values[0] === 'string' ? values[0] : null
}

export function parseContactPlanForm(formData: unknown, now: Date): ContactPlanValidation {
  if (!(formData instanceof FormData) || !Number.isFinite(now.getTime())) {
    return { ok: false, message: 'Dữ liệu kế hoạch liên hệ không hợp lệ.' }
  }
  const customerId = singleField(formData, 'customerId')
  const operation = singleField(formData, 'operation')
  if (!customerId || !/^[A-Za-z0-9_-]{1,191}$/.test(customerId)) {
    return { ok: false, message: 'Mã khách hàng không hợp lệ.' }
  }
  if (operation !== 'SET' && operation !== 'CLEAR') return { ok: false, message: 'Thao tác kế hoạch liên hệ không hợp lệ.' }
  if (operation === 'CLEAR') {
    if (formData.has('nextContactAt')) return { ok: false, message: 'Thao tác xóa lịch không được kèm thời gian mới.' }
    return { ok: true, data: { customerId, operation, nextContactAt: null } }
  }
  const nextContactAt = parseVietnamContactInput(singleField(formData, 'nextContactAt'))
  if (!nextContactAt) return { ok: false, message: 'Nhập ngày giờ Việt Nam hợp lệ theo mẫu YYYY-MM-DDTHH:mm.' }
  const delta = nextContactAt.getTime() - now.getTime()
  if (delta < -CONTACT_PLAN_TOLERANCE_MS) return { ok: false, message: 'Lịch liên hệ mới không được ở quá khứ (cho phép trễ gửi tối đa 60 giây).' }
  if (delta > CONTACT_PLAN_MAX_DAYS * 86_400_000) return { ok: false, message: `Chỉ được lên lịch trong ${CONTACT_PLAN_MAX_DAYS} ngày tới.` }
  // Client actor/ownership/status/last-contact/task fields are never accepted.
  return { ok: true, data: { customerId, operation, nextContactAt } }
}
