import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { User, KeyRound, Sun, Moon, MessageCircle, MessageCircleOff, Globe, Bell, Save, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useApp } from '../../../context/AppContext';
import { enterpriseApi } from '../../../api/services';
import { isChatHidden, setChatHidden, onChatPrefsChange } from '../../../components/chatBubblePrefs';

/**
 * A user's own page — who they are, their password, and the settings that
 * belong to them rather than to the company.
 *
 * "Profile" and "Settings" in the user menu both pointed at /admin, which a
 * non-admin cannot even open, so an ordinary user had nowhere to change
 * anything about themselves.
 *
 * Two kinds of preference live here and they are stored differently on purpose:
 *   - things that should follow the person between devices (theme, timezone,
 *     formats, notifications) go to user_preferences on the server
 *   - things that are about THIS screen (the chat bubble) stay in localStorage,
 *     because they are per-viewer and never need to travel
 */

function Card({ title, subtitle, icon: Icon, children }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <header className="flex items-start gap-3 mb-4">
        {Icon && <span className="mt-0.5 text-gray-400"><Icon size={18} /></span>}
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-t border-gray-100 first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm text-gray-700">{label}</div>
        {hint && <div className="text-[11px] text-gray-400 mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, labelOn = 'On', labelOff = 'Off' }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
        checked ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
      <span className={`w-2 h-2 rounded-full ${checked ? 'bg-emerald-500' : 'bg-gray-300'}`} />
      {checked ? labelOn : labelOff}
    </button>
  );
}

const TIMEZONES = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Europe/London', 'UTC'];
const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
const NUMBER_FORMATS = [['en-PK', 'en-PK — 1,234.56'], ['en-US', 'en-US — 1,234.56'], ['en-IN', 'en-IN — 1,23,456.78']];
const CURRENCY_DISPLAY = [['symbol', 'Rs 1,234'], ['code', 'PKR 1,234'], ['none', '1,234']];

export default function Profile() {
  const { user } = useAuth();
  const { addToast } = useApp();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['user-preferences'],
    queryFn: async () => (await enterpriseApi.getPreferences())?.data || {},
  });

  // Hold only what the user has CHANGED and read through to the fetched values
  // for everything else. Copying the server response into state through an
  // effect would mean a render pass just to mirror data we already have, and
  // would quietly clobber a field someone was editing when the query refetched.
  const [edits, setEdits] = useState({});
  const set = (k, v) => setEdits((e) => ({ ...e, [k]: v }));
  const val = (k, fallback) => (edits[k] !== undefined ? edits[k] : (prefs?.[k] ?? fallback));
  const draft = prefs ? { ...prefs, ...edits } : null;

  // Theme already drives data-theme from localStorage; keep that authoritative
  // for the current screen and ALSO save it so it follows the user elsewhere.
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('riceflow_theme') === 'dark'; } catch { return false; }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    try { localStorage.setItem('riceflow_theme', darkMode ? 'dark' : 'light'); } catch { /* blocked storage */ }
  }, [darkMode]);

  const [chatHidden, setChatHiddenLocal] = useState(() => isChatHidden());
  useEffect(() => onChatPrefsChange(() => setChatHiddenLocal(isChatHidden())), []);

  const saveMut = useMutation({
    mutationFn: (body) => enterpriseApi.updatePreferences(body),
    onSuccess: () => { addToast('Preferences saved', 'success'); setEdits({}); qc.invalidateQueries({ queryKey: ['user-preferences'] }); },
    onError: (e) => addToast(e?.data?.message || e?.message || 'Could not save preferences', 'error'),
  });

  const dirty = useMemo(
    () => Object.keys(edits).some((k) => String(edits[k] ?? '') !== String(prefs?.[k] ?? '')),
    [prefs, edits],
  );

  const save = () => saveMut.mutate({ ...draft, theme: darkMode ? 'dark' : 'light' });

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Your profile</h1>
        <p className="text-xs text-gray-500 mt-0.5">Your account, your password, and the settings that belong to you.</p>
      </div>

      <Card title="Account" subtitle="Ask an administrator to change your name, email or role." icon={User}>
        <Row label="Name">{<span className="text-sm font-medium text-gray-900">{user?.full_name || user?.fullName || '—'}</span>}</Row>
        <Row label="Email">{<span className="text-sm text-gray-700">{user?.email || '—'}</span>}</Row>
        <Row label="Role">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
            <ShieldCheck size={12} /> {user?.role || '—'}
          </span>
        </Row>
      </Card>

      <Card title="Security" icon={KeyRound}>
        <Row label="Password" hint="You will be asked for your current password.">
          <button onClick={() => navigate('/change-password')}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
            Change password
          </button>
        </Row>
      </Card>

      <Card title="Appearance" subtitle="How the app looks and behaves for you." icon={darkMode ? Moon : Sun}>
        <Row label="Theme" hint="Applies immediately on this device, and is remembered for your account.">
          <Toggle checked={darkMode} onChange={setDarkMode} labelOn="Dark" labelOff="Light" />
        </Row>
        <Row label="Chat bubble" hint="The floating chat button. Hiding it here is the same as dismissing it on the page.">
          <button type="button" onClick={() => setChatHidden(!chatHidden)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100">
            {chatHidden ? <MessageCircle size={13} /> : <MessageCircleOff size={13} />}
            {chatHidden ? 'Show the bubble' : 'Hide the bubble'}
          </button>
        </Row>
      </Card>

      <Card title="Regional" subtitle="How dates and numbers are shown to you." icon={Globe}>
        {isLoading || !draft ? <p className="text-sm text-gray-400 py-4">Loading…</p> : (
          <>
            <Row label="Time zone">
              <select value={val('timezone', 'Asia/Karachi')} onChange={(e) => set('timezone', e.target.value)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white">
                {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Row>
            <Row label="Date format">
              <select value={val('date_format', 'DD/MM/YYYY')} onChange={(e) => set('date_format', e.target.value)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white">
                {DATE_FORMATS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Row>
            <Row label="Number format">
              <select value={val('number_format', 'en-PK')} onChange={(e) => set('number_format', e.target.value)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white">
                {NUMBER_FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Row>
            <Row label="Currency">
              <select value={val('currency_display', 'symbol')} onChange={(e) => set('currency_display', e.target.value)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white">
                {CURRENCY_DISPLAY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Row>
          </>
        )}
      </Card>

      <Card title="Notifications" subtitle="Where we may reach you." icon={Bell}>
        {isLoading || !draft ? <p className="text-sm text-gray-400 py-4">Loading…</p> : (
          <>
            <Row label="Email"><Toggle checked={!!val('notifications_email', true)} onChange={(v) => set('notifications_email', v)} /></Row>
            <Row label="Push"><Toggle checked={!!val('notifications_push', true)} onChange={(v) => set('notifications_push', v)} /></Row>
            <Row label="SMS"><Toggle checked={!!val('notifications_sms', true)} onChange={(v) => set('notifications_sms', v)} /></Row>
          </>
        )}
      </Card>

      <div className="flex items-center justify-end gap-3 pb-8">
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        <button onClick={save} disabled={saveMut.isPending || !draft}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <Save size={15} /> {saveMut.isPending ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </div>
  );
}
