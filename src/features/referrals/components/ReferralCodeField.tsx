'use client'

import type { ReferralEntryState } from '../registration-referral-intent'

export type ReferralCodeFieldProps = {
  /** Unique within the receiving form. Controlled by the client form owner. */
  id: string
  state: ReferralEntryState
  onChange: (rawCode: string) => void
  /** Optional adapter owned by the future registration integration. No I/O here. */
  onVerify?: (rawCode: string) => void
  disabled?: boolean
}

const messages: Record<ReferralEntryState['status'], string> = {
  omitted: 'Bạn có thể để trống mã giới thiệu.',
  'invalid-input': 'Dữ liệu mã giới thiệu không hợp lệ. Vui lòng nhập lại.',
  unverified: 'Mã đã nhập chưa được xác minh.',
  pending: 'Đang kiểm tra mã giới thiệu…',
  invalid: 'Nguồn kiểm tra báo mã không hợp lệ. Hãy kiểm tra lại hoặc chủ động xóa mã.',
  'source-error': 'Không thể xác minh mã lúc này. Mã đã nhập được giữ nguyên; bạn có thể thử lại.',
  'reported-valid': 'Nguồn kiểm tra báo mã hợp lệ. Máy chủ vẫn phải xác minh khi đăng ký.',
}

/** Controlled field, not a registration form or a verifier. The parent must use
 * changeReferralCode on every edit, beginReferralCheck on verification, and
 * completeReferralCheck with the captured request when the adapter settles.
 * No storage, referral identity, assignedSalesId or subscription state is used.
 */
export function ReferralCodeField({ id, state, onChange, onVerify, disabled = false }: ReferralCodeFieldProps) {
  const code = state.input.kind === 'provided' ? state.input.code : ''
  const pending = state.status === 'pending'
  const error = state.status === 'invalid' || state.status === 'invalid-input' || state.status === 'source-error'
  const statusId = `${id}-status`
  const helpId = `${id}-help`
  const adapterId = `${id}-adapter`
  const canVerify = !disabled && !pending && state.input.kind === 'provided' && Boolean(onVerify)

  return (
    <div className="w-full min-w-0 space-y-2" aria-busy={pending}>
      <label htmlFor={id} className="block text-sm font-medium">Mã giới thiệu (không bắt buộc)</label>
      <p id={helpId} className="text-sm text-muted-foreground">
        Kết quả kiểm tra tại đây không tạo tài khoản, lưu người giới thiệu hoặc cấp gói dịch vụ.
      </p>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
        <input
          id={id}
          name="referralCode"
          type="text"
          value={code}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error || undefined}
          aria-describedby={`${helpId} ${statusId}${!onVerify ? ` ${adapterId}` : ''}`}
          className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2"
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <button
          type="button"
          disabled={!canVerify}
          className="min-h-11 shrink-0 rounded-md border px-4 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
          onClick={() => { if (canVerify) onVerify?.(code) }}
        >
          {pending ? 'Đang kiểm tra…' : state.status === 'source-error' ? 'Thử lại' : 'Kiểm tra mã'}
        </button>
      </div>
      <p id={statusId} role="status" aria-live="polite" aria-atomic="true" className="break-words text-sm">
        {messages[state.status]}
      </p>
      {!onVerify && <p id={adapterId} className="text-sm">Chưa kết nối nguồn xác minh. Mã nhập vẫn được giữ lại.</p>}
    </div>
  )
}
