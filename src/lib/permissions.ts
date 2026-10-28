export enum PermissionAction {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  MANAGE = 'manage',
  POST = 'post',
  RESERVE = 'reserve',
  ISSUE = 'issue',
  ADJUST = 'adjust',
  ALLOCATE = 'allocate',
  REVERSE = 'reverse',
}

export enum PermissionSubject {
  STOCK_LEDGER = 'stock_ledger',
  STOCK_COST = 'stock_cost',
  SUPPLIER_FINANCE = 'supplier_finance',
  DASHBOARD = 'dashboard',
  VEHICLES = 'vehicles',
  CUSTOMERS = 'customers',
  WORK_ORDERS = 'work_orders',
  QUOTES = 'quotes',
  SERVICES = 'services',
  BILLING = 'billing',
  INVENTORY = 'inventory',
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
    name: 'Stock ledger',
    subject: PermissionSubject.STOCK_LEDGER,
    permissions: [
      { action: PermissionAction.READ, label: 'View stock documents' },
      { action: PermissionAction.CREATE, label: 'Save drafts' },
      { action: PermissionAction.POST, label: 'Проводити надходження' },
      { action: PermissionAction.RESERVE, label: 'Резервувати та знімати резерв' },
      { action: PermissionAction.ISSUE, label: 'Видавати, повертати й переміщувати' },
      { action: PermissionAction.ADJUST, label: 'Проводити інвентаризацію' },
      { action: PermissionAction.REVERSE, label: 'Сторнувати складські документи' },
    ],
  },
  {
    name: 'Purchase costs',
    subject: PermissionSubject.STOCK_COST,
    permissions: [{ action: PermissionAction.READ, label: 'View purchase costs' }],
  },
  {
    name: 'Supplier settlements',
    subject: PermissionSubject.SUPPLIER_FINANCE,
    permissions: [
      { action: PermissionAction.READ, label: 'View balances' },
      { action: PermissionAction.CREATE, label: 'Чернетки оплат' },
      { action: PermissionAction.POST, label: 'Проводити оплати й послуги' },
      { action: PermissionAction.ALLOCATE, label: 'Розносити оплати' },
      { action: PermissionAction.REVERSE, label: 'Сторнувати оплати' },
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
