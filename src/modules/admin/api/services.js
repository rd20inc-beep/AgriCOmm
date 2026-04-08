import api from '../../../api/client';
export const adminApi = {
  customers: (params) => api.get('/api/admin/customers', params),
  createCustomer: (data) => api.post('/api/admin/customers', data),
  updateCustomer: (id, data) => api.put(`/api/admin/customers/${id}`, data),
  suppliers: (params) => api.get('/api/admin/suppliers', params),
  createSupplier: (data) => api.post('/api/admin/suppliers', data),
  updateSupplier: (id, data) => api.put(`/api/admin/suppliers/${id}`, data),
  products: (params) => api.get('/api/admin/products', params),
  createProduct: (data) => api.post('/api/admin/products', data),
  updateProduct: (id, data) => api.put(`/api/admin/products/${id}`, data),
  warehouses: (params) => api.get('/api/admin/warehouses', params),
  createWarehouse: (data) => api.post('/api/admin/warehouses', data),
  updateWarehouse: (id, data) => api.put(`/api/admin/warehouses/${id}`, data),
  bankAccounts: (params) => api.get('/api/admin/bank-accounts', params),
  createBankAccount: (data) => api.post('/api/admin/bank-accounts', data),
  bagTypes: (params) => api.get('/api/admin/bag-types', params),
  createBagType: (data) => api.post('/api/admin/bag-types', data),
  settings: () => api.get('/api/admin/settings'),
  updateSettings: (data) => api.put('/api/admin/settings', data),
  auditLogs: (params) => api.get('/api/admin/audit-logs', params),
};
export const customersApi = {
  list: (params) => api.get('/api/customers', params),
  create: (data) => api.post('/api/customers', data),
  update: (id, data) => api.put(`/api/customers/${id}`, data),
  delete: (id) => api.delete(`/api/customers/${id}`),
};
export const usersApi = {
  list: (params) => api.get('/api/users', params),
  get: (id) => api.get(`/api/users/${id}`),
  create: (data) => api.post('/api/users', data),
  update: (id, data) => api.put(`/api/users/${id}`, data),
  changeRole: (id, data) => api.put(`/api/users/${id}/role`, data),
  deactivate: (id) => api.put(`/api/users/${id}/deactivate`),
  activate: (id) => api.put(`/api/users/${id}/activate`),
};
export const auditApi = {
  list: (params) => api.get('/api/audit-logs', params),
  byEntity: (type, id) => api.get(`/api/audit-logs/entity/${type}/${id}`),
  byUser: (userId, params) => api.get(`/api/audit-logs/user/${userId}`, params),
};
export const authApi = {
  login: (data) => api.post('/api/auth/login', data),
  me: () => api.get('/api/auth/me'),
  changePassword: (data) => api.post('/api/auth/change-password', data),
  forgotPassword: (data) => api.post('/api/auth/forgot-password', data),
  resetPassword: (data) => api.post('/api/auth/reset-password', data),
};
