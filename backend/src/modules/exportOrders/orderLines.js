// Per-line price and packing for an export order.
//
// An order can carry several P.I. lines (export_order_items), each with its own
// price and bag. The export_orders header keeps only a SUMMARY: price_per_mt is
// contract value ÷ total quantity (a weighted average — 10 MT @ 1290 plus
// 10 MT @ 1250 stores 1270), and the bag fields hold one spec. Anything that
// describes a line — its unit price, its bag size, the bags it needs — has to
// read the line. These helpers are the one place that rule lives on the server.
//
// A line with no bag size of its own (a single-line order created before lines
// carried the spec) falls back to the header's, so single-line orders read
// exactly as they always did.

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// The bag a line ships in. Its own size wins, and with it its own master bag.
//
// `single` (the order has ONE line): line and header are the same rice, so a
// line with no size reads the header's bag, and one with a size but no master
// takes the header's master. With several lines the header is NOT a fallback —
// it holds one spec (line 1's, in practice), and lending it to a line with no
// bag of its own is how a 5 kg line printed as 2 kg bags in 10 kg masters.
// Such a line comes back with size 0 and `missing: true`.
function lineBagSpec(line, order = {}, { single = false } = {}) {
  const ownSize = num(line && line.bag_size_kg);
  const ownMaster = num(line && line.master_bag_size_kg);
  const ownType = (line && line.bag_type) || null;
  if (ownSize > 0) {
    return {
      bagSizeKg: ownSize,
      masterBagSizeKg: ownMaster || (single ? num(order.master_bag_size_kg) : 0),
      bagType: ownType || order.bag_type || null,
      fromHeader: false,
      missing: false,
    };
  }
  if (!single) {
    return { bagSizeKg: 0, masterBagSizeKg: ownMaster, bagType: ownType, fromHeader: false, missing: true };
  }
  return {
    bagSizeKg: num(order.bag_size_kg),
    masterBagSizeKg: ownMaster || num(order.master_bag_size_kg),
    bagType: ownType || order.bag_type || null,
    fromHeader: true,
    missing: false,
  };
}

// Every line with its packaging worked out: retail bags (kg ÷ bag size) and
// master bags (kg ÷ master size). With no lines, the header stands in as one.
function linePackaging(order = {}, items = []) {
  const lines = Array.isArray(items) && items.length > 0
    ? items
    : [{ qty_mt: order.qty_mt, price_per_mt: order.price_per_mt }];
  const single = lines.length <= 1;
  return lines.map((line) => {
    const spec = lineBagSpec(line, order, { single });
    const kg = num(line.qty_mt) * 1000;
    const bags = num(line.bag_count) > 0
      ? Math.round(num(line.bag_count))
      : (spec.bagSizeKg > 0 && kg > 0 ? Math.round(kg / spec.bagSizeKg) : 0);
    const masterBags = spec.masterBagSizeKg > 0 && kg > 0 ? Math.ceil(kg / spec.masterBagSizeKg) : 0;
    return { ...spec, kg, bags, masterBags, pricePerMt: num(line.price_per_mt), qtyMt: num(line.qty_mt) };
  });
}

const fmtSize = (kg) => {
  const n = num(kg);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
};

// "2 kg" for one size, "Mixed (2 kg, 5 kg)" for several, '' for none.
function packingSummary(order = {}, items = []) {
  const sizes = [...new Set(linePackaging(order, items).map((l) => l.bagSizeKg).filter((s) => s > 0))];
  if (sizes.length === 0) return { sizes, mixed: false, label: '' };
  if (sizes.length === 1) return { sizes, mixed: false, label: `${fmtSize(sizes[0])} kg` };
  return { sizes, mixed: true, label: `Mixed (${sizes.map((s) => `${fmtSize(s)} kg`).join(', ')})` };
}

// The order-level price. With one price across the lines it is THE unit price;
// with several the header figure is only an average and must be called one.
function priceSummary(order = {}, items = []) {
  const prices = (Array.isArray(items) ? items : []).map((l) => num(l.price_per_mt)).filter((p) => p > 0);
  const distinct = [...new Set(prices)];
  const avg = num(order.price_per_mt);
  if (distinct.length <= 1) {
    return { mixed: false, label: 'Price per MT', value: distinct[0] || avg, min: distinct[0] || avg, max: distinct[0] || avg };
  }
  return { mixed: true, label: 'Avg price per MT', value: avg, min: Math.min(...distinct), max: Math.max(...distinct) };
}

// For a single-line order the line and the header describe the same rice, so a
// line saved without a bag spec takes the header's. Several lines are left
// alone: copying one header bag into all of them is exactly the bug.
function fillSingleLineBagSpec(rows, header) {
  if (!Array.isArray(rows) || rows.length !== 1) return rows;
  const r = rows[0];
  if (num(r.bag_size_kg) > 0) return rows;
  const size = num(header.bag_size_kg);
  if (!(size > 0)) return rows;
  return [{
    ...r,
    bag_size_kg: size,
    master_bag_size_kg: r.master_bag_size_kg != null ? r.master_bag_size_kg : (num(header.master_bag_size_kg) || null),
    bag_type: r.bag_type || header.bag_type || null,
    bag_quality: r.bag_quality || header.bag_quality || null,
    bag_brand: r.bag_brand || header.bag_brand || null,
    bag_color: r.bag_color || header.bag_color || null,
    bag_printing: r.bag_printing || header.bag_printing || null,
  }];
}

// Each order's line prices, for summaries that only load the header.
async function linePricesByOrder(conn, orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const rows = await conn('export_order_items').whereIn('order_id', ids).select('order_id', 'price_per_mt');
  const out = {};
  rows.forEach((r) => { (out[r.order_id] = out[r.order_id] || []).push({ price_per_mt: r.price_per_mt }); });
  return out;
}

// "@ 1,290/MT (1.29/kg)" for one price; "@ avg 1,270/MT (1,250–1,290)" when the
// lines differ — the header figure is then an average, not anybody's rate.
function priceText(order, items) {
  const ps = priceSummary(order, items);
  if (!(ps.value > 0)) return '';
  if (!ps.mixed) {
    return `@ ${ps.value.toLocaleString()}/MT (${(ps.value / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })}/kg)`;
  }
  return `@ avg ${ps.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}/MT (${ps.min.toLocaleString()}–${ps.max.toLocaleString()})`;
}

module.exports = {
  lineBagSpec, linePackaging, packingSummary, priceSummary, fillSingleLineBagSpec,
  linePricesByOrder, priceText,
};
