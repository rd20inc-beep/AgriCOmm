/**
 * Advance-request and balance-reminder emails carry the order total.
 *
 * Both read order.total_value, a column export_orders doesn't have (the total
 * is contract_value), so every reminder went out with a blank "Total Value",
 * and the currency was always 'USD' whatever the order was priced in.
 */
const ORDER = {
  id: 4, order_no: 'EX-004', customer_name: 'ARROCERIA s.r.o', customer_email: 'buyer@example.com',
  currency: 'EUR', contract_value: '60960.00', advance_expected: '0', advance_pct: '0',
  balance_expected: '60960', balance_received: '10000',
};

jest.mock('../config/database', () => {
  const chain = {};
  ['leftJoin', 'select', 'where'].forEach((m) => { chain[m] = () => chain; });
  chain.first = async () => ORDER;
  return () => chain;
});

const emailService = require('../modules/communications/email.service');

describe('reminder emails', () => {
  let sent;
  beforeEach(() => {
    sent = null;
    jest.spyOn(emailService, 'sendEmail').mockImplementation(async (args) => { sent = args; return { id: 1 }; });
  });
  afterEach(() => jest.restoreAllMocks());

  it('balance reminder: total is the contract value, in the order currency', async () => {
    await emailService.sendBalanceReminder({ orderId: 4, userId: 1 });
    expect(sent.templateSlug).toBe('balance_reminder');
    expect(sent.variables.totalValue).toBe('60960.00');
    expect(sent.variables.currency).toBe('EUR');
    expect(sent.variables.amount).toBe(50960);
  });

  it('advance request: same total and currency', async () => {
    await emailService.sendAdvanceRequest({ orderId: 4, userId: 1 });
    expect(sent.templateSlug).toBe('advance_request');
    expect(sent.variables.totalValue).toBe('60960.00');
    expect(sent.variables.currency).toBe('EUR');
  });
});
