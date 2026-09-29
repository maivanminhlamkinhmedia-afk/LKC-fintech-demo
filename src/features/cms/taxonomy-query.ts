import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/roles'
import type { CMSUser } from './access'
import { TaxonomyError, mapTaxonomyError, normalizeTaxonomySearch, parseTaxonomyKind, type TaxonomyPage, type TaxonomyResult } from './taxonomy'
import { currentTaxonomyActor, queryTaxonomyPage } from './taxonomy-store'

export async function getTaxonomyCatalog(actor: CMSUser, kindInput: unknown, input: unknown): Promise<TaxonomyResult<TaxonomyPage>> {
  try {
    if (!actor || !hasPermission(actor.role, 'cms:admin')) throw new TaxonomyError('FORBIDDEN')
    const kind = parseTaxonomyKind(kindInput), search = normalizeTaxonomySearch(input)
    const data = await prisma.$transaction(async tx => {
      await currentTaxonomyActor(tx, actor)
      return queryTaxonomyPage(tx, kind, search)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return { ok: true, data }
  } catch (error) {
    const failure = mapTaxonomyError(error)
    if (failure.code === 'INTERNAL_ERROR') console.error('CMS_TAXONOMY_READ_FAILED')
    return { ok: false, error: failure }
  }
}
