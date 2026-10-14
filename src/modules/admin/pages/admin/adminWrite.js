import { createContext, useContext } from 'react';

/**
 * Whether the signed-in user may change what the current Admin tab shows.
 * Admin.jsx provides it per tab from the permission the tab's write routes
 * check (e.g. admin.manage_master_data); tabs hide Add / Edit / Delete when it
 * is false. Defaults to true so a tab rendered outside Admin keeps working.
 */
export const AdminWriteContext = createContext(true);

export const useAdminCanWrite = () => useContext(AdminWriteContext);

// The permission each tab's write routes check (backend admin.routes.js and
// friends). Tabs not listed have their own gates (or mixed ones) and are left
// writable here.
export const TAB_WRITE_PERMISSION = {
  approvals: ['master_data', 'approve'],
  customers: ['admin', 'manage_master_data'],
  suppliers: ['admin', 'manage_master_data'],
  products: ['admin', 'manage_master_data'],
  categories: ['admin', 'manage_master_data'],
  bagTypes: ['admin', 'manage_master_data'],
  warehouses: ['admin', 'manage_master_data'],
  bankAccounts: ['admin', 'manage_master_data'],
  docTemplates: ['admin', 'manage_master_data'],
  whatsapp: ['admin', 'manage_settings'],
  users: ['admin', 'manage_users'],
  settings: ['admin', 'manage_settings'],
};

export function canWriteTab(tabKey, hasPermission) {
  const perm = TAB_WRITE_PERMISSION[tabKey];
  if (!perm) return true;
  return typeof hasPermission === 'function' && hasPermission(perm[0], perm[1]);
}
