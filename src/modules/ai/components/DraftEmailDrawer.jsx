import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Mail, Copy, Loader2, Sparkles, ExternalLink } from 'lucide-react';
import api from '../../../api/client';
import SlideDrawer from '../../../components/SlideDrawer';

const copy = (t) => navigator.clipboard?.writeText(t);

// Reusable "Draft Email (AI)" drawer for a fixed customer/supplier — used on the
// party statement pages. Drafts from the party's ledger via POST /api/ai/draft.
export default function DraftEmailDrawer({ partyType, partyId, partyName, onClose }) {
  const [kind, setKind] = useState('statement');
  const [instructions, setInstructions] = useState('');
  const { data: status } = useQuery({ queryKey: ['ai-status'], queryFn: async () => (await api.get('/api/ai/status'))?.data });
  const enabled = status?.enabled;
  const mut = useMutation({ mutationFn: (body) => api.post('/api/ai/draft', body) });
  const res = mut.data?.data;
  const generate = () => mut.mutate({ party_type: partyType, party_id: partyId, kind, instructions });
  const mailto = res?.subject
    ? `mailto:${res.to || ''}?subject=${encodeURIComponent(res.subject)}&body=${encodeURIComponent(res.body || '')}`
    : null;

  return (
    <SlideDrawer
      open
      onClose={onClose}
      title="Draft Email"
      subtitle={`${partyName || partyType} · AI-written from the ledger`}
      icon={Sparkles}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          {res?.subject
            ? <a href={mailto} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-blue-700 hover:underline"><ExternalLink className="w-4 h-4" /> Open in email app</a>
            : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Close</button>
            <button onClick={generate} disabled={!enabled || mut.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:opacity-40">
              {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} {res?.subject ? 'Regenerate' : 'Draft Email'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {status && !enabled && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            AI is off. Add <code className="px-1 bg-amber-100 rounded">OPENAI_API_KEY</code> to the server and restart the backend to enable drafting.
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Email type</label>
          <div className="grid grid-cols-3 gap-2">
            {[['statement', 'Statement'], ['reminder', 'Reminder'], ['thankyou', 'Thank-you']].map(([val, lbl]) => (
              <button key={val} onClick={() => setKind(val)} className={`px-3 py-2 rounded-lg border text-sm ${kind === val ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'}`}>{lbl}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Extra instructions (optional)</label>
          <input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. mention the cheque clearing next week"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
        </div>

        {mut.isError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{mut.error?.message}</div>}
        {res?.aiEnabled === false && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{res.message}</div>}

        {res?.subject && (
          <div className="space-y-3 pt-1">
            <div className="text-xs text-gray-500">To: {res.party}{res.to ? ` <${res.to}>` : ' · no email on file'}</div>
            <div className="flex items-center gap-2">
              <input readOnly value={res.subject} className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium bg-gray-50" />
              <button onClick={() => copy(res.subject)} title="Copy subject" className="p-2 text-gray-400 hover:text-gray-700"><Copy className="w-4 h-4" /></button>
            </div>
            <div className="relative">
              <textarea readOnly value={res.body} rows={14} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 whitespace-pre-wrap" />
              <button onClick={() => copy(`Subject: ${res.subject}\n\n${res.body}`)} className="absolute top-2 right-2 inline-flex items-center gap-1 text-[11px] text-blue-700 bg-white border border-gray-200 rounded px-1.5 py-0.5 hover:bg-blue-50"><Copy className="w-3 h-3" /> Copy</button>
            </div>
          </div>
        )}
      </div>
    </SlideDrawer>
  );
}
