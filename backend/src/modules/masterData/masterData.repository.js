const db = require('../../config/database');

const masterDataRepository = {
  // ===================== CUSTOMERS =====================
  async listCustomers({ page = 1, limit = 50, offset = 0, search, country, active } = {}) {
    let query = db('customers').where('archived', false);
    if (active === 'true') query = query.where('is_active', true);
    if (search) {
      query = query.where(function () {
        this.whereILike('name', `%${search}%`)
          .orWhereILike('email', `%${search}%`)
          .orWhereILike('contact_person', `%${search}%`);
      });
    }
    if (country) query = query.where('country', country);

    const countQuery = query.clone().clearSelect().clearOrder().count('id as total').first();
    const [items, countResult] = await Promise.all([
      query.orderBy('name', 'asc').limit(limit).offset(offset),
      countQuery,
    ]);
    return { items, total: parseInt(countResult.total) };
  },

  async getCustomerById(id) {
    return db('customers').where({ id }).first();
  },

  async getCustomerOrderSummary(customerId) {
    return db('export_orders')
      .where({ customer_id: customerId })
      .select(
        db.raw('COUNT(*) as total_orders'),
        db.raw('COALESCE(SUM(contract_value), 0) as total_value'),
        db.raw('COALESCE(SUM(advance_received + balance_received), 0) as total_received')
      )
      .first();
  },

  async createCustomer(data) {
    const [customer] = await db('customers').insert(data).returning('*');
    return customer;
  },

  async updateCustomer(id, data) {
    data.updated_at = db.fn.now();
    const [customer] = await db('customers').where({ id }).update(data).returning('*');
    return customer;
  },

  async countCustomerOrders(customerId) {
    const result = await db('export_orders').where({ customer_id: customerId }).count('id as count').first();
    return parseInt(result.count);
  },

  async archiveCustomer(id) {
    await db('customers').where({ id }).update({ archived: true, is_active: false, updated_at: db.fn.now() });
  },

  async deleteCustomer(id) {
    await db('customers').where({ id }).del();
  },

  // ===================== SUPPLIERS =====================
  async listSuppliers({ page = 1, limit = 50, offset = 0, search } = {}) {
    let query = db('suppliers');
    if (search) {
      query = query.where(function () {
        this.whereILike('name', `%${search}%`);
      });
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('id as total').first();
    const [items, countResult] = await Promise.all([
      query.orderBy('name', 'asc').limit(limit).offset(offset),
      countQuery,
    ]);
    return { items, total: parseInt(countResult.total) };
  },

  async getSupplierById(id) {
    return db('suppliers').where({ id }).first();
  },

  async createSupplier(data) {
    const [supplier] = await db('suppliers').insert(data).returning('*');
    return supplier;
  },

  async updateSupplier(id, data) {
    data.updated_at = db.fn.now();
    const [supplier] = await db('suppliers').where({ id }).update(data).returning('*');
    return supplier;
  },

  // ===================== PRODUCTS =====================
  async listProducts({ page = 1, limit = 50, offset = 0, search } = {}) {
    let query = db('products');
    if (search) {
      query = query.where(function () {
        this.whereILike('name', `%${search}%`);
      });
    }

    const countQuery = query.clone().clearSelect().clearOrder().count('id as total').first();
    const [items, countResult] = await Promise.all([
      query.orderBy('name', 'asc').limit(limit).offset(offset),
      countQuery,
    ]);
    return { items, total: parseInt(countResult.total) };
  },

  async getProductById(id) {
    return db('products').where({ id }).first();
  },

  // ===================== WAREHOUSES =====================
  async listWarehouses() {
    return db('warehouses').orderBy('name', 'asc');
  },

  async getWarehouseById(id) {
    return db('warehouses').where({ id }).first();
  },

  // ===================== BAG TYPES =====================
  async listBagTypes() {
    return db('bag_types').orderBy('name', 'asc');
  },

  // ===================== BANK ACCOUNTS =====================
  async listBankAccounts() {
    return db('bank_accounts').orderBy('account_name', 'asc');
  },

  async getBankAccountById(id) {
    return db('bank_accounts').where({ id }).first();
  },
};

module.exports = masterDataRepository;
