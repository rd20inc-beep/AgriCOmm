/**
 * Mill-store low stock is judged per ITEM (INV-F13).
 *
 * Before: alerts inner-joined mill_stock and grouped per warehouse (an item
 * short in one store but plentiful overall was "low"; an item with no stock row
 * was never seen), the dashboard counted per stock row, the katta summary read
 * only the warehouse_id IS NULL bucket, and the forecast counted empty katta
 * SOLD via local sales as mill consumption.
 */
const repo = require('../modules/millStore/millStore.repository');

describe('item-level low-stock rule', () => {
  // Item-level on hand = SUM over every mill_stock row for the item.
  const onHandByItem = (stockRows) => stockRows.reduce((m, r) => {
    m[r.item_id] = (m[r.item_id] || 0) + Number(r.quantity_available);
    return m;
  }, {});

  test('an item short in one warehouse but fine overall is NOT low', () => {
    const stock = [{ item_id: 1, quantity_available: 10 }, { item_id: 1, quantity_available: 500 }];
    const onHand = onHandByItem(stock)[1];
    expect(repo.isLowStock({ on_hand: onHand, reorder_level: 100, has_stock_row: true })).toBe(false);
    // the per-warehouse view would have flagged the 10-unit row
    expect(repo.isLowStock({ on_hand: 10, reorder_level: 100, has_stock_row: true })).toBe(true);
  });

  test('an item with NO stock row and a reorder level is low (it has none)', () => {
    expect(repo.isLowStock({ on_hand: 0, reorder_level: 50, has_stock_row: false })).toBe(true);
  });

  test('an unused catalogue item with no level and no stock row is not low', () => {
    expect(repo.isLowStock({ on_hand: 0, reorder_level: 0, has_stock_row: false })).toBe(false);
  });

  test('at the level counts as low', () => {
    expect(repo.isLowStock({ on_hand: '100', reorder_level: '100', has_stock_row: true })).toBe(true);
  });
});

describe('the SQL alerts / summary / forecast / katta share', () => {
  test('on hand is a LEFT JOINed per-item SUM, not a per-warehouse group', () => {
    const sql = repo.lowStockItemsQuery().select('mi.id').toString();
    expect(sql).toContain('left join (select "item_id", sum("quantity_available") as "on_hand" from "mill_stock" group by "item_id") as "ms"');
    expect(sql).toContain('COALESCE(ms.on_hand, 0) <= mi.reorder_level');
    expect(sql).not.toMatch(/warehouse/);
  });

  test('alerts and the summary count use the same rule', () => {
    const alerts = repo.lowStockItemsQuery().toString();
    const summary = repo.lowStockItemsQuery().count({ c: 'mi.id' }).toString();
    expect(summary).toContain(alerts.replace(/^select \* /, ''));
  });

  test('burn rate excludes katta sold through local sales, and is valid SQL', () => {
    const sql = repo.burnRateQuery('2026-01-01T00:00:00.000Z').toString();
    expect(sql).toContain('"reference_type" not in (\'local_sale\', \'local_sale_reversal\')');
    expect(sql).toContain('"reference_type" is null');
    // knex .sum(raw('X as y')) rendered SUM(X as y) — a syntax error.
    expect(sql).toContain('SUM(ABS(quantity)) as total_consumed');
    expect(sql).not.toMatch(/sum\(ABS\(quantity\) as/i);
  });

  test('the katta summary reads the same item-level on hand', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../modules/millStore/millStore.service.js'), 'utf8');
    expect(src).toContain("repo.withItemOnHand(db('mill_items as i'), 'i')");
    expect(src).not.toContain("andOnNull('s.warehouse_id')");
  });
});
