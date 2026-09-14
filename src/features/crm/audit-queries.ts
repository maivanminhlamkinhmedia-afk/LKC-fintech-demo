import 'server-only'
import { Prisma } from '@prisma/client'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import type { CRMSearchParams } from '@/features/crm/customer-filters'
import { CRM_AUDIT_ROLES, canReadCRMAudit } from '@/features/crm/audit-access'
import { AUDIT_ACTOR_LIMIT, AUDIT_MAX_PAGE, AUDIT_PAGE_SIZE, auditSqlWhere, auditWhere, parseAuditFilters } from '@/features/crm/audit-filters'
import { auditCustomerHref, getAuditDefinition, safeAuditId, summarizeAuditMetadata, type AuditSummaryField } from '@/features/crm/audit-registry'

export type AuditRow = {
  id: string; createdAt: Date; actor: { id: string; name: string } | null
  action: string; label: string; category: string; entityType: string; entityId: string | null
  summary: AuditSummaryField[]; customerHref: string | null
}
const auditSelect = {
  id: true, createdAt: true, actorId: true, action: true, entityType: true, entityId: true, metadata: true,
  actor: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogSelect
type SelectedAudit = Prisma.AuditLogGetPayload<{ select: typeof auditSelect }>
function auditRow(row: SelectedAudit): AuditRow {
  const definition = getAuditDefinition(row.action)
  // Defense in depth after the SQL binary allowlist; no raw fallback renderer.
  if (!definition) throw new Error('Unrecognized audit action')
  const validEntity = row.entityType === definition.entityType
  return {
    id: row.id, createdAt: row.createdAt,
    actor: row.actor ? { id: row.actor.id, name: row.actor.name } : null,
    action: definition.action, label: definition.label, category: definition.category,
    entityType: validEntity ? definition.entityType : 'Unknown',
    entityId: validEntity && definition.action !== 'CUSTOMER_CSV_EXPORT' && safeAuditId(row.entityId) ? row.entityId : null,
    summary: validEntity ? summarizeAuditMetadata(definition.action, row.metadata) : [],
    customerHref: auditCustomerHref(definition.action, row.entityType, row.entityId, row.metadata),
  }
}

// The sole data boundary authenticates independently of layouts/navigation. No
// cache, writes, audit creation, business enrichment or revalidation occurs here.
export async function getCRMAudit(params: CRMSearchParams, now = new Date()) {
  const session = await requireRole(CRM_AUDIT_ROLES)
  const parsed = parseAuditFilters(params, now)
  const empty = {
    ...parsed, rows: [] as AuditRow[], actors: [] as { id: string; name: string }[],
    total: 0, page: 1, pageCount: 1, historyCapped: false, error: null as string | null,
  }
  let result
  try {
    result = await prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true, status: true } })
      if (!actor || actor.status !== 'ACTIVE') return { denied: '/dang-nhap' } as const
      if (!canReadCRMAudit(actor.role)) return { denied: '/dashboard' } as const
      if (parsed.invalidKeys.length) return { data: empty }
      const where = auditWhere(parsed.filters, parsed.range)
      const predicate = auditSqlWhere(parsed.filters, parsed.range)
      const counts = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total FROM AuditLog a WHERE ${predicate}`)
      const total = Number(counts[0]?.total)
      if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid audit count')
      const pageCount = Math.max(1, Math.min(AUDIT_MAX_PAGE, Math.ceil(total / AUDIT_PAGE_SIZE)))
      const page = Math.min(parsed.filters.page, pageCount)
      const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT a.id FROM AuditLog a WHERE ${predicate}
        ORDER BY a.createdAt DESC, a.id DESC LIMIT ${AUDIT_PAGE_SIZE} OFFSET ${(page - 1) * AUDIT_PAGE_SIZE}`)
      const records = await tx.auditLog.findMany({
        where: { AND: [where, { id: { in: ids.map((entry) => entry.id) } }] },
        select: auditSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: AUDIT_PAGE_SIZE,
      })
      if (records.length !== ids.length) throw new Error('Inconsistent audit page')
      // Actor choices only include current Users related to matching CRM events.
      // Ignore selected actor here so users can change it; never look up an
      // arbitrary URL ID or expose users who occur only in account/auth audits.
      const actors = await tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`SELECT u.id, u.name FROM User u
        WHERE EXISTS (SELECT 1 FROM AuditLog a WHERE a.actorId = u.id AND ${auditSqlWhere(parsed.filters, parsed.range, false)})
        ORDER BY u.id ASC LIMIT ${AUDIT_ACTOR_LIMIT}`)
      return { data: { ...empty, rows: records.map(auditRow), actors, total, page, pageCount, historyCapped: total > AUDIT_MAX_PAGE * AUDIT_PAGE_SIZE } }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 })
  } catch {
    return { ...empty, error: 'Không thể tải nhật ký lúc này. Vui lòng thử lại.' }
  }
  // Preserve established redirect behavior; do not swallow redirects in catch.
  if ('denied' in result && result.denied) redirect(result.denied)
  return result.data!
}
