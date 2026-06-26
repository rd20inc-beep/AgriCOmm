import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, X, Send, ArrowLeft, Megaphone, Search, Paperclip, FileText, Download, Phone, Video, PhoneOff, Mic, MicOff, VideoOff, Smile, Image as ImageIcon, Camera, CheckCircle2, ShieldCheck } from 'lucide-react';
import { chatApi } from '../modules/chat/api';
import { useCalling } from '../modules/chat/useCalling';
import { useAcceptFundTransfer } from '../api/queries';
import { useAuth } from '../context/AuthContext';

const unwrap = (res) => res?.data || res || {};
const EMOJIS = '😀 😁 😂 🤣 😊 😍 😘 😎 🤩 🥳 🤔 😐 😴 😢 😭 😡 🤯 😱 🙄 😅 😉 🙂 🤗 🤝 🙏 👍 👎 👌 ✌️ 🤞 💪 👏 🙌 👋 💯 🔥 ✨ 🎉 ⭐ 💡 ✅ ❌ ⚠️ ❓ ❗ 💰 💵 📈 📉 📊 📦 🚚 🌾 🏭 📝 📌 📅 ⏰ 📞 📧 ❤️ 🎯 🚀'.split(' ');
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso); const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
const initials = (name) => (name || 'U').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// Renders a message's attachment — images inline, other files as a download chip.
function Attachment({ m, mine }) {
  const url = chatApi.attachmentUrl(m.id);
  const isImg = (m.attachment_type || '').startsWith('image/');
  if (isImg) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block mb-1">
        <img src={url} alt={m.attachment_name} className="max-w-full max-h-52 rounded-lg border border-black/10" />
      </a>
    );
  }
  return (
    <a href={url} download={m.attachment_name} target="_blank" rel="noreferrer"
      className={`flex items-center gap-2 mb-1 px-2 py-1.5 rounded-lg ${mine ? 'bg-blue-500/40' : 'bg-gray-100'} max-w-full`}>
      <FileText className="w-4 h-4 flex-shrink-0" />
      <span className="text-xs truncate flex-1">{m.attachment_name}</span>
      <Download className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
    </a>
  );
}

export default function ChatWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const calling = useCalling(user);
  const acceptTransfer = useAcceptFundTransfer();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('list');      // 'list' | 'thread' | 'new'
  const [active, setActive] = useState(null);     // {type:'broadcast'} | {type:'peer', id, name}
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const endRef = useRef(null);
  const fileRef = useRef(null);

  function pickFile(kind) {
    setShowAttach(false);
    const inp = fileRef.current; if (!inp) return;
    if (kind === 'image') { inp.accept = 'image/*'; inp.removeAttribute('capture'); }
    else if (kind === 'camera') { inp.accept = 'image/*'; inp.setAttribute('capture', 'environment'); }
    else { inp.accept = ''; inp.removeAttribute('capture'); }
    inp.value = ''; inp.click();
  }

  // Unread badge — always polling (even when closed) so the dot stays live.
  const { data: unreadData } = useQuery({
    queryKey: ['chat-unread'],
    queryFn: async () => unwrap(await chatApi.unread()),
    refetchInterval: 12000, enabled: !!user,
  });
  const unread = unreadData?.total || 0;

  // Pending approvals the user can act on (fund-transfer acceptances, master-data).
  const { data: approvalsData } = useQuery({
    queryKey: ['chat-approvals'],
    queryFn: async () => unwrap(await chatApi.approvals()),
    refetchInterval: 15000, enabled: !!user,
  });
  const approvals = approvalsData?.items || [];
  const approvalsCount = approvalsData?.count || 0;
  const totalBadge = unread + approvalsCount;

  async function acceptApproval(item) {
    if (item.kind === 'fund_transfer') {
      try {
        await acceptTransfer.mutateAsync(item.transferId);
        qc.invalidateQueries({ queryKey: ['chat-approvals'] });
      } catch (e) { window.alert(e?.response?.data?.message || e?.message || 'Could not accept.'); }
    } else if (item.link) { setOpen(false); navigate(item.link); }
  }

  // Conversations — poll while the panel is open.
  const { data: convData } = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: async () => unwrap(await chatApi.conversations()),
    refetchInterval: open ? 10000 : false, enabled: !!user && open,
  });
  const peers = convData?.peers || [];
  const broadcast = convData?.broadcast || { unread: 0 };

  // All teammates — shown directly in the list so you can start a chat with anyone.
  const { data: usersData } = useQuery({
    queryKey: ['chat-users'],
    queryFn: async () => unwrap(await chatApi.users()),
    enabled: !!user && open,
  });
  const allUsers = usersData?.users || [];

  // Active thread messages — poll while a thread is open.
  const scopeKey = active?.type === 'broadcast' ? 'broadcast' : active?.type === 'peer' ? `peer-${active.id}` : null;
  const { data: msgData } = useQuery({
    queryKey: ['chat-messages', scopeKey],
    queryFn: async () => unwrap(await chatApi.messages(active.type === 'broadcast' ? { broadcast: 1 } : { peer: active.id })),
    refetchInterval: 5000, enabled: !!user && open && view === 'thread' && !!active,
  });
  const messages = msgData?.messages || [];

  // Opening a thread marks it read server-side → refresh badges.
  useEffect(() => {
    if (view === 'thread' && msgData) {
      qc.invalidateQueries({ queryKey: ['chat-unread'] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    }
  }, [msgData, view, qc]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, view]);

  const sendMut = useMutation({
    mutationFn: (payload) => chatApi.send(payload),
    onSuccess: () => {
      setDraft(''); setFile(null); setShowEmoji(false); setShowAttach(false);
      qc.invalidateQueries({ queryKey: ['chat-messages', scopeKey] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
      qc.invalidateQueries({ queryKey: ['chat-unread'] });
    },
  });

  function openThread(target) { setActive(target); setView('thread'); setDraft(''); setFile(null); setShowEmoji(false); setShowAttach(false); }
  function handleSend() {
    const body = draft.trim();
    if ((!body && !file) || !active) return;
    const base = active.type === 'broadcast' ? { broadcast: true } : { recipient_id: active.id };
    sendMut.mutate({ ...base, body, file: file || undefined });
  }

  // Merge every teammate with their conversation preview; people with recent chats
  // float to the top, the rest sort alphabetically — Announcements lives at the end.
  const people = useMemo(() => {
    const byPeer = Object.fromEntries(peers.map((p) => [p.peerId, p]));
    return allUsers
      .map((u) => ({ id: u.id, name: u.full_name, email: u.email, conv: byPeer[u.id] || null }))
      .sort((a, b) => {
        if (a.conv && b.conv) return new Date(b.conv.lastAt) - new Date(a.conv.lastAt);
        if (a.conv) return -1; if (b.conv) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });
  }, [allUsers, peers]);
  const shownPeople = useMemo(() =>
    people.filter((u) => (u.name || '').toLowerCase().includes(userSearch.toLowerCase())),
  [people, userSearch]);

  if (!user) return null;

  const headerTitle = view === 'new' ? 'New message'
    : view === 'approvals' ? 'Approvals'
      : view === 'thread' ? (active?.type === 'broadcast' ? 'Announcements' : active?.name)
        : 'Team Chat';

  return (
    <div className="no-print">
      {/* Floating button */}
      {!open && (
        <button onClick={() => { setOpen(true); setView('list'); }}
          className="fixed bottom-5 right-5 z-[60] w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center transition-colors"
          title="Team chat">
          <MessageCircle className="w-6 h-6" />
          {totalBadge > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-white">
              {totalBadge > 99 ? '99+' : totalBadge}
            </span>
          )}
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-[60] w-[92vw] sm:w-96 h-[520px] max-h-[80vh] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-blue-600 text-white flex items-center gap-2">
            {(view === 'thread' || view === 'new' || view === 'approvals') && (
              <button onClick={() => setView('list')} className="p-1 -ml-1 hover:bg-white/15 rounded"><ArrowLeft className="w-4 h-4" /></button>
            )}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {view === 'thread' && active?.type === 'broadcast' && <Megaphone className="w-4 h-4" />}
              <span className="font-semibold text-sm truncate">{headerTitle}</span>
            </div>
            {view === 'thread' && active?.type === 'peer' && !calling.call && (
              <>
                <button onClick={() => calling.startCall({ id: active.id, name: active.name }, 'audio')} title="Audio call" className="p-1 hover:bg-white/15 rounded"><Phone className="w-4 h-4" /></button>
                <button onClick={() => calling.startCall({ id: active.id, name: active.name }, 'video')} title="Video call" className="p-1 hover:bg-white/15 rounded"><Video className="w-4 h-4" /></button>
              </>
            )}
            <button onClick={() => setOpen(false)} className="p-1 hover:bg-white/15 rounded"><X className="w-4 h-4" /></button>
          </div>

          {/* LIST */}
          {view === 'list' && (
            <div className="flex-1 overflow-y-auto">
              {/* Approvals — pending money acceptances / master-data reviews for you */}
              {approvalsCount > 0 && (
                <button onClick={() => setView('approvals')}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-emerald-50 border-b border-gray-100 text-left bg-emerald-50/50">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0"><ShieldCheck className="w-5 h-5" /></div>
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-sm text-gray-900">Approvals</span>
                    <p className="text-xs text-gray-500 truncate">{approvalsCount} item(s) need your action</p>
                  </div>
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">{approvalsCount}</span>
                </button>
              )}

              {/* Search people */}
              <div className="p-2.5 sticky top-0 bg-white border-b border-gray-100 z-10">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search people…"
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
                </div>
              </div>

              {/* People */}
              {shownPeople.map((u) => (
                <button key={u.id} onClick={() => openThread({ type: 'peer', id: u.id, name: u.name })}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 border-b border-gray-100 text-left">
                  <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 text-xs font-semibold">{initials(u.name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-gray-900 truncate">{u.name}</span>
                      {u.conv && <span className="text-[10px] text-gray-400 flex-shrink-0 ml-1">{fmtTime(u.conv.lastAt)}</span>}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{u.conv ? `${u.conv.fromMe ? 'You: ' : ''}${u.conv.lastBody}` : <span className="text-gray-400">{u.email || 'Tap to start a chat'}</span>}</p>
                  </div>
                  {u.conv?.unread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{u.conv.unread}</span>}
                </button>
              ))}
              {shownPeople.length === 0 && <p className="text-center text-xs text-gray-400 px-4 py-6">No people found.</p>}

              {/* Announcements — broadcast to everyone (kept at the bottom) */}
              <button onClick={() => openThread({ type: 'broadcast' })}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-50/60 border-t border-gray-200 text-left bg-amber-50/30">
                <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0"><Megaphone className="w-5 h-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm text-gray-900">Announcements</span>
                    <span className="text-[10px] text-gray-400">{fmtTime(broadcast.lastAt)}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate">{broadcast.lastBody ? `${broadcast.lastSender ? broadcast.lastSender + ': ' : ''}${broadcast.lastBody}` : 'Send a message to everyone'}</p>
                </div>
                {broadcast.unread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{broadcast.unread}</span>}
              </button>
            </div>
          )}

          {/* APPROVALS */}
          {view === 'approvals' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {approvals.length === 0 && <p className="text-center text-xs text-gray-400 py-8">Nothing awaiting your action 🎉</p>}
              {approvals.map((a) => (
                <div key={a.id} className="bg-white rounded-xl border border-gray-200 p-3">
                  <div className="flex items-start gap-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${a.kind === 'fund_transfer' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>
                      {a.kind === 'fund_transfer' ? <CheckCircle2 className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">{a.title}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{a.message}</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex justify-end">
                    {a.kind === 'fund_transfer' ? (
                      <button onClick={() => acceptApproval(a)} disabled={acceptTransfer.isPending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Accept funds
                      </button>
                    ) : (
                      <button onClick={() => acceptApproval(a)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                        Review →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* THREAD */}
          {view === 'thread' && active && (
            <>
              {active.type === 'broadcast' && (
                <div className="px-3 py-1.5 bg-amber-50 text-amber-700 text-[11px] text-center border-b border-amber-100">Messages here are visible to everyone.</div>
              )}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-1.5 ${m.mine ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'}`}>
                      {!m.mine && (active.type === 'broadcast') && <div className="text-[10px] font-semibold text-blue-600 mb-0.5">{m.sender_name}</div>}
                      {m.hasAttachment && <Attachment m={m} mine={m.mine} />}
                      {m.body && <div className="text-sm whitespace-pre-wrap break-words">{m.body}</div>}
                      <div className={`text-[9px] mt-0.5 text-right ${m.mine ? 'text-blue-100' : 'text-gray-400'}`}>{fmtTime(m.created_at)}</div>
                    </div>
                  </div>
                ))}
                {messages.length === 0 && <p className="text-center text-xs text-gray-400 py-6">No messages yet — say hello.</p>}
                <div ref={endRef} />
              </div>
              <div className="border-t border-gray-100">
                {file && (
                  <div className="px-2.5 pt-2 flex items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 max-w-[80%] px-2 py-1 rounded bg-blue-50 text-blue-700 truncate">
                      <Paperclip className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{file.name}</span>
                    </span>
                    <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }} className="text-gray-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
                {/* Emoji picker */}
                {showEmoji && (
                  <div className="px-2 pb-1 max-h-28 overflow-y-auto grid grid-cols-8 gap-0.5 border-t border-gray-100 pt-1.5">
                    {EMOJIS.map((e) => (
                      <button key={e} onClick={() => setDraft((d) => d + e)} className="text-lg hover:bg-gray-100 rounded leading-none py-1">{e}</button>
                    ))}
                  </div>
                )}
                <div className="p-2.5 flex items-end gap-1.5 relative">
                  <input ref={fileRef} type="file" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) { if (f.size > 25 * 1024 * 1024) { window.alert('File too large (max 25MB).'); return; } setFile(f); } }} />

                  {/* Emoji button */}
                  <button onClick={() => { setShowEmoji((v) => !v); setShowAttach(false); }} title="Emoji"
                    className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${showEmoji ? 'border-blue-400 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                    <Smile className="w-4 h-4" />
                  </button>

                  {/* Attach with options menu */}
                  <div className="relative flex-shrink-0">
                    <button onClick={() => { setShowAttach((v) => !v); setShowEmoji(false); }} title="Attach"
                      className={`w-9 h-9 rounded-lg border flex items-center justify-center ${showAttach ? 'border-blue-400 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                      <Paperclip className="w-4 h-4" />
                    </button>
                    {showAttach && (
                      <div className="absolute bottom-11 left-0 w-44 bg-white rounded-xl shadow-xl border border-gray-200 py-1 z-20">
                        <button onClick={() => pickFile('image')} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><ImageIcon className="w-4 h-4 text-emerald-500" /> Photo / Image</button>
                        <button onClick={() => pickFile('document')} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><FileText className="w-4 h-4 text-blue-500" /> Document</button>
                        <button onClick={() => pickFile('camera')} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Camera className="w-4 h-4 text-violet-500" /> Camera</button>
                      </div>
                    )}
                  </div>

                  <textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder={active.type === 'broadcast' ? 'Announce to everyone…' : 'Type a message…'}
                    className="flex-1 min-w-0 resize-none max-h-24 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
                  <button onClick={handleSend} disabled={(!draft.trim() && !file) || sendMut.isPending}
                    className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 flex-shrink-0">
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}

        </div>
      )}

      <CallOverlay calling={calling} />
    </div>
  );
}

// Ringing / in-call UI — rendered regardless of whether the chat panel is open so
// incoming calls always surface.
function CallOverlay({ calling }) {
  const { call, muted, camOff, acceptCall, declineCall, hangup, toggleMute, toggleCam, localVideoRef, remoteVideoRef, remoteAudioRef } = calling;
  if (!call) return <audio ref={remoteAudioRef} autoPlay className="hidden" />;
  const isVideo = call.kind === 'video';
  const connected = call.status === 'connected';

  // Incoming / outgoing ringing card.
  if (!connected) {
    return (
      <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center" >
        <audio ref={remoteAudioRef} autoPlay className="hidden" />
        <div className="bg-white rounded-2xl shadow-2xl w-80 p-6 text-center">
          <div className="w-20 h-20 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-2xl font-bold mx-auto mb-3">
            {(call.peerName || 'U').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
          </div>
          <div className="text-lg font-semibold text-gray-900">{call.peerName}</div>
          <div className="text-sm text-gray-500 mt-1 flex items-center justify-center gap-1.5">
            {isVideo ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
            {call.status === 'incoming' ? `Incoming ${call.kind} call…` : `Calling…`}
          </div>
          <div className="flex items-center justify-center gap-4 mt-6">
            {call.status === 'incoming' ? (
              <>
                <button onClick={declineCall} className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center"><PhoneOff className="w-6 h-6" /></button>
                <button onClick={acceptCall} className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center">{isVideo ? <Video className="w-6 h-6" /> : <Phone className="w-6 h-6" />}</button>
              </>
            ) : (
              <button onClick={hangup} className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center"><PhoneOff className="w-6 h-6" /></button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Connected in-call view.
  return (
    <div className="fixed inset-0 z-[70] bg-gray-900 flex flex-col">
      <audio ref={remoteAudioRef} autoPlay className="hidden" />
      <div className="flex-1 relative flex items-center justify-center">
        {isVideo ? (
          <>
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain bg-black" />
            <video ref={localVideoRef} autoPlay playsInline muted className="absolute bottom-4 right-4 w-32 h-24 object-cover rounded-lg border-2 border-white/40 bg-black" />
          </>
        ) : (
          <div className="text-center text-white">
            <div className="w-28 h-28 rounded-full bg-white/10 flex items-center justify-center text-4xl font-bold mx-auto mb-4">
              {(call.peerName || 'U').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div className="text-xl font-semibold">{call.peerName}</div>
            <div className="text-sm text-white/60 mt-1">Voice call · connected</div>
          </div>
        )}
        <div className="absolute top-4 left-4 text-white/80 text-sm font-medium">{call.peerName}</div>
      </div>
      <div className="py-5 flex items-center justify-center gap-5 bg-black/30">
        <button onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'} className={`w-12 h-12 rounded-full flex items-center justify-center ${muted ? 'bg-white text-gray-900' : 'bg-white/15 text-white hover:bg-white/25'}`}>
          {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>
        {isVideo && (
          <button onClick={toggleCam} title={camOff ? 'Camera on' : 'Camera off'} className={`w-12 h-12 rounded-full flex items-center justify-center ${camOff ? 'bg-white text-gray-900' : 'bg-white/15 text-white hover:bg-white/25'}`}>
            {camOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
          </button>
        )}
        <button onClick={hangup} title="Hang up" className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center"><PhoneOff className="w-6 h-6" /></button>
      </div>
    </div>
  );
}
