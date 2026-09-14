'use client'

import { CustomerTaskStatus } from '@prisma/client'
import { useActionState, useId } from 'react'
import { updateCustomerTaskStatus, type TaskStatusState } from '@/features/crm/actions'

const initialState: TaskStatusState = { kind: 'idle', message: '' }

export function TaskStatusForm({ taskId, status }: {
  taskId: string
  status: CustomerTaskStatus
}) {
  const [state, formAction, pending] = useActionState(updateCustomerTaskStatus, initialState)
  const inputId = useId()
  const messageId = `${inputId}-message`

  return (
    <form action={formAction} className="mt-4 space-y-2" aria-busy={pending}>
      <input type="hidden" name="taskId" value={taskId} />
      <label htmlFor={inputId} className="block text-xs font-medium text-slate-600">Cập nhật trạng thái công việc</label>
      <div className="flex flex-wrap gap-2">
        <select
          key={status}
          id={inputId}
          name="status"
          defaultValue={status}
          required
          disabled={pending}
          aria-describedby={messageId}
          className="min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:opacity-60"
        >
          {Object.values(CustomerTaskStatus).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? 'Đang lưu…' : 'Cập nhật'}
        </button>
      </div>
      <p
        id={messageId}
        role={state.kind === 'error' ? 'alert' : 'status'}
        aria-live={state.kind === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
        className={`text-xs ${state.kind === 'error' ? 'text-red-700' : 'text-emerald-700'}`}
      >
        {pending ? 'Đang cập nhật công việc…' : state.message}
      </p>
    </form>
  )
}
