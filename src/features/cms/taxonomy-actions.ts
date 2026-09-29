'use server'

import { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { revalidatePath } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/roles'
import { nextArticleUpdatedAt } from './article-draft'
import { TaxonomyError, mapTaxonomyError, normalizeTaxonomyDelete, normalizeTaxonomyInput, parseTaxonomyId, parseTaxonomyKind, type TaxonomyMutationResult } from './taxonomy'
import { currentTaxonomyActor, findTaxonomyItem, taxonomyReferenceCount } from './taxonomy-store'
import { getTaxonomyCatalog } from './taxonomy-query'

async function mutate(operation: 'create' | 'update' | 'delete', kindInput: unknown, idInput: unknown, input: unknown): Promise<TaxonomyMutationResult> {
  let result: Extract<TaxonomyMutationResult, { ok: true }>['data']
  try {
    const session = await getServerSession(authOptions), actor = session?.user
    if (!actor || !hasPermission(actor.role, 'cms:admin')) throw new TaxonomyError('FORBIDDEN')
    const kind = parseTaxonomyKind(kindInput), id = operation === 'create' ? null : parseTaxonomyId(idInput)
    const { data, expectedUpdatedAt } = operation === 'delete' ? { data: null, expectedUpdatedAt: normalizeTaxonomyDelete(input) } : normalizeTaxonomyInput(kind, operation, input)
    result = await prisma.$transaction(async tx => {
      await currentTaxonomyActor(tx, actor)
      const current = id === null ? null : await findTaxonomyItem(tx, kind, id)
      if (id !== null && !current) throw new TaxonomyError('NOT_FOUND')
      if (current && current.updatedAt !== expectedUpdatedAt!.toISOString()) throw new TaxonomyError('EDIT_CONFLICT')
      if (operation === 'delete') {
        if (await taxonomyReferenceCount(tx, kind, id!)) throw new TaxonomyError('TAXONOMY_IN_USE')
        const where = { id: id!, updatedAt: expectedUpdatedAt! }
        let removed: { count: number }
        switch (kind) {
          case 'category': removed = await tx.articleCategory.deleteMany({ where }); break
          case 'topic': removed = await tx.articleTopic.deleteMany({ where }); break
          case 'tag': removed = await tx.articleTag.deleteMany({ where }); break
          case 'instrument': removed = await tx.financialInstrument.deleteMany({ where }); break
        }
        if (removed.count !== 1) throw new TaxonomyError('EDIT_CONFLICT')
        return { kind, item: null, deletedId: id }
      }
      if (!data) throw new TaxonomyError('INTERNAL_ERROR')
      if (current && Object.entries(data).every(([field, value]) => current[field as keyof typeof current] === value)) return { kind, item: current, deletedId: null }
      let persistedId = id
      const metadata = { name: data.name }
      const activeMetadata = { ...metadata, isActive: data.isActive! }
      if (operation === 'create') {
        switch (kind) {
          case 'category': persistedId = (await tx.articleCategory.create({ data: { ...activeMetadata, slug: data.slug!, description: data.description!, sortOrder: data.sortOrder! }, select: { id: true } })).id; break
          case 'topic': persistedId = (await tx.articleTopic.create({ data: { ...activeMetadata, slug: data.slug!, description: data.description! }, select: { id: true } })).id; break
          case 'tag': persistedId = (await tx.articleTag.create({ data: { ...metadata, slug: data.slug! }, select: { id: true } })).id; break
          case 'instrument': persistedId = (await tx.financialInstrument.create({ data: { ...activeMetadata, canonicalKey: data.canonicalKey!, symbol: data.symbol!, instrumentType: data.instrumentType!, exchange: data.exchange!, countryCode: data.countryCode!, currency: data.currency! }, select: { id: true } })).id; break
        }
      } else {
        const where = { id: id!, updatedAt: expectedUpdatedAt! }, updatedAt = nextArticleUpdatedAt(expectedUpdatedAt!)
        let changed: { count: number }
        switch (kind) {
          case 'category': changed = await tx.articleCategory.updateMany({ where, data: { ...activeMetadata, description: data.description!, sortOrder: data.sortOrder!, updatedAt } }); break
          case 'topic': changed = await tx.articleTopic.updateMany({ where, data: { ...activeMetadata, description: data.description!, updatedAt } }); break
          case 'tag': changed = await tx.articleTag.updateMany({ where, data: { ...metadata, updatedAt } }); break
          case 'instrument': changed = await tx.financialInstrument.updateMany({ where, data: { ...activeMetadata, countryCode: data.countryCode!, currency: data.currency!, updatedAt } }); break
        }
        if (changed.count !== 1) throw new TaxonomyError('EDIT_CONFLICT')
      }
      const item = await findTaxonomyItem(tx, kind, persistedId!)
      if (!item || (current && item.updatedAt <= current.updatedAt)) throw new TaxonomyError('EDIT_CONFLICT')
      return { kind, item, deletedId: null }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    const failure = mapTaxonomyError(error, operation === 'delete')
    if (failure.code === 'INTERNAL_ERROR') console.error('CMS_TAXONOMY_WRITE_FAILED')
    return { ok: false, error: failure }
  }
  let warning = false
  for (const path of ['/creator', '/creator/taxonomy', '/creator/articles/[id]/classification']) {
    try { if (path.includes('[id]')) revalidatePath(path, 'page'); else revalidatePath(path) } catch { warning = true }
  }
  if (warning) console.error('CMS_TAXONOMY_REVALIDATION_FAILED')
  return { ok: true, data: result, ...(warning ? { warning: 'Danh mục đã được lưu. Tải lại danh sách để xem dữ liệu mới.' } : {}) }
}
export async function createTaxonomy(kind: unknown, input: unknown): Promise<TaxonomyMutationResult> { return mutate('create', kind, null, input) }
export async function updateTaxonomy(kind: unknown, id: unknown, input: unknown): Promise<TaxonomyMutationResult> { return mutate('update', kind, id, input) }
export async function deleteTaxonomy(kind: unknown, id: unknown, input: unknown): Promise<TaxonomyMutationResult> { return mutate('delete', kind, id, input) }
export async function searchTaxonomy(kind: unknown, input: unknown) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || !hasPermission(session.user.role, 'cms:admin')) throw new TaxonomyError('FORBIDDEN')
    return getTaxonomyCatalog(session.user, kind, input)
  } catch (error) { return { ok: false as const, error: mapTaxonomyError(error) } }
}
