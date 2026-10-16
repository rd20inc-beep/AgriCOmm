const db = require('../../config/database');

// In-app team chat. 1:1 direct messages (recipient_id set) and broadcast
// "Announcements" (recipient_id NULL, is_broadcast). Unread is computed against a
// per-user, per-scope last-read marker in chat_reads ('broadcast' | '<peerId>').

async function lastReadMap(userId) {
  const rows = await db('chat_reads').where('user_id', userId).select('scope', 'last_read_at');
  const map = {};
  for (const r of rows) map[r.scope] = r.last_read_at;
  return map;
}

async function markRead(userId, scope) {
  await db('chat_reads')
    .insert({ user_id: userId, scope: String(scope), last_read_at: db.fn.now() })
    .onConflict(['user_id', 'scope'])
    .merge({ last_read_at: db.fn.now() });
}

// Other active users — the address book for starting a chat.
async function listUsers(meId) {
  return db('users')
    .where('is_active', true).whereNot('id', meId)
    .select('id', 'full_name', 'email')
    .orderBy('full_name');
}

// Conversation summaries: the broadcast channel + every peer the user has a
// thread with, each carrying its last message and unread count.
async function getConversations(meId) {
  const reads = await lastReadMap(meId);

  const preview = (body, name) => (body && body.trim()) ? body : (name ? `📎 ${name}` : '');
  // Broadcast channel.
  const bcLast = await db('chat_messages as m').leftJoin('users as u', 'u.id', 'm.sender_id')
    .where('m.is_broadcast', true).orderBy('m.created_at', 'desc')
    .select('m.body', 'm.attachment_name', 'm.created_at', 'u.full_name as sender_name', 'm.sender_id').first();
  const bcUnreadQ = db('chat_messages').where('is_broadcast', true).whereNot('sender_id', meId);
  if (reads.broadcast) bcUnreadQ.where('created_at', '>', reads.broadcast);
  const bcUnread = parseInt((await bcUnreadQ.count('id as n').first()).n, 10) || 0;

  // 1:1 threads — pull recent direct messages involving me, fold by peer.
  const directs = await db('chat_messages as m')
    .leftJoin('users as su', 'su.id', 'm.sender_id')
    .leftJoin('users as ru', 'ru.id', 'm.recipient_id')
    .where('m.is_broadcast', false)
    .where(function () { this.where('m.sender_id', meId).orWhere('m.recipient_id', meId); })
    .orderBy('m.created_at', 'desc')
    .select('m.id', 'm.sender_id', 'm.recipient_id', 'm.body', 'm.attachment_name', 'm.created_at', 'su.full_name as sender_name', 'ru.full_name as recipient_name')
    .limit(500);

  const peers = new Map();
  for (const m of directs) {
    const peerId = m.sender_id === meId ? m.recipient_id : m.sender_id;
    const peerName = m.sender_id === meId ? m.recipient_name : m.sender_name;
    if (!peers.has(peerId)) {
      peers.set(peerId, { peerId, peerName: peerName || 'User', lastBody: preview(m.body, m.attachment_name), lastAt: m.created_at, fromMe: m.sender_id === meId, unread: 0 });
    }
    // unread = messages TO me from this peer after my last read of that scope.
    const lr = reads[String(peerId)];
    if (m.recipient_id === meId && m.sender_id === peerId && (!lr || new Date(m.created_at) > new Date(lr))) {
      peers.get(peerId).unread += 1;
    }
  }

  return {
    broadcast: { scope: 'broadcast', lastBody: bcLast ? preview(bcLast.body, bcLast.attachment_name) : null, lastAt: bcLast?.created_at || null, lastSender: bcLast?.sender_name || null, unread: bcUnread },
    peers: Array.from(peers.values()).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt)),
  };
}

async function getMessages(meId, { peer, broadcast }) {
  let q = db('chat_messages as m').leftJoin('users as u', 'u.id', 'm.sender_id')
    .select('m.id', 'm.sender_id', 'm.recipient_id', 'm.is_broadcast', 'm.body', 'm.created_at', 'u.full_name as sender_name',
      'm.attachment_name', 'm.attachment_type', 'm.attachment_size')
    .orderBy('m.created_at', 'asc').limit(300);
  if (broadcast) {
    q = q.where('m.is_broadcast', true);
    await markRead(meId, 'broadcast');
  } else {
    const peerId = parseInt(peer, 10);
    q = q.where('m.is_broadcast', false).where(function () {
      this.where(function () { this.where('m.sender_id', meId).andWhere('m.recipient_id', peerId); })
        .orWhere(function () { this.where('m.sender_id', peerId).andWhere('m.recipient_id', meId); });
    });
    await markRead(meId, peerId);
  }
  const rows = await q;
  return rows.map((m) => ({ ...m, mine: m.sender_id === meId, hasAttachment: !!m.attachment_name }));
}

// Announcements reach every user, so posting one is limited (P1-11 / PLT-29) to
// Owner / Super Admin and roles holding admin.manage_users — the roles that
// already manage the whole user base. Reading the channel stays open to all.
async function canBroadcast(userId) {
  const user = await db('users').where({ id: userId }).select('role_id').first();
  if (!user || !user.role_id) return false;
  const role = await db('roles').where({ id: user.role_id }).select('name').first();
  if (role && (role.name === 'Owner' || role.name === 'Super Admin')) return true;
  const grant = await db('role_permissions as rp').join('permissions as p', 'rp.permission_id', 'p.id')
    .where('rp.role_id', user.role_id).where({ 'p.module': 'admin', 'p.action': 'manage_users' })
    .select('p.id').first();
  return !!grant;
}

async function sendMessage(meId, { recipient_id, body, broadcast, attachment }) {
  const text = String(body || '').trim();
  if (!text && !attachment) { const e = new Error('Message cannot be empty.'); e.statusCode = 400; throw e; }
  if (!broadcast && !recipient_id) { const e = new Error('recipient_id is required for a direct message.'); e.statusCode = 400; throw e; }
  if (broadcast && !(await canBroadcast(meId))) {
    // Don't keep an upload for a message that was refused.
    if (attachment?.path) require('fs').promises.unlink(attachment.path).catch(() => {});
    const e = new Error('Only an Owner or an admin who manages users can post announcements.'); e.statusCode = 403; throw e;
  }
  const [row] = await db('chat_messages').insert({
    sender_id: meId,
    recipient_id: broadcast ? null : recipient_id,
    is_broadcast: !!broadcast,
    body: text || null,
    attachment_path: attachment?.path || null,
    attachment_name: attachment?.name || null,
    attachment_type: attachment?.type || null,
    attachment_size: attachment?.size || null,
  }).returning('*');
  // Sending implies you've read up to now in that scope.
  await markRead(meId, broadcast ? 'broadcast' : recipient_id);
  return row;
}

// Resolve a message's attachment for serving — only a participant (sender,
// recipient, or anyone for a broadcast) may download it.
async function getAttachment(messageId, userId) {
  const m = await db('chat_messages').where('id', messageId).first();
  if (!m || !m.attachment_path) { const e = new Error('Attachment not found.'); e.statusCode = 404; throw e; }
  const allowed = m.is_broadcast || m.sender_id === userId || m.recipient_id === userId;
  if (!allowed) { const e = new Error('Not authorized to view this attachment.'); e.statusCode = 403; throw e; }
  return { filePath: m.attachment_path, fileName: m.attachment_name || 'file', mimeType: m.attachment_type || 'application/octet-stream' };
}

async function getUnread(meId) {
  const conv = await getConversations(meId);
  const peerUnread = conv.peers.reduce((s, p) => s + p.unread, 0);
  return { total: peerUnread + conv.broadcast.unread, broadcast: conv.broadcast.unread, direct: peerUnread };
}

// Pending approvals the current user can act on — surfaced in the chat widget.
// The list is the approvals inbox (approvalsInbox.service): every queue, each
// filtered by its approve route's guard, with roles resolved by NAME (the old
// hard-coded role ids differed between installs — PLT-15). Fund transfers stay
// one line each, so they can be accepted inline; every other type is one
// summary line linking to the inbox filtered to that type.
async function getApprovals(meId) {
  const { getInbox } = require('../approvalsInbox/approvalsInbox.service');
  const inbox = await getInbox(meId);
  const items = [];
  const grouped = new Map();
  for (const it of inbox.items) {
    if (it.type === 'fund_transfer') {
      items.push({
        id: `ft-${it.id}`, kind: 'fund_transfer', transferId: it.id,
        title: 'Accept funds', date: it.requestedAt,
        message: `${it.currency === 'PKR' ? 'Rs' : it.currency} ${Math.round(it.amount || 0).toLocaleString()} · ${it.summary} · ${it.ref}`,
      });
    } else {
      if (!grouped.has(it.type)) grouped.set(it.type, { label: it.typeLabel, n: 0 });
      grouped.get(it.type).n += 1;
    }
  }
  for (const [type, { label, n }] of grouped) {
    items.push({
      id: type, kind: type, title: label,
      message: `${n} item(s) awaiting your action.`,
      link: `/approvals?type=${type}`,
    });
  }
  return { items, count: items.length };
}

module.exports = { listUsers, getConversations, getMessages, sendMessage, canBroadcast, getUnread, markRead, getAttachment, getApprovals };
