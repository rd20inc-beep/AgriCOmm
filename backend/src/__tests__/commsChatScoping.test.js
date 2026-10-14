/**
 * P1-11 — per-user communications endpoints act only on the caller's own rows,
 * and chat announcements need Owner / Super Admin / admin.manage_users.
 * Executes the real controller, notification service and chat service against
 * an in-memory database with a second user.
 */
jest.mock('../config/database', () => require('./helpers/rbacMemoryDb').db);

const rdb = require('./helpers/rbacMemoryDb');
const controller = require('../modules/communications/communications.controller');
const chat = require('../modules/chat/chat.service');

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const call = async (fn, user, params = {}, body = {}) => {
  const r = res();
  await controller[fn]({ user, params, body, query: {} }, r);
  return r;
};

// Role ids === user ids: 1 Owner, 2 Super Admin, 3 HR admin (manage_users), 4 Clerk, 5 Clerk B
beforeEach(() => rdb.reset({
  roles: { Owner: [], 'Super Admin': [], 'HR Admin': ['admin.manage_users'], Clerk: ['reports.view'], 'Clerk B': ['reports.view'] },
  tables: {
    notifications: [{ id: 1, user_id: 4, title: 'mine', is_read: false }],
    tasks_assignments: [{ id: 10, task_no: 'T-1', title: 'Count stock', assigned_to: 4, assigned_by: 1, status: 'Open' }],
    follow_ups: [{ id: 20, user_id: 4, status: 'Pending' }],
    chat_messages: [],
    chat_reads: [],
  },
}));

describe('notifications', () => {
  it('another user cannot mark my notification read', async () => {
    const r = await call('markNotificationRead', { id: 5 }, { id: '1' });
    expect(r.statusCode).toBe(404);
    expect(rdb.state.tables.notifications[0].is_read).toBe(false);
  });
  it('the owner can', async () => {
    const r = await call('markNotificationRead', { id: 4 }, { id: '1' });
    expect(r.statusCode).toBe(200);
    expect(rdb.state.tables.notifications[0].is_read).toBe(true);
  });
});

describe('tasks', () => {
  it('a stranger cannot update or complete a task', async () => {
    expect((await call('updateTask', { id: 5 }, { id: '10' }, { title: 'pwned' })).statusCode).toBe(404);
    expect((await call('completeTask', { id: 5 }, { id: '10' })).statusCode).toBe(404);
    expect(rdb.state.tables.tasks_assignments[0]).toMatchObject({ title: 'Count stock', status: 'Open' });
  });

  it('the assignee may change progress only — not the title or who assigned it', async () => {
    const r = await call('updateTask', { id: 4 }, { id: '10' }, { status: 'In Progress', title: 'x', assigned_by: 4, assigned_to: 5 });
    expect(r.statusCode).toBe(200);
    expect(rdb.state.tables.tasks_assignments[0]).toMatchObject({ status: 'In Progress', title: 'Count stock', assigned_by: 1, assigned_to: 4 });
  });

  it('the assigner may edit the task but never its id / task_no / assigned_by', async () => {
    const r = await call('updateTask', { id: 1 }, { id: '10' }, { title: 'Count bags', id: 99, task_no: 'X', assigned_by: 5 });
    expect(r.statusCode).toBe(200);
    expect(rdb.state.tables.tasks_assignments[0]).toMatchObject({ id: 10, task_no: 'T-1', title: 'Count bags', assigned_by: 1 });
  });

  it('the assignee may complete it', async () => {
    expect((await call('completeTask', { id: 4 }, { id: '10' })).statusCode).toBe(200);
  });
});

describe('follow-ups', () => {
  it('only the owner can mark one done', async () => {
    expect((await call('markFollowUpDone', { id: 5 }, { id: '20' })).statusCode).toBe(404);
    expect((await call('markFollowUpDone', { id: 4 }, { id: '20' })).statusCode).toBe(200);
  });
});

describe('chat announcements', () => {
  it.each([[1, true], [2, true], [3, true], [4, false]])('user %i may broadcast: %s', async (id, ok) => {
    expect(await chat.canBroadcast(id)).toBe(ok);
  });

  it('a regular user is refused with 403 and nothing is stored', async () => {
    await expect(chat.sendMessage(4, { body: 'hello all', broadcast: true })).rejects.toMatchObject({ statusCode: 403 });
    expect(rdb.state.tables.chat_messages).toHaveLength(0);
  });

  it('direct messages are unaffected', async () => {
    const m = await chat.sendMessage(4, { body: 'hi', recipient_id: 5, broadcast: false });
    expect(m.recipient_id).toBe(5);
  });
});
