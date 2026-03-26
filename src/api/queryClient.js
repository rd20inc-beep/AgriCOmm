import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,        // 30 seconds before data is considered stale
      gcTime: 5 * 60 * 1000,       // 5 minutes garbage collection
      retry: 1,                     // retry once on failure
      refetchOnWindowFocus: false,   // don't refetch when user tabs back
    },
    mutations: {
      retry: 0,
    },
  },
});

// Query key factories for consistent cache management
export const queryKeys = {
  // Export Orders
  orders: {
    all: ['export-orders'],
    list: (params) => ['export-orders', 'list', params],
    detail: (id) => ['export-orders', 'detail', id],
  },
  // Milling
  batches: {
    all: ['milling-batches'],
    list: (params) => ['milling-batches', 'list', params],
    detail: (id) => ['milling-batches', 'detail', id],
  },
  // Master Data
  customers: { all: ['customers'], list: (params) => ['customers', 'list', params] },
  suppliers: { all: ['suppliers'], list: (params) => ['suppliers', 'list', params] },
  products: { all: ['products'], list: (params) => ['products', 'list', params] },
  bankAccounts: { all: ['bank-accounts'] },
  warehouses: { all: ['warehouses'] },
  // Inventory
  inventory: {
    all: ['inventory'],
    list: (params) => ['inventory', 'list', params],
    summary: ['inventory', 'summary'],
  },
  // Finance
  receivables: { all: ['receivables'], list: (params) => ['receivables', 'list', params] },
  payables: { all: ['payables'], list: (params) => ['payables', 'list', params] },
  journals: { all: ['journals'], list: (params) => ['journals', 'list', params] },
  financeOverview: ['finance-overview'],
  // Documents
  documents: { all: ['documents'], list: (params) => ['documents', 'list', params] },
  // Dashboard
  dashboard: ['dashboard'],
  // Intelligence
  exceptions: { all: ['exceptions'] },
  riskDashboard: ['risk-dashboard'],
  // Settings
  settings: ['settings'],
  // Notifications
  notifications: ['notifications'],
  notificationCount: ['notification-count'],
};
