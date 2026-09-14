import { requirePermission } from '@/lib/authz'
import { customerExportResponse } from '@/features/crm/customer-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await requirePermission('sales:read')
  return customerExportResponse(session.user.id, new URL(request.url).searchParams)
}

// Do not let automatic HEAD dispatch generate an audited CSV download.
export function HEAD() {
  return new Response(null, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } })
}
