import { useState, useEffect } from 'react';
import { Mail, Send, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { communicationApi } from '../modules/communications/api/services';
import { sendComposedEmail } from './emailComposerSend';

// Plain-text email (no attachment) sent through POST /api/communication/email/send.
// It used to toast "Email sent" and close without calling anything, so every
// reminder sent from it went nowhere. Success is now only reported when the
// server answers 2xx with the mail actually handed to SMTP; the server's own
// message is shown otherwise. Documents (the Proforma) are sent from the
// Document Center, which renders and attaches the PDF.
export default function EmailComposer({
  isOpen,
  onClose,
  defaultTo = '',
  defaultSubject = '',
  defaultBody = '',
  linkedType = null,
  linkedId = null,
}) {
  const { addToast, emailSettings } = useApp();

  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [sending, setSending] = useState(false);

  // Reset fields whenever the composer opens or its defaults change.
  useEffect(() => {
    if (!isOpen) return;
    setTo(defaultTo);
    setCc('');
    setSubject(defaultSubject);
    setBody(defaultBody);
  }, [isOpen, defaultTo, defaultSubject, defaultBody]);

  if (!isOpen) return null;

  const senderEmail = emailSettings?.senderEmail || 'noreply@agririce.com';
  const senderName = emailSettings?.senderName || 'AGRI COMMODITIES';

  const handleSend = async () => {
    if (sending) return;
    if (!to.trim()) {
      addToast('Please enter a recipient email', 'error');
      return;
    }
    if (!subject.trim()) {
      addToast('Please enter a subject', 'error');
      return;
    }
    setSending(true);
    try {
      const outcome = await sendComposedEmail(communicationApi.sendEmail, { to, cc, subject, body, linkedType, linkedId });
      if (outcome === 'queued') {
        addToast('You are offline — the email is queued and will send when the connection returns.', 'info');
      } else {
        addToast(`Email sent to ${to.trim()}`, 'success');
      }
      onClose();
    } catch (err) {
      addToast(err?.message || 'Email send failed', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={sending ? undefined : onClose}
      />

      {/* Modal card */}
      <div className="relative w-full max-w-2xl mx-4 bg-white rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Title bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-600" />
            Compose Email
          </h2>
          <button
            onClick={onClose}
            disabled={sending}
            aria-label="Close"
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* From */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
            <div className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
              {senderName} &lt;{senderEmail}&gt;
            </div>
          </div>

          {/* To */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* CC */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CC <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="cc@example.com"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject..."
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Write your message..."
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={sending}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {sending ? 'Sending…' : 'Send Email'}
          </button>
        </div>
      </div>
    </div>
  );
}
