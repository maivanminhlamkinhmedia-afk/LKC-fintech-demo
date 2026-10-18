import 'server-only'

/** Public presentation proposal, not a success receipt or shared HTTP contract.
 * Transport must use this DTO only, with uniform status/headers for equivalent
 * outcomes. Body mapping alone does NOT address timing or production abuse.
 */
export type RegistrationPublicOutcome = Readonly<{
  state: 'not-confirmed' | 'review-required'
  nextAction: 'await-guidance' | 'await-reconciliation'
  resubmit: false
  message: string
}>

const neutral: RegistrationPublicOutcome = Object.freeze({
  state: 'not-confirmed',
  nextAction: 'await-guidance',
  resubmit: false,
  message: 'Chưa thể xác nhận kết quả đăng ký. Vui lòng chờ hướng dẫn trước khi gửi yêu cầu khác.',
})

const reconciliation: RegistrationPublicOutcome = Object.freeze({
  state: 'review-required',
  nextAction: 'await-reconciliation',
  resubmit: false,
  message: 'Kết quả cần được đối soát. Không gửi lại yêu cầu tạo tài khoản; vui lòng chờ hướng dẫn.',
})

/** Receives a trusted core result, defensively typed unknown to handle broken
 * adapters. Never spreads/serializes it or reads its messages, fields or secrets.
 * Even committed maps to neutral: no account/email claim or success oracle.
 * Unknown/malformed results retain a reconciliation state, never a safe retry.
 * This is not a hostile in-process Proxy sandbox or durable reconciliation store.
 */
export function registrationPublicOutcome(result: unknown): RegistrationPublicOutcome {
  try {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return reconciliation
    const prototype = Object.getPrototypeOf(result)
    if (prototype !== Object.prototype && prototype !== null) return reconciliation
    const descriptor = Object.getOwnPropertyDescriptor(result, 'kind')
    if (!descriptor || !('value' in descriptor)) return reconciliation
    switch (descriptor.value) {
      case 'committed':
      case 'invalid-input':
      case 'policy-unresolved':
      case 'field-error':
      case 'conflict':
      case 'unavailable':
        return neutral
      case 'outcome-unknown':
      default:
        return reconciliation
    }
  } catch {
    return reconciliation
  }
}
