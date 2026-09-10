'use client'

import { FormEvent, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)
    const form = new FormData(event.currentTarget)

    const result = await signIn('credentials', {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      redirect: false,
    })

    setLoading(false)
    if (result?.error) {
      setError('Email hoặc mật khẩu không đúng, hoặc tài khoản chưa được kích hoạt.')
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-[#071528] flex items-center justify-center px-5 py-20">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
        <Link href="/" className="text-sm font-semibold text-[#1B4FA0]">← Về trang chủ</Link>
        <h1 className="mt-5 text-3xl font-bold text-[#0A1628]">Đăng nhập LKC</h1>
        <p className="mt-2 text-sm text-slate-500">Truy cập tài khoản, biểu đồ, tài liệu và khu vực làm việc theo vai trò.</p>

        <form onSubmit={onSubmit} className="mt-7 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-[#1B4FA0]" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Mật khẩu</span>
            <input name="password" type="password" required autoComplete="current-password" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-[#1B4FA0]" />
          </label>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <button disabled={loading} className="w-full rounded-xl bg-gradient-to-r from-[#1B4FA0] to-[#2BAD97] px-4 py-3 font-semibold text-white disabled:opacity-60">
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </main>
  )
}
