import 'server-only'

/** Feature-local seams only. No default policy or production adapter is supplied. */
export type RegistrationPolicy =
  | 'identity'
  | 'password'
  | 'referralCode'
  | 'emailVerification'
  | 'accountActivation'
  | 'customerProfile'

export type PolicyResolution =
  | { readonly state: 'unresolved' }
  | { readonly state: 'resolved'; readonly reference: string }

export type RegistrationPolicies = Readonly<Record<RegistrationPolicy, PolicyResolution>>
export type ResolvedRegistrationPolicies = Readonly<Record<RegistrationPolicy, string>>
export type RegistrationField = 'name' | 'email' | 'password' | 'referralCode'

export interface RegistrationInput {
  readonly name: string
  readonly email: string
  readonly password: string
  /** Exact entered bytes; undefined/empty means absent. No trim/case conversion. */
  readonly referralCode?: string
}

export type PreparedRegistration =
  | { readonly kind: 'ready'; readonly name: string; readonly email: string; readonly passwordHash: string }
  | { readonly kind: 'invalid'; readonly field: 'name' | 'email' | 'password' }
  | { readonly kind: 'unresolved'; readonly policy: RegistrationPolicy }

export type ReferralVerification =
  | { readonly kind: 'verified'; readonly sourceId: string; readonly sourceVersion: string }
  | { readonly kind: 'invalid' | 'disabled' | 'unavailable' | 'unresolved' }

/**
 * Every operation MUST use the very same database transaction/connection.
 * verifyReferral must enforce the approved C04 format/case/expiry/eligibility
 * policy and keep the verified source valid until attribution commits (locking
 * or equivalent transactional constraints). sourceId is opaque, NOT a caregiver.
 * None of these methods may emit email, grant access, or perform external writes.
 */
export interface RegistrationTransaction {
  emailExists(email: string): Promise<boolean>
  verifyReferral(code: string, policyReference: string): Promise<ReferralVerification>
  createUser(input: {
    readonly name: string
    readonly email: string
    readonly passwordHash: string
    readonly role: 'CLIENT'
    /** Adapter resolves these references; core never invents status/verification. */
    readonly accountActivationPolicy: string
    readonly emailVerificationPolicy: string
  }): Promise<{ readonly id: string }>
  /** CRM owner must resolve customerCode generation/profile defaults explicitly. */
  createCustomerProfile(input: { readonly userId: string; readonly policyReference: string }): Promise<{ readonly id: string }>
  createAttribution(input: {
    readonly userId: string
    readonly customerProfileId: string
    readonly sourceId: string
    readonly sourceVersion: string
  }): Promise<void>
  /** Adapter supplies C07 event ID/version, trusted actor, semantic reason and
   * timestamp per the approved audit contract; never log PII or raw secrets. */
  appendAudit(input: {
    readonly event: 'CLIENT_REGISTRATION'
    readonly userId: string
    readonly customerProfileId: string
    readonly referralSourceId: string | null
    readonly referralSourceVersion: string | null
    readonly policyReferences: ResolvedRegistrationPolicies
  }): Promise<void>
}

/** Only the trusted adapter may certify a fully rolled-back failure.
 * Map duplicate email from the actual unique constraint, never error text.
 * A lost commit acknowledgement MUST NOT use this class.
 */
export class RegistrationRolledBackError extends Error {
  constructor(readonly kind: 'duplicate-email' | 'conflict' | 'unavailable') {
    super('Registration transaction rolled back')
    this.name = 'RegistrationRolledBackError'
  }
}

export interface RegistrationServerPorts {
  /** Server configuration, never deserialized from browser input. Resolved is
   * an adapter assertion referencing owner-approved policy, not a PO signature. */
  readonly policies: RegistrationPolicies
  /** Validate identity/password and hash using approved Auth policies. No DB
   * writes/logging/email. No credential, referral secret or PII in errors/logs. */
  prepareCredentials(
    input: Readonly<Pick<RegistrationInput, 'name' | 'email' | 'password'>>,
    policies: ResolvedRegistrationPolicies,
  ): Promise<PreparedRegistration>
  /**
   * Invoke work exactly once; resolve ONLY after a confirmed durable commit.
   * Any callback throw MUST roll back ALL writes and then rethrow that object.
   * On uncertain rollback/commit, throw a different error, never a callback
   * error or RegistrationRolledBackError. No automatic callback retries.
   * Enforce email uniqueness under concurrency. Bound transaction duration.
   * No external side effects; audit is transactional, not a post-commit logger.
   */
  runInTransaction(work: (tx: RegistrationTransaction) => Promise<void>): Promise<void>
}

export type RegistrationResult =
  | { readonly kind: 'committed' }
  | { readonly kind: 'invalid-input' }
  | { readonly kind: 'policy-unresolved'; readonly policies: readonly RegistrationPolicy[] }
  | { readonly kind: 'field-error'; readonly field: RegistrationField; readonly code: 'invalid' | 'disabled' | 'unavailable' | 'unresolved' | 'duplicate-email' }
  | { readonly kind: 'conflict'; readonly retry: 'new-server-attempt-required' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'outcome-unknown'; readonly retry: 'reconciliation-required' }
