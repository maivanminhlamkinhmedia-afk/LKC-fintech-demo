import type { Article, Prisma } from '@prisma/client'
import { APP_ROLES, hasPermission, type AppRole } from '@/lib/roles'

export type CMSUser = {
  id: string
  role: AppRole
}

export type CMSArticle = Pick<Article, 'id' | 'authorId' | 'status'>

type Actor = CMSUser | null | undefined
type ArticleInput = CMSArticle | null | undefined

// Pure policies for server-side callers. Obtain user from
// await requirePermission('cms:access') in '@/lib/authz', and article from the
// database. Never construct these authorization inputs from FormData/client data.
export function canAccessCms(user: Actor): user is CMSUser {
  return typeof user?.id === 'string'
    && user.id.trim().length > 0
    && APP_ROLES.includes(user.role)
    && hasPermission(user.role, 'cms:access')
}

export function canCreateArticle(user: Actor): boolean {
  return canAccessCms(user) && hasPermission(user.role, 'cms:article:create')
}

export function canReadArticle(user: Actor, article: ArticleInput): boolean {
  if (!canAccessCms(user) || !article?.id) return false

  return hasPermission(user.role, 'cms:article:read:any')
    || (hasPermission(user.role, 'cms:article:read:own') && article.authorId === user.id)
}

export function canUpdateArticle(user: Actor, article: ArticleInput): boolean {
  if (!canAccessCms(user) || !article?.id) return false
  if (hasPermission(user.role, 'cms:article:update:any')) return true

  return hasPermission(user.role, 'cms:article:update:own')
    && article.authorId === user.id
    && (article.status === 'DRAFT' || article.status === 'CHANGES_REQUESTED')
}

export function canSubmitArticle(user: Actor, article: ArticleInput): boolean {
  if (!canAccessCms(user) || !article?.id) return false

  // Submission transitions are enforced by the later workflow tasks.
  return hasPermission(user.role, 'cms:article:submit')
    && (hasPermission(user.role, 'cms:admin') || article.authorId === user.id)
}

export function canReviewArticle(user: Actor, article: ArticleInput): boolean {
  return canAccessCms(user) && !!article?.id && hasPermission(user.role, 'cms:article:review')
}

export function canApproveArticle(user: Actor, article: ArticleInput): boolean {
  return canAccessCms(user) && !!article?.id && hasPermission(user.role, 'cms:article:approve')
}

export function canPublishArticle(user: Actor, article: ArticleInput): boolean {
  return canAccessCms(user) && !!article?.id && hasPermission(user.role, 'cms:article:publish')
}

// Combine this scope with additional list filters using AND so they cannot
// overwrite authorId. An empty IN list matches no article, including for callers
// that accidentally invoke this policy before the cms:access session guard.
export function articleCmsScope(user: Actor): Prisma.ArticleWhereInput {
  if (canAccessCms(user)) {
    if (hasPermission(user.role, 'cms:article:read:any')) return {}
    if (hasPermission(user.role, 'cms:article:read:own')) return { authorId: user.id }
  }

  return { id: { in: [] } }
}
