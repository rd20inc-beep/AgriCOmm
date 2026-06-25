import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, X, Send, ArrowLeft, Megaphone, Plus, Search, Paperclip, FileText, Download, Phone, Video, PhoneOff, Mic, MicOff, VideoOff } from 'lucide-react';
import { chatApi } from '../modules/chat/api';
import { useCalling } from '../modules/chat/useCalling';
import { useAuth } from '../context/AuthContext';

const unwrap = (res) => res?.data || res || {};
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
  const qc = useQueryClient();
  const calling = useCalling(user);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('list');      // 'list' | 'thread' | 'new'
  const [active, setActive] = useState(null);     // {type:'broadcast'} | {type:'peer', id, name}
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState(null);
  const [userSearch, setUserSearch] = useState('');
  const endRef = useRef(null);
  const fileRef = useRef(null);

  // Unread badge — always polling (even when closed) so the dot stays live.
  const { data: unreadData } = useQuery({
    queryKey: ['chat-unread'],
    queryFn: async () => unwrap(await chatApi.unread()),
    refetchInterval: 12000, enabled: !!user,
  });
  const unread = unreadData?.total || 0;

  // Conversations — poll while the panel is open.
  const { data: convData } = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: async () => unwrap(await chatApi.conversations()),
    refetchInterval: open ? 10000 : false, enabled: !!user && open,
  });
  const peers = convData?.peers || [];
  const broadcast = convData?.broadcast || { unread: 0 };

  // Address book for starting a new chat.
  const { data: usersData } = useQuery({
    queryKey: ['chat-users'],
    queryFn: async () => unwrap(await chatApi.users()),
    enabled: !!user && open && view === 'new',
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
      setDraft(''); setFile(null);
      qc.invalidateQueries({ queryKey: ['chat-messages', scopeKey] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
      qc.invalidateQueries({ queryKey: ['chat-unread'] });
    },
  });

  function openThread(target) { setActive(target); setView('thread'); setDraft(''); setFile(null); }
  function handleSend() {
    const body = draft.trim();
    if ((!body && !file) || !active) return;
    const base = active.type === 'broadcast' ? { broadcast: true } : { recipient_id: active.id };
    sendMut.mutate({ ...base, body, file: file || undefined });
  }

  const filteredUsers = useMemo(() =>
    allUsers.filter((u) => (u.full_name || '').toLowerCase().includes(userSearch.toLowerCase())),
  [allUsers, userSearch]);

  if (!user) return null;

  const headerTitle = view === 'new' ? 'New message'
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
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-[60] w-[92vw] sm:w-96 h-[520px] max-h-[80vh] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-blue-600 text-white flex items-center gap-2">
            {(view === 'thread' || view === 'new') && (
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
              <button onClick={() => openThread({ type: 'broadcast' })}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 border-b border-gray-100 text-left">
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

              {peers.map((p) => (
                <button key={p.peerId} onClick={() => openThread({ type: 'peer', id: p.peerId, name: p.peerName })}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 border-b border-gray-100 text-left">
                  <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 text-xs font-semibold">{initials(p.peerName)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-gray-900 truncate">{p.peerName}</span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0 ml-1">{fmtTime(p.lastAt)}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">{p.fromMe ? 'You: ' : ''}{p.lastBody}</p>
                  </div>
                  {p.unread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{p.unread}</span>}
                </button>
              ))}

              {peers.length === 0 && (
                <p className="text-center text-xs text-gray-400 px-4 py-6">No conversations yet. Start one with <span className="font-medium">New message</span>.</p>
              )}
            </div>
          )}

          {/* NEW chat — pick a person */}
          {view === 'new' && (
            <div className="flex-1 overflow-y-auto">
              <div className="p-3 sticky top-0 bg-white border-b border-gray-100">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input autoFocus value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search people…"
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
                </div>
              </div>
              {filteredUsers.map((u) => (
                <button key={u.id} onClick={() => openThread({ type: 'peer', id: u.id, name: u.full_name })}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left">
                  <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-semibold">{initials(u.full_name)}</div>
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900 truncate">{u.full_name}</div>
                    <div className="text-[11px] text-gray-400 truncate">{u.email}</div>
                  </div>
                </button>
              ))}
              {filteredUsers.length === 0 && <p className="text-center text-xs text-gray-400 py-6">No people found.</p>}
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
                <div className="p-2.5 flex items-end gap-2">
                  <input ref={fileRef} type="file" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) { if (f.size > 25 * 1024 * 1024) { window.alert('File too large (max 25MB).'); return; } setFile(f); } }} />
                  <button onClick={() => fileRef.current?.click()} title="Attach a file"
                    className="w-9 h-9 rounded-lg border border-gray-200 text-gray-500 flex items-center justify-center hover:bg-gray-50 flex-shrink-0">
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder={active.type === 'broadcast' ? 'Announce to everyone…' : 'Type a message…'}
                    className="flex-1 resize-none max-h-24 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
                  <button onClick={handleSend} disabled={(!draft.trim() && !file) || sendMut.isPending}
                    className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 flex-shrink-0">
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Footer action (list view) */}
          {view === 'list' && (
            <button onClick={() => { setView('new'); setUserSearch(''); }}
              className="m-3 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
              <Plus className="w-4 h-4" /> New message
            </button>
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
