import { CustomerActivityType } from '@prisma/client'

// Explicit allowlist: future/system enum members never become manual options by default.
export const MANUAL_ACTIVITY_TYPES = [
  CustomerActivityType.NOTE, CustomerActivityType.CALL, CustomerActivityType.EMAIL,
  CustomerActivityType.MEETING, CustomerActivityType.MESSAGE,
] as const
export type ManualActivityType = (typeof MANUAL_ACTIVITY_TYPES)[number]
export const MAX_INTERACTION_CONTENT = 5000
export const ACTIVITY_LABELS: Record<CustomerActivityType, string> = {
  NOTE: 'Ghi chú', CALL: 'Cuộc gọi', EMAIL: 'Email', MEETING: 'Cuộc họp', MESSAGE: 'Tin nhắn',
  STATUS_CHANGE: 'Thay đổi trạng thái', ASSIGNMENT: 'Phân công Sales',
}

export function isManualActivityType(value: string): value is ManualActivityType {
  return MANUAL_ACTIVITY_TYPES.includes(value as ManualActivityType)
}

export function singleInteractionField(formData: FormData, name: string) {
  const values = formData.getAll(name)
  return values.length === 1 && typeof values[0] === 'string' ? values[0] : null
}

type InteractionInput = { customerId: string; type: ManualActivityType; title: string; content: string }
type InteractionValidation = { ok: true; data: InteractionInput } | { ok: false; message: string }

export function parseInteractionForm(formData: unknown): InteractionValidation {
  if (!(formData instanceof FormData)) return { ok: false, message: 'Dữ liệu tương tác không hợp lệ.' }
  const customerId = singleInteractionField(formData, 'customerId')
  const type = singleInteractionField(formData, 'type')
  const rawContent = singleInteractionField(formData, 'content')
  if (!customerId || !/^[A-Za-z0-9_-]{1,191}$/.test(customerId)) {
    return { ok: false, message: 'Mã khách hàng không hợp lệ.' }
  }
  if (!type || !isManualActivityType(type)) {
    return { ok: false, message: 'Loại tương tác không hợp lệ hoặc dành riêng cho hệ thống.' }
  }
  if (rawContent === null) return { ok: false, message: 'Nội dung tương tác phải là một giá trị văn bản duy nhất.' }
  const content = rawContent.trim()
  if (!content) return { ok: false, message: 'Nội dung tương tác không được để trống.' }
  // MySQL Text allows 65,535 bytes. 5,000 UTF-16 units fit even for multibyte Unicode.
  if (content.length > MAX_INTERACTION_CONTENT) {
    return { ok: false, message: `Nội dung tương tác không được vượt quá ${MAX_INTERACTION_CONTENT} ký tự.` }
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)) {
    return { ok: false, message: 'Nội dung tương tác chứa ký tự điều khiển không hợp lệ.' }
  }
  // The existing required title is a short type label, never a second copy of client content.
  // Submitted actor, timestamps, title, ownership and task fields are deliberately ignored.
  return { ok: true, data: { customerId, type, title: ACTIVITY_LABELS[type], content } }
}
