'use server'

import { Prisma } from '@prisma/client'
import { requirePermission } from '@/lib/authz'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/roles'
import { canAccessCms, type CMSUser } from '@/features/cms/access'
import {
  AUTHOR_ROLES,
  AUTHOR_PROFILE_PUBLIC_SELECT,
  AuthorProfileError,
  canManageAuthorProfile,
  canonicalizeAuthorSlug,
  mapAuthorProfileError,
  normalizeAuthorProfileInput,
  toPublicAuthorProfile,
  type PublicAuthorProfile,
} from '@/features/cms/author-profile'

export type AuthorProfileWriteResult =
  | { ok: true; profile: PublicAuthorProfile }
  | { ok: false; error: ReturnType<typeof mapAuthorProfileError> }

function denied(): AuthorProfileWriteResult {
  return { ok: false, error: mapAuthorProfileError(new AuthorProfileError('FORBIDDEN')) }
}

async function saveAuthorProfile(
  actor: CMSUser,
  targetUserId: string,
  input: unknown,
): Promise<AuthorProfileWriteResult> {
  try {
    const profile = await prisma.$transaction(async (tx) => {
      // Recheck current eligibility under the same transaction as the write.
      // Session identity remains authoritative; a changed role requires reload.
      const currentActor = await tx.user.findUnique({
        where: { id: actor.id },
        select: { id: true, role: true, status: true },
      })
      if (!currentActor || currentActor.role !== actor.role || currentActor.status !== 'ACTIVE') {
        throw new AuthorProfileError('FORBIDDEN')
      }

      const target = targetUserId === actor.id
        ? currentActor
        : await tx.user.findUnique({
          where: { id: targetUserId },
          select: { id: true, role: true, status: true },
        })
      if (!canManageAuthorProfile(actor, target)) throw new AuthorProfileError('FORBIDDEN')

      const data = normalizeAuthorProfileInput(input)
      return tx.authorProfile.upsert({
        where: { userId: targetUserId },
        create: { ...data, userId: targetUserId, isPublic: data.isPublic ?? true },
        // Omitted isPublic stays omitted here, preserving an existing private profile.
        update: data,
        select: AUTHOR_PROFILE_PUBLIC_SELECT,
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return { ok: true, profile: toPublicAuthorProfile(profile) }
  } catch (error) {
    // Only a stable domain result crosses the action boundary, never Prisma errors.
    return { ok: false, error: mapAuthorProfileError(error) }
  }
}

export async function upsertMyAuthorProfile(input: unknown): Promise<AuthorProfileWriteResult> {
  const { user } = await requirePermission('cms:access')
  if (!canAccessCms(user)) return denied()

  // Extra userId/role/status input fields are never consulted for authorization.
  return saveAuthorProfile(user, user.id, input)
}

export async function upsertAuthorProfileForUser(
  targetUserId: unknown,
  input: unknown,
): Promise<AuthorProfileWriteResult> {
  const { user } = await requirePermission('cms:admin')
  if (!canAccessCms(user) || !hasPermission(user.role, 'cms:admin')) return denied()
  if (typeof targetUserId !== 'string' || !targetUserId.trim() || targetUserId.length > 191) return denied()

  return saveAuthorProfile(user, targetUserId, input)
}

export async function getPublicAuthorProfileBySlug(slug: unknown): Promise<PublicAuthorProfile | null> {
  let canonicalSlug: string
  try {
    canonicalSlug = canonicalizeAuthorSlug(slug)
  } catch {
    return null
  }

  try {
    const profile = await prisma.authorProfile.findFirst({
      where: {
        slug: canonicalSlug,
        isPublic: true,
        user: { is: { status: 'ACTIVE', role: { in: [...AUTHOR_ROLES] } } },
      },
      select: AUTHOR_PROFILE_PUBLIC_SELECT,
    })
    return profile ? toPublicAuthorProfile(profile) : null
  } catch {
    // Do not reveal database details or distinguish authorization/filter failures.
    throw new Error('Không thể tải hồ sơ tác giả.')
  }
}
