'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ReferralCodeField } from './ReferralCodeField'
import {
  beginReferralCheck, changeReferralCode, completeReferralCheck, createReferralEntry,
  getRegistrationReferralIntent, type RegistrationReferralIntent,
} from '../registration-referral-intent'

type Field = 'name' | 'email' | 'password' | 'confirmPassword' | 'referralCode'
type FieldErrors = Partial<Record<Field, 'required' | 'invalid'>>

/** Presentation seam only, NOT an approved C04/server contract. Production does
 * not supply this adapter. A separate owner grant must implement server authority.
 * No client success/role/subscription result is supported in this UI foundation.
 */
export type RegistrationEntryAdapter = {
  submit: (data: FormData, referral: RegistrationReferralIntent) => Promise<unknown>
  verifyReferral?: (code: string) => Promise<unknown>
}

const fields = [
  { key: 'name', label: 'Họ và tên', type: 'text', autoComplete: 'name' },
  { key: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { key: 'password', label: 'Mật khẩu', type: 'password', autoComplete: 'new-password' },
  { key: 'confirmPassword', label: 'Nhập lại mật khẩu', type: 'password', autoComplete: 'new-password' },
] as const

// Display only allowlisted error codes; never render a remote message/identity.
function readFieldErrors(result: unknown): FieldErrors {
  const errors: FieldErrors = {}
  if (!result || typeof result !== 'object') return errors
  const status = Object.getOwnPropertyDescriptor(result, 'status')
  const data = Object.getOwnPropertyDescriptor(result, 'fields')
  if (status?.value !== 'field-errors' || !data || !('value' in data) || !data.value || typeof data.value !== 'object') return errors
  for (const field of [...fields.map(f => f.key), 'referralCode'] as Field[]) {
    const value = Object.getOwnPropertyDescriptor(data.value, field)?.value
    if (value === 'required' || value === 'invalid') errors[field] = value
  }
  return errors
}

export function ClientRegistrationEntry({ adapter }: { adapter?: RegistrationEntryAdapter } = {}) {
  const id = useId()
  const [referral, setReferral] = useState(() => createReferralEntry())
  const referralRef = useRef(referral)
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failed, setFailed] = useState(false)
  const available = typeof adapter?.submit === 'function'
  const locked = !available || pending
  const noticeId = `${id}-notice`
  const feedbackId = `${id}-feedback`

  function changeCode(code: string) {
    if (!available || submitting.current) return
    const next = changeReferralCode(referralRef.current, code)
    referralRef.current = next
    setReferral(next)
    setErrors(current => ({ ...current, referralCode: undefined }))
  }

  async function verifyCode() {
    if (!available || !adapter?.verifyReferral || submitting.current) return
    const next = beginReferralCheck(referralRef.current)
    if (!next.request || next === referralRef.current) return
    referralRef.current = next
    setReferral(next)
    const request = next.request
    let result: unknown = { outcome: 'unavailable' }
    try { result = await adapter.verifyReferral(request.code) } catch { /* Safe generic source error. */ }
    const completed = completeReferralCheck(referralRef.current, request, result)
    referralRef.current = completed
    setReferral(completed)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Before FormData or any input read. Native controls are also disabled in the
    // default route; no password/registration data is received, retained or sent.
    if (!available || !adapter || submitting.current) return
    submitting.current = true
    const form = event.currentTarget
    const data = new FormData(form)
    const intent = getRegistrationReferralIntent(referralRef.current)
    // Always preserve the exact entered code; do not trust a displayed outcome.
    if (intent.kind === 'requires-server-verification') data.set('referralCode', intent.code)
    setPending(true)
    setFailed(false)
    setErrors({})
    try {
      const result = await adapter.submit(data, intent)
      setErrors(readFieldErrors(result))
    } catch { /* Do not display raw errors or account details. */ }
    finally {
      // Passwords stay in native inputs only until a submission attempt finishes.
      for (const key of ['password', 'confirmPassword']) {
        data.delete(key)
        const input = form.elements.namedItem(key)
        if (input instanceof HTMLInputElement) input.value = ''
      }
      submitting.current = false
      setPending(false)
      // Even a forged success payload cannot claim an account was created here.
      setFailed(true)
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-5 pb-16 pt-28 sm:px-6 lg:pb-24 lg:pt-36">
      <div className="grid min-w-0 gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        <section aria-labelledby={`${id}-heading`} className="min-w-0 lg:pt-6">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#167A70]">LKC Fintech · Tài khoản</p>
          <h1 id={`${id}-heading`} className="mt-4 text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">Bắt đầu hành trình<br className="hidden sm:block" /> cùng LKC</h1>
          <p className="mt-5 max-w-md text-base leading-7 text-slate-600">Một tài khoản để tìm hiểu sản phẩm và theo dõi nội dung phù hợp với nhu cầu của bạn.</p>
          <ol className="mt-8 space-y-5 text-sm text-slate-600" aria-label="Các bước đăng ký khi dịch vụ mở">
            {['Tạo tài khoản với thông tin của bạn', 'Xác minh email theo hướng dẫn', 'Tìm hiểu và lựa chọn sản phẩm phù hợp'].map((text, index) => (
              <li key={text} className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E3F3F0] font-semibold text-[#12665E]">{index + 1}</span>{text}</li>
            ))}
          </ol>
          <p className="mt-7 max-w-md text-sm leading-6 text-slate-600">Mã giới thiệu không bắt buộc. Tạo tài khoản không tự kích hoạt sản phẩm hoặc gói dịch vụ.</p>
          <Link href="/san-pham" className="mt-6 inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-[#1B4FA0] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Khám phá sản phẩm LKC →</Link>
        </section>

        <section aria-labelledby={`${id}-form-title`} className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <h2 id={`${id}-form-title`} className="text-2xl font-bold">Tạo tài khoản</h2>
          <p className="mt-2 text-sm text-slate-600">Đã có tài khoản? <Link href="/dang-nhap" className="inline-flex min-h-11 items-center rounded font-semibold text-[#1B4FA0] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Đăng nhập</Link></p>
          {!available && <div id={noticeId} role="status" className="my-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><strong className="block">Đăng ký trực tuyến chưa sẵn sàng</strong>Các ô nhập đang tạm khóa. Trang này chưa tiếp nhận thông tin đăng ký hoặc mật khẩu. Bạn có thể liên hệ LKC để được hỗ trợ.</div>}
          <form onSubmit={submit} aria-label="Thông tin tạo tài khoản" aria-describedby={!available ? noticeId : undefined} aria-busy={pending} autoComplete={available ? 'on' : 'off'}>
            <fieldset disabled={locked} className="min-w-0 space-y-5">
              <legend className="sr-only">Thông tin đăng ký</legend>
              {fields.map(field => {
                const errorId = `${id}-${field.key}-error`
                const error = errors[field.key]
                return <div key={field.key}>
                  <label htmlFor={`${id}-${field.key}`} className="mb-2 block text-sm font-medium">{field.label}</label>
                  <input id={`${id}-${field.key}`} name={field.key} type={field.type} required disabled={locked}
                    autoComplete={available ? field.autoComplete : 'off'} readOnly={!available} {...(!available ? { value: '' } : {})}
                    aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : !available ? noticeId : undefined}
                    className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4FA0] disabled:cursor-not-allowed disabled:bg-slate-50" />
                  {error && <p id={errorId} className="mt-2 text-sm text-red-700">{error === 'required' ? 'Vui lòng nhập thông tin này.' : 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.'}</p>}
                </div>
              })}
              <div role="group" aria-label="Mã giới thiệu" aria-describedby={errors.referralCode ? `${id}-referral-error` : undefined}>
                <ReferralCodeField id={`${id}-referral`} state={referral} onChange={changeCode} onVerify={available && adapter?.verifyReferral ? verifyCode : undefined} disabled={locked} />
                {errors.referralCode && <p id={`${id}-referral-error`} role="alert" className="mt-2 text-sm text-red-700">Mã giới thiệu chưa được chấp nhận. Vui lòng sửa hoặc chủ động xóa mã.</p>}
              </div>
              <button type="submit" disabled={locked} className="min-h-12 w-full rounded-xl bg-gradient-to-r from-[#1B4FA0] to-[#167A70] px-4 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-60">{pending ? 'Đang gửi…' : available ? 'Tạo tài khoản' : 'Đăng ký chưa sẵn sàng'}</button>
            </fieldset>
            <p id={feedbackId} role="status" aria-live="polite" aria-atomic="true" className="mt-4 text-sm leading-6 text-slate-700">{pending ? 'Đang gửi yêu cầu. Vui lòng chờ.' : failed ? 'Chưa thể hoàn tất đăng ký. Vui lòng kiểm tra thông tin hoặc thử lại sau.' : ''}</p>
          </form>
          {!available && <Link href="/nha-dau-tu" className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-[#1B4FA0] px-4 py-3 text-center font-semibold text-[#1B4FA0] focus-visible:outline-2 focus-visible:outline-offset-4">Liên hệ LKC</Link>}
        </section>
      </div>
    </main>
  )
}
