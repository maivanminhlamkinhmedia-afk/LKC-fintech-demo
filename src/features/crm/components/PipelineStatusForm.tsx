'use client'

import { CustomerStatus } from '@prisma/client'
import { useActionState, useId } from 'react'
import {
  updateCustomerPipelineStatus,
  type PipelineStatusState,
} from '@/features/crm/pipeline-actions'

const initialState: PipelineStatusState = { kind: 'idle', message: '' }

export function PipelineStatusForm({
  customerId,
  status,
}: {
  customerId: string
  status: CustomerStatus
}) {
  const inputId = useId()
  const messageId = `${inputId}-message`
  const [state, formAction, pending] = useActionState(updateCustomerPipelineStatus, initialState)

  return (
    <form action={formAction} className="mt-4 border-t border-slate-100 pt-3" aria-busy={pending}>
      <input type="hidden" name="customerId" value={customerId} />
      <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-slate-600">
        Chuyển trạng thái
      </label>
      <div className="flex gap-2">
        <select
          key={status}
          id={inputId}
          name="status"
          defaultValue={status}
          required
          disabled={pending}
          aria-describedby={messageId}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs disabled:opacity-60"
        >
          {Object.values(CustomerStatus).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#1B4FA0] px-3 py-2 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
      <p
        id={messageId}
        role={state.kind === 'error' ? 'alert' : 'status'}
        aria-live={state.kind === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
        className={`mt-2 text-xs ${state.kind === 'error' ? 'text-red-700' : 'text-emerald-700'}`}
      >
        {pending ? 'Đang cập nhật trạng thái khách hàng…' : state.message}
      </p>
    </form>
  )
}
