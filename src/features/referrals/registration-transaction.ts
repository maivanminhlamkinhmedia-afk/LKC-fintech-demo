import 'server-only'

import {
  RegistrationRolledBackError,
  type RegistrationInput,
  type RegistrationPolicy,
  type RegistrationResult,
  type RegistrationServerPorts,
  type ResolvedRegistrationPolicies,
} from './registration-server-ports'

const policyNames: readonly RegistrationPolicy[] = [
  'identity', 'password', 'referralCode', 'emailVerification', 'accountActivation', 'customerProfile',
]
const inputKeys = new Set(['name', 'email', 'password', 'referralCode'])

/** Input is a bounded decoded JSON record. Size/rate limits belong to the future
 * transport adapter. This is not a hostile Proxy sandbox or duplicate-key parser.
 * Accessors, inherited fields, symbols and extra browser fields are rejected.
 */
function readInput(value: unknown): RegistrationInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !inputKeys.has(key)) return null
    const descriptor = descriptors[key]
    if (!('value' in descriptor) || typeof descriptor.value !== 'string') return null
  }
  for (const key of ['name', 'email', 'password']) {
    if (!Object.hasOwn(descriptors, key)) return null
  }
  return Object.freeze({
    name: descriptors.name.value as string,
    email: descriptors.email.value as string,
    password: descriptors.password.value as string,
    ...(Object.hasOwn(descriptors, 'referralCode')
      ? { referralCode: descriptors.referralCode.value as string } : {}),
  })
}

class RegistrationAbort extends Error {
  constructor(readonly result: RegistrationResult) {
    super('Registration aborted')
  }
}

function requireId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0) throw new Error('Invalid adapter receipt')
}

/** Unwired server core. No route/action, DB implementation, policy defaults or
 * retry loop. A committed result says nothing about activation, email delivery
 * or entitlement. Callers MUST NOT automatically retry an unknown outcome.
 */
export async function registerClientTransaction(
  rawInput: unknown,
  ports: RegistrationServerPorts,
): Promise<RegistrationResult> {
  let input: RegistrationInput | null
  try { input = readInput(rawInput) } catch { return { kind: 'invalid-input' } }
  if (!input) return { kind: 'invalid-input' }

  let transactionEntered = false
  let callbackEntered = false
  let writesCompleted = false
  try {
    // Snapshot policy references so asynchronous work cannot switch policies.
    const references = {} as Record<RegistrationPolicy, string>
    const unresolved: RegistrationPolicy[] = []
    for (const name of policyNames) {
      const policy = ports.policies[name]
      if (!policy || policy.state !== 'resolved' || typeof policy.reference !== 'string' || !policy.reference.trim()) {
        unresolved.push(name)
      } else references[name] = policy.reference
    }
    if (unresolved.length) return { kind: 'policy-unresolved', policies: unresolved }
    const policies: ResolvedRegistrationPolicies = Object.freeze(references)
    const prepared = await ports.prepareCredentials(Object.freeze({
      name: input.name, email: input.email, password: input.password,
    }), policies)
    if (prepared.kind === 'unresolved') return { kind: 'policy-unresolved', policies: [prepared.policy] }
    if (prepared.kind === 'invalid') return { kind: 'field-error', field: prepared.field, code: 'invalid' }
    if (prepared.kind !== 'ready' || typeof prepared.name !== 'string' || typeof prepared.email !== 'string'
      || typeof prepared.passwordHash !== 'string' || !prepared.passwordHash) return { kind: 'unavailable' }
    const userInput = Object.freeze({
      name: prepared.name, email: prepared.email, passwordHash: prepared.passwordHash,
      role: 'CLIENT' as const,
      accountActivationPolicy: policies.accountActivation,
      emailVerificationPolicy: policies.emailVerification,
    })

    transactionEntered = true
    await ports.runInTransaction(async tx => {
      if (callbackEntered) throw new Error('Transaction callback replay forbidden')
      callbackEntered = true
      let sourceId: string | null = null
      let sourceVersion: string | null = null
      if (input.referralCode !== undefined && input.referralCode !== '') {
        let referral
        try { referral = await tx.verifyReferral(input.referralCode, policies.referralCode) }
        catch { throw new RegistrationAbort({ kind: 'field-error', field: 'referralCode', code: 'unavailable' }) }
        if (!referral || (referral.kind === 'verified' && (typeof referral.sourceId !== 'string' || !referral.sourceId
          || typeof referral.sourceVersion !== 'string' || !referral.sourceVersion))) {
          throw new RegistrationAbort({ kind: 'field-error', field: 'referralCode', code: 'unavailable' })
        }
        switch (referral.kind) {
          case 'verified': sourceId = referral.sourceId; sourceVersion = referral.sourceVersion; break
          case 'invalid': case 'disabled': case 'unavailable': case 'unresolved':
            throw new RegistrationAbort({ kind: 'field-error', field: 'referralCode', code: referral.kind })
          default: throw new RegistrationAbort({ kind: 'field-error', field: 'referralCode', code: 'unavailable' })
        }
      }
      const exists = await tx.emailExists(userInput.email)
      if (exists === true) throw new RegistrationAbort({ kind: 'field-error', field: 'email', code: 'duplicate-email' })
      if (exists !== false) throw new Error('Invalid adapter response')
      const user = await tx.createUser(userInput)
      requireId(user.id)
      const profile = await tx.createCustomerProfile(Object.freeze({ userId: user.id, policyReference: policies.customerProfile }))
      requireId(profile.id)
      if (sourceId !== null && sourceVersion !== null) await tx.createAttribution(Object.freeze({ userId: user.id, customerProfileId: profile.id, sourceId, sourceVersion }))
      await tx.appendAudit(Object.freeze({
        event: 'CLIENT_REGISTRATION', userId: user.id, customerProfileId: profile.id,
        referralSourceId: sourceId, referralSourceVersion: sourceVersion, policyReferences: policies,
      }))
      writesCompleted = true
    })
    if (!writesCompleted) return { kind: 'outcome-unknown', retry: 'reconciliation-required' }
    return { kind: 'committed' }
  } catch (error) {
    if (transactionEntered && error instanceof RegistrationAbort) return error.result
    if (transactionEntered && error instanceof RegistrationRolledBackError) {
      if (error.kind === 'duplicate-email') return { kind: 'field-error', field: 'email', code: 'duplicate-email' }
      if (error.kind === 'conflict') return { kind: 'conflict', retry: 'new-server-attempt-required' }
      return { kind: 'unavailable' }
    }
    // No raw errors, identifiers, credentials or input echoed to the caller.
    return transactionEntered
      ? { kind: 'outcome-unknown', retry: 'reconciliation-required' }
      : { kind: 'unavailable' }
  }
}
