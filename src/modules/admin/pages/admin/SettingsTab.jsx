import { useState, useEffect } from 'react';
import { Settings, Server, Mail, FileText, Eye, Edit3, Building2 } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useAppSettings, useCompanyProfile } from '../../../../shared/hooks/useMasterData';

export default function SettingsTab() {
  const { emailSettings, addToast } = useApp();
  const companyProfileData = useCompanyProfile();
  const { settings, updateSettings } = useAppSettings();

  // Company profile editable state (seeded from resolved profile data)
  const [companyName, setCompanyName] = useState(companyProfileData?.name || '');
  const [companyTagline, setCompanyTagline] = useState(companyProfileData?.tagline || '');
  const [companyAddress, setCompanyAddress] = useState(companyProfileData?.address || '');
  const [companyPhone, setCompanyPhone] = useState(companyProfileData?.phone || '');
  const [companyEmail, setCompanyEmail] = useState(companyProfileData?.email || '');
  const [companyWebsite, setCompanyWebsite] = useState(companyProfileData?.website || '');
  const [companyNtn, setCompanyNtn] = useState(companyProfileData?.ntn || '');

  // System configuration — only settings the system actually reads, saved under
  // the snake_case keys their readers use (backend schemas.updateSettings):
  //   payment_reminder_days → overdue-advance scan + Finance › Confirmations
  //   min_margin_pct        → low-margin order alerts (automation)
  // (No FX fallback rate any more — owner decision D-10: rates live per
  // currency in Finance › Rates; a posting with no rate on file is refused.)
  const [paymentReminderDays, setPaymentReminderDays] = useState(settings.paymentReminderDays);
  const [minMarginPct, setMinMarginPct] = useState(settings.minMarginPct);
  const [saving, setSaving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // Settings arrive after mount on a cold load — follow them until edited.
  useEffect(() => { setPaymentReminderDays(settings.paymentReminderDays); }, [settings.paymentReminderDays]);
  useEffect(() => { setMinMarginPct(settings.minMarginPct); }, [settings.minMarginPct]);

  const errMsg = (err) => {
    const first = err?.data?.errors?.[0] || err?.errors?.[0];
    return first ? `${first.field}: ${first.message}` : (err?.message || 'request failed');
  };

  const handleSaveSettings = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await updateSettings({
        payment_reminder_days: Number(paymentReminderDays),
        min_margin_pct: Number(minMarginPct),
      });
      addToast('Settings saved', 'success');
    } catch (err) {
      addToast(`Settings not saved: ${errMsg(err)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCompanyProfile = async () => {
    if (savingProfile) return;
    setSavingProfile(true);
    try {
      await updateSettings({
      companyProfile: {
        name:     companyName.trim(),
        tagline:  companyTagline.trim(),
        address:  companyAddress.trim(),
        phone:    companyPhone.trim(),
        email:    companyEmail.trim(),
        website:  companyWebsite.trim(),
        ntn:      companyNtn.trim(),
      },
      });
      addToast('Company profile saved — printed sheets and hero bands will use this on next refresh', 'success');
    } catch (err) {
      addToast(`Company profile not saved: ${errMsg(err)}`, 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ─── Company Profile ───────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
          <Building2 className="w-5 h-5 text-gray-600" />
          Company Profile
        </h2>
        <p className="text-xs text-gray-500 mb-5">
          Appears on every printed sheet (Money In, Money Out, Accounting, P&L, etc.) and on order documents.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Legal / Display Name</label>
            <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. AGRI COMMODITIES (Pvt) Ltd"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Tagline</label>
            <input type="text" value={companyTagline} onChange={(e) => setCompanyTagline(e.target.value)}
              placeholder="Serving Natural Nutrition"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input type="text" value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)}
              placeholder="Suite, building, street, city"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input type="text" value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)}
              placeholder="+92 21 0000000"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)}
              placeholder="info@yourcompany.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
            <input type="text" value={companyWebsite} onChange={(e) => setCompanyWebsite(e.target.value)}
              placeholder="www.yourcompany.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">NTN / Tax ID</label>
            <input type="text" value={companyNtn} onChange={(e) => setCompanyNtn(e.target.value)}
              placeholder="0000000-0"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
        </div>

        <div className="pt-5">
          <button onClick={handleSaveCompanyProfile} disabled={savingProfile}
            className="disabled:opacity-50 inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm">
            {savingProfile ? 'Saving…' : 'Save Company Profile'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-6">
          <Settings className="w-5 h-5 text-gray-600" />
          System Configuration
        </h2>

        <div className="space-y-6 max-w-full lg:max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Reminder Interval (Days)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              An export order still Awaiting Advance after twice this many days is flagged as overdue.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="1"
                min="1"
                max="365"
                value={paymentReminderDays ?? ''}
                onChange={(e) => setPaymentReminderDays(parseInt(e.target.value) || 1)}
                className="w-32 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <span className="text-sm text-gray-500">days</span>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Low Margin Alert Threshold (%)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Open export orders with a booked margin below this are flagged.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={minMarginPct ?? ''}
                onChange={(e) => setMinMarginPct(parseFloat(e.target.value) || 0)}
                className="w-32 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </div>

          <p className="border-t border-gray-200 pt-6 text-xs text-gray-500">
            Exchange rates are kept per currency in Finance › Rates. There is no fallback rate:
            a foreign-currency entry with no rate on file is refused until one is entered.
          </p>

          <div className="pt-4">
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="disabled:opacity-50 inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>

      {/* Email / SMTP — configured on the server, shown read-only */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-2">
          <Server className="w-5 h-5 text-gray-600" />
          Email / SMTP
        </h2>
        <p className="text-sm text-gray-600">
          Outgoing email uses the server's SMTP configuration (environment variables on the backend),
          not a setting saved here. Ask the system administrator to change the mail server or its password.
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Sender shown on composed emails: {emailSettings?.senderName} &lt;{emailSettings?.senderEmail}&gt;
        </p>
      </div>

      {/* Email Templates */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-6">
          <FileText className="w-5 h-5 text-gray-600" />
          Email Templates
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { name: 'Advance Payment Request', subject: 'Advance Payment Required - Order {orderId}' },
            { name: 'Balance Payment Reminder', subject: 'Balance Payment Due - Order {orderId}' },
            { name: 'Proforma Invoice', subject: 'Proforma Invoice - {piNumber}' },
            { name: 'Shipment Notification', subject: 'Shipment Update - Order {orderId}' },
          ].map((tpl) => (
            <div key={tpl.name} className="border border-gray-200 rounded-lg p-4 hover:border-blue-200 hover:bg-blue-50/30 transition-colors">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-gray-900">{tpl.name}</h3>
                  <p className="text-xs text-gray-500 mt-1 truncate">Subject: {tpl.subject}</p>
                </div>
                <Mail className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => addToast(`Editing template: ${tpl.name}`, 'info')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                >
                  <Edit3 className="w-3 h-3" />
                  Edit
                </button>
                <button
                  onClick={() => addToast(`Previewing template: ${tpl.name}`, 'info')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors"
                >
                  <Eye className="w-3 h-3" />
                  Preview
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
