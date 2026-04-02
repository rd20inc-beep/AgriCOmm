const mockState = {
  tables: {},
  seq: {},
};

function resetState() {
  mockState.tables = {
    export_orders: [],
    milling_batches: [],
    export_order_costs: [],
    export_order_status_history: [],
    receivables: [],
    payments: [],
    export_order_documents: [],
    document_checklists: [],
    order_packing_lines: [],
    shipment_containers: [],
    inventory_lots: [],
  };
  mockState.seq = {
    export_orders: 1,
    milling_batches: 1,
    export_order_costs: 1,
    export_order_status_history: 1,
    receivables: 1,
    payments: 1,
    export_order_documents: 1,
    document_checklists: 1,
    order_packing_lines: 1,
    shipment_containers: 1,
    inventory_lots: 1,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return '2026-04-01T00:00:00.000Z';
}

function valuesEqual(left, right) {
  if (left === right) return true;
  if (typeof left === 'number' && typeof right === 'string' && right.trim() !== '' && !Number.isNaN(Number(right))) {
    return left === Number(right);
  }
  if (typeof right === 'number' && typeof left === 'string' && left.trim() !== '' && !Number.isNaN(Number(left))) {
    return Number(left) === right;
  }
  return false;
}

function applySelect(row, fields) {
  if (!fields || fields.length === 0 || fields[0] === '*') {
    return clone(row);
  }

  const picked = {};
  fields.forEach((field) => {
    const aliasMatch = field.match(/^(.+)\s+as\s+(.+)$/i);
    if (aliasMatch) {
      picked[aliasMatch[2].trim()] = row[aliasMatch[1].trim()];
    } else {
      picked[field] = row[field];
    }
  });
  return picked;
}

function matches(row, conditions) {
  return conditions.every((condition) => {
    if (condition.type === 'object') {
      return Object.entries(condition.value).every(([key, value]) => valuesEqual(row[key], value));
    }
    if (condition.type === 'compare') {
      const left = row[condition.field];
      const right = condition.value;
      switch (condition.operator) {
        case '=':
          return valuesEqual(left, right);
        case '>=':
          return parseFloat(left) >= parseFloat(right);
        case '<=':
          return parseFloat(left) <= parseFloat(right);
        case '>':
          return parseFloat(left) > parseFloat(right);
        case '<':
          return parseFloat(left) < parseFloat(right);
        case 'like': {
          const pattern = String(right).replace(/%/g, '');
          return String(left || '').includes(pattern);
        }
        default:
          throw new Error(`Unsupported operator ${condition.operator}`);
      }
    }
    if (condition.type === 'whereIn') {
      return condition.values.includes(row[condition.field]);
    }
    return true;
  });
}

class MutationQuery {
  constructor(rows) {
    this.rows = rows;
  }

  returning(fields) {
    if (!fields || fields === '*' || (Array.isArray(fields) && fields.includes('*'))) {
      return Promise.resolve(clone(this.rows));
    }
    const selected = this.rows.map((row) => applySelect(row, Array.isArray(fields) ? fields : [fields]));
    return Promise.resolve(selected);
  }

  then(resolve, reject) {
    return Promise.resolve(clone(this.rows)).then(resolve, reject);
  }
}

class Query {
  constructor(tableName) {
    this.tableName = tableName;
    this.conditions = [];
    this.selectedFields = null;
    this.firstOnly = false;
    this.sortField = null;
    this.sortDirection = 'asc';
  }

  _rows() {
    let rows = mockState.tables[this.tableName] || [];
    rows = rows.filter((row) => matches(row, this.conditions));
    if (this.sortField) {
      rows = [...rows].sort((a, b) => {
        if (a[this.sortField] === b[this.sortField]) return 0;
        if (this.sortDirection === 'desc') {
          return a[this.sortField] > b[this.sortField] ? -1 : 1;
        }
        return a[this.sortField] > b[this.sortField] ? 1 : -1;
      });
    }
    return rows;
  }

  where(arg1, arg2, arg3) {
    if (typeof arg1 === 'object') {
      this.conditions.push({ type: 'object', value: arg1 });
    } else if (arg3 === undefined) {
      this.conditions.push({ type: 'compare', field: arg1, operator: '=', value: arg2 });
    } else {
      this.conditions.push({ type: 'compare', field: arg1, operator: arg2, value: arg3 });
    }
    return this;
  }

  whereIn(field, values) {
    this.conditions.push({ type: 'whereIn', field, values });
    return this;
  }

  select(...fields) {
    this.selectedFields = fields;
    return this;
  }

  orderBy(field, direction = 'asc') {
    this.sortField = field;
    this.sortDirection = direction;
    return this;
  }

  first() {
    this.firstOnly = true;
    return this;
  }

  insert(payload) {
    const rows = Array.isArray(payload) ? payload : [payload];
    const inserted = rows.map((row) => {
      const tableSeq = mockState.seq[this.tableName] || 1;
      mockState.seq[this.tableName] = tableSeq + 1;
      const record = {
        id: row.id || tableSeq,
        ...clone(row),
      };
      mockState.tables[this.tableName].push(record);
      return record;
    });
    return new MutationQuery(inserted);
  }

  update(payload) {
    const rows = this._rows();
    rows.forEach((row) => {
      Object.assign(row, clone(payload));
    });
    return new MutationQuery(rows);
  }

  delete() {
    const rows = this._rows();
    const table = mockState.tables[this.tableName] || [];
    mockState.tables[this.tableName] = table.filter((row) => !rows.includes(row));
    return Promise.resolve(rows.length);
  }

  del() {
    return this.delete();
  }

  increment(field, amount) {
    const rows = this._rows();
    rows.forEach((row) => {
      row[field] = (parseFloat(row[field]) || 0) + parseFloat(amount);
    });
    return Promise.resolve(rows.length);
  }

  count(fieldExpr) {
    const aliasMatch = fieldExpr.match(/\s+as\s+(.+)$/i);
    const alias = aliasMatch ? aliasMatch[1].trim() : 'count';
    const value = {};
    value[alias] = String(this._rows().length);
    return {
      first: () => Promise.resolve(value),
    };
  }

  then(resolve, reject) {
    let result = this._rows();
    if (this.selectedFields) {
      result = result.map((row) => applySelect(row, this.selectedFields));
    } else {
      result = result.map((row) => clone(row));
    }
    if (this.firstOnly) {
      result = result[0] || undefined;
    }
    return Promise.resolve(result).then(resolve, reject);
  }
}

function mockDb(tableName) {
  return new Query(tableName);
}

mockDb.transaction = async (callback) => callback(mockDb);
mockDb.fn = {
  now,
};

jest.mock('../config/database', () => mockDb);

jest.mock('../services/inventoryService', () => ({
  reserveStock: jest.fn().mockResolvedValue(null),
  dispatchForShipment: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/accountingService', () => ({
  autoPost: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/automationService', () => ({
  onAdvanceConfirmed: jest.fn().mockResolvedValue(null),
  onBalanceConfirmed: jest.fn().mockResolvedValue(null),
  onShipmentDeparted: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/documentService', () => ({
  createChecklist: jest.fn(async (trx, { linkedType, linkedId, items }) => {
    const rows = items.map((item) => ({
      linked_type: linkedType,
      linked_id: linkedId,
      doc_type: item.doc_type,
      is_required: item.is_required !== false,
      is_fulfilled: false,
      due_date: item.due_date || null,
      notes: item.notes || null,
    }));
    return trx('document_checklists').insert(rows).returning('*');
  }),
  isDocumentationComplete: jest.fn(async (linkedType, linkedId) => {
    return mockState.tables.document_checklists
      .filter((row) => row.linked_type === linkedType && row.linked_id === linkedId && row.is_required)
      .every((row) => row.is_fulfilled);
  }),
  checkMissingDocsWithConn: jest.fn(async (conn, linkedType, linkedId) => {
    return mockState.tables.document_checklists
      .filter((row) => row.linked_type === linkedType && row.linked_id === linkedId && row.is_required && !row.is_fulfilled);
  }),
}));

jest.mock('../services/emailService', () => ({
  sendBalanceReminder: jest.fn().mockResolvedValue(null),
}));

const controller = require('../controllers/exportOrderController');
const workflowService = require('../services/exportOrderWorkflowService');
const millingController = require('../controllers/millingController');

function makeReq(overrides = {}) {
  return {
    params: {},
    body: {},
    user: { id: 1, role_id: 1 },
    ...overrides,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function createAwaitingAdvanceOrder() {
  const req = makeReq({
    body: {
      customer_id: 10,
      product_id: 20,
      product_name: 'Super Kernel Rice',
      qty_mt: 100,
      price_per_mt: 500,
      currency: 'USD',
      incoterm: 'FOB',
      country: 'Kenya',
      advance_pct: 20,
      shipment_eta: '2026-04-20',
      source: 'Internal Mill',
      status: 'Awaiting Advance',
    },
  });
  const res = makeRes();
  await controller.create(req, res);
  return { req, res, order: res.body.data.order };
}

beforeEach(() => {
  resetState();
});

describe('Export order workflow', () => {
  it('creates a new order with receivables, checklist, and awaiting advance status', async () => {
    const { res, order } = await createAwaitingAdvanceOrder();

    expect(res.statusCode).toBe(201);
    expect(order.order_no).toBe('EX-001');
    expect(order.status).toBe('Awaiting Advance');
    expect(order.current_step).toBe(2);
    expect(mockState.tables.receivables).toHaveLength(2);
    expect(mockState.tables.document_checklists).toHaveLength(7);
    expect(mockState.tables.export_order_status_history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          order_id: order.id,
          to_status: 'Awaiting Advance',
        }),
      ])
    );
  });

  it('progresses an order from advance receipt to ready to ship, shipped, arrived, and closed', async () => {
    const { order } = await createAwaitingAdvanceOrder();

    let req = makeReq({
      params: { id: String(order.id) },
      body: {
        amount: 10000,
        payment_date: '2026-04-02',
        payment_method: 'tt',
        bank_reference: 'ADV-001',
      },
    });
    let res = makeRes();
    await controller.confirmAdvance(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.order.status).toBe('Advance Received');
    expect(res.body.data.order.advance_received).toBe(10000);
    expect(mockState.tables.payments[0]).toEqual(
      expect.objectContaining({
        payment_no: 'PAY-001',
        linked_receivable_id: mockState.tables.receivables.find((row) => row.type === 'Advance').id,
      })
    );

    const persistedOrder = mockState.tables.export_orders[0];
    persistedOrder.status = 'Docs In Preparation';
    persistedOrder.current_step = 6;

    const docTypes = ['phyto', 'bl_draft', 'bl_final', 'commercial_invoice', 'packing_list', 'coo', 'fumigation'];
    for (const docType of docTypes) {
      req = makeReq({
        params: { id: String(order.id) },
        body: {
          doc_type: docType,
        },
      });
      res = makeRes();
      await controller.approveDocument(req, res);
      expect(res.statusCode).toBe(200);
    }

    expect(mockState.tables.export_orders[0].status).toBe('Awaiting Balance');

    req = makeReq({
      params: { id: String(order.id) },
      body: {
        amount: 40000,
        payment_date: '2026-04-06',
        payment_method: 'tt',
        bank_reference: 'BAL-001',
      },
    });
    res = makeRes();
    await controller.confirmBalance(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.order.status).toBe('Ready to Ship');
    expect(mockState.tables.payments[1]).toEqual(
      expect.objectContaining({
        payment_no: 'PAY-002',
        linked_receivable_id: mockState.tables.receivables.find((row) => row.type === 'Balance').id,
      })
    );

    req = makeReq({
      params: { id: String(order.id) },
      body: {
        vessel_name: 'MV Test',
        booking_no: 'BK-001',
        containers: [
          { container_no: 'MSCU1234567', seal_no: 'SEAL-1', gross_weight_kg: 25100, net_weight_kg: 24350, notes: 'Front container' },
          { container_no: 'MSCU7654321', seal_no: 'SEAL-2', gross_weight_kg: 24800, net_weight_kg: 24090, notes: 'Rear container' },
        ],
        atd: '2026-04-07',
        eta: '2026-04-20',
        destination_port: 'Jebel Ali',
        notes: 'Container departed',
      },
    });
    res = makeRes();
    await controller.updateShipment(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.order.status).toBe('Shipped');
    expect(res.body.data.shipmentContainers).toHaveLength(2);
    expect(mockState.tables.shipment_containers).toHaveLength(2);
    expect(mockState.tables.shipment_containers[0]).toEqual(
      expect.objectContaining({
        order_id: order.id,
        sequence_no: 1,
        container_no: 'MSCU1234567',
      })
    );

    req = makeReq({
      params: { id: String(order.id) },
      body: {
        ata: '2026-04-20',
        notes: 'Reached destination',
      },
    });
    res = makeRes();
    await controller.updateShipment(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.order.status).toBe('Arrived');

    req = makeReq({
      params: { id: String(order.id) },
      body: { status: 'Closed', notes: 'Settled and closed' },
    });
    res = makeRes();
    await controller.updateStatus(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.order.status).toBe('Closed');

    const transitions = mockState.tables.export_order_status_history.map((row) => row.to_status);
    expect(transitions).toEqual(
      expect.arrayContaining([
        'Advance Received',
        'Awaiting Balance',
        'Ready to Ship',
        'Shipped',
        'Arrived',
        'Closed',
      ])
    );
  });

  it('rejects duplicate full advance confirmation once the advance is already settled', async () => {
    const { order } = await createAwaitingAdvanceOrder();

    let req = makeReq({
      params: { id: String(order.id) },
      body: {
        amount: 10000,
        payment_date: '2026-04-02',
        payment_method: 'tt',
      },
    });
    let res = makeRes();
    await controller.confirmAdvance(req, res);
    expect(res.statusCode).toBe(200);

    req = makeReq({
      params: { id: String(order.id) },
      body: {
        amount: 1,
        payment_date: '2026-04-03',
        payment_method: 'tt',
      },
    });
    res = makeRes();
    await controller.confirmAdvance(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/already been fully received/i);
  });

  it('promotes to advance received when the expected advance has a tiny decimal remainder', async () => {
    const { order } = await createAwaitingAdvanceOrder();
    order.advance_expected = 10000.0000001;
    mockState.tables.receivables.find((row) => row.type === 'Advance').expected_amount = 10000.0000001;

    const req = makeReq({
      params: { id: String(order.id) },
      body: {
        amount: 10000,
        payment_date: '2026-04-02',
        payment_method: 'tt',
        bank_reference: 'ADV-ROUNDING-001',
      },
    });
    const res = makeRes();

    await controller.confirmAdvance(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.order.status).toBe('Advance Received');
    expect(res.body.data.order.current_step).toBe(3);
    expect(mockState.tables.receivables.find((row) => row.type === 'Advance').status).toBe('Received');
  });

  it('derives allowed actions from the backend workflow state', () => {
    const actions = workflowService.getAllowedActions({
      status: 'Awaiting Balance',
      advance_received: 25000,
      advance_expected: 25000,
      balance_received: 0,
      balance_expected: 40000,
      milling_order_id: 7,
    });

    expect(actions).toEqual(expect.objectContaining({
      canConfirmAdvance: false,
      canStartDocs: false,
      canRequestBalance: true,
      canCreateMilling: false,
      canUpdateShipment: false,
      canPutOnHold: true,
      canCloseOrder: false,
    }));
  });

  it('creates a linked milling batch and moves the export order to in milling atomically', async () => {
    const { order } = await createAwaitingAdvanceOrder();

    let req = makeReq({
      params: { id: String(order.id) },
      body: {
        amount: 10000,
        payment_date: '2026-04-02',
        payment_method: 'tt',
      },
    });
    let res = makeRes();
    await controller.confirmAdvance(req, res);
    expect(res.statusCode).toBe(200);

    req = makeReq({
      body: {
        supplier_id: 9,
        linked_export_order_id: order.id,
        raw_qty_mt: 65,
        planned_finished_mt: 50,
      },
    });
    res = makeRes();
    await millingController.create(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.data.batch.linked_export_order_id).toBe(order.id);
    expect(res.body.data.order.status).toBe('In Milling');
    expect(mockState.tables.export_orders[0].status).toBe('In Milling');
    expect(mockState.tables.export_orders[0].milling_order_id).toBe(res.body.data.batch.id);
    expect(
      mockState.tables.export_order_status_history.some((row) => row.to_status === 'In Milling')
    ).toBe(true);
  });

  it('starts docs preparation explicitly, then requests balance once docs are complete', async () => {
    const { order } = await createAwaitingAdvanceOrder();

    let req = makeReq({
      params: { id: String(order.id) },
      body: {
        amount: 10000,
        payment_date: '2026-04-02',
        payment_method: 'tt',
      },
    });
    let res = makeRes();
    await controller.confirmAdvance(req, res);
    expect(res.statusCode).toBe(200);

    req = makeReq({
      body: {
        supplier_id: 9,
        linked_export_order_id: order.id,
        raw_qty_mt: 65,
        planned_finished_mt: 50,
      },
    });
    res = makeRes();
    await millingController.create(req, res);
    expect(res.statusCode).toBe(201);

    req = makeReq({
      params: { id: String(order.id) },
      body: { notes: 'Begin export documentation' },
    });
    res = makeRes();
    await controller.startDocsPreparation(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.order.status).toBe('Docs In Preparation');

    const docTypes = ['phyto', 'bl_draft', 'bl_final', 'commercial_invoice', 'packing_list', 'coo', 'fumigation'];
    for (const docType of docTypes) {
      req = makeReq({
        params: { id: String(order.id) },
        body: { doc_type: docType },
      });
      res = makeRes();
      await controller.uploadDocument(req, res);
      expect(res.statusCode).toBe(200);

      req = makeReq({
        params: { id: String(order.id) },
        body: { doc_type: docType },
      });
      res = makeRes();
      await controller.approveDocument(req, res);
      expect(res.statusCode).toBe(200);
    }

    expect(mockState.tables.export_orders[0].status).toBe('Awaiting Balance');

    req = makeReq({
      params: { id: String(order.id) },
      body: { notes: 'Send balance reminder' },
    });
    res = makeRes();
    await controller.requestBalance(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.order.status).toBe('Awaiting Balance');
    expect(res.body.data.requested_amount).toBe(40000);
    expect(
      mockState.tables.export_order_status_history.some((row) => row.reason === 'Send balance reminder')
    ).toBe(true);
  });
});
