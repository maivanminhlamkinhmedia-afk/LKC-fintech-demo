import 'server-only'

import type { Prisma, InstrumentType } from '@prisma/client'
import { hasPermission } from '@/lib/roles'
import type { CMSUser } from './access'
import { TaxonomyError, exactTaxonomyObject, normalizeTaxonomySearch, parseTaxonomyId, parseTaxonomyTimestamp, type TaxonomyItem, type TaxonomyKind, type TaxonomyOption, type TaxonomyPage, type TaxonomySearch } from './taxonomy'

export const categorySelect = { id: true, name: true, slug: true, description: true, sortOrder: true, isActive: true, createdAt: true, updatedAt: true } as const
export const topicSelect = { id: true, name: true, slug: true, description: true, isActive: true, createdAt: true, updatedAt: true } as const
export const tagSelect = { id: true, name: true, slug: true, createdAt: true, updatedAt: true } as const
export const instrumentSelect = { id: true, name: true, canonicalKey: true, symbol: true, instrumentType: true, exchange: true, countryCode: true, currency: true, isActive: true, createdAt: true, updatedAt: true } as const
type Row = { id: string; name: string; slug?: string; canonicalKey?: string; symbol?: string; isActive?: boolean; description?: string | null; sortOrder?: number; instrumentType?: InstrumentType; exchange?: string | null; countryCode?: string | null; currency?: string | null; createdAt: Date; updatedAt: Date }
export function taxonomyOptionDto(kind: TaxonomyKind, row: Pick<Row, 'id' | 'name' | 'slug' | 'canonicalKey' | 'symbol' | 'isActive'>): TaxonomyOption {
  try {
    parseTaxonomyId(row.id)
    if (typeof row.name !== 'string' || (kind === 'instrument' ? typeof row.canonicalKey !== 'string' || typeof row.symbol !== 'string' : typeof row.slug !== 'string') || (kind !== 'tag' && typeof row.isActive !== 'boolean')) throw new Error()
    return { id: row.id, kind, name: row.name, slug: kind === 'instrument' ? null : row.slug!, canonicalKey: kind === 'instrument' ? row.canonicalKey! : null, symbol: kind === 'instrument' ? row.symbol! : null, isActive: kind === 'tag' ? null : row.isActive! }
  } catch { throw new TaxonomyError('INTERNAL_ERROR') }
}
export function taxonomyItemDto(kind: TaxonomyKind, row: Row): TaxonomyItem {
  try {
    const createdAt = parseTaxonomyTimestamp(row.createdAt.toISOString()).toISOString()
    const updatedAt = parseTaxonomyTimestamp(row.updatedAt.toISOString()).toISOString()
    for (const field of ['description', 'exchange', 'countryCode', 'currency'] as const) if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string') throw new Error()
    if (kind === 'category' && !Number.isInteger(row.sortOrder)) throw new Error()
    return { ...taxonomyOptionDto(kind, row), description: row.description ?? null, sortOrder: row.sortOrder ?? null,
      instrumentType: row.instrumentType ?? null, exchange: row.exchange ?? null, countryCode: row.countryCode ?? null, currency: row.currency ?? null, createdAt, updatedAt }
  } catch { throw new TaxonomyError('INTERNAL_ERROR') }
}
export async function currentTaxonomyActor(tx: Prisma.TransactionClient, sessionActor: CMSUser): Promise<CMSUser> {
  const actor = await tx.user.findUnique({ where: { id: sessionActor.id }, select: { id: true, role: true, status: true } })
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== sessionActor.role || !hasPermission(actor.role, 'cms:admin')) throw new TaxonomyError('FORBIDDEN')
  return actor
}
export async function findTaxonomyItem(tx: Prisma.TransactionClient, kind: TaxonomyKind, id: string): Promise<TaxonomyItem | null> {
  let row: Row | null
  switch (kind) {
    case 'category': row = await tx.articleCategory.findUnique({ where: { id }, select: categorySelect }); break
    case 'topic': row = await tx.articleTopic.findUnique({ where: { id }, select: topicSelect }); break
    case 'tag': row = await tx.articleTag.findUnique({ where: { id }, select: tagSelect }); break
    case 'instrument': row = await tx.financialInstrument.findUnique({ where: { id }, select: instrumentSelect }); break
  }
  return row ? taxonomyItemDto(kind, row) : null
}
export async function taxonomyReferenceCount(tx: Prisma.TransactionClient, kind: TaxonomyKind, id: string): Promise<number> {
  switch (kind) {
    // Deliberately all Article statuses/owners. SetNull is not permission to detach.
    case 'category': return tx.article.count({ where: { categoryId: id } })
    case 'topic': return tx.articleTopicMapping.count({ where: { topicId: id } })
    case 'tag': return tx.articleTagMapping.count({ where: { tagId: id } })
    case 'instrument': return tx.articleInstrument.count({ where: { instrumentId: id } })
  }
}
export async function queryTaxonomyPage(tx: Prisma.TransactionClient, kind: TaxonomyKind, search: TaxonomySearch): Promise<TaxonomyPage> {
  const active = kind === 'tag' ? 'all' : search.active
  const where = { ...(active === 'active' ? { isActive: true } : {}), ...(search.q ? { OR: kind === 'instrument'
    ? [{ name: { contains: search.q } }, { symbol: { contains: search.q } }, { canonicalKey: { contains: search.q } }]
    : [{ name: { contains: search.q } }, { slug: { contains: search.q } }] } : {}) }
  let total: number
  switch (kind) {
    case 'category': total = await tx.articleCategory.count({ where }); break
    case 'topic': total = await tx.articleTopic.count({ where }); break
    case 'tag': total = await tx.articleTag.count({ where }); break
    case 'instrument': total = await tx.financialInstrument.count({ where }); break
  }
  const totalPages = Math.max(1, Math.ceil(total / 25)), page = Math.min(search.page, totalPages)
  const args = { where, skip: (page - 1) * 25, take: 25 }
  const orderBy = [{ name: 'asc' as const }, { id: 'asc' as const }]
  let rows: Row[]
  switch (kind) {
    case 'category': rows = await tx.articleCategory.findMany({ ...args, select: categorySelect, orderBy: [{ sortOrder: 'asc' }, ...orderBy] }); break
    case 'topic': rows = await tx.articleTopic.findMany({ ...args, select: topicSelect, orderBy }); break
    case 'tag': rows = await tx.articleTag.findMany({ ...args, select: tagSelect, orderBy }); break
    case 'instrument': rows = await tx.financialInstrument.findMany({ ...args, select: instrumentSelect, orderBy }); break
  }
  return { kind, q: search.q, active, items: rows.map(row => taxonomyItemDto(kind, row)), total, totalPages, page }
}
// Internal only. Classification authorizes its fresh actor and scoped parent
// first, in the same Serializable transaction as this bounded options read.
export async function queryTaxonomyOptions(tx: Prisma.TransactionClient, kind: TaxonomyKind, input: unknown): Promise<TaxonomyPage<TaxonomyOption>> {
  const values = exactTaxonomyObject(input, ['q', 'page'])
  const search = normalizeTaxonomySearch({ q: values.q, page: values.page, active: 'active' })
  const page = await queryTaxonomyPage(tx, kind, search)
  return { ...page, items: page.items.map(item => ({ id: item.id, kind, name: item.name, slug: item.slug, canonicalKey: item.canonicalKey, symbol: item.symbol, isActive: item.isActive })) }
}
