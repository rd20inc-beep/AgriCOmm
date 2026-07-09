// Pakistani-rice per-grade quality split. Stored on milling_quality_samples
// in snake_case (b1_pct / b2_pct / cobba_pct / csr_pct / nb_pct / ov_pct);
// FE uses camelCase via the standard transformKeys pipeline.
// Shared by the regular batch page and the dedicated service-milling page.
export const qualityParams = [
  // Aggregate metrics
  { key: 'moisture',       label: 'Moisture %',       unit: '%', backendKey: 'moisture' },
  { key: 'broken',         label: 'Broken %',         unit: '%', backendKey: 'broken' },
  { key: 'foreignMatter',  label: 'Foreign matter %', unit: '%', backendKey: 'foreign_matter' },
  { key: 'chalky',         label: 'Chalky %',         unit: '%', backendKey: 'chalky' },
  { key: 'purity',         label: 'Purity %',         unit: '%', backendKey: 'purity' },
  // Pakistani broken-grade breakdown
  { key: 'b1Pct',          label: 'B-1',              unit: '%', backendKey: 'b1_pct' },
  { key: 'b2Pct',          label: 'B-2',              unit: '%', backendKey: 'b2_pct' },
  { key: 'b3Pct',          label: 'B-3',              unit: '%', backendKey: 'b3_pct' },
  { key: 'csrPct',         label: 'C.S',              unit: '%', backendKey: 'csr_pct' },
  { key: 'shortGrainPct',  label: 'Short Grain',      unit: '%', backendKey: 'short_grain_pct' },
  { key: 'cobbaPct',       label: 'Choba',            unit: '%', backendKey: 'cobba_pct' },
  { key: 'nbPct',          label: 'N.B',              unit: '%', backendKey: 'nb_pct' },
  { key: 'ovPct',          label: 'O.V',              unit: '%', backendKey: 'ov_pct' },
];

export default qualityParams;

// Weight-weighted aggregate of the per-truck quality (milling_vehicle_arrivals
// .quality_json) as a { <param.key>: value, pricePerKg, pricePerMT } object —
// used to autofill the batch's Sample analysis from what the trucks recorded.
// Reads camelCase or snake keys, and the un-suffixed grade keys (b1 / csr /
// short_grain) that the vehicle drawer stores.
export function aggregateVehicleQuality(vehicles) {
  const vq = (v) => v.qualityJson || v.quality_json || null;
  const withQ = (vehicles || []).filter((v) => { const q = vq(v); return q && typeof q === 'object' && Object.keys(q).length > 0; });
  if (!withQ.length) return null;
  const wOf = (v) => parseFloat(v.weightKg ?? v.weight_kg) || 1;
  const qGet = (q, p) => {
    const base = p.backendKey.replace(/_pct$/, '');
    const raw = q?.[p.key] ?? q?.[p.backendKey] ?? q?.[base];
    const n = parseFloat(raw);
    return Number.isNaN(n) ? null : n;
  };
  const agg = {};
  qualityParams.forEach((p) => {
    let num = 0, den = 0;
    withQ.forEach((v) => { const val = qGet(vq(v), p); if (val == null) return; const w = wOf(v); num += val * w; den += w; });
    if (den > 0) agg[p.key] = Math.round((num / den) * 100) / 100;
  });
  let pnum = 0, pden = 0;
  withQ.forEach((v) => {
    const q = vq(v) || {};
    const pv = parseFloat(q.pricePerMt ?? q.price_per_mt ?? q.pricePerMT); if (Number.isNaN(pv)) return;
    const w = wOf(v); pnum += pv * w; pden += w;
  });
  agg.pricePerMT = pden > 0 ? Math.round(pnum / pden) : '';
  agg.pricePerKg = agg.pricePerMT ? Math.round((agg.pricePerMT / 1000) * 100) / 100 : '';
  return Object.keys(agg).length ? agg : null;
}
