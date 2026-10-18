/** Client entry state only. Nothing here authenticates a referral or writes attribution.
 * C04 registration must revalidate the exact submitted code on the server, inside
 * the separately owned registration transaction. Do not persist this state as proof.
 */
export type ReferralInput =
  | Readonly<{ kind: 'omitted' }>
  | Readonly<{ kind: 'provided'; code: string }>
  | Readonly<{ kind: 'invalid-input' }>

export type ReferralStatus =
  | 'omitted' | 'invalid-input' | 'unverified' | 'pending'
  | 'invalid' | 'source-error' | 'reported-valid'

export type ReferralCheckRequest = Readonly<{ code: string }>

export type ReferralEntryState = Readonly<{
  input: ReferralInput
  status: ReferralStatus
  request: ReferralCheckRequest | null
}>

/** No trimming, case folding, format, length or expiry policy is inferred.
 * Only an absent value or the exact empty string means omission. Whitespace is
 * retained as entered and requires server policy, rather than silently dropped.
 */
export function readReferralInput(raw: unknown): ReferralInput {
  if (raw === undefined || raw === '') return Object.freeze({ kind: 'omitted' })
  if (typeof raw !== 'string') return Object.freeze({ kind: 'invalid-input' })
  return Object.freeze({ kind: 'provided', code: raw })
}

export function createReferralEntry(raw: unknown = ''): ReferralEntryState {
  const input = readReferralInput(raw)
  return Object.freeze({
    input,
    status: input.kind === 'provided' ? 'unverified' : input.kind,
    request: null,
  })
}

/** Explicit user editing creates a fresh state and invalidates any prior result. */
export function changeReferralCode(_state: ReferralEntryState, raw: unknown): ReferralEntryState {
  return createReferralEntry(raw)
}

export function beginReferralCheck(state: ReferralEntryState): ReferralEntryState {
  if (state.input.kind !== 'provided' || state.status === 'pending') return state
  return Object.freeze({
    input: state.input,
    status: 'pending',
    // Object identity correlates responses, including edit A -> B -> A and retries.
    // This is a local race guard, not an authentication token or server contract.
    request: Object.freeze({ code: state.input.code }),
  })
}

/** Candidate display adapter payload, NOT a shared C04 API contract.
 * Accept only a decoded plain data record with one own data property. Never
 * render remote messages/identities. Hostile in-process Proxies are outside this
 * JSON transport boundary; catching errors is not a sandbox for their side effects.
 */
function readOutcome(payload: unknown): 'valid' | 'invalid' | 'unavailable' {
  try {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return 'unavailable'
    const prototype = Object.getPrototypeOf(payload)
    if (prototype !== Object.prototype && prototype !== null) return 'unavailable'
    const keys = Reflect.ownKeys(payload)
    if (keys.length !== 1 || keys[0] !== 'outcome') return 'unavailable'
    const descriptor = Object.getOwnPropertyDescriptor(payload, 'outcome')
    if (!descriptor || !('value' in descriptor)) return 'unavailable'
    return descriptor.value === 'valid' || descriptor.value === 'invalid'
      ? descriptor.value : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/** Transport rejection/timeout should be delivered as { outcome: 'unavailable' }.
 * A positive response remains display-only: even forged 'valid' cannot authorize
 * registration, email verification, attribution, billing or a subscription here.
 */
export function completeReferralCheck(
  state: ReferralEntryState,
  request: ReferralCheckRequest,
  payload: unknown,
): ReferralEntryState {
  if (state.status !== 'pending' || state.request !== request) return state
  const outcome = readOutcome(payload)
  return Object.freeze({
    input: state.input,
    status: outcome === 'valid' ? 'reported-valid' : outcome === 'invalid' ? 'invalid' : 'source-error',
    request: null,
  })
}

export type RegistrationReferralIntent =
  | Readonly<{ kind: 'omitted' }>
  | Readonly<{ kind: 'blocked'; reason: 'invalid-input' }>
  | Readonly<{
    kind: 'requires-server-verification'
    code: string
    displayStatus: ReferralStatus
  }>

/** An intent, never a registration-ready decision. No client status bypasses the
 * server. Keep entered invalid/pending/failed codes in the submission intent so
 * an integrator cannot silently turn a failed check into no referral.
 */
export function getRegistrationReferralIntent(state: ReferralEntryState): RegistrationReferralIntent {
  if (state.input.kind === 'omitted') return Object.freeze({ kind: 'omitted' })
  if (state.input.kind === 'invalid-input') return Object.freeze({ kind: 'blocked', reason: 'invalid-input' })
  return Object.freeze({
    kind: 'requires-server-verification',
    code: state.input.code,
    displayStatus: state.status,
  })
}
