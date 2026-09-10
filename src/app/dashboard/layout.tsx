import { PortalShell } from '@/components/portal/PortalShell'
import { requireUser } from '@/lib/authz'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser()
  return <PortalShell user={session.user}>{children}</PortalShell>
}
