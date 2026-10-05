/**
 * ONE definition of "company stock" and "on hand" (inventory/stockSql.js).
 *
 * Client-owned Service Milling lots (ownership='client') sit in our warehouse
 * but belong to the client. Before this, the printable stock report, stock
 * aging/turnover/valuation, the executive summary, the intelligence stock KPIs
 * and stock-take line creation all counted them as company stock.
 */
const { fakeKnex } = require('./helpers/fakeKnex');
const knexLib = require('knex');
const stockSql = require('../modules/inventory/stockSql');

const pg = knexLib({ client: 'pg' }); // SQL builder only — never connects

const LOTS = [
  { id: 1, lot_no: 'CO-1', ownership: 'company', qty: 1000, net_weight_kg: 1000 },
  { id: 2, lot_no: 'CL-1', ownership: 'client', qty: 5000, net_weight_kg: 5000 },
  { id: 3, lot_no: 'CO-2', ownership: 'company', qty: 250, net_weight_kg: 250 },
];

describe('companyStock', () => {
  test('excludes client-owned (service-milling) lots by default', async () => {
    const db = fakeKnex({ inventory_lots: LOTS });
    const rows = await stockSql.companyStock(db('inventory_lots as l'), 'l');
    expect(rows.map((r) => r.lot_no)).toEqual(['CO-1', 'CO-2']);
  });

  test('works on the bare table (no alias)', async () => {
    const db = fakeKnex({ inventory_lots: LOTS });
    const rows = await stockSql.companyStock(db('inventory_lots'), null);
    expect(rows.map((r) => r.id)).toEqual([1, 3]);
  });

  test('?ownership=client gives the Service view, ?ownership=all both', async () => {
    const db = fakeKnex({ inventory_lots: LOTS });
    expect((await stockSql.companyStock(db('inventory_lots'), null, 'client')).map((r) => r.id)).toEqual([2]);
    expect((await stockSql.companyStock(db('inventory_lots'), null, 'all')).map((r) => r.id)).toEqual([1, 2, 3]);
  });

  test('an unknown ownership value falls back to company, never to everything', async () => {
    const db = fakeKnex({ inventory_lots: LOTS });
    expect((await stockSql.companyStock(db('inventory_lots'), null, "x' OR 1=1 --")).map((r) => r.id)).toEqual([1, 3]);
    expect(stockSql.ownershipSql('l', 'bogus')).toBe("l.ownership = 'company'");
    expect(stockSql.ownershipSql('l', 'all')).toBe('TRUE');
  });

  test('renders a plain equality on the aliased column', () => {
    const sql = stockSql.companyStock(pg('inventory_lots as l').select('l.id'), 'l').toString();
    expect(sql).toBe('select "l"."id" from "inventory_lots" as "l" where "l"."ownership" = \'company\'');
  });
});

describe('shared on-hand SQL', () => {
  test('on hand prefers net weight, falls back to qty', () => {
    expect(stockSql.ON_HAND_KG).toBe('(CASE WHEN l.net_weight_kg > 0 THEN l.net_weight_kg ELSE CAST(l.qty AS DECIMAL) END)');
    expect(stockSql.onHandKg('il')).toContain('il.net_weight_kg');
  });

  test('katta and bags are on-hand counts scaled from the intake, split at 50 kg', () => {
    expect(stockSql.UNITS_ON_HAND).toContain('l.total_bags * (');
    expect(stockSql.UNITS_ON_HAND).toContain('/ l.received_net_weight_kg');
    expect(stockSql.IS_KATTA).toContain('= 0 OR');
    expect(stockSql.IS_KATTA).toContain('>= 50');
    expect(stockSql.KATTA_ON_HAND).toContain(`THEN ${stockSql.UNITS_ON_HAND} ELSE 0`);
    expect(stockSql.BAGS_ON_HAND).toContain(`THEN 0 ELSE ${stockSql.UNITS_ON_HAND}`);
  });

  test('hasStock drops lots holding nothing', () => {
    const sql = stockSql.hasStock(pg('inventory_lots as l').select('l.id'), 'l').toString();
    expect(sql).toContain(`where ${stockSql.ON_HAND_KG} > 0`);
  });

  test('subtype filter: broken is the rollup of every graded broken subtype', () => {
    const rollup = stockSql.whereSubtype(pg('inventory_lots as l').select('l.id'), 'broken', 'l').toString();
    expect(rollup).toContain("LIKE 'broken%'");
    const b1 = stockSql.whereSubtype(pg('inventory_lots as l').select('l.id'), 'broken-b1', 'l').toSQL();
    expect(b1.bindings).toEqual(['broken-b1']);
    const all = stockSql.whereSubtype(pg('inventory_lots as l').select('l.id'), 'All', 'l').toString();
    expect(all).not.toContain('where');
  });
});

describe('the report code uses the shared helper', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

  test.each([
    ['modules/analytics/reporting.controller.js', /stockSql\.companyStock\(q, 'l', req\.query\.ownership\)/],
    ['modules/analytics/reporting.controller.js', /stockSql\.companyStock\(lotsQ, 'l', req\.query\.ownership\)/],
    ['modules/analytics/reporting.service.js', /companyStock\(db\('inventory_lots'\), null\)\s*\n\s*\.where\('qty', '>', 0\)/],
    ['modules/analytics/intelligence.service.js', /companyStock\(db\('inventory_lots'\), null\)\.where\('type', 'raw'\)/],
    ['modules/analytics/intelligence.service.js', /companyStock\(db\('inventory_lots'\), null\)\.where\('type', 'finished'\)/],
    ['modules/inventory/lotInventory.controller.js', /stockSql\.KATTA_ON_HAND/],
  ])('%s', (file, re) => {
    expect(read(file)).toMatch(re);
  });
});
