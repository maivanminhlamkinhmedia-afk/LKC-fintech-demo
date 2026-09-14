'use client'

import { useActionState, useId } from 'react'
import {
  addSalesTeamMember,
  removeSalesTeamMember,
  type TeamMemberActionState,
} from '@/features/crm/team-actions'

const initialState: TeamMemberActionState = { kind: 'idle', message: '' }

export function AddTeamMemberForm({ teamId, sales }: {
  teamId: string
  sales: { id: string; name: string; email: string }[]
}) {
  const [state, formAction, pending] = useActionState(addSalesTeamMember, initialState)
  const inputId = useId()
  const messageId = `${inputId}-message`

  return (
    <form action={formAction} aria-busy={pending} className="space-y-2">
      <input type="hidden" name="teamId" value={teamId} />
      <label htmlFor={inputId} className="block text-sm font-medium">Thêm nhân viên Sales</label>
      <div className="flex flex-wrap gap-2">
        <select
          id={inputId}
          name="userId"
          required
          defaultValue=""
          disabled={pending || sales.length === 0}
          aria-describedby={messageId}
          className="min-w-0 rounded-xl border px-3 py-2 text-sm disabled:opacity-60"
        >
          <option value="" disabled>{sales.length ? 'Chọn nhân viên Sales' : 'Không có Sales khả dụng'}</option>
          {sales.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}
        </select>
        <button type="submit" disabled={pending || sales.length === 0} className="rounded-xl bg-[#2BAD97] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? 'Đang thêm…' : 'Thêm'}
        </button>
      </div>
      <p id={messageId} role={state.kind === 'error' ? 'alert' : 'status'} aria-live={state.kind === 'error' ? 'assertive' : 'polite'} aria-atomic="true" className={`text-sm ${state.kind === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
        {pending ? 'Đang kiểm tra và thêm thành viên…' : state.message}
      </p>
    </form>
  )
}

export function RemoveTeamMemberForm({ teamId, membershipId }: {
  teamId: string
  membershipId: string
}) {
  const [state, formAction, pending] = useActionState(removeSalesTeamMember, initialState)
  const inputId = useId()
  const messageId = `${inputId}-message`
  const warningId = `${inputId}-warning`
  const confirmation = state.kind === 'warning' ? state.confirmation : undefined

  return (
    <form action={formAction} aria-busy={pending} className="space-y-3">
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      {confirmation && (
        <div role="alert" aria-labelledby={warningId} className="min-w-64 max-w-md space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <h3 id={warningId} className="font-semibold">Xác nhận xóa thành viên có khách hàng</h3>
          <p className="break-words">Sales: <strong>{confirmation.salesName}</strong> · {confirmation.salesEmail}</p>
          <p>Đang phụ trách <strong>{confirmation.assignedCustomerCount}</strong> khách hàng, trong đó <strong>{confirmation.nonClosedCustomerCount}</strong> khách hàng chưa đóng.</p>
          <p>Xóa khỏi đội chỉ xóa tư cách thành viên, không phân công lại hoặc xóa khách hàng và công việc. Khách hàng và công việc vẫn giữ nguyên người phụ trách.</p>
          <p>Quyền xem khách hàng của quản lý đội có thể thay đổi. Máy chủ sẽ kiểm tra lại số khách hàng khi bạn xác nhận.</p>
          <input type="hidden" name="confirmationToken" value={confirmation.token} />
          <label htmlFor={inputId} className="flex items-start gap-2 font-medium">
            <input
              key={confirmation.token}
              id={inputId}
              name="confirmation"
              type="checkbox"
              value="REMOVE_MEMBERSHIP_KEEP_ASSIGNMENTS"
              required
              disabled={pending}
              className="mt-1 size-4 shrink-0"
            />
            <span>Tôi hiểu và xác nhận xóa thành viên, giữ nguyên phân công khách hàng và công việc.</span>
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} aria-describedby={messageId} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60">
          {pending ? 'Đang xử lý…' : confirmation ? 'Xác nhận xóa khỏi đội' : 'Xóa khỏi đội'}
        </button>
        {confirmation && (
          <a href={pending ? undefined : `/sales/teams/${teamId}`} aria-disabled={pending} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 aria-disabled:opacity-60">Hủy</a>
        )}
      </div>
      <p id={messageId} role={state.kind === 'error' ? 'alert' : 'status'} aria-live={state.kind === 'error' ? 'assertive' : 'polite'} aria-atomic="true" className={`max-w-md text-sm ${state.kind === 'error' ? 'text-red-700' : state.kind === 'warning' ? 'text-amber-800' : 'text-emerald-700'}`}>
        {pending ? 'Đang kiểm tra thành viên và khách hàng được phân công…' : state.message}
      </p>
    </form>
  )
}
