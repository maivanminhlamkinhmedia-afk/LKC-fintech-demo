import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import type { AppRole } from '@/lib/roles'

export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60,
  },
  pages: {
    signIn: '/dang-nhap',
  },
  providers: [
    CredentialsProvider({
      name: 'Email & mật khẩu',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Mật khẩu', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase()
        const password = credentials?.password
        if (!email || !password) return null

        const user = await prisma.user.findUnique({ where: { email } })
        if (!user || user.status !== 'ACTIVE') return null

        const ok = await bcrypt.compare(password, user.password)
        if (!ok) return null

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        })

        await prisma.auditLog.create({
          data: {
            actorId: user.id,
            action: 'AUTH_LOGIN',
            entityType: 'User',
            entityId: user.id,
          },
        })

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as AppRole,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? ''
        session.user.role = (token.role ?? 'CLIENT') as AppRole
      }
      return session
    },
  },
}
