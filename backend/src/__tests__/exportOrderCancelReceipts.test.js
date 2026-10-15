/**
 * Cancelling an export order never deletes or debits away a receipt (P2-15).
 *
 * cancelOrder used to decrement the bank for each confirmed receipt and
 * hard-delete the payment and its bank_transactions row, so the receipt history
 * disappeared. disposeOrderReceipts now:
 *   - refuses (400) when money was received and no disposition was chosen,
 *     and refuses a forfeit with no Owner authorisation (403);
 *   - never issues a DELETE or a bank decrement of its own;
 *   - still marks receipts pending Finance as Rejected (no money moved);
 *   - leaves rejected / reversed / superseded rows alone.
 * The refund / credit / forfeit postings are proven end to end in
 * exportCancelRefund.integration.test.js (DB-gated).
 */
const { disposeOrderReceipts, isConfirmed } = require('../modules/exportOrders/unwindReceipts');

function recordingTrx() {
  const calls = [];
  const trx = (table) => {
    const q = { table, where: null, whereIn: null };
    const b = {
      where(c) { q.where = c; return b; },
      whereIn(col, ids) { q.whereIn = { col, ids: [...ids] }; return b; },
      async first() { return undefined; },
      async decrement(col, by) { calls.push({ op: 'decrement', ...q, col, by }); return 1; },
      async del() { calls.push({ op: 'del', ...q }); return 1; },
      async update(patch) { calls.push({ op: 'update', ...q, patch }); return 1; },
      insert() { calls.push({ op: 'insert', ...q }); return { returning: async () => [{}] }; },
    };
    return b;
  };
  trx.fn = { now: () => 'now()' };
  return { trx, calls };
}

const order = { id: 1, order_no: 'EX-006', customer_id: 9 };
const confirmed = { id: 11, type: 'receipt', status: 'Confirmed', bank_account_id: 4, currency: 'USD', amount: '3000.00', base_amount_pkr: '840000.00', linked_receivable_id: 5 };
const pending = { id: 12, type: 'receipt', status: 'Pending Finance Confirmation', bank_account_id: 4, currency: 'USD', amount: '2000.00', base_amount_pkr: '560000.00' };
const rejected = { id: 13, type: 'receipt', status: 'Rejected', currency: 'USD', amount: '1500.00' };
const superseded = { id: 14, type: 'receipt', status: 'Superseded', currency: 'USD', amount: '2000.00' };
const reversed = { id: 15, type: 'receipt', status: 'Reversed', currency: 'USD', amount: '100.00' };

describe('cancel never destroys a receipt', () => {
  it('money received and no disposition chosen: refused, nothing written', async () => {
    const { trx, calls } = recordingTrx();
    await expect(disposeOrderReceipts(trx, { order, payments: [confirmed, pending], userId: 2 }))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/Choose what happens to the money/) });
    expect(calls).toEqual([]);
  });

  it('forfeit without an Owner authorisation: refused (403)', async () => {
    const { trx, calls } = recordingTrx();
    await expect(disposeOrderReceipts(trx, { order, payments: [confirmed], disposition: 'forfeit', userId: 2 }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(calls).toEqual([]);
  });

  it('only unconfirmed / dead receipts: no disposition needed, the pending one is Rejected, nothing deleted or debited', async () => {
    const { trx, calls } = recordingTrx();
    const out = await disposeOrderReceipts(trx, { order, payments: [pending, rejected, superseded, reversed], userId: 2 });
    expect(calls.filter((c) => c.op === 'del' || c.op === 'decrement')).toEqual([]);
    const updates = calls.filter((c) => c.op === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].whereIn.ids).toEqual([12]);
    expect(updates[0].patch.status).toBe('Rejected');
    expect(updates[0].patch.reject_reason).toMatch(/EX-006 cancelled/);
    expect(out).toMatchObject({ refunded: 0, credited: 0, forfeited: 0, voided: 1 });
  });

  it('isConfirmed: Confirmed and legacy NULL receipts only — never a refund, a superseded or a pending row', () => {
    expect(isConfirmed(confirmed)).toBe(true);
    expect(isConfirmed({ ...confirmed, status: null })).toBe(true);
    expect(isConfirmed({ ...confirmed, type: 'payment' })).toBe(false);
    for (const p of [pending, rejected, superseded, reversed]) expect(isConfirmed(p)).toBe(false);
  });
});
