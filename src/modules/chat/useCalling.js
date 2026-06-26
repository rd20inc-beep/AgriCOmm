import { useState, useRef, useEffect, useCallback } from 'react';
import { chatApi } from './api';
import { ensureNotifyPermission, showNotify } from './notify';

// 1:1 WebRTC audio/video calling. Signaling rides the per-user SSE channel
// (/api/streams/call-signals) for inbound and POST /api/chat/signal for outbound.
// Connectivity uses STUN + a TURN relay (fetched from /api/chat/ice-config —
// ephemeral coturn credentials). TURN is what lets calls connect across
// mobile/symmetric NATs where STUN alone fails. Falls back to public STUN if the
// config can't be fetched.
const ICE_FALLBACK = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

export function useCalling(user) {
  // call: { peerId, peerName, kind: 'audio'|'video', status: 'outgoing'|'incoming'|'connected' }
  const [call, setCall] = useState(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [, setTick] = useState(0); // force re-attach of media when streams change

  const iceRef = useRef(ICE_FALLBACK);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingIce = useRef([]);
  const offerRef = useRef(null);
  const callRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const ringTimerRef = useRef(null);

  useEffect(() => { callRef.current = call; }, [call]);

  // A realistic telephone ring: a "brrr-brrr" double burst of the classic 440+480 Hz
  // ringback pair (the two close tones beat to give the warbling phone-ring sound).
  const ringOnce = useCallback(() => {
    const ctx = audioCtxRef.current; if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const burst = (start, dur) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(0.22, start + 0.04);
      g.gain.setValueAtTime(0.22, start + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      g.connect(ctx.destination);
      [440, 480].forEach((f) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        o.connect(g); o.start(start); o.stop(start + dur);
      });
    };
    burst(now, 0.4);
    burst(now + 0.6, 0.4);
  }, []);

  // Create the AudioContext once and unlock it (+ ask for notification permission)
  // on the first user gesture — browsers block audio and gate Notification prompts
  // until the page has been interacted with.
  useEffect(() => {
    try { audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* noop */ }
    const unlock = () => { audioCtxRef.current?.resume().catch(() => {}); ensureNotifyPermission(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);

  // Fetch the ICE config (STUN + TURN with ephemeral creds) once, so calls can
  // relay across restrictive NATs. Keeps the STUN-only fallback if it fails.
  useEffect(() => {
    let alive = true;
    chatApi.iceConfig()
      .then((res) => { const cfg = res?.data?.iceServers || res?.iceServers; if (alive && Array.isArray(cfg) && cfg.length) iceRef.current = { iceServers: cfg }; })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Ring while a call is being set up (incoming for the callee, ringback for the caller).
  useEffect(() => {
    const ringing = call && (call.status === 'incoming' || call.status === 'outgoing');
    if (ringing) {
      ringOnce();
      ringTimerRef.current = setInterval(ringOnce, 3000);
      // OS notification for incoming calls (desktop + mobile via the service worker).
      if (call.status === 'incoming') {
        showNotify(`Incoming ${call.kind} call`, {
          body: `${call.peerName} is calling…`, tag: 'rf-call', renotify: true,
          requireInteraction: true, icon: '/logo.png', vibrate: [400, 200, 400],
        });
      }
    }
    return () => { if (ringTimerRef.current) { clearInterval(ringTimerRef.current); ringTimerRef.current = null; } };
  }, [call?.status, ringOnce]); // eslint-disable-line react-hooks/exhaustive-deps

  const signal = useCallback((to, type, payload, kind) => {
    chatApi.signal({ to, type, payload, kind }).catch(() => {});
  }, []);

  const cleanup = useCallback(() => {
    if (pcRef.current) { try { pcRef.current.close(); } catch { /* noop */ } pcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null; }
    remoteStreamRef.current = null; offerRef.current = null; pendingIce.current = [];
    setMuted(false); setCamOff(false); setCall(null);
  }, []);

  function makePc(peerId) {
    const pc = new RTCPeerConnection(iceRef.current);
    pc.onicecandidate = (e) => { if (e.candidate) signal(peerId, 'ice', e.candidate); };
    pc.ontrack = (e) => { remoteStreamRef.current = e.streams[0]; setTick((t) => t + 1); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) { /* leave teardown to hangup */ }
    };
    pcRef.current = pc;
    return pc;
  }
  const getMedia = (kind) => navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });

  const startCall = useCallback(async (peer, kind) => {
    if (callRef.current) return;
    try {
      const stream = await getMedia(kind); localStreamRef.current = stream;
      const pc = makePc(peer.id);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      setCall({ peerId: peer.id, peerName: peer.name, kind, status: 'outgoing' });
      signal(peer.id, 'offer', offer, kind);
    } catch (e) { cleanup(); window.alert('Could not start the call (mic/camera): ' + e.message); }
  }, [signal, cleanup]);

  const acceptCall = useCallback(async () => {
    const c = callRef.current; if (!c || !offerRef.current) return;
    try {
      const stream = await getMedia(c.kind); localStreamRef.current = stream;
      const pc = makePc(c.peerId);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(offerRef.current));
      for (const cand of pendingIce.current) { try { await pc.addIceCandidate(cand); } catch { /* noop */ } }
      pendingIce.current = [];
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      setCall({ ...c, status: 'connected' });
      signal(c.peerId, 'answer', answer);
    } catch (e) { cleanup(); window.alert('Could not join the call (mic/camera): ' + e.message); }
  }, [signal, cleanup]);

  const declineCall = useCallback(() => { const c = callRef.current; if (c) signal(c.peerId, 'decline'); cleanup(); }, [signal, cleanup]);
  const hangup = useCallback(() => { const c = callRef.current; if (c) signal(c.peerId, c.status === 'outgoing' ? 'cancel' : 'hangup'); cleanup(); }, [signal, cleanup]);

  const toggleMute = useCallback(() => {
    const s = localStreamRef.current; if (!s) return;
    const on = !muted; s.getAudioTracks().forEach((t) => { t.enabled = !on; }); setMuted(on);
  }, [muted]);
  const toggleCam = useCallback(() => {
    const s = localStreamRef.current; if (!s) return;
    const off = !camOff; s.getVideoTracks().forEach((t) => { t.enabled = !off; }); setCamOff(off);
  }, [camOff]);

  // Inbound signaling over SSE.
  useEffect(() => {
    if (!user) return undefined;
    const es = new EventSource(chatApi.callStreamUrl());
    es.onmessage = async (ev) => {
      let sig; try { sig = JSON.parse(ev.data); } catch { return; }
      if (!sig || !sig.type) return;
      const c = callRef.current;
      if (sig.type === 'offer') {
        if (c) { signal(sig.from, 'busy'); return; }
        offerRef.current = sig.payload;
        setCall({ peerId: sig.from, peerName: sig.fromName, kind: sig.kind || 'audio', status: 'incoming' });
      } else if (sig.type === 'answer') {
        if (pcRef.current) {
          try { await pcRef.current.setRemoteDescription(new RTCSessionDescription(sig.payload)); } catch { /* noop */ }
          for (const cand of pendingIce.current) { try { await pcRef.current.addIceCandidate(cand); } catch { /* noop */ } }
          pendingIce.current = [];
          setCall((prev) => (prev ? { ...prev, status: 'connected' } : prev));
        }
      } else if (sig.type === 'ice') {
        const cand = sig.payload; if (!cand) return;
        if (pcRef.current && pcRef.current.remoteDescription) { try { await pcRef.current.addIceCandidate(cand); } catch { /* noop */ } }
        else pendingIce.current.push(cand);
      } else if (['decline', 'busy', 'hangup', 'cancel'].includes(sig.type)) {
        cleanup();
      }
    };
    es.onerror = () => { /* EventSource auto-reconnects */ };
    return () => es.close();
  }, [user?.id, signal, cleanup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Attach media streams to their elements whenever the call UI (re)renders.
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    if (remoteVideoRef.current && remoteStreamRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;
    if (remoteAudioRef.current && remoteStreamRef.current) remoteAudioRef.current.srcObject = remoteStreamRef.current;
  });

  return {
    call, muted, camOff,
    startCall, acceptCall, declineCall, hangup, toggleMute, toggleCam,
    localVideoRef, remoteVideoRef, remoteAudioRef,
  };
}
