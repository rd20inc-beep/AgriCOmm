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

  // Broadcast channel.
  const bcLast = await db('chat_messages as m').leftJoin('users as u', 'u.id', 'm.sender_id')
    .where('m.is_broadcast', true).orderBy('m.created_at', 'desc')
    .select('m.body', 'm.created_at', 'u.full_name as sender_name', 'm.sender_id').first();
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
    .select('m.id', 'm.sender_id', 'm.recipient_id', 'm.body', 'm.created_at', 'su.full_name as sender_name', 'ru.full_name as recipient_name')
    .limit(500);

  const peers = new Map();
  for (const m of directs) {
    const peerId = m.sender_id === meId ? m.recipient_id : m.sender_id;
    const peerName = m.sender_id === meId ? m.recipient_name : m.sender_name;
    if (!peers.has(peerId)) {
      peers.set(peerId, { peerId, peerName: peerName || 'User', lastBody: m.body, lastAt: m.created_at, fromMe: m.sender_id === meId, unread: 0 });
    }
    // unread = messages TO me from this peer after my last read of that scope.
    const lr = reads[String(peerId)];
    if (m.recipient_id === meId && m.sender_id === peerId && (!lr || new Date(m.created_at) > new Date(lr))) {
      peers.get(peerId).unread += 1;
    }
  }

  return {
    broadcast: { scope: 'broadcast', lastBody: bcLast?.body || null, lastAt: bcLast?.created_at || null, lastSender: bcLast?.sender_name || null, unread: bcUnread },
    peers: Array.from(peers.values()).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt)),
  };
}

async function getMessages(meId, { peer, broadcast }) {
  let q = db('chat_messages as m').leftJoin('users as u', 'u.id', 'm.sender_id')
    .select('m.id', 'm.sender_id', 'm.recipient_id', 'm.is_broadcast', 'm.body', 'm.created_at', 'u.full_name as sender_name')
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
  return rows.map((m) => ({ ...m, mine: m.sender_id === meId }));
}

async function sendMessage(meId, { recipient_id, body, broadcast }) {
  const text = String(body || '').trim();
  if (!text) { const e = new Error('Message cannot be empty.'); e.statusCode = 400; throw e; }
  if (!broadcast && !recipient_id) { const e = new Error('recipient_id is required for a direct message.'); e.statusCode = 400; throw e; }
  const [row] = await db('chat_messages').insert({
    sender_id: meId,
    recipient_id: broadcast ? null : recipient_id,
    is_broadcast: !!broadcast,
    body: text,
  }).returning('*');
  // Sending implies you've read up to now in that scope.
  await markRead(meId, broadcast ? 'broadcast' : recipient_id);
  return row;
}

async function getUnread(meId) {
  const conv = await getConversations(meId);
  const peerUnread = conv.peers.reduce((s, p) => s + p.unread, 0);
  return { total: peerUnread + conv.broadcast.unread, broadcast: conv.broadcast.unread, direct: peerUnread };
}

module.exports = { listUsers, getConversations, getMessages, sendMessage, getUnread, markRead };
