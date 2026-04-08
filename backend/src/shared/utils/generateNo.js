/**
 * Sequential number generators — single source of truth for all entity numbering.
 * Extracted from exportOrderController.js and inventoryService.js
 */

/**
 * Generate next order number: EX-001, EX-002, ...
 */
async function generateOrderNo(trx) {
  const all = await trx('export_orders').select('order_no');
  let maxNum = 0;
  for (const row of all) {
    const num = parseInt((row.order_no || '').replace('EX-', ''), 10) || 0;
    if (num > maxNum) maxNum = num;
  }
  return `EX-${String(maxNum + 1).padStart(3, '0')}`;
}

/**
 * Generate next payment number: PAY-001, PAY-002, ...
 * @param {Object} trx - Knex transaction
 * @param {string} prefix - Payment number prefix (default: 'PAY')
 */
async function generatePaymentNo(trx, prefix = 'PAY') {
  const last = await trx('payments')
    .select('payment_no')
    .where('payment_no', 'like', `${prefix}-%`)
    .orderBy('id', 'desc')
    .first();

  if (!last || !last.payment_no) {
    return `${prefix}-001`;
  }

  const num = parseInt(last.payment_no.replace(`${prefix}-`, ''), 10) || 0;
  return `${prefix}-${String(num + 1).padStart(3, '0')}`;
}

/**
 * Generate next lot transaction number: TXN-YYYYMMDD-0001
 */
async function generateLotTxnNo(trx) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = await trx('lot_transactions').count('id as c').first();
  return `TXN-${today}-${String((count?.c || 0) + 1).padStart(4, '0')}`;
}

/**
 * Generate next lot number: LOT-YYYYMMDD-0001
 */
async function generateLotNo(trx) {
  const today = new Date();
  const dateStr =
    today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');

  const prefix = `LOT-${dateStr}-`;

  const last = await trx('inventory_lots')
    .where('lot_no', 'like', `${prefix}%`)
    .orderBy('lot_no', 'desc')
    .select('lot_no')
    .first();

  let seq = 1;
  if (last && last.lot_no) {
    const parts = last.lot_no.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) {
      seq = lastSeq + 1;
    }
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * Generate next journal number: JE-YYYYMM-0001
 */
async function generateJournalNo(trx, date) {
  const journalDate = date || new Date().toISOString().slice(0, 10);
  const ym = journalDate.slice(0, 7).replace('-', '');
  const lastJE = await trx('journal_entries')
    .where('journal_no', 'like', `JE-${ym}-%`)
    .orderBy('id', 'desc')
    .first();

  let seq = 1;
  if (lastJE && lastJE.journal_no) {
    const parts = lastJE.journal_no.split('-');
    const lastSeq = parseInt(parts[2], 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }
  return `JE-${ym}-${String(seq).padStart(4, '0')}`;
}

module.exports = {
  generateOrderNo,
  generatePaymentNo,
  generateLotTxnNo,
  generateLotNo,
  generateJournalNo,
};
