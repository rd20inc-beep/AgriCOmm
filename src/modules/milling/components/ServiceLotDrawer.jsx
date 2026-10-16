import { useState } from 'react';
import { Package, Plus, X } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import RiceTypePicker from '../../../components/RiceTypePicker';
import CustomerPicker from '../../../components/CustomerPicker';
import FieldError from '../../../shared/components/FieldError';
import { useCreateMillingBatch, useProducts } from '../../../api/queries';
import { serviceMillingApi } from '../api/services';
import { fmtPKR, fmtKg, fmtNum } from '../../../shared/utils/format';
import { EMPTY_SERVICE_LOT, validateServiceLot, buildServiceLotPayload, withKattaWeight } from '../utils/serviceLot';

const AMBER_INPUT = 'w-full border border-amber-300 rounded-lg px-3 py-2 text-sm outline-none bg-white';

// New service (toll) milling lot, opened in place wherever it is needed
// (Service Milling page, Milling dashboard). The client owns the rice; we bill
// milling / rental / labour. Same request as before (see utils/serviceLot.js).
export default function ServiceLotDrawer({ open, onClose, onCreated, addToast }) {
  const createBatchMut = useCreateMillingBatch();
  const { data: products = [] } = useProducts();
  const [form, setForm] = useState(EMPTY_SERVICE_LOT);
  const [errors, setErrors] = useState({});
  const set = (k, v) => {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };
  const isBagUnit = form.receivedUnit === 'bag';
  const setKatta = (count, size) => setForm((p) => withKattaWeight(p, count, size));
  const setReceivedUnit = (unit) => setForm((p) => ({ ...withKattaWeight(p, '', unit === 'katta' ? '50' : ''), receivedUnit: unit }));
  const vehicles = form.serviceVehicles || [];
  const setVehicle = (i, patch) => set('serviceVehicles', vehicles.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  function close() {
    setForm(EMPTY_SERVICE_LOT());
    setErrors({});
    onClose?.();
  }

  async function handleCreate() {
    const errs = validateServiceLot(form);
    if (Object.keys(errs).length) {
      setErrors(errs);
      addToast?.(Object.values(errs)[0], 'error');
      return;
    }
    try {
      const res = await createBatchMut.mutateAsync(buildServiceLotPayload(form));
      const batchNo = res?.data?.batch?.batch_no || res?.data?.batch?.id;
      addToast?.(`Service lot ${batchNo || ''} created`.trim(), 'success');
      setForm(EMPTY_SERVICE_LOT());
      setErrors({});
      onCreated?.(batchNo);
    } catch (err) {
      addToast?.(`Failed to create service lot: ${err.message}`, 'error');
    }
  }

  const kattas = parseFloat(form.kattaCount) || parseFloat(form.bagCount) || 0;
  const milledKg = parseFloat(form.expectedOutputKg) || parseFloat(form.rawQtyKg) || 0;
  const mill = milledKg * (parseFloat(form.serviceMillingRatePerKg) || 0);
  const rent = kattas * (parseFloat(form.serviceRentalRatePerKatta) || 0);
  const lab = kattas * (parseFloat(form.serviceLabourRatePerKatta) || 0);
  const serviceTotal = mill + rent + lab;
  const vehicleKg = vehicles.reduce((s, v) => s + (parseFloat(v.weight_kg) || 0), 0);
  const vehicleBags = vehicles.reduce((s, v) => s + (parseInt(v.total_bags, 10) || 0), 0);

  function addVehicle() {
    // The new truck starts with the weight + bags not yet on a truck.
    const totalWeight = parseFloat(form.rawQtyKg) || 0;
    const totalBags = parseInt(form.totalBags, 10) || parseInt(form.kattaCount, 10) || 0;
    const remW = Math.max(0, Math.round(totalWeight - vehicleKg));
    const remB = Math.max(0, totalBags - vehicleBags);
    set('serviceVehicles', [...vehicles, { vehicle_no: '', driver_name: '', weight_kg: remW > 0 ? String(remW) : '', total_bags: remB > 0 ? String(remB) : '' }]);
  }

  return (
    <SlideDrawer
      open={open}
      onClose={close}
      title="New Service Milling Lot"
      subtitle="Client-owned rice, milled for a fee"
      icon={Package}
      size="xl"
      footer={(
        <div className="flex justify-end gap-2">
          <button onClick={close} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={handleCreate} disabled={createBatchMut.isPending} className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">
            {createBatchMut.isPending ? 'Creating…' : 'Create Service Lot'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-200 text-amber-900 uppercase tracking-wide">Client-Owned</span>
            <p className="text-xs text-amber-800">This rice belongs to the client — it is tracked as Service Milling stock, never company stock.</p>
          </div>

          <CustomerPicker
            label={<span className="text-xs font-semibold text-amber-800 uppercase">Service Milling Client <span className="text-red-500">*</span></span>}
            value={form.clientCustomerId}
            onChange={(id) => set('clientCustomerId', id)}
            addToast={addToast}
            placeholder="Search client we are milling for…"
            clearable
            listFn={() => serviceMillingApi.listClients()}
            createFn={(data) => serviceMillingApi.createClient(data)}
          />
          <FieldError error={errors.clientCustomerId} />

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-700">Received in:</span>
            <div className="inline-flex rounded-lg border border-amber-300 overflow-hidden text-xs">
              <button type="button" onClick={() => setReceivedUnit('katta')}
                className={`px-3 py-1.5 font-medium ${!isBagUnit ? 'bg-amber-500 text-white' : 'bg-white text-gray-600 hover:bg-amber-50'}`}>Kattas (50 kg)</button>
              <button type="button" onClick={() => setReceivedUnit('bag')}
                className={`px-3 py-1.5 font-medium border-l border-amber-300 ${isBagUnit ? 'bg-amber-500 text-white' : 'bg-white text-gray-600 hover:bg-amber-50'}`}>Bags (2–25 kg)</button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date Received</label>
              <input type="date" value={form.dateReceived} onChange={(e) => set('dateReceived', e.target.value)} className={AMBER_INPUT} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">{isBagUnit ? 'Bags Received' : 'Kattas Received'}</label>
              <input type="number" min="0" value={form.kattaCount} onChange={(e) => setKatta(e.target.value, form.kattaSizeKg)} placeholder={isBagUnit ? 'e.g. 800' : 'e.g. 200'} className={AMBER_INPUT} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">{isBagUnit ? 'Bag Size (kg)' : 'Katta Size (kg)'}</label>
              <input type="number" min="0" step="0.5" value={form.kattaSizeKg} onChange={(e) => setKatta(form.kattaCount, e.target.value)} placeholder={isBagUnit ? 'e.g. 25' : 'e.g. 50'} className={AMBER_INPUT} />
              {form.kattaCount && form.kattaSizeKg && (
                <p className="text-[11px] text-emerald-700 mt-0.5">= {fmtKg((parseFloat(form.kattaCount) || 0) * (parseFloat(form.kattaSizeKg) || 0))}</p>
              )}
              {isBagUnit && <p className="text-[11px] text-gray-400 mt-0.5">Mixed bag sizes? Enter total bags + type the weighed quantity below.</p>}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-amber-800 uppercase mb-2">Service Charges</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Milling (PKR / kg)</label>
                <input type="number" step="0.01" min="0" value={form.serviceMillingRatePerKg} onChange={(e) => set('serviceMillingRatePerKg', e.target.value)} placeholder="e.g. 3.5" className={AMBER_INPUT} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Rental (PKR / {isBagUnit ? 'bag' : 'katta'})</label>
                <input type="number" step="0.01" min="0" value={form.serviceRentalRatePerKatta} onChange={(e) => set('serviceRentalRatePerKatta', e.target.value)} placeholder="e.g. 10" className={AMBER_INPUT} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Labour (PKR / {isBagUnit ? 'bag' : 'katta'})</label>
                <input type="number" step="0.01" min="0" value={form.serviceLabourRatePerKatta} onChange={(e) => set('serviceLabourRatePerKatta', e.target.value)} placeholder="e.g. 5" className={AMBER_INPUT} />
              </div>
            </div>
            {serviceTotal > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs bg-white rounded-lg border border-amber-200 px-3 py-2">
                <span className="text-gray-500">Milling <b className="text-gray-800">{fmtPKR(mill, { decimals: 2 })}</b></span>
                <span className="text-gray-500">Rental <b className="text-gray-800">{fmtPKR(rent, { decimals: 2 })}</b></span>
                <span className="text-gray-500">Labour <b className="text-gray-800">{fmtPKR(lab, { decimals: 2 })}</b></span>
                <span className="ml-auto text-emerald-700 font-bold">Est. Service Total {fmtPKR(serviceTotal, { decimals: 2 })}</span>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-amber-800 uppercase">Incoming Vehicles <span className="normal-case font-normal text-gray-400">(optional — trucks bringing the client's rice)</span></h4>
              <button type="button" onClick={addVehicle} className="text-xs text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1">
                <Plus size={12} /> Add vehicle
              </button>
            </div>
            {vehicles.length === 0 ? (
              <p className="text-[11px] text-gray-400">No vehicles added. You can add trucks here (their rice is received as client-owned stock) or record the total quantity below.</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 px-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  <span className="col-span-3">Truck No</span>
                  <span className="col-span-3">Driver</span>
                  <span className="col-span-3">Weight (KG)</span>
                  <span className="col-span-2">Bags</span>
                  <span className="col-span-1" />
                </div>
                {vehicles.map((v, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center bg-white rounded-lg border border-amber-200 p-2">
                    <input value={v.vehicle_no} onChange={(e) => setVehicle(i, { vehicle_no: e.target.value })} placeholder="Truck no" aria-label="Truck no" className="col-span-3 border border-gray-200 rounded px-2 py-1.5 text-xs outline-none" />
                    <input value={v.driver_name} onChange={(e) => setVehicle(i, { driver_name: e.target.value })} placeholder="Driver" aria-label="Driver" className="col-span-3 border border-gray-200 rounded px-2 py-1.5 text-xs outline-none" />
                    <input type="number" min="0" value={v.weight_kg} onChange={(e) => setVehicle(i, { weight_kg: e.target.value })} placeholder="Weight KG" aria-label="Weight KG" className="col-span-3 border border-gray-200 rounded px-2 py-1.5 text-xs outline-none" />
                    <input type="number" min="0" value={v.total_bags} onChange={(e) => setVehicle(i, { total_bags: e.target.value })} placeholder="Bags" aria-label="Bags" className="col-span-2 border border-gray-200 rounded px-2 py-1.5 text-xs outline-none" />
                    <button type="button" aria-label="Remove vehicle" title="Remove vehicle" onClick={() => set('serviceVehicles', vehicles.filter((_, j) => j !== i))} className="col-span-1 text-gray-300 hover:text-rose-500 flex justify-center"><X size={14} /></button>
                  </div>
                ))}
                {(vehicleKg > 0 || vehicleBags > 0) && (
                  <p className="text-[11px] text-emerald-700 font-medium">Total received: {fmtKg(vehicleKg)} · {vehicleBags} bags — this becomes the batch quantity.</p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes / Remarks</label>
            <input type="text" value={form.serviceRemarks} onChange={(e) => set('serviceRemarks', e.target.value)} placeholder="e.g. paddy variety, moisture, handling notes" className={AMBER_INPUT} />
          </div>
        </div>

        <div>
          <RiceTypePicker
            label={<>Received Rice / Paddy Type <span className="text-red-500">*</span></>}
            value={form.productId}
            onChange={(id) => set('productId', id)}
            products={products}
            addToast={addToast}
            placeholder="Search rice type, e.g. 1121 Basmati, D98…"
            clearable={false}
          />
          <FieldError error={errors.productId} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantity Received (KG) <span className="text-red-500">*</span></label>
            <input type="number" value={form.rawQtyKg} onChange={(e) => set('rawQtyKg', e.target.value)} placeholder="e.g. 30000" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            <FieldError error={errors.rawQtyKg} />
            {form.rawQtyKg && <p className="text-xs text-gray-400 mt-0.5">{fmtKg(parseFloat(form.rawQtyKg) || 0)}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Number of Bags</label>
            <input type="number" value={form.totalBags} onChange={(e) => set('totalBags', e.target.value)} placeholder="e.g. 600" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none" />
            {form.rawQtyKg && parseInt(form.totalBags, 10) > 0 && (
              <p className="text-xs text-emerald-600 mt-0.5 font-medium">Avg: {fmtNum(parseFloat(form.rawQtyKg) / parseInt(form.totalBags, 10), 2)} kg/bag</p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Batch Name</label>
          <input type="text" value={form.batchName} onChange={(e) => set('batchName', e.target.value)} maxLength={200}
            placeholder="e.g. Client Ali — June paddy" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tags <span className="text-gray-400 font-normal">(comma-separated)</span></label>
          <input type="text" value={form.customTags} onChange={(e) => set('customTags', e.target.value)}
            placeholder="e.g. Toll, June" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
    </SlideDrawer>
  );
}
