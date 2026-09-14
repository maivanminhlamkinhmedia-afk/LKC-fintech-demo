import { createHmac, timingSafeEqual } from 'node:crypto'

const PURPOSE = 'sales-team-member-removal:v1'
export const REMOVAL_CONFIRMATION_MAX_AGE_MS = 10 * 60 * 1000

export type RemovalConfirmationBinding = {
  actorId: string
  teamId: string
  membershipId: string
  userId: string
  membershipCreatedAt: string
}

type ConfirmationOptions = { secret?: string; now?: number }

function signingSecret(options: ConfirmationOptions) {
  const secret = options.secret ?? process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('Removal confirmation signing is not configured')
  return secret
}

function signature(payload: string, secret: string) {
  // Domain separation prevents reuse of other HMACs made with the auth secret.
  return createHmac('sha256', secret).update(`${PURPOSE}.${payload}`).digest()
}

export function createRemovalConfirmation(binding: RemovalConfirmationBinding, options: ConfirmationOptions = {}) {
  const issuedAt = options.now ?? Date.now()
  const payload = Buffer.from(JSON.stringify({
    purpose: PURPOSE,
    ...binding,
    issuedAt,
    expiresAt: issuedAt + REMOVAL_CONFIRMATION_MAX_AGE_MS,
  })).toString('base64url')
  return `${payload}.${signature(payload, signingSecret(options)).toString('base64url')}`
}

export function verifyRemovalConfirmation(token: string, binding: RemovalConfirmationBinding, options: ConfirmationOptions = {}) {
  if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return false
  const [payload, encodedSignature] = token.split('.')
  const suppliedSignature = Buffer.from(encodedSignature, 'base64url')
  if (suppliedSignature.toString('base64url') !== encodedSignature) return false
  const expectedSignature = signature(payload, signingSecret(options))
  if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) return false

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const now = options.now ?? Date.now()
    return data !== null && typeof data === 'object'
      && data.purpose === PURPOSE
      && Object.entries(binding).every(([key, value]) => data[key] === value)
      && Number.isSafeInteger(data.issuedAt)
      && Number.isSafeInteger(data.expiresAt)
      && data.expiresAt - data.issuedAt === REMOVAL_CONFIRMATION_MAX_AGE_MS
      && data.issuedAt <= now
      && data.expiresAt > now
  } catch {
    return false
  }
}
