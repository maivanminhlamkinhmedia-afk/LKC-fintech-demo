import 'server-only'

import { Buffer } from 'node:buffer'
import type { RegistrationInput, RegistrationResult } from './registration-server-ports'
import { registrationPublicOutcome, type RegistrationPublicOutcome } from './registration-public-outcome'

type InputField = keyof RegistrationInput
const fields: readonly InputField[] = ['name', 'email', 'password', 'referralCode']

/** Server-owned approval references, NEVER browser-supplied configuration.
 * No production numbers or approval records are supplied by this feature.
 * Approved is the trusted adapter's assertion, not a signature check by the gate.
 * All sizes are UTF-8 bytes, not JS UTF-16 length. No format/case/expiry defaults.
 */
export type RegistrationRequestPolicy =
  | { readonly state: 'unresolved' }
  | {
    readonly state: 'approved'
    readonly reference: string
    readonly rateLimitPolicyReference: string
    readonly maxBodyBytes: number
    readonly maxFieldBytes: Readonly<Record<InputField, number>>
  }

export interface RegistrationRateLimitAuthority {
  /** Assertion by a trusted server composition root; not proof of backend safety.
   * A real adapter must atomically consume a durable, shared budget BEFORE allow.
   * Bind trusted request identity/keys in the server closure; never use a key,
   * X-Forwarded-For value or verification claim supplied in the registration body.
   * Policy governs quotas/windows/keys/timeouts. No in-memory fallback is provided.
   * Deployment requires tests for cross-worker races, restart, outage and spoofing.
   */
  readonly capability: 'durable-atomic'
  readonly policyReference: string
  consume(input: Readonly<{
    operation: 'client-registration'
    policyReference: string
  }>): Promise<{ readonly decision: 'allow' | 'deny' }>
}

export interface RegistrationRequestGatePorts {
  readonly policy?: RegistrationRequestPolicy
  readonly rateLimit?: RegistrationRateLimitAuthority
  /** Trusted server closure invoking the reviewed core, never a browser callback.
   * Must preserve unresolved commit outcomes for reconciliation on the server.
   * No automatic replay on timeout/lost ACK. Durable reconciliation is an adapter
   * gate; the public DTO is not a substitute for that persistent evidence.
   */
  readonly executeRegistration?: (input: RegistrationInput) => Promise<RegistrationResult>
}

function positiveBytes(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Unwired entry boundary. Accept a bounded transport-owned byte buffer, not an
 * already-parsed browser object or caller-declared Content-Length. The future
 * transport must ALSO cap streamed/decompressed bytes before allocating this
 * buffer. No hard-coded production limits, timers or in-memory limiter exist.
 * JSON duplicate keys are not detected by JSON.parse; parser policy remains open.
 * Arbitrary hostile JS objects/Proxies are outside the byte transport boundary.
 */
export async function gateRegistrationRequest(
  body: unknown,
  ports: RegistrationRequestGatePorts,
): Promise<RegistrationPublicOutcome> {
  let executionStarted = false
  try {
    const policy = ports.policy
    if (!policy || policy.state !== 'approved' || typeof policy.reference !== 'string' || !policy.reference.trim()
      || typeof policy.rateLimitPolicyReference !== 'string' || !policy.rateLimitPolicyReference.trim()
      || !positiveBytes(policy.maxBodyBytes)) return registrationPublicOutcome({ kind: 'unavailable' })
    const limits = {} as Record<InputField, number>
    for (const field of fields) {
      const limit = policy.maxFieldBytes?.[field]
      if (!positiveBytes(limit)) return registrationPublicOutcome({ kind: 'unavailable' })
      limits[field] = limit
    }
    // Size checked before copy, UTF-8 decoding, JSON parsing, rate backend or core.
    if (!(body instanceof Uint8Array) || body.byteLength > policy.maxBodyBytes
      || !(body.buffer instanceof ArrayBuffer)) return registrationPublicOutcome({ kind: 'invalid-input' })
    const rateLimit = ports.rateLimit
    const execute = ports.executeRegistration?.bind(ports)
    const rateReference = policy.rateLimitPolicyReference
    if (!rateLimit || rateLimit.capability !== 'durable-atomic' || rateLimit.policyReference !== rateReference
      || typeof rateLimit.consume !== 'function' || !execute) return registrationPublicOutcome({ kind: 'unavailable' })
    // Owned snapshot prevents transport mutation while the rate authority awaits.
    const bytes = new Uint8Array(body)
    const decision = await rateLimit.consume(Object.freeze({ operation: 'client-registration', policyReference: rateReference }))
    // Do not coerce truthy results or execute getters from malformed decisions.
    const descriptor = decision && Object.getOwnPropertyDescriptor(decision, 'decision')
    if (!descriptor || !('value' in descriptor) || descriptor.value !== 'allow') {
      return registrationPublicOutcome({ kind: 'unavailable' })
    }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return registrationPublicOutcome({ kind: 'invalid-input' })
    const data = value as Record<string, unknown>
    for (const key of Object.keys(data)) {
      if (!fields.includes(key as InputField)) return registrationPublicOutcome({ kind: 'invalid-input' })
    }
    for (const field of fields) {
      if (field === 'referralCode' && !Object.hasOwn(data, field)) continue
      const text = data[field]
      if (!Object.hasOwn(data, field) || typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > limits[field]) {
        return registrationPublicOutcome({ kind: 'invalid-input' })
      }
    }
    const input: RegistrationInput = Object.freeze({
      name: data.name as string, email: data.email as string, password: data.password as string,
      ...(Object.hasOwn(data, 'referralCode') ? { referralCode: data.referralCode as string } : {}),
    })
    executionStarted = true
    return registrationPublicOutcome(await execute(input))
  } catch {
    // Once execution starts, a thrown error may be a lost commit ACK. Never
    // downgrade it to an ordinary validation failure or recommend account retry.
    return registrationPublicOutcome({ kind: executionStarted ? 'outcome-unknown' : 'unavailable' })
  }
}
