import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { INACTIVE_ORDER_STATUSES, isActiveOrder } from '../orderStatus';

/**
 * D-15 "active order" (contract active_order.v1): the screens that count the
 * orders they hold use the SAME status list as the server's kpi/orderStatus.js.
 * The backend module is loaded here, so a change to one side fails this test.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const be = require(resolve(HERE, '../../../../backend/src/modules/kpi/orderStatus.js'));

describe('active order — screens and server agree', () => {
  it('one inactive-status list', () => {
    expect([...INACTIVE_ORDER_STATUSES]).toEqual([...be.INACTIVE_ORDER_STATUSES]);
  });

  it.each(['Draft', 'Cancelled', 'Closed', 'Awaiting Advance', 'Advance Received', 'In Milling', 'Shipped', 'Arrived', ''])(
    'isActiveOrder(%p) is identical', (status) => {
      expect(isActiveOrder({ status })).toBe(be.isActiveOrder(status));
    },
  );

  it('a Draft is not an active order (the Export home used to count it)', () => {
    expect(isActiveOrder({ status: 'Draft' })).toBe(false);
    expect(isActiveOrder(null)).toBe(false);
  });
});
