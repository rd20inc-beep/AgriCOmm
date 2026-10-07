// Per-line price and packing for an export order (camelCase, transformOrder shape).
//
// An order can carry several P.I. lines, each with its own price and bag. The
// order header keeps only a SUMMARY: pricePerMT is contract value ÷ total
// quantity — a weighted AVERAGE (10 MT @ 1290 + 10 MT @ 1250 → 1270) — and the
// bag fields hold one spec. Anything describing a line must read the line; an
// order-level figure must say it is an average or "Mixed". Mirrors
// backend/src/modules/exportOrders/orderLines.js.

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export const fmtSizeKg = (kg) => {
  const n = num(kg);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
};

export function orderItems(order) {
  return Array.isArray(order?.items) ? order.items : [];
}

export function hasMultipleLines(order) {
  return orderItems(order).length > 1;
}

// The bag a line ships in. Its own size wins, and with it its own master bag
// (none when it has none) — a line never inherits another spec's master.
//
// `single` (the order has ONE line): line and header are the same rice, so a
// line saved without a size (orders from before lines carried the spec) reads
// the header's bag, and a line with a size but no master takes the header's
// master. With several lines the header is NOT a fallback: it holds one spec
// (in practice line 1's), and handing that to a line with no bag of its own is
// how a 5 kg line printed as 2 kg bags in 10 kg masters. Such a line comes
// back with size 0 and `missing: true`, for the caller to show '—' and flag.
export function lineBagSpec(line, order = {}, { single = false } = {}) {
  const own = num(line?.bagSizeKg ?? line?.bag_size_kg);
  const ownMaster = num(line?.masterBagSizeKg ?? line?.master_bag_size_kg);
  const ownType = line?.bagType || line?.bag_type || '';
  if (own > 0) {
    return {
      bagSizeKg: own,
      masterBagSizeKg: ownMaster || (single ? num(order.masterBagSizeKg) : 0),
      bagType: ownType || order.bagType || '',
      fromHeader: false,
      missing: false,
    };
  }
  if (!single) {
    return { bagSizeKg: 0, masterBagSizeKg: ownMaster, bagType: ownType, fromHeader: false, missing: true };
  }
  return {
    bagSizeKg: num(order.bagSizeKg),
    masterBagSizeKg: ownMaster || num(order.masterBagSizeKg),
    bagType: ownType || order.bagType || '',
    fromHeader: true,
    missing: false,
  };
}

// Retail bag sizes that travel inside a master bag (mirrors createOrderForm's
// requiresMasterBag). A line in one of these with no master bag is flagged
// rather than silently given another line's.
export const RETAIL_SIZES_NEEDING_MASTER = [0.5, 1, 2, 5, 10];
export function lineNeedsMaster(spec, packingType = 'retail') {
  return packingType === 'retail' && RETAIL_SIZES_NEEDING_MASTER.includes(num(spec.bagSizeKg)) && !(num(spec.masterBagSizeKg) > 0);
}

// A stored line `packing` text is kept only when it states the line's own bag
// size; a text saying another size (copied from line 1, or left over from an
// edit) gives way to one composed from the line's real bag and master.
export function packingTextFits(text, bagSizeKg) {
  if (!text) return false;
  const n = num(bagSizeKg);
  if (!(n > 0)) return true;
  const sizes = [...String(text).matchAll(/(\d+(?:\.\d+)?)\s*(?:KGS?|KILO)/gi)].map((m) => parseFloat(m[1]));
  return sizes.length === 0 || sizes.includes(n);
}

// Each line with its packaging worked out. With no lines the header stands in.
export function linePackaging(order = {}) {
  const items = orderItems(order);
  const lines = items.length > 0 ? items : [{ qtyMT: order.qtyMT, pricePerMT: order.pricePerMT, bagCount: order.totalBags }];
  const single = lines.length <= 1;
  return lines.map((line) => {
    const spec = lineBagSpec(line, order, { single });
    const qtyMT = num(line.qtyMT ?? line.qty_mt);
    const kg = qtyMT * 1000;
    const ownCount = num(line.bagCount ?? line.bag_count);
    const bags = ownCount > 0 ? Math.round(ownCount)
      : (spec.bagSizeKg > 0 && kg > 0 ? Math.round(kg / spec.bagSizeKg) : 0);
    const masterBags = spec.masterBagSizeKg > 0 && kg > 0 ? Math.ceil(kg / spec.masterBagSizeKg) : 0;
    const retailPerMaster = spec.masterBagSizeKg > 0 && spec.bagSizeKg > 0
      ? Math.floor(spec.masterBagSizeKg / spec.bagSizeKg) : 0;
    return {
      ...spec, qtyMT, kg, bags, masterBags, retailPerMaster,
      pricePerMT: num(line.pricePerMT ?? line.price_per_mt),
      productName: line.productName || line.product_name || '',
    };
  });
}

// "2 kg" for one size, "Mixed (2 kg, 5 kg)" for several, '' for none. Totals
// are summed per line, so a 2 kg line and a 5 kg line need 10,000 + 4,000 bags,
// not 20,000 of the first line's size.
export function packingSummary(order = {}) {
  const lines = linePackaging(order);
  const sizes = [...new Set(lines.map((l) => l.bagSizeKg).filter((s) => s > 0))];
  const masterSizes = [...new Set(lines.map((l) => l.masterBagSizeKg).filter((s) => s > 0))];
  const totalBags = lines.reduce((s, l) => s + l.bags, 0);
  const masterBags = lines.reduce((s, l) => s + l.masterBags, 0);
  const sizeText = (list) => list.map((s) => `${fmtSizeKg(s)} kg`).join(', ');
  return {
    lines,
    sizes,
    masterSizes,
    mixed: sizes.length > 1,
    label: sizes.length === 0 ? '' : (sizes.length === 1 ? `${fmtSizeKg(sizes[0])} kg` : `Mixed (${sizeText(sizes)})`),
    masterLabel: masterSizes.length === 0 ? '' : (masterSizes.length === 1 ? `${fmtSizeKg(masterSizes[0])} kg` : `Mixed (${sizeText(masterSizes)})`),
    totalBags,
    masterBags,
  };
}

// The order-level price. One price across the lines → it is THE unit price;
// several → the header figure is only an average and is labelled as one, with
// the range beside it.
export function priceSummary(order = {}) {
  const prices = orderItems(order).map((l) => num(l.pricePerMT ?? l.price_per_mt)).filter((p) => p > 0);
  const distinct = [...new Set(prices)];
  const avg = num(order.pricePerMT);
  if (distinct.length <= 1) {
    const v = distinct[0] || avg;
    return { mixed: false, label: 'Price per MT', value: v, min: v, max: v };
  }
  return { mixed: true, label: 'Avg price per MT', value: avg, min: Math.min(...distinct), max: Math.max(...distinct) };
}
