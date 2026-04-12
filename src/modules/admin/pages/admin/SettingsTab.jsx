import { useState } from 'react';
import { Settings, Server, Shield, Mail, FileText, Eye, Edit3 } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';

export default function SettingsTab() {
  const {
    settings, updateSettings,
    emailSettings, updateEmailSettings,
    addToast,
  } = useApp();

  // Settings controlled state
  const [qualityThreshold, setQualityThreshold] = useState(settings.qualityThreshold);
  const [defaultAdvancePct, setDefaultAdvancePct] = useState(settings.defaultAdvancePct);
  const [defaultCurrency, setDefaultCurrency] = useState(settings.defaultCurrency);
  const [paymentReminderDays, setPaymentReminderDays] = useState(settings.paymentReminderDays);
  const [lowMarginThreshold, setLowMarginThreshold] = useState(settings.lowMarginThreshold);

  // SMTP / Email settings local state
  const [smtpHost, setSmtpHost] = useState(emailSettings.smtpHost);
  const [smtpPort, setSmtpPort] = useState(emailSettings.smtpPort);
  const [smtpUser, setSmtpUser] = useState(emailSettings.smtpUser);
  const [smtpPassword, setSmtpPassword] = useState(emailSettings.smtpPassword);
  const [senderName, setSenderName] = useState(emailSettings.senderName);
  const [senderEmail, setSenderEmail] = useState(emailSettings.senderEmail);
  const [enableTls, setEnableTls] = useState(emailSettings.enableTls);

  const handleSaveSettings = () => {
    updateSettings({
      qualityThreshold,
      defaultAdvancePct,
      defaultCurrency,
      paymentReminderDays,
      lowMarginThreshold,
    });
    updateEmailSettings({
      smtpHost, smtpPort, smtpUser, smtpPassword,
      senderName, senderEmail, enableTls,
    });
    addToast('Settings saved successfully', 'success');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-6">
          <Settings className="w-5 h-5 text-gray-600" />
          System Configuration
        </h2>

        <div className="space-y-6 max-w-full lg:max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Quality Variance Threshold (%)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Batches exceeding this variance between sample and arrival analysis will trigger an alert.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.1"
                min="0"
                max="10"
                value={qualityThreshold}
                onChange={(e) => setQualityThreshold(parseFloat(e.target.value) || 0)}
                className="w-32 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <span className="text-sm text-gray-500">% variance allowed</span>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Advance Payment Percentage
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Default advance percentage applied to new export orders.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="5"
                min="0"
                max="100"
                value={defaultAdvancePct}
                onChange={(e) => setDefaultAdvancePct(parseFloat(e.target.value) || 0)}
                className="w-32 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Export Currency
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Base currency for export transactions. Milling operations always use PKR.
            </p>
            <select
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value)}
              className="w-48 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="USD">USD - US Dollar</option>
              <option value="PKR">PKR - Pakistani Rupee</option>
              <option value="EUR">EUR - Euro</option>
              <option value="GBP">GBP - British Pound</option>
            </select>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Reminder Interval (Days)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Number of days after due date before automatic payment reminders are sent.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="1"
                min="1"
                max="60"
                value={paymentReminderDays}
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
              Orders with profit margin below this threshold will be flagged.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="1"
                min="0"
                max="50"
                value={lowMarginThreshold}
                onChange={(e) => setLowMarginThreshold(parseInt(e.target.value) || 0)}
                className="w-32 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </div>

          <div className="pt-4">
            <button
              onClick={handleSaveSettings}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
            >
              Save Settings
            </button>
          </div>
        </div>
      </div>

      {/* Email / SMTP Configuration */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-6">
          <Server className="w-5 h-5 text-gray-600" />
          Email / SMTP Configuration
        </h2>

        <div className="space-y-6 max-w-full lg:max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Host</label>
            <input
              type="text"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Port</label>
            <input
              type="number"
              value={smtpPort}
              onChange={(e) => setSmtpPort(parseInt(e.target.value) || 587)}
              className="w-32 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">SMTP User / Email</label>
            <input
              type="text"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Password</label>
            <input
              type="password"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div className="border-t border-gray-200 pt-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Sender Name</label>
            <input
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sender Email</label>
            <input
              type="email"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enableTls"
              checked={enableTls}
              onChange={(e) => setEnableTls(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="enableTls" className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-green-500" />
              Enable TLS
            </label>
          </div>

          <div className="pt-2">
            <button
              onClick={() => addToast('SMTP connection successful', 'success')}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
            >
              <Mail className="w-4 h-4" />
              Test Connection
            </button>
          </div>
        </div>
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
