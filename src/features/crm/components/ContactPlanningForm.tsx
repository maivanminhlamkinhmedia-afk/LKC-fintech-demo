'use client'

import { useActionState, useId, useState } from 'react'
import { updateCustomerNextContact, type ContactPlanState } from '@/features/crm/contact-plan-actions'
import { CONTACT_PLAN_MAX_DAYS, CONTACT_PLAN_TOLERANCE_MS } from '@/features/crm/contact-plan-time'

const initialState: ContactPlanState = { kind: 'idle', message: '' }

export function ContactPlanningForm({ customerId, initialValue }: {
  customerId: string
  initialValue: string
}) {
  const [setState, setAction, setPending] = useActionState(updateCustomerNextContact, initialState)
  const [clearState, clearAction, clearPending] = useActionState(updateCustomerNextContact, initialState)
  const [draft, setDraft] = useState({ source: initialValue, value: initialValue })
  const inputId = useId()
  const helpId = `${inputId}-help`
  const setMessageId = `${inputId}-set-message`
  const clearMessageId = `${inputId}-clear-message`
  const pending = setPending || clearPending
  // A handled error keeps the controlled draft. A newly committed server value
  // replaces it after revalidation, including when CLEAR changes the value to null.
  // Advance the tracked source as well, so an older draft cannot return if the
  // server later changes back to a previously displayed value.
  if (draft.source !== initialValue) {
    setDraft({ source: initialValue, value: initialValue })
  }
  const value = draft.source === initialValue ? draft.value : initialValue

  return (
    <div className="mt-6 border-t border-slate-200 pt-6">
      <p id={helpId} className="text-sm leading-relaxed text-slate-500">
        Nhập ngày giờ Việt Nam (UTC+7), chính xác đến phút. Chọn thời điểm trong tương lai, tối đa {CONTACT_PLAN_MAX_DAYS} ngày;
        máy chủ cho phép trễ tối đa {CONTACT_PLAN_TOLERANCE_MS / 1000} giây để bù thời gian gửi yêu cầu. Ngày giờ không hợp lệ sẽ không được tự điều chỉnh.
      </p>
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <form data-contact-plan-form="SET" action={setAction} aria-busy={setPending}>
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="operation" value="SET" />
          <label htmlFor={inputId} className="block text-sm font-medium">Ngày giờ liên hệ tiếp theo (UTC+7)</label>
          <div className="mt-2 flex flex-wrap gap-3">
            <input
              id={inputId}
              name="nextContactAt"
              type="datetime-local"
              step={60}
              required
              value={value}
              onChange={(event) => setDraft({ source: initialValue, value: event.target.value })}
              disabled={pending}
              aria-describedby={`${helpId} ${setMessageId}`}
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
            />
            <button type="submit" disabled={pending} className="rounded-xl bg-[#1B4FA0] px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60">
              {setPending ? 'Đang lưu…' : 'Lưu kế hoạch liên hệ'}
            </button>
          </div>
          <p id={setMessageId} role={setState.kind === 'error' ? 'alert' : 'status'} aria-live={setState.kind === 'error' ? 'assertive' : 'polite'} aria-atomic="true" className={`mt-3 text-sm ${setState.kind === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
            {setPending ? 'Đang kiểm tra và lưu kế hoạch…' : setState.message}
          </p>
        </form>
        <form data-contact-plan-form="CLEAR" action={clearAction} aria-busy={clearPending}>
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="operation" value="CLEAR" />
          <p className="text-sm font-medium">Bỏ lịch liên hệ đã lên</p>
          <button type="submit" disabled={pending} aria-describedby={clearMessageId} className="mt-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60">
            {clearPending ? 'Đang xóa lịch…' : 'Xóa lịch liên hệ tiếp theo'}
          </button>
          <p id={clearMessageId} role={clearState.kind === 'error' ? 'alert' : 'status'} aria-live={clearState.kind === 'error' ? 'assertive' : 'polite'} aria-atomic="true" className={`mt-3 text-sm ${clearState.kind === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
            {clearPending ? 'Đang kiểm tra và xóa lịch…' : clearState.message}
          </p>
        </form>
      </div>
    </div>
  )
}
