'use client'

import type { CustomerTaskPriority } from '@prisma/client'
import { useActionState, useId, useState } from 'react'
import { updateCustomerTaskPlan, type TaskPlanState } from '@/features/crm/task-plan-actions'
import {
  TASK_PLAN_TITLE_MAX, TASK_PLAN_PRIORITIES, TASK_PLAN_MIN_INPUT, TASK_PLAN_MAX_INPUT,
} from '@/features/crm/task-plan-validation'
import { toVietnamContactInput } from '@/features/crm/contact-plan-time'

const initialState: TaskPlanState = { kind: 'idle', message: '' }
type TaskPlanningProps = {
  taskId: string
  title: string
  priority: CustomerTaskPriority
  dueAt: Date | null
  updatedAt: Date
}

function TaskPlanningFields({ taskId, title, priority, dueAt, version, pending, messageId }: Omit<TaskPlanningProps, 'updatedAt'> & {
  version: string
  pending: boolean
  messageId: string
}) {
  const [draft, setDraft] = useState({ title, priority, dueAt: toVietnamContactInput(dueAt) })
  const inputId = useId()
  const helpId = `${inputId}-help`
  const inputClass = 'mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60'

  return (
    <>
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="expectedUpdatedAt" value={version} />
      <label htmlFor={`${inputId}-title`} className="block text-sm font-medium">Tiêu đề task</label>
      <input
        id={`${inputId}-title`} name="title" required maxLength={TASK_PLAN_TITLE_MAX}
        value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        disabled={pending} aria-describedby={`${helpId} ${messageId}`} className={inputClass}
      />
      <label htmlFor={`${inputId}-priority`} className="mt-3 block text-sm font-medium">Ưu tiên task</label>
      <select
        id={`${inputId}-priority`} name="priority" required value={draft.priority}
        onChange={(event) => setDraft({ ...draft, priority: event.target.value as CustomerTaskPriority })}
        disabled={pending} aria-describedby={messageId} className={inputClass}
      >
        {TASK_PLAN_PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <label htmlFor={`${inputId}-due`} className="mt-3 block text-sm font-medium">Hạn công việc (UTC+7)</label>
      <input
        id={`${inputId}-due`} name="dueAt" type="datetime-local" step={60}
        min={TASK_PLAN_MIN_INPUT} max={TASK_PLAN_MAX_INPUT}
        value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })}
        disabled={pending} aria-describedby={`${helpId} ${messageId}`} className={inputClass}
      />
      <button type="button" onClick={() => setDraft({ ...draft, dueAt: '' })} disabled={pending} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium disabled:opacity-60">
        Bỏ hạn trong biểu mẫu
      </button>
      <p id={helpId} className="mt-3 text-xs leading-relaxed text-slate-500">
        Tiêu đề tối đa {TASK_PLAN_TITLE_MAX} ký tự. Hạn theo giờ Việt Nam (UTC+7), chính xác đến phút, từ 01/01/1900 đến 31/12/2100; chấp nhận hạn đã qua.
        Để trống hạn rồi bấm Lưu để xóa hạn đã lưu. Nút bỏ hạn chỉ đổi biểu mẫu, chưa lưu dữ liệu.
        Kế hoạch task không thay đổi lịch liên hệ khách hàng, người phụ trách hoặc trạng thái task.
      </p>
      <button type="submit" disabled={pending} className="mt-3 rounded-lg bg-[#1B4FA0] px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60">
        {pending ? 'Đang lưu…' : 'Lưu kế hoạch task'}
      </button>
    </>
  )
}

export function TaskPlanningForm(props: TaskPlanningProps) {
  const [state, formAction, pending] = useActionState(updateCustomerTaskPlan, initialState)
  const messageId = `${useId()}-task-plan-message`
  const version = props.updatedAt.toISOString()

  return (
    <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-[#1B4FA0]">Chỉnh sửa kế hoạch task</summary>
      <form data-task-plan-form="" action={formAction} aria-busy={pending} className="mt-4">
        {/* Keep the draft and its version together. Fresh server versions remount
            fields, while action feedback survives successful revalidation. */}
        <TaskPlanningFields key={`${props.taskId}:${version}`} {...props} version={version} pending={pending} messageId={messageId} />
        <p
          id={messageId} role={state.kind === 'error' ? 'alert' : 'status'}
          aria-live={state.kind === 'error' ? 'assertive' : 'polite'} aria-atomic="true"
          className={`mt-3 text-sm ${state.kind === 'error' ? 'text-red-700' : 'text-emerald-700'}`}
        >
          {pending ? 'Đang kiểm tra phiên bản và lưu kế hoạch task…' : state.message}
        </p>
      </form>
    </details>
  )
}
