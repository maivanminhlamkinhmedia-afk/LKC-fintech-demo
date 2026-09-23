import type { ArticleStatus, Prisma } from '@prisma/client'
import { articleCmsScope, type CMSUser } from './access'

export const EDITORIAL_IN_PROGRESS_STATUSES = [
  'SUBMITTED',
  'EDITORIAL_REVIEW',
  'CHANGES_REQUESTED',
  'FACT_CHECK',
  'APPROVED',
  'SCHEDULED',
] as const satisfies readonly ArticleStatus[]

export const PUBLISHED_STATUSES = [
  'PUBLISHED',
  'CORRECTED',
] as const satisfies readonly ArticleStatus[]

export const RECENT_ARTICLE_SELECT = {
  id: true,
  title: true,
  slug: true,
  articleType: true,
  status: true,
  updatedAt: true,
  publishedAt: true,
} as const satisfies Prisma.ArticleSelect

export const OWN_AUTHOR_PROFILE_SELECT = {
  displayName: true,
  slug: true,
  jobTitle: true,
  isPublic: true,
  updatedAt: true,
} as const satisfies Prisma.AuthorProfileSelect

// The actor comes from the server session. Additional filters can only narrow
// the existing CMS scope, including its deny scope for unauthorized callers.
export function dashboardArticleWhere(
  user: CMSUser | null | undefined,
  extraFilter?: Prisma.ArticleWhereInput,
): Prisma.ArticleWhereInput {
  return { AND: [articleCmsScope(user), extraFilter ?? {}] }
}
