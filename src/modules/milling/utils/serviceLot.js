// New service (toll) milling lot: blank form, validation and the create
// payload. Pure — shared by the Service Milling page (P5-10, NAV-28: the
// drawer opens in place) and the Milling dashboard's New Batch flow, so both
// send exactly the same request to POST /milling/batches.

export const EMPTY_SERVICE_LOT = () => ({
  clientCustomerId: '',
  productId: '',
  rawQtyKg: '', totalBags: '',
  serviceMillingRatePerKg: '', serviceRentalRatePerKatta: '', serviceLabourRatePerKatta: '',
  // Received in kattas (50 kg) or small bags (2–25 kg); kattaCount/kattaSizeKg
  // hold the count + size for whichever is chosen.
  receivedUnit: 'katta',
  dateReceived: '', kattaCount: '', kattaSizeKg: '50', bagCount: '', expectedOutputKg: '', serviceRemarks: '',
  serviceVehicles: [], // [{ vehicle_no, driver_name, weight_kg, total_bags }]
  batchName: '', customTags: '',
});

const vehicleKgOf = (form) => (form.serviceVehicles || []).reduce((s, v) => s + (parseFloat(v.weight_kg) || 0), 0);

// Field errors, or {} when the lot can be created. The client is required
// (the rice is theirs, never a company supplier's), so are the rice type and
// a received quantity (typed, or the incoming trucks' weights).
export function validateServiceLot(form) {
  const errors = {};
  if (!form.productId) errors.productId = 'Rice type is required';
  if (!form.clientCustomerId) errors.clientCustomerId = 'Select the client';
  if (!(parseFloat(form.rawQtyKg) > 0) && vehicleKgOf(form) <= 0) errors.rawQtyKg = 'Enter the quantity received';
  return errors;
}

// The create request. Quantity comes from the trucks when entered, else the
// typed field; the count goes to the katta or bag column so billing reads the
// right unit.
export function buildServiceLotPayload(form) {
  const isBagUnit = form.receivedUnit === 'bag';
  const vehicleKg = vehicleKgOf(form);
  const rawKg = vehicleKg > 0 ? vehicleKg : (parseFloat(form.rawQtyKg) || 0);
  return {
    milling_fee_per_kg: 0,
    mill_id: null,
    shift: 'Day',
    planned_finished_kg: null,
    batch_name: form.batchName?.trim() || null,
    custom_tags: form.customTags || '',
    notes: null,
    is_service_milling: true,
    client_customer_id: parseInt(form.clientCustomerId, 10),
    service_milling_rate_per_kg: form.serviceMillingRatePerKg || null,
    service_rental_rate_per_katta: form.serviceRentalRatePerKatta || null,
    service_labour_rate_per_katta: form.serviceLabourRatePerKatta || null,
    date_received: form.dateReceived || null,
    katta_count: isBagUnit ? null : (form.kattaCount || null),
    bag_count: isBagUnit ? (form.kattaCount || null) : (form.bagCount || null),
    expected_output_kg: form.expectedOutputKg || null,
    service_remarks: form.serviceRemarks || null,
    vehicles: (form.serviceVehicles || [])
      .filter((v) => v.vehicle_no || parseFloat(v.weight_kg) > 0 || parseInt(v.total_bags, 10) > 0)
      .map((v) => ({ vehicle_no: v.vehicle_no || null, driver_name: v.driver_name || null, weight_kg: v.weight_kg || null, total_bags: v.total_bags || null })),
    // Client-owned stock: no company supplier; the backend stamps the raw lot
    // with the client as owner.
    supplier_id: null,
    raw_qty_kg: rawKg,
    product_id: parseInt(form.productId, 10),
  };
}

// Kattas × size pre-fills the received weight and bag count (still editable).
export function withKattaWeight(form, nextKatta, nextSize) {
  const count = parseFloat(nextKatta);
  const size = parseFloat(nextSize);
  const upd = { ...form, kattaCount: nextKatta, kattaSizeKg: nextSize, totalBags: nextKatta || '' };
  if (count > 0 && size > 0) {
    const w = Math.round(count * size);
    upd.rawQtyKg = String(w);
  }
  return upd;
}
