export const APP_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'SALES_MANAGER',
  'SALES',
  'CREATOR',
  'ANALYST',
  'EMPLOYEE',
  'CLIENT',
] as const

export type AppRole = (typeof APP_ROLES)[number]

export type Permission =
  | 'admin:access'
  | 'users:read'
  | 'users:write'
  | 'sales:read'
  | 'sales:write'
  | 'content:read'
  | 'content:write'
  | 'analysis:read'
  | 'analysis:write'
  | 'chart:use'
  | 'learning:use'
  | 'account:self'
  | 'cms:access'
  | 'cms:article:create'
  | 'cms:article:read:own'
  | 'cms:article:read:any'
  | 'cms:article:update:own'
  | 'cms:article:update:any'
  | 'cms:article:submit'
  | 'cms:article:review'
  | 'cms:article:approve'
  | 'cms:article:publish'
  | 'cms:admin'

const ALL_PERMISSIONS: Permission[] = [
  'admin:access', 'users:read', 'users:write', 'sales:read', 'sales:write',
  'content:read', 'content:write', 'analysis:read', 'analysis:write',
  'chart:use', 'learning:use', 'account:self',
  'cms:access', 'cms:article:create', 'cms:article:read:own', 'cms:article:read:any',
  'cms:article:update:own', 'cms:article:update:any', 'cms:article:submit',
  'cms:article:review', 'cms:article:approve', 'cms:article:publish', 'cms:admin',
]

export const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  ADMIN: ALL_PERMISSIONS,
  MANAGER: ['users:read', 'sales:read', 'content:read', 'analysis:read', 'chart:use', 'learning:use'],
  SALES_MANAGER: ['sales:read', 'sales:write', 'users:read', 'chart:use', 'learning:use'],
  SALES: ['sales:read', 'sales:write', 'chart:use', 'learning:use'],
  CREATOR: [
    'content:read', 'content:write', 'analysis:read', 'chart:use', 'learning:use',
    'cms:access', 'cms:article:create', 'cms:article:read:own',
    'cms:article:update:own', 'cms:article:submit',
  ],
  ANALYST: ['analysis:read', 'analysis:write', 'content:read', 'chart:use', 'learning:use'],
  EMPLOYEE: ['content:read', 'chart:use', 'learning:use'],
  CLIENT: ['chart:use', 'learning:use', 'account:self'],
}

export const ROLE_LABELS: Record<AppRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER: 'Quản lý',
  SALES_MANAGER: 'Quản lý Sales',
  SALES: 'Sales',
  CREATOR: 'Người tạo nội dung',
  ANALYST: 'Chuyên viên phân tích',
  EMPLOYEE: 'Nhân viên',
  CLIENT: 'Khách hàng',
}

export function hasPermission(role: AppRole, permission: Permission) {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}
