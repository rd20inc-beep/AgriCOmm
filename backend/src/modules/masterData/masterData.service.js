const repo = require('./masterData.repository');
const { NotFoundError, ValidationError, ConflictError } = require('../../shared/errors');

const masterDataService = {
  // ===================== CUSTOMERS =====================
  async listCustomers(params) {
    return repo.listCustomers(params);
  },

  async getCustomerById(id) {
    const customer = await repo.getCustomerById(id);
    if (!customer) throw new NotFoundError('Customer not found.');
    const orderSummary = await repo.getCustomerOrderSummary(id);
    return { customer, orderSummary };
  },

  async createCustomer(data) {
    if (!data.name || !data.name.trim()) {
      throw new ValidationError('Customer name is required.');
    }
    const insertData = {
      name: data.name.trim(),
      country: data.country || null,
      contact_person: data.contact_person || null,
      email: data.email || null,
      phone: data.phone || null,
      address: data.address || null,
      payment_terms: data.payment_terms || 'Advance',
      currency: data.currency || 'USD',
      credit_limit: data.credit_limit ? parseFloat(data.credit_limit) : 0,
      bank_name: data.bank_name || null,
      bank_account: data.bank_account || null,
      bank_swift: data.bank_swift || null,
      bank_iban: data.bank_iban || null,
      is_active: true,
    };
    return repo.createCustomer(insertData);
  },

  async updateCustomer(id, data) {
    const updates = { ...data };
    delete updates.id;
    delete updates.created_at;
    const customer = await repo.updateCustomer(id, updates);
    if (!customer) throw new NotFoundError('Customer not found.');
    return customer;
  },

  async deleteCustomer(id) {
    const linkedCount = await repo.countCustomerOrders(id);
    if (linkedCount > 0) {
      await repo.archiveCustomer(id);
      return { archived: true, message: 'Customer archived (has linked orders).' };
    }
    await repo.deleteCustomer(id);
    return { archived: false, message: 'Customer deleted.' };
  },

  // ===================== SUPPLIERS =====================
  async listSuppliers(params) {
    return repo.listSuppliers(params);
  },

  async getSupplierById(id) {
    const supplier = await repo.getSupplierById(id);
    if (!supplier) throw new NotFoundError('Supplier not found.');
    return { supplier };
  },

  // ===================== PRODUCTS =====================
  async listProducts(params) {
    return repo.listProducts(params);
  },

  async getProductById(id) {
    const product = await repo.getProductById(id);
    if (!product) throw new NotFoundError('Product not found.');
    return { product };
  },

  // ===================== WAREHOUSES =====================
  async listWarehouses() {
    return repo.listWarehouses();
  },

  // ===================== BAG TYPES =====================
  async listBagTypes() {
    return repo.listBagTypes();
  },

  // ===================== BANK ACCOUNTS =====================
  async listBankAccounts() {
    return repo.listBankAccounts();
  },
};

module.exports = masterDataService;
