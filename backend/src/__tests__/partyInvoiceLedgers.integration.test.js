/**
 * P4-07 — party and invoice ledgers (RPT-17, MIL-46).
 *
 *  * Mill supplier statement is entity-scoped: the mill's bills and journals
 *    only; an unlabelled journal tied to a mill bill is in, one that cannot be
 *    tied is left out and counted. A period's opening = the previous closing.
 *  * Invoice ledger: one status vocabulary (a Pending payable is "Unpaid" and
 *    the filter finds it), invoices grouped before the limit, outstanding is
 *    per invoice, client lots excluded, voids listed without money, and a
 *    cost-blind role sees no purchase money.
 *
 * DB-gated: skipped unless DB_HOST is set.
 */
const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

d('party + invoice ledgers (DB-gated)', () => {
  let db; let acct; let svc; let redactInvoiceLedger; const ids = {};
  const run = `${Date.now()}`.slice(-7);
  const tag = `ZZPI${run}`;

  const journal = async ({ no, date, entity, partyId, refNo, amount, payment = false }) => {
    const [je] = await db('journal_entries').insert({
      journal_no: `${tag}-J-${no}`, date, status: 'Posted', currency: 'PKR', total_debit: amount, total_credit: amount,
      entity, party_type: partyId ? 'supplier' : null, party_id: partyId || null, ref_no: refNo, ref_type: 'ZZ test',
    }).returning('*');
    // a bill: Dr stock / Cr AP; a payment: Dr AP / Cr bank
    const lines = payment
      ? [{ account_id: ids.ap, debit: amount, credit: 0 }, { account_id: ids.stock, debit: 0, credit: amount }]
      : [{ account_id: ids.stock, debit: amount, credit: 0 }, { account_id: ids.ap, debit: 0, credit: amount }];
    await db('journal_lines').insert(lines.map((l) => ({ journal_id: je.id, account: String(l.account_id), ...l })));
  };

  beforeAll(async () => {
    db = require('../config/database');
    acct = require('../modules/accounting/accounting.service');
    svc = require('../modules/analytics/reporting.service');
    ({ redactInvoiceLedger } = require('../modules/analytics/reporting.controller'));
    ids.ap = (await db('chart_of_accounts').where({ code: '2010' }).first('id')).id;
    ids.stock = (await db('chart_of_accounts').where({ code: '1210' }).first('id')).id;
    const [s] = await db('suppliers').insert({ name: `${tag} Supplier` }).returning('*');
    ids.sup = s.id;
    await db('payables').insert([
      { pay_no: `${tag}-PM1`, linked_ref: `${tag}-LOT1`, supplier_id: s.id, entity: 'mill', category: 'Raw Material', original_amount: 1000, paid_amount: 0, outstanding: 1000, status: 'Pending', currency: 'PKR' },
      { pay_no: `${tag}-PM2`, linked_ref: `${tag}-LOT2`, supplier_id: s.id, entity: 'mill', category: 'Raw Material', original_amount: 500, paid_amount: 0, outstanding: 500, status: 'Pending', currency: 'PKR' },
      { pay_no: `${tag}-PE1`, linked_ref: `${tag}-EXP1`, supplier_id: s.id, entity: 'export', category: 'Packaging', original_amount: 7000, paid_amount: 0, outstanding: 7000, status: 'Pending', currency: 'PKR' },
    ]);
    await journal({ no: 1, date: '2091-01-10', entity: 'mill', partyId: s.id, refNo: `${tag}-LOT1`, amount: 1000 });
    await journal({ no: 2, date: '2091-02-10', entity: null, partyId: s.id, refNo: `${tag}-LOT2`, amount: 500 });
    await journal({ no: 3, date: '2091-02-15', entity: 'mill', partyId: s.id, refNo: `${tag}-PAY1`, amount: 300, payment: true });
    await journal({ no: 4, date: '2091-01-20', entity: 'export', partyId: s.id, refNo: `${tag}-EXP1`, amount: 7000 });
    await journal({ no: 5, date: '2091-01-25', entity: null, partyId: s.id, refNo: `${tag}-MYSTERY`, amount: 40 });
  });
  afterAll(async () => { if (db) await db.destroy(); });

  describe('mill supplier statement (MIL-46)', () => {
    test('scoped to the mill: export bill out, unlabelled-but-tied journal in, untied one counted', async () => {
      const all = await acct.getSupplierStatement(ids.sup, {});
      expect(all.closing_balance).toBe(1000 + 500 - 300 + 7000 + 40);
      expect(all.entity_scope).toBeNull();

      const mill = await acct.getSupplierStatement(ids.sup, { entity: 'mill' });
      expect(mill.closing_balance).toBe(1000 + 500 - 300);
      expect(mill.entity_scope).toEqual({ entity: 'mill', excluded_unscoped_lines: 1 });
      expect(mill.transactions.map((t) => t.ref_no)).not.toContain(`${tag}-EXP1`);
      expect(mill.open_items.map((o) => o.ref)).not.toContain(`${tag}-EXP1`);
    });

    test('mill customer statement: mill sales only, export journal out, voided sale not charged', async () => {
      const [c] = await db('customers').insert({ name: `ZZC${run} Customer` }).returning('*');
      const sale = (n, status) => ({
        sale_no: `ZZC${run}-CS${n}`, sale_date: '2091-04-01', item_name: 'ZZ', customer_id: c.id, quantity_input: 1, quantity_kg: 1,
        rate_input: 1, rate_per_kg: 1, total_amount: 250, paid_amount: 0, due_amount: 250, status, entity: 'mill',
      });
      await db('local_sales').insert([sale(1, 'Completed'), sale(2, 'Voided')]);
      const [je] = await db('journal_entries').insert({
        journal_no: `${tag}-J-C1`, date: '2091-04-02', status: 'Posted', currency: 'PKR', total_debit: 900, total_credit: 900,
        entity: 'export', party_type: 'customer', party_id: c.id, ref_no: `${tag}-EXPORDER`,
      }).returning('*');
      const ar = (await db('chart_of_accounts').where({ code: '1110' }).first('id')).id;
      const rev = (await db('chart_of_accounts').where({ code: '4000' }).first('id')) || (await db('chart_of_accounts').whereIn('code', ['4010', '4100']).first('id'));
      await db('journal_lines').insert([
        { journal_id: je.id, account: String(ar), account_id: ar, debit: 900, credit: 0 },
        { journal_id: je.id, account: String(rev.id), account_id: rev.id, debit: 0, credit: 900 },
      ]);
      const all = await acct.getCustomerStatement(c.id, {});
      expect(all.closing_balance).toBe(250 + 900);
      const mill = await acct.getCustomerStatement(c.id, { entity: 'mill' });
      expect(mill.closing_balance).toBe(250);
    });

    test('opening of a period = closing of the previous period', async () => {
      const jan = await acct.getSupplierStatement(ids.sup, { entity: 'mill', dateTo: '2091-01-31' });
      const feb = await acct.getSupplierStatement(ids.sup, { entity: 'mill', dateFrom: '2091-02-01' });
      expect(jan.closing_balance).toBe(1000);
      expect(feb.opening_balance).toBe(jan.closing_balance);
      expect(feb.closing_balance).toBe(1200);
    });
  });

  describe('invoice ledger (RPT-17)', () => {
    beforeAll(async () => {
      const [wh] = await db('warehouses').insert({ name: `${tag} WH`, entity: 'mill', type: 'raw', is_active: true }).returning('*');
      const [p] = await db('products').insert({ name: `${tag} Rice` }).returning('*');
      const base = { entity: 'mill', warehouse_id: wh.id, product_id: p.id, unit: 'KG', item_name: 'ZZ', type: 'raw', variety: `${tag} rice`, purchase_date: '2091-03-01', supplier_id: ids.sup };
      const [l1] = await db('inventory_lots').insert({ ...base, lot_no: `${tag}-LOT1`, qty: 100, available_qty: 100, net_weight_kg: 100, status: 'Available' }).returning('*');
      await db('inventory_lots').insert({ ...base, lot_no: `${tag}-LOT2`, qty: 0, net_weight_kg: 0, status: 'Closed', voided_at: new Date() });
      await db('inventory_lots').insert({ ...base, lot_no: `${tag}-CLIENT`, qty: 50, available_qty: 50, net_weight_kg: 50, status: 'Available', ownership: 'client' });
      ids.lot1 = l1.id;
      // One invoice, three lines: two paid, one with money due.
      const line = (n, due) => ({
        sale_no: `${tag}-S${n}`, sale_group_no: `${tag}-INV`, sale_date: '2091-03-05', item_name: `${tag} rice`, buyer_name: `${tag} Buyer`,
        quantity_input: 10, quantity_kg: 10, rate_input: 10, rate_per_kg: 10, total_amount: 100, paid_amount: 100 - due, due_amount: due,
        status: 'Completed', entity: 'mill',
      });
      await db('local_sales').insert([line(1, 0), line(2, 0), line(3, 40)]);
    });

    test('a Pending payable reads Unpaid and the Unpaid filter finds it; void and client lots handled', async () => {
      const r = await svc.getInvoiceLedger({ q: tag, kind: 'purchase' });
      const byNo = Object.fromEntries(r.rows.map((x) => [x.invoiceNo, x]));
      expect(byNo[`${tag}-LOT1`].paymentStatus).toBe('Unpaid');
      expect(byNo[`${tag}-LOT2`]).toMatchObject({ paymentStatus: 'Void', outstanding: 0 });
      expect(byNo[`${tag}-CLIENT`]).toBeUndefined();
      expect(r.totals.purchase).toMatchObject({ count: 2, total: 1000, outstanding: 1000 });
      const unpaid = await svc.getInvoiceLedger({ q: tag, kind: 'purchase', status: 'Unpaid' });
      expect(unpaid.rows.map((x) => x.invoiceNo)).toEqual([`${tag}-LOT1`]);
    });

    test('lines grouped before the limit; search on one line returns the whole invoice; outstanding per invoice', async () => {
      const r = await svc.getInvoiceLedger({ q: `${tag}-S2`, kind: 'sale', limit: 1 });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({ invoiceNo: `${tag}-INV`, total: 300, received: 260, outstanding: 40, paymentStatus: 'Partial', isGroup: true });
      expect(r.totals.sale).toMatchObject({ total: 300, outstanding: 40 });
      const out = await svc.getInvoiceLedger({ q: tag, kind: 'sale', outstanding: '1' });
      expect(out.rows[0].total).toBe(300); // the whole invoice, not just its unpaid line
    });

    test('totals cover everything filtered and say when the list is truncated', async () => {
      const r = await svc.getInvoiceLedger({ q: tag, limit: 1 });
      expect(r.rows).toHaveLength(1);
      expect(r.totals).toMatchObject({ count: 3, listed: 1, truncated: true });
      expect(r.totals.purchase.total).toBe(1000);
      expect(r.totals.sale.total).toBe(300);
    });

    test('cost-blind role sees no purchase money; profit-blind sees no sale money', async () => {
      const blind = redactInvoiceLedger(await svc.getInvoiceLedger({ q: tag }), { cost: false, profit: true });
      const p = blind.rows.find((x) => x.kind === 'purchase');
      const s = blind.rows.find((x) => x.kind === 'sale');
      expect([p.total, p.received, p.outstanding]).toEqual([null, null, null]);
      expect(s.total).toBe(300);
      expect(blind.totals.purchase).toEqual({ count: 2, redacted: true });
      const noProfit = redactInvoiceLedger(await svc.getInvoiceLedger({ q: tag }), { cost: true, profit: false });
      expect(noProfit.rows.find((x) => x.kind === 'sale').total).toBeNull();
      expect(noProfit.rows.find((x) => x.invoiceNo === `${tag}-LOT1`).total).toBe(1000);
    });
  });
});
