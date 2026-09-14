import { CustomerTaskPriority } from '@prisma/client'
import { parseVietnamContactInput } from './contact-plan-time'

// Match createCustomerTask's existing 160 UTF-16-unit title limit.
export const TASK_PLAN_TITLE_MAX = 160
export const TASK_PLAN_PRIORITIES = Object.values(CustomerTaskPriority)
// Task deadlines may be overdue: do not apply CRM-012's future-only policy.
export const TASK_PLAN_MIN_INPUT = '1900-01-01T00:00'
export const TASK_PLAN_MAX_INPUT = '2100-12-31T23:59'

export function canPlanTask(status: string) {
  return status === 'TODO' || status === 'IN_PROGRESS'
}

type TaskPlanInput = {
  taskId: string
  title: string
  priority: CustomerTaskPriority
  dueAt: Date | null
  expectedUpdatedAt: Date
}
type TaskPlanValidation = { ok: true; data: TaskPlanInput } | { ok: false; message: string }

function singleField(form: FormData, name: string) {
  const values = form.getAll(name)
  return values.length === 1 && typeof values[0] === 'string' ? values[0] : null
}

export function parseTaskPlanForm(form: unknown): TaskPlanValidation {
  if (!(form instanceof FormData)) return { ok: false, message: 'Dữ liệu kế hoạch công việc không hợp lệ.' }
  const taskId = singleField(form, 'taskId')
  const rawTitle = singleField(form, 'title')
  const priority = singleField(form, 'priority')
  const rawDueAt = singleField(form, 'dueAt')
  const version = singleField(form, 'expectedUpdatedAt')
  if (!taskId || !/^[A-Za-z0-9_-]{1,191}$/.test(taskId)) return { ok: false, message: 'Mã công việc không hợp lệ.' }
  if (rawTitle === null || /[\u0000-\u001f\u007f]/.test(rawTitle)) {
    return { ok: false, message: 'Tiêu đề phải là một giá trị văn bản, không chứa ký tự điều khiển.' }
  }
  const title = rawTitle.trim()
  if (!title || title.length > TASK_PLAN_TITLE_MAX) {
    return { ok: false, message: `Tiêu đề công việc phải có từ 1 đến ${TASK_PLAN_TITLE_MAX} ký tự.` }
  }
  const parsedPriority = TASK_PLAN_PRIORITIES.find((value) => value === priority)
  if (!parsedPriority) return { ok: false, message: 'Độ ưu tiên công việc không hợp lệ.' }
  // Only an explicitly present empty string clears the deadline. Missing is an error.
  if (rawDueAt === null) return { ok: false, message: 'Phải gửi một giá trị hạn công việc; để trống nếu muốn xóa hạn.' }
  let dueAt: Date | null = null
  if (rawDueAt !== '') {
    dueAt = parseVietnamContactInput(rawDueAt)
    if (!dueAt || rawDueAt < TASK_PLAN_MIN_INPUT || rawDueAt > TASK_PLAN_MAX_INPUT) {
      return { ok: false, message: 'Nhập hạn theo YYYY-MM-DDTHH:mm, giờ Việt Nam, trong các năm 1900–2100. Có thể chọn ngày đã qua.' }
    }
  }
  if (!version || !/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(version)) {
    return { ok: false, message: 'Phiên bản công việc không hợp lệ. Vui lòng tải lại trang.' }
  }
  const expectedUpdatedAt = new Date(version)
  if (!Number.isFinite(expectedUpdatedAt.getTime()) || expectedUpdatedAt.toISOString() !== version) {
    return { ok: false, message: 'Phiên bản công việc không hợp lệ. Vui lòng tải lại trang.' }
  }
  // No client customer, assignee, status, history or contact-plan fields enter data.
  return { ok: true, data: { taskId, title, priority: parsedPriority, dueAt, expectedUpdatedAt } }
}
