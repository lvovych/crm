export enum PermissionAction {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  MANAGE = 'manage',
}

export enum PermissionSubject {
  DASHBOARD = 'dashboard',
  VEHICLES = 'vehicles',
  CUSTOMERS = 'customers',
  WORK_ORDERS = 'work_orders',
  QUOTES = 'quotes',
  SERVICES = 'services',
  BILLING = 'billing',
  INVENTORY = 'inventory',
  BRANDS = 'brands',
  FINANCE = 'finance',
  FINANCE_BACKDATE = 'finance_backdate',
  FINANCE_TRANSFER = 'finance_transfer',
  SETTLEMENTS = 'supplier_settlements',
  RECEIPTS = 'receipts',
  SUPPLIERS = 'suppliers',
  LABOR_PRESETS = 'labor_presets',
  INSPECTIONS = 'inspections',
  TIRE_HOTEL = 'tire_hotel',
  REPORTS = 'reports',
  SETTINGS = 'settings',
  WORK_BOARD = 'work_board',
  AI_ASSISTANT = 'ai_assistant',
  TIME_TRACKING = 'time_tracking',
}

export type PermissionInput = {
  action: PermissionAction
  subject: PermissionSubject
}

export type PermissionGroup = {
  name: string
  subject: PermissionSubject
  permissions: {
    action: PermissionAction
    label: string
  }[]
}

export const permissionGroups: PermissionGroup[] = [
  {
    name: 'Cash accounts',
    subject: PermissionSubject.FINANCE,
    permissions: [
      { action: PermissionAction.READ, label: 'View balances' },
      { action: PermissionAction.CREATE, label: 'Prepare documents' },
      { action: PermissionAction.UPDATE, label: 'Post payments' },
      { action: PermissionAction.DELETE, label: 'Reverse and refund' },
      { action: PermissionAction.MANAGE, label: 'Manage accounts and activation' },
    ],
  },
  {
    name: 'Backdated money operations',
    subject: PermissionSubject.FINANCE_BACKDATE,
    permissions: [{ action: PermissionAction.CREATE, label: 'Post in prior days' }],
  },
  {
    name: 'Account transfers',
    subject: PermissionSubject.FINANCE_TRANSFER,
    permissions: [{ action: PermissionAction.CREATE, label: 'Transfer money' }],
  },
  {
    name: 'Brands (shared directory)',
    subject: PermissionSubject.BRANDS,
    permissions: [
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.CREATE, label: 'Create' },
      { action: PermissionAction.UPDATE, label: 'Edit and restore' },
      { action: PermissionAction.DELETE, label: 'Deactivate' },
    ],
  },
  {
    name: 'Supplier settlements',
    subject: PermissionSubject.SETTLEMENTS,
    permissions: [
      { action: PermissionAction.READ, label: 'View balances' },
      { action: PermissionAction.CREATE, label: 'Register payments and allocations' },
      { action: PermissionAction.MANAGE, label: 'Reconcile opening balances' },
      { action: PermissionAction.DELETE, label: 'Reverse transactions' },
    ],
  },
  {
    name: 'Supplier receipts',
    subject: PermissionSubject.RECEIPTS,
    permissions: [
      { action: PermissionAction.READ, label: 'View receipts' },
      { action: PermissionAction.CREATE, label: 'Prepare drafts' },
      { action: PermissionAction.UPDATE, label: 'Post receipts' },
      { action: PermissionAction.DELETE, label: 'Reverse receipts' },
    ],
  },
  {
    name: 'Suppliers',
    subject: PermissionSubject.SUPPLIERS,
    permissions: [
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.CREATE, label: 'Create' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
      { action: PermissionAction.DELETE, label: 'Archive' },
      { action: PermissionAction.MANAGE, label: 'Review imports' },
    ],
  },
  {
    name: 'Dashboard',
    subject: PermissionSubject.DASHBOARD,
    permissions: [{ action: PermissionAction.READ, label: 'View' }],
  },
  {
    name: 'Vehicles',
    subject: PermissionSubject.VEHICLES,
    permissions: [
      { action: PermissionAction.CREATE, label: 'Create' },
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
      { action: PermissionAction.DELETE, label: 'Delete' },
    ],
  },
  {
    name: 'Customers',
    subject: PermissionSubject.CUSTOMERS,
    permissions: [
      { action: PermissionAction.CREATE, label: 'Create' },
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
      { action: PermissionAction.DELETE, label: 'Delete' },
    ],
  },
  {
    name: 'Work Orders',
    subject: PermissionSubject.WORK_ORDERS,
    permissions: [
      { action: PermissionAction.CREATE, label: 'Create' },
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
      { action: PermissionAction.DELETE, label: 'Delete' },
    ],
  },
  {
    name: 'Quotes',
    subject: PermissionSubject.QUOTES,
    permissions: [
      { action: PermissionAction.CREATE, label: 'Create' },
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
      { action: PermissionAction.DELETE, label: 'Delete' },
    ],
  },
  {
    name: 'Services',
    subject: PermissionSubject.SERVICES,
    permissions: [
      { action: PermissionAction.CREATE, label: 'Create' },
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
      { action: PermissionAction.DELETE, label: 'Delete' },
    ],
  },
  {
    name: 'Billing',
    subject: PermissionSubject.BILLING,
    permissions: [
      { action: PermissionAction.CREATE, label: 'Create' },
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
      { action: PermissionAction.DELETE, label: 'Delete' },
    ],
  },
  {
    name: 'Inventory',
    subject: PermissionSubject.INVENTORY,
    permissions: [
      { action: PermissionAction.CREATE, label: 'Create' },
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
      { action: PermissionAction.DELETE, label: 'Delete' },
    ],
  },
  {
    name: 'Labor Presets',
    subject: PermissionSubject.LABOR_PRESETS,
    permissions: [
      { action: PermissionAction.CREATE, label: 'Create' },
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
      { action: PermissionAction.DELETE, label: 'Delete' },
    ],
  },
  {
    name: 'Inspections',
    subject: PermissionSubject.INSPECTIONS,
    permissions: [
      { action: PermissionAction.CREATE, label: 'Create' },
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
      { action: PermissionAction.DELETE, label: 'Delete' },
    ],
  },
  {
    name: 'Tire Hotel',
    subject: PermissionSubject.TIRE_HOTEL,
    permissions: [
      { action: PermissionAction.CREATE, label: 'Create' },
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
      { action: PermissionAction.DELETE, label: 'Delete' },
      { action: PermissionAction.MANAGE, label: 'Manage storage layout' },
    ],
  },
  {
    name: 'Reports',
    subject: PermissionSubject.REPORTS,
    permissions: [{ action: PermissionAction.READ, label: 'View' }],
  },
  {
    // View is the timesheet page; Edit is correcting what a clock recorded.
    // Clocking oneself in and out is not here: that follows UPDATE:SERVICES,
    // the same permission the technician app asks for.
    name: 'Time tracking',
    subject: PermissionSubject.TIME_TRACKING,
    permissions: [
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
    ],
  },
  {
    name: 'Work Board',
    subject: PermissionSubject.WORK_BOARD,
    permissions: [
      { action: PermissionAction.CREATE, label: 'Create' },
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
      { action: PermissionAction.DELETE, label: 'Delete' },
    ],
  },
  {
    name: 'AI Assistant',
    subject: PermissionSubject.AI_ASSISTANT,
    permissions: [{ action: PermissionAction.READ, label: 'View' }],
  },
  {
    name: 'Settings',
    subject: PermissionSubject.SETTINGS,
    permissions: [
      { action: PermissionAction.READ, label: 'View' },
      { action: PermissionAction.UPDATE, label: 'Edit' },
    ],
  },
]

export function hasPermission(
  userPermissions: { action: string; subject: string }[],
  required: PermissionInput
): boolean {
  return userPermissions.some((p) => p.action === required.action && p.subject === required.subject)
}

export function hasAllPermissions(
  userPermissions: { action: string; subject: string }[],
  required: PermissionInput[]
): boolean {
  return required.every((req) => hasPermission(userPermissions, req))
}
