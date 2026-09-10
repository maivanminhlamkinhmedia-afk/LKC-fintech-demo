import type { DefaultSession } from 'next-auth'
import type { AppRole } from '@/lib/roles'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: AppRole
    } & DefaultSession['user']
  }

  interface User {
    role: AppRole
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    role?: AppRole
  }
}
