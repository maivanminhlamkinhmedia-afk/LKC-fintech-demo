'use client'

import { useActionState, useId } from 'react'
import { createCustomerInteraction, type InteractionState } from '@/features/crm/activity-actions'
import { ACTIVITY_LABELS, MANUAL_ACTIVITY_TYPES, MAX_INTERACTION_CONTENT } from '@/features/crm/interaction-validation'

const initialState: InteractionState = { kind: 'idle', message: '' }

export function CreateInteractionForm({ customerId }: { customerId: string }) {
  const [state, formAction, pending] = useActionState(createCustomerInteraction, initialState)
  const typeId = useId()
  const contentId = useId()
  const messageId = `${contentId}-message`
  const helpId = `${contentId}-help`
  const selectedType = MANUAL_ACTIVITY_TYPES.find((type) => type === state.values?.type) ?? MANUAL_ACTIVITY_TYPES[0]

  return (
    <form data-interaction-form="" action={formAction} aria-busy={pending} className="rounded-2xl bg-white p-6 shadow-sm">
      <input type="hidden" name="customerId" value={customerId} />
      <h2 className="text-xl font-bold">Ghi nhận tương tác</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">Ghi lại trao đổi đã diễn ra. Biểu mẫu này không gửi email, tin nhắn hay thực hiện cuộc gọi.</p>
      <label htmlFor={typeId} className="mt-5 block text-sm font-medium">Loại tương tác</label>
      <select
        id={typeId}
        name="type"
        defaultValue={selectedType}
        required
        disabled={pending}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
      >
        {MANUAL_ACTIVITY_TYPES.map((type) => <option key={type} value={type}>{ACTIVITY_LABELS[type]}</option>)}
      </select>
      <label htmlFor={contentId} className="mt-4 block text-sm font-medium">Nội dung</label>
      <textarea
        id={contentId}
        name="content"
        defaultValue={state.values?.content ?? ''}
        required
        maxLength={MAX_INTERACTION_CONTENT}
        rows={6}
        disabled={pending}
        aria-describedby={`${helpId} ${messageId}`}
        placeholder="Nội dung trao đổi hoặc ghi chú về khách hàng..."
        className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
      />
      <p id={helpId} className="mt-2 text-xs leading-relaxed text-slate-500">Tối đa {MAX_INTERACTION_CONTENT} ký tự. Lịch sử chỉ được bổ sung; không có thao tác sửa hoặc xóa tương tác.</p>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">Ghi nhận cuộc gọi, email, cuộc họp hoặc tin nhắn sẽ cập nhật thời điểm liên hệ gần nhất khi lưu. Ghi chú không thay đổi thời điểm này.</p>
      <button type="submit" disabled={pending} className="mt-4 rounded-xl bg-[#2BAD97] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60">{pending ? 'Đang lưu…' : 'Lưu tương tác'}</button>
      <p id={messageId} role={state.kind === 'error' ? 'alert' : 'status'} aria-live={state.kind === 'error' ? 'assertive' : 'polite'} aria-atomic="true" className={`mt-3 text-sm ${state.kind === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
        {pending ? 'Đang kiểm tra và ghi nhận tương tác…' : state.message}
      </p>
    </form>
  )
}
