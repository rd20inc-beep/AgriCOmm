import { useState, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import Modal from './Modal';

// Web-friendly confirm dialog for sending a document over WhatsApp — replaces
// the browser's native window.prompt. Prefills the party's number on file and
// lets the user edit it before sending. Shared by every "Send on WhatsApp" flow
// (transaction invoices/receipts/vouchers + export documents).
export default function WhatsAppSendModal({
  isOpen,
  onClose,
  onConfirm,            // (digits) => Promise|void  — parent performs the send
  sending = false,
  docTitle = 'document',
  partyName,
  partyLabel = 'To',
  defaultNumber = '',
}) {
  const [number, setNumber] = useState(defaultNumber);

  // Reset the field to the number on file each time the dialog is opened.
  useEffect(() => { if (isOpen) setNumber(defaultNumber || ''); }, [isOpen, defaultNumber]);

  const digits = String(number || '').replace(/[^\d]/g, '');
  const valid = digits.length >= 8;

  const submit = () => { if (valid && !sending) onConfirm(digits); };

  return (
    <Modal
      isOpen={isOpen}
      onClose={sending ? () => {} : onClose}
      title="Send on WhatsApp"
      size="sm"
      footer={(
        <>
          <button
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!valid || sending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {sending ? 'Sending…' : 'Send'}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Send <span className="font-semibold text-gray-900">{docTitle}</span>
          {partyName ? <> to <span className="font-semibold text-gray-900">{partyName}</span></> : null} as a PDF, with the details in the message.
        </p>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {partyLabel} — WhatsApp number
          </label>
          <div className="flex items-center rounded-lg border border-gray-300 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 overflow-hidden">
            <span className="px-3 py-2 text-sm text-gray-400 bg-gray-50 border-r border-gray-200 select-none">+</span>
            <input
              type="tel"
              autoFocus
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="923001234567"
              className="flex-1 px-3 py-2 text-sm outline-none"
            />
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            Include the country code (e.g. 92 for Pakistan). {defaultNumber ? 'Prefilled from the record — edit if needed.' : 'No number was on file.'}
          </p>
          {!valid && digits.length > 0 && (
            <p className="mt-1 text-xs text-red-500">That number looks too short — check the country code.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
