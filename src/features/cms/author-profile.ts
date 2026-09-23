import type { AuthorProfile, Prisma, UserStatus } from '@prisma/client'
import { hasPermission, type AppRole } from '@/lib/roles'
import { canAccessCms, type CMSUser } from './access'

export const AUTHOR_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CREATOR'] as const

export type AuthorTargetUser = {
  id: string
  role: AppRole
  status: UserStatus
}

const USER_STATUSES: readonly UserStatus[] = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED']

function isAuthorTarget(target: AuthorTargetUser | null | undefined): target is AuthorTargetUser {
  return typeof target?.id === 'string'
    && target.id.trim().length > 0
    && AUTHOR_ROLES.some(role => role === target.role)
    && USER_STATUSES.includes(target.status)
}

// Callers supply the authenticated session actor and a server-loaded target User.
// An inactive target may be inspected internally, but cannot be written or publicized.
export function canReadAuthorProfile(
  actor: CMSUser | null | undefined,
  target: AuthorTargetUser | null | undefined,
): boolean {
  if (!canAccessCms(actor) || !isAuthorTarget(target)) return false
  if (actor.id === target.id && actor.role !== target.role) return false

  if (actor.role === 'CREATOR') return target.role === 'CREATOR' && actor.id === target.id
  if (!hasPermission(actor.role, 'cms:admin')) return false
  if (actor.role === 'SUPER_ADMIN') return true
  return actor.role === 'ADMIN' && target.role !== 'SUPER_ADMIN'
}

export function canManageAuthorProfile(
  actor: CMSUser | null | undefined,
  target: AuthorTargetUser | null | undefined,
): boolean {
  return canReadAuthorProfile(actor, target) && target?.status === 'ACTIVE'
}

export type AuthorProfileInput = {
  displayName: unknown
  slug: unknown
  jobTitle?: unknown
  bio?: unknown
  avatarUrl?: unknown
  expertise?: unknown
  publicEmail?: unknown
  isPublic?: unknown
}

export type AuthorProfileField = keyof AuthorProfileInput

export type NormalizedAuthorProfileInput = {
  displayName: string
  slug: string
  jobTitle: string | null
  bio: string | null
  avatarUrl: string | null
  expertise: string | null
  publicEmail: string | null
  isPublic?: boolean
}

const ERROR_MESSAGES = {
  VALIDATION_ERROR: 'Author profile input is invalid.',
  FORBIDDEN: 'You cannot access or manage this author profile.',
  SLUG_CONFLICT: 'This author slug is already in use.',
  WRITE_CONFLICT: 'The author profile changed concurrently. Please try again.',
  WRITE_FAILED: 'The author profile could not be saved.',
} as const

export type AuthorProfileErrorCode = keyof typeof ERROR_MESSAGES

export class AuthorProfileError extends Error {
  readonly code: AuthorProfileErrorCode
  readonly field?: AuthorProfileField

  constructor(code: AuthorProfileErrorCode, field?: AuthorProfileField) {
    super(ERROR_MESSAGES[code])
    this.name = 'AuthorProfileError'
    this.code = code
    if (field !== undefined) this.field = field
  }
}

const PROFILE_FIELDS: readonly AuthorProfileField[] = [
  'displayName', 'slug', 'jobTitle', 'bio', 'avatarUrl', 'expertise', 'publicEmail', 'isPublic',
]
const COMBINING_MARKS = new RegExp('\\p{M}', 'gu')

export function canonicalizeAuthorSlug(input: unknown): string {
  if (typeof input !== 'string') throw new AuthorProfileError('VALIDATION_ERROR', 'slug')

  const slug = input.trim().toLowerCase().normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (slug.length < 2 || slug.length > 120) throw new AuthorProfileError('VALIDATION_ERROR', 'slug')
  return slug
}

function inputField(input: object, field: AuthorProfileField): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, field)
    if (!descriptor) return undefined
    if (!('value' in descriptor)) throw new AuthorProfileError('VALIDATION_ERROR', field)
    return descriptor.value
  } catch {
    throw new AuthorProfileError('VALIDATION_ERROR', field)
  }
}

function optionalText(input: unknown, field: AuthorProfileField, maxLength?: number): string | null {
  if (input === null || input === undefined) return null
  if (typeof input !== 'string') throw new AuthorProfileError('VALIDATION_ERROR', field)
  const value = input.trim()
  if (maxLength !== undefined && Array.from(value).length > maxLength) {
    throw new AuthorProfileError('VALIDATION_ERROR', field)
  }
  return value || null
}

function normalizeAvatarUrl(input: unknown): string | null {
  const value = optionalText(input, 'avatarUrl')
  if (value === null) return null

  const hasControls = Array.from(value).some(character => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (!/^https?:\/\//i.test(value) || value.includes('\\') || hasControls) {
    throw new AuthorProfileError('VALIDATION_ERROR', 'avatarUrl')
  }
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      throw new AuthorProfileError('VALIDATION_ERROR', 'avatarUrl')
    }
  } catch {
    throw new AuthorProfileError('VALIDATION_ERROR', 'avatarUrl')
  }
  return value
}

function normalizePublicEmail(input: unknown): string | null {
  const value = optionalText(input, 'publicEmail')?.toLowerCase() ?? null
  if (value !== null && (Array.from(value).length > 191 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
    throw new AuthorProfileError('VALIDATION_ERROR', 'publicEmail')
  }
  return value
}

export function normalizeAuthorProfileInput(input: unknown): NormalizedAuthorProfileInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new AuthorProfileError('VALIDATION_ERROR')
  }
  try {
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) throw new AuthorProfileError('VALIDATION_ERROR')
  } catch {
    throw new AuthorProfileError('VALIDATION_ERROR')
  }

  const displayName = optionalText(inputField(input, 'displayName'), 'displayName', 120)
  if (displayName === null) throw new AuthorProfileError('VALIDATION_ERROR', 'displayName')
  const isPublic = inputField(input, 'isPublic')
  if (isPublic !== undefined && typeof isPublic !== 'boolean') {
    throw new AuthorProfileError('VALIDATION_ERROR', 'isPublic')
  }

  // Explicit allowlist: ownership, User fields and unknown payload keys never persist.
  return {
    displayName,
    slug: canonicalizeAuthorSlug(inputField(input, 'slug')),
    jobTitle: optionalText(inputField(input, 'jobTitle'), 'jobTitle', 160),
    bio: optionalText(inputField(input, 'bio'), 'bio', 5000),
    avatarUrl: normalizeAvatarUrl(inputField(input, 'avatarUrl')),
    expertise: optionalText(inputField(input, 'expertise'), 'expertise', 2000),
    publicEmail: normalizePublicEmail(inputField(input, 'publicEmail')),
    // Absence preserves an existing visibility choice; creates default to true at the write boundary.
    ...(isPublic === undefined ? {} : { isPublic }),
  }
}

export const AUTHOR_PROFILE_PUBLIC_SELECT = {
  id: true,
  displayName: true,
  slug: true,
  jobTitle: true,
  bio: true,
  avatarUrl: true,
  expertise: true,
  publicEmail: true,
  isPublic: true,
  updatedAt: true,
} as const satisfies Prisma.AuthorProfileSelect

export type PublicAuthorProfile = Pick<AuthorProfile, keyof typeof AUTHOR_PROFILE_PUBLIC_SELECT>

export function toPublicAuthorProfile(profile: PublicAuthorProfile): PublicAuthorProfile {
  return {
    id: profile.id,
    displayName: profile.displayName,
    slug: profile.slug,
    jobTitle: profile.jobTitle,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    expertise: profile.expertise,
    publicEmail: profile.publicEmail,
    isPublic: profile.isPublic,
    updatedAt: profile.updatedAt,
  }
}

export type AuthorProfileFailure = {
  code: AuthorProfileErrorCode
  message: string
  field?: AuthorProfileField
}

function ownErrorValue(error: unknown, key: string): unknown {
  if (error === null || typeof error !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(error, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function uniqueTargetMatches(target: unknown, field: 'slug' | 'userId'): boolean {
  const targets = Array.isArray(target) ? target : [target]
  return targets.some(value => value === field || value === `AuthorProfile_${field}_key`)
}

export function mapAuthorProfileError(error: unknown): AuthorProfileFailure {
  try {
    const code = ownErrorValue(error, 'code')
    if (error instanceof AuthorProfileError && typeof code === 'string'
      && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)) {
      const safeCode = code as AuthorProfileErrorCode
      const field = ownErrorValue(error, 'field')
      return {
        code: safeCode,
        message: ERROR_MESSAGES[safeCode],
        ...(PROFILE_FIELDS.some(value => value === field) ? { field: field as AuthorProfileField } : {}),
      }
    }
    if (code === 'P2002') {
      const meta = ownErrorValue(error, 'meta')
      const target = ownErrorValue(meta, 'target')
      // Prisma 7's MariaDB adapter may supply the index through its structured cause.
      const adapterCause = ownErrorValue(ownErrorValue(meta, 'driverAdapterError'), 'cause')
      const adapterIndex = ownErrorValue(ownErrorValue(adapterCause, 'constraint'), 'index')
      if (uniqueTargetMatches(target, 'slug') || adapterIndex === 'AuthorProfile_slug_key') {
        return { code: 'SLUG_CONFLICT', message: ERROR_MESSAGES.SLUG_CONFLICT, field: 'slug' }
      }
      return { code: 'WRITE_CONFLICT', message: ERROR_MESSAGES.WRITE_CONFLICT }
    }
    if (code === 'P2034') return { code: 'WRITE_CONFLICT', message: ERROR_MESSAGES.WRITE_CONFLICT }
  } catch {
    // Even malformed errors must not expose database details or throw from this mapper.
  }
  return { code: 'WRITE_FAILED', message: ERROR_MESSAGES.WRITE_FAILED }
}
