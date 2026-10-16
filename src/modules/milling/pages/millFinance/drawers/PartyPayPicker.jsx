import { useState } from 'react';
import { Banknote, HandCoins } from 'lucide-react';
import SlideDrawer from '../../../../../components/SlideDrawer';
import SearchSelect from '../../../../../shared/components/SearchSelect';
import MillSupplierPayDrawer from '../../../components/MillSupplierPayDrawer';
import MillCustomerPayDrawer from '../../../components/MillCustomerPayDrawer';
import { useSupplierDirectory, useCustomerDirectory } from '../hooks/usePartyDirectories';
import { PKR } from '../constants';

/**
 * Pay Supplier / Receive Money from the Mill Finance header. Step 1 picks the
 * party (only parties with something open are offered first); step 2 is the
 * EXISTING per-invoice drawer (MillSupplierPayDrawer / MillCustomerPayDrawer),
 * which owns the account, the amount check and the recordPayment call. Nothing
 * is posted from here.
 */
export default function PartyPayPicker({ mode, onClose, initialParty = null }) {
  const [party, setParty] = useState(initialParty);
  if (party) {
    return mode === 'supplier'
      ? <MillSupplierPayDrawer supplier={party} onClose={onClose} />
      : <MillCustomerPayDrawer customer={party} onClose={onClose} />;
  }
  return mode === 'supplier'
    ? <SupplierPick onPick={setParty} onClose={onClose} />
    : <CustomerPick onPick={setParty} onClose={onClose} />;
}

function PickShell({ title, subtitle, icon, label, options, loading, onPick, onClose, empty }) {
  return (
    <SlideDrawer open onClose={onClose} title={title} subtitle={subtitle} icon={icon}>
      <div className="space-y-3">
        <label className="block text-xs font-medium text-gray-600">{label}</label>
        {loading ? <p className="text-sm text-gray-400">Loading…</p>
          : options.length === 0 ? <p className="text-sm text-gray-400">{empty}</p>
            : (
              <SearchSelect
                value=""
                onChange={(val) => { const o = options.find((x) => String(x.value) === String(val)); if (o) onPick(o.party); }}
                options={options}
                placeholder="Search…"
              />
            )}
        <p className="text-[11px] text-gray-400">Next you choose the invoice, the amount and the account — and confirm before anything is posted.</p>
      </div>
    </SlideDrawer>
  );
}

function SupplierPick({ onPick, onClose }) {
  const { rows, isLoading } = useSupplierDirectory();
  const options = rows.filter((r) => r.id && r.outstanding > 0.001).map((r) => ({
    value: r.id, label: r.name, sub: `${PKR(r.outstanding)} outstanding · ${r.count} bill(s)`, party: { id: r.id, name: r.name },
  }));
  return (
    <PickShell title="Pay Supplier" subtitle="Mill payables — pay against a specific bill" icon={Banknote}
      label="Supplier" options={options} loading={isLoading} onPick={onPick} onClose={onClose}
      empty="No mill supplier has an outstanding bill." />
  );
}

function CustomerPick({ onPick, onClose }) {
  const { rows, isLoading } = useCustomerDirectory();
  const options = rows.filter((r) => r.outstanding > 0.001).map((r) => ({
    value: r.id, label: r.name, sub: `${PKR(r.outstanding)} owed to the mill`, party: { id: r.id, name: r.name },
  }));
  return (
    <PickShell title="Receive Money" subtitle="Local-sale receipts — against a specific invoice" icon={HandCoins}
      label="Customer" options={options} loading={isLoading} onPick={onPick} onClose={onClose}
      empty="No local customer owes the mill anything." />
  );
}
