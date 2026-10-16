import { useEffect, useState } from 'react';
import { Mail, Loader2 } from 'lucide-react';
import api from '../../../../api/client';
import { CUSTOMER_EMAIL_EVENTS } from './customerEmailEvents';

// Automatic CUSTOMER emails — opt-in per event (P5-12 / PLT-14); the event
// list lives in customerEmailEvents.js.

export default function CustomerEmailSettings({ addToast }) {
  const [events, setEvents] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    api.get('/api/admin/settings')
      .then((res) => {
        const s = res?.data?.settings || res?.settings || {};
        const v = s.customer_email_events;
        if (live) setEvents(v && typeof v === 'object' ? v : {});
      })
      .catch(() => {})
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = Object.fromEntries(CUSTOMER_EMAIL_EVENTS.map((e) => [e.key, events[e.key] === true]));
      await api.put('/api/admin/settings', { customer_email_events: payload });
      addToast?.('Customer email settings saved', 'success');
    } catch (err) {
      addToast?.(err?.message || 'Could not save customer email settings', 'error');
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
        <Mail className="w-5 h-5 text-gray-400" /> Automatic customer emails
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Off by default. When an event is switched on, the buyer is emailed automatically once the change has been saved
        (never for a change that was rolled back). Staff notifications are not affected.
      </p>
      {!loaded ? (
        <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
      ) : (
        <div className="space-y-2">
          {CUSTOMER_EMAIL_EVENTS.map((e) => (
            <label key={e.key} className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={events[e.key] === true}
                onChange={(ev) => setEvents((p) => ({ ...p, [e.key]: ev.target.checked }))} />
              <span>
                <span className="font-medium text-gray-800">{e.label}</span>
                <span className="block text-xs text-gray-500">{e.hint}</span>
              </span>
            </label>
          ))}
          <button type="button" onClick={save} disabled={saving}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      )}
    </div>
  );
}
