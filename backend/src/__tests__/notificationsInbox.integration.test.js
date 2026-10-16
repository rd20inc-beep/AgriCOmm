/**
 * P5-01 / P5-02 (DB-gated): the bell's notifications and the approvals inbox.
 *
 *   - an event notifies the right role BY NAME, also when role ids differ
 *     between installs (the old code hard-coded ids: PLT-15)
 *   - permission fan-out (createForPermission) reaches exactly the approvers
 *   - read state is per user; links are permission-safe
 *   - the inbox lists each type only for users who pass its approve gate,
 *     honours maker-checker, and the route returns the same list
 *
 * Local run (throwaway DB, migrated):
 *   DB_HOST=… DB_NAME=… npx jest --runInBand src/__tests__/notificationsInbox.integration.test.js
 */
jest.mock('../modules/communications/email.service', () => new Proxy({}, {
  get: () => jest.fn(() => Promise.resolve(null)),
}));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(120000);

d('notifications + approvals inbox (DB-gated)', () => {
  let db; let notificationService; let automation; let inbox; let inboxRouter;
  const tag = `${Date.now()}`.slice(-7);
  const created = { users: [], roles: [], items: [], prs: [], runs: [], storeAdj: [], orders: [], customers: [], products: [] };
  let roles;

  const mkUser = async (name, roleId, conn = db) => {
    const [u] = await conn('users').insert({
      email: `zz-${name}-${tag}@test.local`, full_name: `ZZ ${name} ${tag}`, password_hash: 'x', role_id: roleId, is_active: true, status: 'active',
    }).returning('*');
    if (conn === db) created.users.push(u.id);
    return u;
  };
  const mkRole = async (name, perms, conn = db) => {
    const [r] = await conn('roles').insert({ name: `${name} ${tag}` }).returning('*');
    for (const [module, action] of perms) {
      const p = await conn('permissions').where({ module, action }).first();
      await conn('role_permissions').insert({ role_id: r.id, permission_id: p.id });
    }
    if (conn === db) created.roles.push(r.id);
    return r;
  };
  const callInbox = async (user, query = {}) => {
    const layer = inboxRouter.stack.find((l) => l.route && l.route.path === '/');
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    await layer.route.stack[0].handle({ user, query, params: {} }, res, () => {});
    return res;
  };

  beforeAll(async () => {
    db = require('../config/database');
    notificationService = require('../services/notificationService');
    automation = require('../modules/admin/automation.service');
    inbox = require('../modules/approvalsInbox/approvalsInbox.service');
    inboxRouter = require('../modules/approvalsInbox/approvalsInbox.routes');
    roles = Object.fromEntries((await db('roles').select('id', 'name')).map((r) => [r.name, r.id]));
  });

  afterAll(async () => {
    if (!db) return;
    const users = created.users;
    await db('notifications').whereIn('user_id', users).del();
    await db('mill_stock_adjustments').whereIn('id', created.storeAdj).orWhereIn('item_id', created.items).del();
    await db('mill_items').whereIn('id', created.items).del();
    await db('purchase_requirements').whereIn('id', created.prs).del();
    await db('mill_payroll_runs').whereIn('id', created.runs).del();
    await db('export_orders').whereIn('id', created.orders).del();
    await db('customers').whereIn('id', created.customers).del();
    await db('products').whereIn('id', created.products).del();
    await db('users').whereIn('id', users).del();
    await db('role_permissions').whereIn('role_id', created.roles).del();
    await db('roles').whereIn('id', created.roles).del();
    await db.destroy();
  });

  describe('role fan-out by NAME', () => {
    it('reaches the Export Manager even when that role has a different id', async () => {
      await db.transaction(async (trx) => {
        // Make this install look like another one: the role named "Export
        // Manager" gets a NEW id, and the old id now belongs to another role.
        const oldId = roles['Export Manager'];
        await trx('roles').where({ id: oldId }).update({ name: `ZZ Decoy ${tag}` });
        const [em] = await trx('roles').insert({ name: 'Export Manager' }).returning('*');
        expect(em.id).not.toBe(oldId);
        const realEm = await mkUser('em-new-id', em.id, trx);
        const onOldId = await mkUser('decoy-old-id', oldId, trx);

        const [customer] = await trx('customers').insert({ name: `ZZ Buyer ${tag}`, country: 'UAE' }).returning('*');
        const [product] = await trx('products').insert({ name: `ZZ Rice ${tag}` }).returning('*');
        const [order] = await trx('export_orders').insert({
          order_no: `ZZ-EX-${tag}`, customer_id: customer.id, product_id: product.id, created_by: realEm.id,
          status: 'Advance Received', currency: 'USD',
          qty_mt: 10, price_per_mt: 500, contract_value: 5000,
        }).returning('*');
        await automation.onAdvanceConfirmed(trx, { orderId: order.id, amount: 1000, userId: null });

        const mine = await trx('notifications').where({ user_id: realEm.id });
        const decoy = await trx('notifications').where({ user_id: onOldId.id });
        expect(mine).toHaveLength(1);
        expect(mine[0]).toMatchObject({ title: 'Advance Payment Confirmed', linked_ref: order.order_no, type: 'payment', is_read: false });
        expect(decoy).toHaveLength(0);
        throw new Error('ROLLBACK');
      }).catch((e) => { if (e.message !== 'ROLLBACK') throw e; });
    });

    it('createForPermission reaches holders of the permission plus Owner / Super Admin, not others', async () => {
      const approverRole = await mkRole('ZZ Store Approver', [['mill_store', 'approve_adjustment']]);
      const otherRole = await mkRole('ZZ Store Viewer', [['mill_store', 'view']]);
      const approver = await mkUser('store-approver', approverRole.id);
      const viewer = await mkUser('store-viewer', otherRole.id);
      const owner = await mkUser('owner', roles.Owner);
      const requester = await mkUser('requester', approverRole.id);
      const rows = await notificationService.createForPermission(null, {
        permission: ['mill_store', 'approve_adjustment'], excludeUserId: requester.id,
        title: `ZZ test ${tag}`, message: 'm', type: 'approval', link: '/approvals?type=store_adjustment',
      });
      const got = new Set(rows.map((r) => r.user_id));
      expect(got.has(approver.id)).toBe(true);
      expect(got.has(owner.id)).toBe(true);
      expect(got.has(viewer.id)).toBe(false);
      expect(got.has(requester.id)).toBe(false);
    });
  });

  describe('read state is per user, links are permission-safe', () => {
    it('marking one user read leaves the other unread; nobody marks another user\'s', async () => {
      const exportRole = await mkRole('ZZ Export Viewer', [['export_orders', 'view']]);
      const a = await mkUser('reader-a', exportRole.id);
      const b = await mkUser('reader-b', roles['QC Analyst']);
      const [customer] = await db('customers').insert({ name: `ZZ Reader Buyer ${tag}`, country: 'UAE' }).returning('*');
      const [product] = await db('products').insert({ name: `ZZ Reader Rice ${tag}` }).returning('*');
      const [order] = await db('export_orders').insert({
        order_no: `ZZ-RD-${tag}`, customer_id: customer.id, product_id: product.id, created_by: a.id, status: 'Draft', currency: 'USD',
      }).returning('*');
      created.orders.push(order.id); created.customers.push(customer.id); created.products.push(product.id);
      const ref = order.order_no;
      const [na, nb] = await Promise.all([
        notificationService.create(null, { userId: a.id, title: 'Shared event', message: 'x', type: 'shipment', linkedRef: ref }),
        notificationService.create(null, { userId: b.id, title: 'Shared event', message: 'x', type: 'shipment', linkedRef: ref }),
      ]);

      expect(await notificationService.getCount(a.id)).toBe(1);
      expect(await notificationService.markRead(nb.id, a.id)).toBeUndefined(); // not a's row
      expect(await notificationService.getCount(b.id)).toBe(1);

      await notificationService.markRead(na.id, a.id);
      expect(await notificationService.getCount(a.id)).toBe(0);
      expect(await notificationService.getCount(b.id)).toBe(1);

      const listA = await notificationService.getAll(a.id);
      const listB = await notificationService.getAll(b.id);
      expect(listA.unread).toBe(0);
      expect(listB.unread).toBe(1);
      expect(listA.notifications[0].is_read).toBe(true);
      expect(listB.notifications[0].is_read).toBe(false);
      expect(listA.notifications[0].link).toBe(`/export/${order.id}`); // may open orders
      expect(listB.notifications[0].link).toBeNull(); // QC Analyst may not

      await notificationService.markAllRead(b.id);
      expect(await notificationService.getCount(b.id)).toBe(0);
    });
  });

  describe('approvals inbox', () => {
    let owner; let millMgr; let preparer; let checker; let auditor; let pr; let run; let adj;

    beforeAll(async () => {
      owner = await mkUser('inbox-owner', roles.Owner);
      millMgr = await mkUser('inbox-mm', roles['Mill Manager']);
      auditor = await mkUser('inbox-auditor', roles['Read-Only Auditor']);
      const payrollRole = await mkRole('ZZ Payroll Approver', [['payroll', 'approve'], ['payroll', 'view'], ['finance', 'view']]);
      const payrollNoFinance = await mkRole('ZZ Payroll Only', [['payroll', 'approve']]);
      preparer = await mkUser('inbox-preparer', payrollRole.id);
      checker = await mkUser('inbox-checker', payrollNoFinance.id);

      const [item] = await db('mill_items').insert({ code: `ZZ-${tag}`, name: `ZZ Bag ${tag}`, category: 'packaging', unit: 'pcs' }).returning('*');
      created.items.push(item.id);
      [adj] = await db('mill_stock_adjustments').insert({
        item_id: item.id, adjustment_type: 'damage', quantity_delta: -5, reason: 'torn', status: 'Pending', requested_by: millMgr.id,
      }).returning('*');
      created.storeAdj.push(adj.id);
      [pr] = await db('purchase_requirements').insert({ pr_no: `ZZ-PR-${tag}`, item_name: 'ZZ Twine', status: 'pending', raised_by: millMgr.id }).returning('*');
      created.prs.push(pr.id);
      [run] = await db('mill_payroll_runs').insert({ period: '2099-01', pay_date: '2099-01-31', status: 'prepared', net_total: 1000, created_by: preparer.id }).returning('*');
      created.runs.push(run.id);
    });

    const keys = async (user) => (await inbox.getInbox(user.id)).items.map((i) => i.key);

    it('store adjustments are in the Owner\'s inbox, not the Mill Manager\'s', async () => {
      expect(await keys(owner)).toContain(`store_adjustment:${adj.id}`);
      expect(await keys(millMgr)).not.toContain(`store_adjustment:${adj.id}`);
    });

    it('purchase requests follow the route\'s role list', async () => {
      expect(await keys(millMgr)).toContain(`purchase_requirement:${pr.id}`);
      expect(await keys(preparer)).not.toContain(`purchase_requirement:${pr.id}`);
    });

    it('maker-checker: the preparer of a payroll run does not see it; another approver and the Owner do', async () => {
      expect(await keys(preparer)).not.toContain(`payroll_run:${run.id}`);
      expect(await keys(checker)).toContain(`payroll_run:${run.id}`);
      expect(await keys(owner)).toContain(`payroll_run:${run.id}`);
    });

    it('links only to pages the user can open', async () => {
      const forChecker = (await inbox.getInbox(checker.id)).items.find((i) => i.key === `payroll_run:${run.id}`);
      const forOwner = (await inbox.getInbox(owner.id)).items.find((i) => i.key === `payroll_run:${run.id}`);
      expect(forChecker.link).toBeNull(); // payroll.approve but no finance.view → /finance/* would bounce
      expect(forOwner.link).toBe('/finance/payroll');
    });

    it('a user with no approval rights gets an empty inbox', async () => {
      const res = await inbox.getInbox(auditor.id);
      expect(res).toEqual({ items: [], types: [], count: 0 });
    });

    it('the route returns the same list, count and per-type counts; ?type= filters', async () => {
      const res = await callInbox({ id: owner.id });
      expect(res.statusCode).toBe(200);
      const { items, count, types } = res.body.data;
      expect(count).toBe(items.length);
      expect(types.reduce((s, t) => s + t.count, 0)).toBe(count);
      const only = await callInbox({ id: owner.id }, { type: 'store_adjustment' });
      expect(only.body.data.items.every((i) => i.type === 'store_adjustment')).toBe(true);
      expect(only.body.data.items.map((i) => i.key)).toContain(`store_adjustment:${adj.id}`);
    });

    it('requesting a store adjustment notifies its approvers (the Owner), not the requester', async () => {
      const millStore = require('../modules/millStore/millStore.service');
      const before = await notificationService.getCount(owner.id);
      await millStore.requestAdjustment({ item_id: created.items[0], adjustment_type: 'wastage', quantity_delta: -2, reason: 'spilt' }, millMgr.id);
      expect(await notificationService.getCount(owner.id)).toBe(before + 1);
      const [n] = (await notificationService.getAll(owner.id)).notifications;
      expect(n).toMatchObject({ type: 'approval', title: 'Store adjustment to approve', link: '/approvals?type=store_adjustment' });
      expect(await db('notifications').where({ user_id: millMgr.id, title: 'Store adjustment to approve' })).toHaveLength(0);
    });

    it('chat approvals come from the same inbox (no role ids)', async () => {
      const chat = require('../modules/chat/chat.service');
      const res = await chat.getApprovals(owner.id);
      const store = res.items.find((i) => i.kind === 'store_adjustment');
      expect(store).toBeDefined();
      expect(store.link).toBe('/approvals?type=store_adjustment');
      expect((await chat.getApprovals(auditor.id)).count).toBe(0);
    });
  });
});
