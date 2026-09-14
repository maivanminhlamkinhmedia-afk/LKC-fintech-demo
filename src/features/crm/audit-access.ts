// Audit history is not ordinary sales:read data. Keep this explicit policy shared
// by navigation and the independently authenticated server-only query boundary.
export const CRM_AUDIT_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const

export function canReadCRMAudit(role: string) {
  return CRM_AUDIT_ROLES.some((allowed) => allowed === role)
}
