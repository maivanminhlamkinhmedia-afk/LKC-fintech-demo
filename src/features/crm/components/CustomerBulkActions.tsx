'use client'

import Link from 'next/link'
import { useActionState, useId, useState } from 'react'
import { updateCustomerPriorities, type CustomerBulkState } from '@/features/crm/customer-bulk-actions'
import { MAX_BULK_CUSTOMERS } from '@/features/crm/customer-bulk-validation'
import { CUSTOMER_PRIORITIES, formatCRMDate, isOverdueFollowUp } from '@/features/crm/customer-filters'
import type { CustomerSummary } from '@/features/crm/customer-queries'

type CustomerCardsProps = { customers: CustomerSummary[]; now: Date }
type CustomerSelection = {
  selected: ReadonlySet<string>
  pending: boolean
  messageId: string
  toggle: (id: string, checked: boolean) => void
}
const initialState: CustomerBulkState = { kind: 'idle', message: '' }

export function CustomerCards({ customers, now, selection }: CustomerCardsProps & { selection?: CustomerSelection }) {
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {customers.map((customer) => (
        <article key={customer.id} data-customer-id={customer.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {selection && (
            <label className="mb-4 flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox" name="customerIds" value={customer.id}
                checked={selection.selected.has(customer.id)}
                onChange={(event) => selection.toggle(customer.id, event.target.checked)}
                disabled={selection.pending} aria-describedby={selection.messageId}
                aria-label={`Chọn khách hàng ${customer.customerCode}`}
                className="h-4 w-4 rounded border-slate-300 accent-[#1B4FA0] disabled:opacity-60"
              />
              Chọn khách hàng
            </label>
          )}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words font-semibold">{customer.user.name}</h2>
              <p className="break-all text-sm text-slate-500">{customer.customerCode}</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{customer.status}</span>
          </div>
          <p className="mt-4 break-all text-sm">{customer.user.email}</p>
          <p className="mt-2 text-xs text-slate-500">Ưu tiên: {customer.priority}</p>
          <p className="mt-2 text-xs text-slate-600">Follow-up: {formatCRMDate(customer.nextContactAt)}</p>
          {isOverdueFollowUp(customer.nextContactAt, now) && <p className="mt-1 text-xs font-semibold text-red-700">Follow-up quá hạn</p>}
          <p className="mt-1 text-xs text-slate-500">Sales phụ trách: {customer.assignedSales?.name ?? 'Chưa phân công'}</p>
          <Link href={`/sales/customers/${customer.id}`} className="mt-5 inline-flex rounded-xl bg-[#1B4FA0] px-4 py-2 text-sm font-semibold text-white">Xem CRM</Link>
        </article>
      ))}
    </div>
  )
}

function BulkPriorityFields({ customers, now, pending, messageId }: CustomerCardsProps & { pending: boolean; messageId: string }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [priority, setPriority] = useState('')
  const fieldId = useId()
  const helpId = `${fieldId}-help`
  const allSelected = customers.length > 0 && selected.size === customers.length

  function toggle(id: string, checked: boolean) {
    setSelected((previous) => {
      const next = new Set(previous)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <>
      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h2 className="font-semibold">Cập nhật ưu tiên khách hàng</h2>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 py-2 text-sm font-medium">
            <input
              type="checkbox" checked={allSelected}
              ref={(input) => { if (input) input.indeterminate = selected.size > 0 && !allSelected }}
              onChange={(event) => setSelected(new Set(event.target.checked ? customers.map((customer) => customer.id) : []))}
              disabled={pending || customers.length === 0} aria-describedby={helpId}
              className="h-4 w-4 rounded border-slate-300 accent-[#1B4FA0] disabled:opacity-60"
            />
            Chọn tất cả trên trang này
          </label>
          <p className="py-2 text-sm text-slate-600" role="status" aria-live="polite" aria-atomic="true">Đã chọn {selected.size}/{customers.length} khách hàng</p>
          <label htmlFor={fieldId} className="text-sm font-medium">
            Ưu tiên khách hàng mới
            <select
              id={fieldId} name="priority" required value={priority}
              onChange={(event) => setPriority(event.target.value)} disabled={pending}
              aria-describedby={`${helpId} ${messageId}`}
              className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="">Chọn mức ưu tiên</option>
              {CUSTOMER_PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button type="submit" disabled={pending || selected.size === 0 || !priority} className="rounded-xl bg-[#1B4FA0] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
            {pending ? 'Đang cập nhật…' : 'Cập nhật khách hàng đã chọn'}
          </button>
        </div>
        <p id={helpId} className="mt-3 text-xs leading-relaxed text-slate-600">
          Chỉ chọn khách hàng trên trang hiện tại; lựa chọn được xóa khi đổi bộ lọc, trang hoặc danh sách kết quả. Máy chủ nhận tối đa {MAX_BULK_CUSTOMERS} khách hàng mỗi lần.
          Chỉ đổi ưu tiên khách hàng, không đổi ưu tiên task, trạng thái, Sales phụ trách hay lịch liên hệ.
        </p>
      </div>
      <CustomerCards customers={customers} now={now} selection={{ selected, pending, messageId, toggle }} />
    </>
  )
}

export function CustomerBulkActions({ customers, now, selectionKey }: CustomerCardsProps & { selectionKey: string }) {
  const [state, formAction, pending] = useActionState(updateCustomerPriorities, initialState)
  const messageId = `${useId()}-bulk-message`

  return (
    <form data-customer-bulk-form="" action={formAction} aria-busy={pending}>
      <p
        id={messageId} role={state.kind === 'error' ? 'alert' : 'status'}
        aria-live={state.kind === 'error' ? 'assertive' : 'polite'} aria-atomic="true"
        className={`mt-4 text-sm ${state.kind === 'error' ? 'text-red-700' : 'text-emerald-700'}`}
      >
        {pending ? 'Đang kiểm tra quyền và cập nhật ưu tiên khách hàng…' : state.message}
      </p>
      {/* Reset the complete selection when the visible result changes, without
          discarding feedback from the action that caused the refresh. */}
      <BulkPriorityFields key={selectionKey} customers={customers} now={now} pending={pending} messageId={messageId} />
    </form>
  )
}
