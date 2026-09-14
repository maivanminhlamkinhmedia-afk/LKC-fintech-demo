import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/authz'
import { hasPermission } from '@/lib/roles'
import { customerSalesScope } from '@/features/crm/access'
import type { CRMSearchParams } from '@/features/crm/customer-filters'
import { parseActivityFilters } from '@/features/crm/activity-filters'
import { getCustomerActivityTimeline } from '@/features/crm/activity-queries'
import { ActivityTimeline } from '@/features/crm/components/ActivityTimeline'
import { CreateInteractionForm } from '@/features/crm/components/CreateInteractionForm'
import { TaskStatusForm } from '@/features/crm/components/TaskStatusForm'
import {
  createCustomerTask,
  updateCustomerProfile,
} from '@/features/crm/actions'

const formatter = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
})

function formatDate(value: Date | null) {
  if (!value) return '—'
  return formatter.format(value)
}

function toVietnamDateTimeLocal(value: Date | null) {
  if (!value) return ''

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)

  const map = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  )

  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`
}

export default async function CustomerCRMPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<CRMSearchParams>
}) {
  const session = await requirePermission('sales:read')
  const { id } = await params

  const customer = await prisma.customerProfile.findFirst({
    where: {
      id,
      ...customerSalesScope(session.user),
    },
    include: {
      user: true,
      assignedSales: true,
      tasks: {
        include: {
          assignedTo: true,
          createdBy: true,
        },
        orderBy: [
          {
            status: 'asc',
          },
          {
            dueAt: 'asc',
          },
          {
            createdAt: 'desc',
          },
        ],
        take: 100,
      },
    },
  })

  if (!customer) {
    notFound()
  }

  const { filters, invalidKeys } = parseActivityFilters(await searchParams)
  const timeline = await getCustomerActivityTimeline(session.user, customer.id, filters)
  if (!timeline) notFound()

  return (
    <section className="space-y-8">
      <div>
        <Link
          href="/sales/customers"
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          ← Quay lại danh sách khách hàng
        </Link>

        <div className="mt-4">
          <h1 className="text-3xl font-bold">
            {customer.user.name}
          </h1>

          <p className="mt-1 text-slate-500">
            {customer.customerCode} · {customer.user.email}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-slate-500">
            Trạng thái
          </p>
          <p className="mt-2 font-semibold">
            {customer.status}
          </p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-slate-500">
            Ưu tiên
          </p>
          <p className="mt-2 font-semibold">
            {customer.priority}
          </p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-slate-500">
            Sales phụ trách
          </p>
          <p className="mt-2 font-semibold">
            {customer.assignedSales?.name ?? 'Chưa phân công'}
          </p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-slate-500">
            Liên hệ tiếp theo
          </p>
          <p className="mt-2 font-semibold">
            {formatDate(customer.nextContactAt)}
          </p>
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        <form
          action={updateCustomerProfile}
          className="rounded-2xl bg-white p-6 shadow-sm"
        >
          <input
            type="hidden"
            name="customerId"
            value={customer.id}
          />

          <h2 className="text-xl font-bold">
            Hồ sơ CRM
          </h2>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">
                Trạng thái
              </span>

              <select
                name="status"
                defaultValue={customer.status}
                className="w-full rounded-xl border px-3 py-2"
              >
                <option value="LEAD">LEAD</option>
                <option value="PROSPECT">PROSPECT</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="DORMANT">DORMANT</option>
                <option value="CLOSED">CLOSED</option>
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-500">
                Mức ưu tiên
              </span>

              <select
                name="priority"
                defaultValue={customer.priority}
                className="w-full rounded-xl border px-3 py-2"
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-500">
                Nguồn khách
              </span>

              <input
                name="source"
                defaultValue={customer.source ?? ''}
                placeholder="Facebook, Referral, Website..."
                className="w-full rounded-xl border px-3 py-2"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-500">
                Follow-up tiếp theo
              </span>

              <input
                name="nextContactAt"
                type="datetime-local"
                defaultValue={toVietnamDateTimeLocal(
                  customer.nextContactAt,
                )}
                className="w-full rounded-xl border px-3 py-2"
              />
            </label>
          </div>

          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-slate-500">
              Ghi chú tổng quan
            </span>

            <textarea
              name="note"
              defaultValue={customer.note ?? ''}
              rows={5}
              className="w-full rounded-xl border px-3 py-2"
            />
          </label>

          <button className="mt-4 rounded-xl bg-[#1B4FA0] px-5 py-2.5 font-semibold text-white">
            Lưu hồ sơ
          </button>
        </form>

        {hasPermission(session.user.role, 'sales:write') && <CreateInteractionForm customerId={customer.id} />}
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        <ActivityTimeline customerId={customer.id} filters={filters} invalidKeys={invalidKeys} timeline={timeline} />

        <div className="space-y-6">
          <form
            action={createCustomerTask}
            className="rounded-2xl bg-white p-6 shadow-sm"
          >
            <input
              type="hidden"
              name="customerId"
              value={customer.id}
            />

            <h2 className="text-xl font-bold">
              Tạo Follow-up Task
            </h2>

            <label className="mt-5 block text-sm">
              <span className="mb-1 block text-slate-500">
                Công việc
              </span>

              <input
                name="title"
                required
                placeholder="Ví dụ: Gọi lại khách hàng"
                className="w-full rounded-xl border px-3 py-2"
              />
            </label>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-500">
                  Priority
                </span>

                <select
                  name="priority"
                  defaultValue="MEDIUM"
                  className="w-full rounded-xl border px-3 py-2"
                >
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                  <option value="URGENT">URGENT</option>
                </select>
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-slate-500">
                  Deadline
                </span>

                <input
                  name="dueAt"
                  type="datetime-local"
                  className="w-full rounded-xl border px-3 py-2"
                />
              </label>
            </div>

            <label className="mt-4 block text-sm">
              <span className="mb-1 block text-slate-500">
                Mô tả
              </span>

              <textarea
                name="description"
                rows={3}
                className="w-full rounded-xl border px-3 py-2"
              />
            </label>

            <button className="mt-4 rounded-xl bg-[#1B4FA0] px-5 py-2.5 font-semibold text-white">
              Tạo task
            </button>
          </form>

          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold">
              Follow-up Tasks
            </h2>

            <div className="mt-5 space-y-4">
              {customer.tasks.length === 0 && (
                <p className="text-sm text-slate-500">
                  Chưa có task.
                </p>
              )}

              {customer.tasks.map((task) => (
                <article
                  key={task.id}
                  className="rounded-xl border p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {task.title}
                      </p>

                      <p className="mt-1 text-xs text-slate-500">
                        {task.priority} · Deadline:{' '}
                        {formatDate(task.dueAt)}
                      </p>

                      <p className="mt-1 text-xs text-slate-500">
                        Phụ trách:{' '}
                        {task.assignedTo?.name ??
                          'Chưa phân công'}
                      </p>
                    </div>

                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">
                      {task.status}
                    </span>
                  </div>

                  {task.description && (
                    <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">
                      {task.description}
                    </p>
                  )}

                  {hasPermission(session.user.role, 'sales:write') && (
                    <TaskStatusForm taskId={task.id} status={task.status} />
                  )}
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
