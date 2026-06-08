/**
 * Backfill the arrival quality analysis for blended batches created before the
 * blend flow started deriving it.
 *
 * A blended batch inherits its material, cost and quality from its source lots,
 * so it should never ask for a paddy arrival analysis. New blends now auto-fill
 * the batch's 'arrival' quality sample (qty-weighted from the lots). This
 * migration does the same for existing blends (e.g. M-033) that have source
 * lots but no arrival sample yet, so their Quality tab and costing are
 * populated rather than warning the user to enter it.
 *
 * Self-contained, idempotent (only fills batches missing an arrival sample;
 * the one-per-(batch,type) unique constraint also guards duplicates).
 */

exports.up = async function (knex) {
  const batches = await knex('milling_batches as mb')
    .whereExists(function () {
      this.select('*').from('batch_source_lots as bsl').whereRaw('bsl.batch_id = mb.id');
    })
    .whereNotExists(function () {
      this.select('*').from('milling_quality_samples as q')
        .whereRaw('q.batch_id = mb.id').andWhere('q.analysis_type', 'arrival');
    })
    .select('mb.id', 'mb.created_by');

  for (const b of batches) {
    const lots = await knex('batch_source_lots as bsl')
      .leftJoin('inventory_lots as il', 'bsl.lot_id', 'il.id')
      .where('bsl.batch_id', b.id)
      .select('bsl.qty_mt', 'bsl.cost_total_pkr', 'il.moisture_pct', 'il.broken_pct', 'il.quality_json');
    if (lots.length === 0) continue;

    const wAvg = (getter) => {
      let num = 0, den = 0;
      for (const l of lots) {
        const q = parseFloat(l.qty_mt) || 0;
        const raw = getter(l);
        const v = raw == null ? NaN : parseFloat(raw);
        if (Number.isNaN(v) || q <= 0) continue;
        num += v * q; den += q;
      }
      return den > 0 ? Math.round((num / den) * 100) / 100 : null;
    };
    const qj = (l, key) => (l.quality_json && l.quality_json[key] != null ? l.quality_json[key] : null);
    const totalQty = lots.reduce((s, l) => s + (parseFloat(l.qty_mt) || 0), 0);
    const totalCost = lots.reduce((s, l) => s + (parseFloat(l.cost_total_pkr) || 0), 0);
    const pricePerMt = totalQty > 0 ? Math.round((totalCost / totalQty) * 100) / 100 : null;

    await knex('milling_quality_samples').insert({
      batch_id: b.id,
      analysis_type: 'arrival',
      moisture: wAvg((l) => l.moisture_pct ?? qj(l, 'moisture')),
      broken: wAvg((l) => l.broken_pct ?? qj(l, 'broken')),
      chalky: wAvg((l) => qj(l, 'chalky')),
      foreign_matter: wAvg((l) => qj(l, 'foreign_matter')),
      purity: wAvg((l) => qj(l, 'purity')),
      price_per_mt: pricePerMt,
      price_per_kg: pricePerMt != null ? Math.round((pricePerMt / 1000) * 100) / 100 : null,
      created_by: b.created_by || null,
    });
  }
};

exports.down = async function () {
  // No-op: auto-derived arrival samples are indistinguishable from user-entered
  // ones and are harmless to keep. Re-running up() is idempotent (it only fills
  // batches still missing an arrival sample).
};
