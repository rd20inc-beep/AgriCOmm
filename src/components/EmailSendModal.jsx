import { useState, useEffect } from 'react';
import { Mail, Loader2 } from 'lucide-react';
import Modal from './Modal';

// Web-friendly confirm dialog for emailing a document. Prefills the customer's
// email on file (editable) plus an editable subject, then sends the PDF as an
// attachment from the system. Mirrors WhatsAppSendModal.
export default function EmailSendModal({
  isOpen,
  onClose,
  onConfirm,            // ({ email, subject }) => Promise|void  — parent performs the send
  sending = false,
  docTitle = 'document',
  partyName,
  defaultEmail = '',
  defaultSubject = '',
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [subject, setSubject] = useState(defaultSubject);

  useEffect(() => { if (isOpen) { setEmail(defaultEmail || ''); setSubject(defaultSubject || ''); } }, [isOpen, defaultEmail, defaultSubject]);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  const submit = () => { if (valid && !sending) onConfirm({ email: String(email).trim(), subject: String(subject).trim() }); };

  return (
    <Modal
      isOpen={isOpen}
      onClose={sending ? () => {} : onClose}
      title="Email document"
      size="sm"
      footer={(
        <>
          <button onClick={onClose} disabled={sending}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={!valid || sending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
            {sending ? 'Sending…' : 'Send'}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Email <span className="font-semibold text-gray-900">{docTitle}</span>
          {partyName ? <> to <span className="font-semibold text-gray-900">{partyName}</span></> : null} as a PDF attachment.
        </p>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To — email address</label>
          <input
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="customer@example.com"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1.5 text-xs text-gray-400">
            {defaultEmail ? 'Prefilled from the customer record — edit if needed.' : 'No email was on file for this customer.'}
          </p>
          {!valid && String(email || '').trim().length > 0 && (
            <p className="mt-1 text-xs text-red-500">That doesn't look like a valid email address.</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={docTitle}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>
    </Modal>
  );
}
