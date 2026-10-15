const db = require('../../config/database');
const auditService = require('../admin/audit.service');
const accountingService = require('../accounting/accounting.service');
const { postProcessingDelta } = require('../milling/millingCompletionJournal');
const inventoryService = require('../inventory/inventory.service');
const { NotFoundError, ValidationError, ConflictError, ForbiddenError } = require('../../shared/errors');
const { isKattaItem } = require('../../shared/packagingTypes');
const { moveStock, postStoreJournal } = require('./storeStock');
const {
  LOCKED_STATUSES, isBatchCompleted, canEditBatchPacking, assertCanEditBatchPacking,
} = require('../milling/packingGate');
const { resolveBatchPackSpec } = require('../milling/batchPackSpec');

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(num(v) * 100) / 100;

// Packing a milling batch's finished rice into bags. Records the packed (net) /
// tare / gross weight, posts the bag cost to the P&L (mirrors mill-store
// consumption GL: DR 6000 / CR 1250) and folds it into the batch's residual cost.
//
// Store stock — ONE mover per kind of packaging (owner decision 2026-10-07):
//   P.P. bags, master bags, polythene  → drawn HERE (reference_type='packing'),
//                                        the moment they are physically used.
//   KATTA                              → NOT drawn here. Katta stock moves only
//                                        through inventoryService.reconcileBatchKatta
//                                        at yield, which consumes this run's
//                                        recorded katta count (reference_type=
//                                        'batch_katta'). The log still records it.
//
// Cost follows the stock (P3-05): a run books what it DREW, at average cost —
// never a shortfall — and a katta's cost is booked by the reconcile when it
// draws the katta (katta_cost_mode 'yield'). Runs recorded before that booked
// their katta here for the full count ('pack'); those keep their booking and
// the reconcile draws their katta without booking it again.
const packingService = {
  // Summary of what's already been packed for a batch + how much finished rice
  // remains unpacked.
  async history(batchId, user = null) {
    const batch = await db('milling_batches').where('id', batchId).first();
    if (!batch) throw new NotFoundError('Batch not found.');

    const logs = await db('mill_packing_logs as pl')
      .leftJoin('mill_items as mi', 'mi.id', 'pl.bag_item_id')
      .leftJoin('mill_items as mb', 'mb.id', 'pl.master_bag_item_id')
      .leftJoin('mill_items as po', 'po.id', 'pl.poly_item_id')
      .leftJoin('users as u', 'u.id', 'pl.packed_by')
      .where('pl.batch_id', batchId)
      .select('pl.*', 'mi.name as bag_item_name', 'mi.code as bag_item_code',
        'mb.name as master_bag_name', 'po.name as poly_name', 'u.full_name as packed_by_name')
      .orderBy('pl.created_at', 'desc');

    const finishedKg = (Number(batch.actual_finished_kg) || 0);
    const packedKg = logs.reduce((s, l) => s + (Number(l.packed_weight_kg) || 0), 0);
    const totalBags = logs.reduce((s, l) => s + (Number(l.bags_count) || 0), 0);

    return {
      batchId: Number(batchId),
      batchNo: batch.batch_no,
      finishedKg,
      packedKg: Number(packedKg.toFixed(3)),
      remainingKg: Number(Math.max(0, finishedKg - packedKg).toFixed(3)),
      totalBags,
      logs,
      batchStatus: batch.status,
      completed: isBatchCompleted(batch),
      // The bag this batch packs into, and where that comes from.
      packSpec: await resolveBatchPackSpec(db, batch),
      // What THIS user may change — the same rule the edit routes enforce.
      access: user ? {
        runs: await canEditBatchPacking(db, user, batch, 'runs'),
        spec: await canEditBatchPacking(db, user, batch, 'spec'),
      } : null,
    };
  },

  // Pack `bagsCount` bags of `bagItemId` against a batch. Bags may be collected
  // into an outer "master" bag (e.g. 5 x 3.5 kg into a 20 kg master) and lined
  // with a polythene sheet — both optional, stocked packaging items whose cost
  // folds into the run. The caller sends the master COUNT; a master holds whole
  // bags, so that count is bags / floor(master capacity / bag capacity).
  async pack(batchId, {
    bag_item_id, bags_count, warehouse_id = null, notes,
    master_bag_item_id = null, master_bags_count = null,
    // Where the polythene goes: lining each retail bag, lining the master, or
    // both. The quantity used to be assumed as one sheet per retail bag, which
    // is only one of the three real cases — and at Rs 12 a sheet the difference
    // between 400, 80 and 480 is real money.
    poly_item_id = null, poly_count = null, poly_applies_to = 'bag',
  }, userId, { allowOverPack = false, req = null } = {}) {
    const bagsCount = Number(bags_count);
    if (!bagsCount || bagsCount <= 0) throw new ValidationError('Bag count must be greater than zero.');

    return db.transaction(async (trx) => {
      const batch = await trx('milling_batches').where('id', batchId).forUpdate().first();
      if (!batch) throw new NotFoundError('Batch not found.');
      if (LOCKED_STATUSES.includes(batch.status)) {
        throw new ForbiddenError(`This batch is ${batch.status} — its packing is locked.`);
      }

      const item = await trx('mill_items').where('id', bag_item_id).first();
      if (!item) throw new NotFoundError('Bag item not found.');

      const capacity = Number(item.capacity_kg) || 0;
      if (capacity <= 0) {
        throw new ValidationError(`Set a bag capacity (kg per bag) for "${item.name}" before packing.`);
      }
      const tare = Number(item.tare_weight_kg) || 0;
      const warehouseId = warehouse_id || null;

      // Packing material shortages are ALLOWED (non-blocking): consume what's in
      // stock, record the shortfall, and flag it so a purchase alert follows. The
      // depleted item also auto-surfaces in the low-stock alerts (reorder level).
      // Only what is drawn is costed (INV-38 / MIL-24): the run used to credit
      // 1250 for the full intended count, shortfall included, so 1250 fell
      // below what the store held.
      const shortages = [];
      // Katta is recorded on the log but drawn — and costed — at yield by the
      // katta reconcile (which flags its own shortage), never here as well.
      const bagIsKatta = isKattaItem(item);

      const packedKg = Number((bagsCount * capacity).toFixed(3));   // net rice
      const tareKg = Number((bagsCount * tare).toFixed(4));         // packaging
      const grossKg = Number((packedKg + tareKg).toFixed(3));

      // Don't pack more net rice than the batch produced (small tolerance).
      const finishedKg = (Number(batch.actual_finished_kg) || 0);
      if (!allowOverPack && finishedKg > 0) {
        const alreadyPacked = Number((await trx('mill_packing_logs')
          .where('batch_id', batchId).sum({ s: 'packed_weight_kg' }).first())?.s || 0);
        if (alreadyPacked + packedKg > finishedKg * 1.01) {
          throw new ValidationError(
            `Over-pack: batch produced ${finishedKg.toLocaleString()} kg, already packed ${alreadyPacked.toLocaleString()} kg, this adds ${packedKg.toLocaleString()} kg.`
          );
        }
      }

      // A katta bag is costed at yield, when the reconcile draws it.
      const costPerBag = bagIsKatta ? 0 : (Number(item.avg_cost_per_unit) || 0);

      const [log] = await trx('mill_packing_logs').insert({
        batch_id: batchId,
        bag_item_id,
        warehouse_id: warehouseId,
        bags_count: bagsCount,
        capacity_kg_per_bag: capacity,
        tare_kg_per_bag: tare,
        packed_weight_kg: packedKg,
        tare_weight_kg: tareKg,
        gross_weight_kg: grossKg,
        cost_per_bag: costPerBag,
        total_cost: 0,
        katta_cost_mode: 'yield',
        notes: notes || null,
        packed_by: userId,
      }).returning('*');

      // ── Draw the bag, the optional outer master bag and polythene sheet ─────
      // Each is a stocked packaging item: validate, draw down stock under a row
      // lock at the item's average cost, record a 'packing' consumption
      // movement against this log, and return what was DRAWN and its value.
      // Shortage-tolerant: consume what's in stock, flag any shortfall. `qty`
      // stays the INTENDED count so the log records what was packed.
      const consumePackaging = async (itemId, count, label, pkgRow = null) => {
        const qty = Number(count);
        if (!itemId || !qty || qty <= 0) return { cost: 0, item: null, qty: 0 };
        const pkg = pkgRow || await trx('mill_items').where('id', itemId).first();
        if (!pkg) throw new NotFoundError(`${label} item not found.`);
        // A katta used here is recorded, but drawn and costed at yield by the
        // katta reconcile — the one mover for katta stock.
        if (isKattaItem(pkg)) return { cost: 0, item: pkg, qty };
        const reason = `${label} (${qty} × ${pkg.name}) for ${batch.batch_no || `batch ${batchId}`}`;
        const issue = await moveStock(trx, {
          itemId: pkg.id, warehouseId, qty: -qty, valuation: 'avg', clamp: true,
          movement: {
            movement_type: 'consumption', reference_type: 'packing', reference_id: log.id,
            reason, performed_by: userId,
          },
        });
        if (issue.short > 0) {
          shortages.push({ item: pkg.name, unit: pkg.unit, needed: qty, available: -issue.moved, short: issue.short });
          await trx('mill_stock_movements')
            .where({ reference_type: 'packing', reference_id: log.id, item_id: pkg.id, reason })
            .update({ reason: `${reason} (${issue.short} short)` });
        }
        return { cost: Math.abs(issue.value), item: pkg, qty };
      };

      const bag = await consumePackaging(bag_item_id, bagsCount, 'Packed bags', item);
      const totalCost = bag.cost;
      const master = await consumePackaging(master_bag_item_id, master_bags_count, 'Master bag');

      // Polythene quantity follows where it is applied, unless the caller gave a
      // count outright. 'both' is bags PLUS masters — a sheet inside each retail
      // bag and one lining each master — not one or the other.
      const polyScope = ['bag', 'master', 'both'].includes(poly_applies_to) ? poly_applies_to : 'bag';
      const masterQty = Number(master.qty) || 0;
      const derivedPoly = polyScope === 'master' ? masterQty
        : polyScope === 'both' ? bagsCount + masterQty
          : bagsCount;
      const polyQty = poly_count == null || poly_count === '' ? derivedPoly : Number(poly_count);
      const poly = await consumePackaging(poly_item_id, polyQty, `Polythene sheet (${polyScope})`);
      const grandTotal = Number((totalCost + master.cost + poly.cost).toFixed(2));

      // Stamp the master/poly breakdown + the run cost (what was drawn) onto the
      // log. The stamped values are read back onto `log` afterwards: this returns
      // the row from the original insert, so without that every master and
      // polythene field came back null to the caller even though the database
      // held them.
      {
        const stamped = {
          master_bag_item_id: master.item ? master_bag_item_id : null,
          master_bags_count: master.qty || null,
          master_cost: master.qty ? master.cost : null,
          poly_item_id: poly.item ? poly_item_id : null,
          poly_count: poly.qty || null,
          poly_cost: poly.qty ? poly.cost : null,
          poly_applies_to: poly.qty > 0 ? polyScope : null,
          total_cost: grandTotal,
        };
        await trx('mill_packing_logs').where('id', log.id).update(stamped);
        Object.assign(log, stamped);
      }

      // Human-readable breakdown of everything consumed in this run.
      const breakdown = [`${bagsCount} × ${item.name}`]
        .concat(master.qty ? [`${master.qty} × ${master.item.name} (master)`] : [])
        .concat(poly.qty ? [`${poly.qty} × ${poly.item.name} (polythene, ${polyScope === 'both' ? 'bags + masters' : polyScope === 'master' ? 'masters' : 'bags'})`] : [])
        .join(' + ');

      // GL: recognise the packing cost drawn (bag + master + polythene) — DR 6000
      // Operating Expenses / CR 1250 Bags & Packaging (same treatment as store
      // consumption). Part of the packing run (P2-02): a failed journal rolls
      // the run back and the user sees why.
      if (grandTotal > 0) {
        await postStoreJournal(trx, {
          amount: grandTotal,
          refType: 'Mill Packing',
          refNo: batch.batch_no || `BATCH-${batchId}`,
          description: `Packing (${breakdown}) for batch ${batch.batch_no || batchId} — Rs ${Math.round(grandTotal).toLocaleString('en-PK')}`,
          userId,
          what: 'The packing run',
        });
      }

      // Fold the packing cost into the batch as the run's own 'packaging'
      // milling_cost line (source packing_run / log id — MIL-23) so it shows in
      // Mill Finance (Operating / Costs) and rolls into the residual
      // finished-rice cost. The GL expenses the bags when they are drawn (the
      // 6000/1250 journal above) and ABSORBS them into finished stock once:
      // the batch's completion credits 6000 for its packaging (A3b), and a run
      // after the completion absorbs its own cost here — Dr 1220 / Cr 6000.
      if (grandTotal > 0) {
        await trx('milling_costs').insert({
          batch_id: batchId, category: 'packaging', amount: grandTotal, currency: 'PKR',
          notes: `Packing: ${breakdown} (log #${log.id})`,
          source: 'packing_run', source_id: log.id,
          created_by: userId || null,
        });
        await postProcessingDelta(trx, accountingService, {
          batch, delta: grandTotal, label: `packaging (packing run #${log.id})`, userId,
        });
        // Re-cost the batch's outputs so the finished cost/kg includes the bags
        // (no-op if the batch hasn't yielded yet).
        // Not swallowed: the cost sheet above already carries the bags, so a
        // failed re-cost would leave the lots at the old cost/kg — and a
        // database error here aborts the transaction, which COMMIT would then
        // silently roll back while the user was told it worked.
        if ((Number(batch.actual_finished_kg) || 0) > 0) {
          await inventoryService.recomputeBatchOutputsAfterPriceChange(trx, batchId, { userId });
        }
      }

      // ── Tell the output lot what it was actually packed into ─────────────
      // The bag spec is stamped onto the finished lot by reconcileBatchKatta,
      // which runs at YIELD. Pack after the yield — which is the normal order of
      // work, since you mill first and bag afterwards — and there was no packing
      // run to read at the time, so the lot was left with no spec at all and
      // every report fell back to dividing the weight by 50. Batch M-005 packed
      // 873 x 25 kg and its 21,825 kg lot read as 437 katta; M-006 packed
      // 7,435 x 3.63 kg (8 lb retail) and read as 540.
      //
      // reconcileBatchKatta is idempotent — it reverses its own prior movements
      // before recomputing — so running it again here is safe, and it is the
      // single source of truth for the spec AND for the katta accounting. That
      // second part matters: it is the ONLY thing that moves katta stock, so
      // re-running is what draws this run's katta (and releases the katta the
      // yield had assumed by weight). Before yield nothing moves: the yield's
      // own reconcile picks the run up.
      //
      // Non-blocking, like the GL and cost steps above: the packing run itself is
      // recorded either way.
      // Katta this run named but the store does not hold is flagged like any
      // other packing shortage.
      // It runs in a SAVEPOINT: a failure undoes only the reconcile's own
      // writes. Without one, a database error inside it aborted the whole
      // transaction and COMMIT silently discarded the packing run too.
      if ((Number(batch.actual_finished_kg) || 0) > 0) {
        try {
          const katta = await trx.transaction((sp) => inventoryService.reconcileBatchKatta(sp, batchId, userId));
          for (const s of (katta && katta.shortages) || []) {
            shortages.push({ item: s.item, unit: 'pcs', needed: s.needed, available: s.available, short: s.short });
          }
        } catch (e) { console.error('Packing katta/bag-spec reconcile failed (packing still recorded):', e.message); }
      }

      // Flag any packing-material shortage on the log (Purchase Required) so the UI
      // and reports surface it; the depleted items also auto-appear in low-stock
      // alerts. Non-blocking — packing still completed above.
      if (shortages.length) {
        const summary = 'Packing material shortage (purchase required): '
          + shortages.map((s) => `${s.short} ${s.unit} ${s.item}`).join(', ') + '.';
        await trx('mill_packing_logs').where('id', log.id)
          .update({ notes: [log.notes, summary].filter(Boolean).join(' ') });
        log.notes = [log.notes, summary].filter(Boolean).join(' ');
      }

      // Audited inside the transaction (P2-30) when called over HTTP.
      if (req) {
        await auditService.logInTrx(trx, req, {
          action: 'pack', entityType: 'milling_batch', entityId: batchId,
          result: { packing_log_id: log.id, bags_count: bagsCount, total_cost: grandTotal },
        });
      }

      return { ...log, shortages };
    });
  },

  // ── Correct / delete a packing run (owner decision 2026-10-08) ─────────────
  // A run is corrected by applying the DIFFERENCE to store stock and to the
  // packaging cost, never by undoing and re-recording it:
  //   stock  — per item, the run's net draw (its 'packing' movements) moves by
  //            the change in intended count; a draw that needs more than the
  //            store holds is refused (409), never driven negative. Katta is
  //            not drawn here (the yield reconcile is its one mover), so a
  //            katta count change moves nothing until the reconcile re-runs.
  //   GL     — a signed-delta journal for the cost difference on the same
  //            accounts the run posted (DR 6000 / CR 1250, reversed for a cut).
  //   cost   — the run's 'packaging' milling_cost is set to the new total and,
  //            when the batch has yielded, its outputs are re-costed.
  // Deleting is the same with an empty run, then the row goes; the audit log
  // (route) keeps the before-image and the stock/GL trail keeps the movements.
  async updateRun(batchId, logId, body, user) {
    return db.transaction(async (trx) => {
      const { batch, log } = await lockRun(trx, batchId, logId, user);
      const next = await buildNextRun(trx, batch, log, body);
      const result = await applyRunChange(trx, { batch, log, next, userId: user && user.id });
      const [after] = await trx('mill_packing_logs').where('id', log.id).update(next.row).returning('*');
      await afterRunChange(trx, batch, user && user.id, result.costDelta);
      return { before: log, after: after || { ...log, ...next.row }, ...result };
    });
  },

  async deleteRun(batchId, logId, user) {
    return db.transaction(async (trx) => {
      const { batch, log } = await lockRun(trx, batchId, logId, user);
      const result = await applyRunChange(trx, { batch, log, next: null, userId: user && user.id });
      await trx('mill_packing_logs').where('id', log.id).del();
      await afterRunChange(trx, batch, user && user.id, result.costDelta);
      return { deleted: true, before: log, ...result };
    });
  },

  // Set (or clear, with all-null) the batch's packing-spec override.
  async setPackSpec(batchId, { pack_bag_size_kg = null, pack_bag_type = null, pack_master_bag_size_kg = null } = {}, user) {
    return db.transaction(async (trx) => {
      const batch = await trx('milling_batches').where('id', batchId).forUpdate().first();
      if (!batch) throw new NotFoundError('Batch not found.');
      await assertCanEditBatchPacking(trx, user, batch, 'spec');

      const size = num(pack_bag_size_kg);
      const master = num(pack_master_bag_size_kg);
      const type = pack_bag_type == null ? '' : String(pack_bag_type).trim();
      if (!(size > 0) && (type || master > 0)) {
        throw new ValidationError('Give the bag size (kg) — a bag type or master bag alone is not a packing spec.');
      }
      if (size > 0 && master > 0 && master < size) {
        throw new ValidationError('The master bag must hold at least one bag.');
      }
      const before = {
        pack_bag_size_kg: batch.pack_bag_size_kg ?? null,
        pack_bag_type: batch.pack_bag_type ?? null,
        pack_master_bag_size_kg: batch.pack_master_bag_size_kg ?? null,
      };
      const patch = size > 0
        ? { pack_bag_size_kg: size, pack_bag_type: type.slice(0, 100) || null, pack_master_bag_size_kg: master > 0 ? master : null }
        : { pack_bag_size_kg: null, pack_bag_type: null, pack_master_bag_size_kg: null };
      await trx('milling_batches').where('id', batch.id).update({ ...patch, updated_at: trx.fn.now() });
      const updated = { ...batch, ...patch };

      // A yielded batch's outputs carry the bag size: re-stamp them (the
      // reconcile is idempotent and the one katta mover).
      if (isBatchCompleted(batch)) await inventoryService.reconcileBatchKatta(trx, batch.id, user && user.id);

      return { before, after: patch, packSpec: await resolveBatchPackSpec(trx, updated) };
    });
  },
};

// ── Packing-run correction helpers ─────────────────────────────────────────

// Lock the batch and the run, and check the caller may change it.
async function lockRun(trx, batchId, logId, user) {
  const batch = await trx('milling_batches').where('id', batchId).forUpdate().first();
  if (!batch) throw new NotFoundError('Batch not found.');
  const log = await trx('mill_packing_logs').where({ id: logId, batch_id: batch.id }).forUpdate().first();
  if (!log) throw new NotFoundError('Packing run not found on this batch.');
  await assertCanEditBatchPacking(trx, user, batch, 'runs');
  return { batch, log };
}

// The bag / master / polythene a run names, with the count of each and — for a
// katta booked by the run itself ('pack' runs, before P3-05) — the cost it booked.
function runComponents(log) {
  return [
    { role: 'bag', itemId: log.bag_item_id, qty: num(log.bags_count), cost: round2(num(log.bags_count) * num(log.cost_per_bag)) },
    { role: 'master', itemId: log.master_bag_item_id, qty: num(log.master_bags_count), cost: round2(log.master_cost) },
    { role: 'poly', itemId: log.poly_item_id, qty: num(log.poly_count), cost: round2(log.poly_cost) },
  ].filter((c) => c.itemId && c.qty > 0);
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const same = (a, b) => a != null && b != null && String(a) === String(b);

// The corrected run: fields the caller sent replace the run's, the rest stay.
// Costs are filled in by applyRunChange from what the change actually draws.
async function buildNextRun(trx, batch, log, body = {}) {
  const pick = (k, cur) => (has(body, k) ? body[k] : cur);
  const bagItemId = pick('bag_item_id', log.bag_item_id);
  const bagsCount = num(pick('bags_count', log.bags_count));
  if (!bagItemId) throw new ValidationError('Choose the bag.');
  if (!(bagsCount > 0)) throw new ValidationError('Bag count must be greater than zero.');

  let masterItemId = pick('master_bag_item_id', log.master_bag_item_id) || null;
  let masterCount = num(pick('master_bags_count', log.master_bags_count));
  if (!masterItemId || masterCount <= 0) { masterItemId = null; masterCount = 0; }

  let polyItemId = pick('poly_item_id', log.poly_item_id) || null;
  const scopeIn = pick('poly_applies_to', log.poly_applies_to);
  const polyScope = ['bag', 'master', 'both'].includes(scopeIn) ? scopeIn : 'bag';
  const derivedPoly = polyScope === 'master' ? masterCount : polyScope === 'both' ? bagsCount + masterCount : bagsCount;
  let polyCount;
  if (has(body, 'poly_count') && body.poly_count != null && body.poly_count !== '') polyCount = num(body.poly_count);
  else if (!has(body, 'poly_count') && same(polyItemId, log.poly_item_id) && !has(body, 'poly_applies_to')) polyCount = num(log.poly_count);
  else polyCount = derivedPoly;
  if (!polyItemId || polyCount <= 0) { polyItemId = null; polyCount = 0; }

  const ids = [...new Set([bagItemId, masterItemId, polyItemId].filter(Boolean).map(Number))];
  const items = new Map((await trx('mill_items').whereIn('id', ids)).map((i) => [Number(i.id), i]));
  const bagItem = items.get(Number(bagItemId));
  if (!bagItem) throw new NotFoundError('Bag item not found.');
  if (masterItemId && !items.get(Number(masterItemId))) throw new NotFoundError('Master bag item not found.');
  if (polyItemId && !items.get(Number(polyItemId))) throw new NotFoundError('Polythene item not found.');

  const sameBag = same(bagItemId, log.bag_item_id);
  const capacity = sameBag ? num(log.capacity_kg_per_bag) : num(bagItem.capacity_kg);
  const tare = sameBag ? num(log.tare_kg_per_bag) : num(bagItem.tare_weight_kg);
  if (capacity <= 0) throw new ValidationError(`Set a bag capacity (kg per bag) for "${bagItem.name}" before packing.`);

  const packedKg = Number((bagsCount * capacity).toFixed(3));
  const tareKg = Number((bagsCount * tare).toFixed(4));

  // Over-pack guard, as on create — against the other runs, not this one.
  const finishedKg = num(batch.actual_finished_kg);
  if (finishedKg > 0) {
    const others = (await trx('mill_packing_logs').where('batch_id', batch.id).select('id', 'packed_weight_kg'))
      .filter((r) => !same(r.id, log.id))
      .reduce((s, r) => s + num(r.packed_weight_kg), 0);
    if (others + packedKg > finishedKg * 1.01) {
      throw new ValidationError(
        `Over-pack: batch produced ${finishedKg.toLocaleString()} kg, other runs packed ${others.toLocaleString()} kg, this run would pack ${packedKg.toLocaleString()} kg.`
      );
    }
  }

  const components = [
    { role: 'bag', itemId: Number(bagItemId), qty: bagsCount },
    ...(masterItemId ? [{ role: 'master', itemId: Number(masterItemId), qty: masterCount }] : []),
    ...(polyItemId ? [{ role: 'poly', itemId: Number(polyItemId), qty: polyCount }] : []),
  ];
  const nameOf = (id) => items.get(Number(id))?.name || `item ${id}`;
  const breakdown = [`${bagsCount} × ${nameOf(bagItemId)}`]
    .concat(masterItemId ? [`${masterCount} × ${nameOf(masterItemId)} (master)`] : [])
    .concat(polyItemId ? [`${polyCount} × ${nameOf(polyItemId)} (polythene)`] : [])
    .join(' + ');

  return {
    components,
    items,
    breakdown,
    row: {
      bag_item_id: Number(bagItemId),
      bags_count: bagsCount,
      capacity_kg_per_bag: capacity,
      tare_kg_per_bag: tare,
      packed_weight_kg: packedKg,
      tare_weight_kg: tareKg,
      gross_weight_kg: Number((packedKg + tareKg).toFixed(3)),
      master_bag_item_id: masterItemId ? Number(masterItemId) : null,
      master_bags_count: masterItemId ? masterCount : null,
      poly_item_id: polyItemId ? Number(polyItemId) : null,
      poly_count: polyItemId ? polyCount : null,
      poly_applies_to: polyItemId ? polyScope : null,
      notes: has(body, 'notes') ? (body.notes || null) : log.notes,
    },
  };
}

// Move stock and cost from the run as it was to the run as it will be
// (`next` null = the run is being deleted). Returns what moved.
//
// Value moves with the stock: a further draw leaves the store at the item's
// average cost, a return comes back at the cost it left at, and the GL delta
// is exactly that value. A katta booked by a 'pack' run keeps its booking
// rule (count × the unit it was booked at); a 'yield' run's katta carries no
// cost here — the reconcile books it when it draws it.
async function applyRunChange(trx, { batch, log, next, userId }) {
  const label = batch.batch_no || `batch ${batch.id}`;
  const warehouseId = log.warehouse_id ?? null;
  const packMode = (log.katta_cost_mode || 'pack') === 'pack';
  const oldComps = runComponents(log);
  const newComps = next ? next.components : [];

  const sumBy = (comps) => comps.reduce((m, c) => m.set(Number(c.itemId), (m.get(Number(c.itemId)) || 0) + c.qty), new Map());
  const oldQty = sumBy(oldComps);
  const newQty = sumBy(newComps);

  // What the run actually drew, per item, and at what value (a shortfall was
  // flagged, not drawn).
  const moves = await trx('mill_stock_movements')
    .where({ reference_type: 'packing', reference_id: log.id })
    .select('item_id', 'warehouse_id', 'quantity', 'cost_per_unit', 'total_cost');
  const drawn = new Map();
  const drawnVal = new Map();
  for (const m of moves) {
    const id = Number(m.item_id);
    const q = num(m.quantity);
    const v = m.total_cost != null ? num(m.total_cost) : round2(Math.abs(q) * num(m.cost_per_unit));
    drawn.set(id, (drawn.get(id) || 0) - q);
    drawnVal.set(id, round2((drawnVal.get(id) || 0) + (q < 0 ? v : -v)));
  }

  const itemIds = [...new Set([...oldQty.keys(), ...newQty.keys(), ...drawn.keys()])];
  const items = next ? new Map(next.items) : new Map();
  const missing = itemIds.filter((id) => !items.has(id));
  if (missing.length) for (const i of await trx('mill_items').whereIn('id', missing)) items.set(Number(i.id), i);

  const stock = [];
  const afterVal = new Map(); // item → value the run has drawn after the change
  let storeValueOut = 0;      // value that left (+) / came back to (−) the store now
  for (const id of itemIds) {
    const it = items.get(id) || { id, name: `item ${id}` };
    const d = drawn.get(id) || 0;
    const v = drawnVal.get(id) || 0;
    // Katta: the yield reconcile is its one mover. A run never draws it now;
    // one logged under the old rule did, and that draw stands up to the new
    // count (the reconcile draws only the remainder) — the rest goes back.
    const target = isKattaItem(it)
      ? Math.min(d, newQty.get(id) || 0)
      : Math.max(0, d + ((newQty.get(id) || 0) - (oldQty.get(id) || 0)));
    const change = target - d; // > 0 draw more, < 0 return to store
    if (Math.abs(change) < 1e-9) { afterVal.set(id, v); continue; }

    const reason = next
      ? `Packing run #${log.id} corrected for ${label}: ${change > 0 ? `${change} more drawn` : `${-change} returned`}`
      : `Packing run #${log.id} deleted for ${label}: ${-change} returned`;
    const res = await moveStock(trx, {
      itemId: id, warehouseId, qty: -change,
      // A return comes back at the cost it left at.
      valuation: change > 0 ? 'avg' : 'cost',
      unitCost: change > 0 ? null : (d > 0 ? v / d : num(it.avg_cost_per_unit)),
      // A draw the store cannot cover is refused (409), never clamped.
      shortMessage: ({ available }) => `Not enough ${it.name} in store: this change needs ${change} more, only ${available} available. Receive stock first or pack fewer.`,
      movement: {
        movement_type: change > 0 ? 'consumption' : 'return',
        reference_type: 'packing', reference_id: log.id, reason, performed_by: userId || null,
      },
    });
    storeValueOut = round2(storeValueOut - res.value);
    afterVal.set(id, round2(v - res.value));
    stock.push({ itemId: id, item: it.name, change: -change });
  }

  // Cost of each component after the change. A non-katta item's cost is what
  // the run has drawn of it (split by count if one item fills two roles).
  const unitBooked = (role, itemId) => {
    const o = oldComps.find((c) => c.role === role && same(c.itemId, itemId));
    if (o && o.qty > 0) return o.cost / o.qty;
    return num(items.get(Number(itemId))?.avg_cost_per_unit);
  };
  let kattaBefore = 0;
  for (const c of oldComps) if (packMode && isKattaItem(items.get(Number(c.itemId)) || {})) kattaBefore = round2(kattaBefore + c.cost);
  let kattaAfter = 0;
  const roleCost = {};
  for (const c of newComps) {
    const it = items.get(Number(c.itemId)) || {};
    if (isKattaItem(it)) {
      roleCost[c.role] = packMode ? round2(c.qty * unitBooked(c.role, c.itemId)) : 0;
      kattaAfter = round2(kattaAfter + roleCost[c.role]);
    } else {
      const totalQty = newQty.get(Number(c.itemId)) || 0;
      roleCost[c.role] = totalQty > 0 ? round2((afterVal.get(Number(c.itemId)) || 0) * (c.qty / totalQty)) : 0;
    }
  }

  // Cost: what the run booked, moved by exactly the value that moved. A
  // deleted run takes back everything it booked.
  const oldTotal = log.total_cost != null ? round2(log.total_cost) : round2(oldComps.reduce((s, c) => s + c.cost, 0));
  const costDelta = next ? round2(storeValueOut + (kattaAfter - kattaBefore)) : round2(-oldTotal);
  const newTotal = next ? round2(oldTotal + costDelta) : 0;
  if (next) {
    const bag = newComps.find((c) => c.role === 'bag');
    Object.assign(next.row, {
      cost_per_bag: bag && bag.qty > 0 ? Number(((roleCost.bag || 0) / bag.qty).toFixed(4)) : 0,
      master_cost: next.row.master_bag_item_id ? (roleCost.master || 0) : null,
      poly_cost: next.row.poly_item_id ? (roleCost.poly || 0) : null,
      total_cost: newTotal,
    });
  }

  // The run's own 'packaging' milling cost line carries its total into
  // residual costing (source packing_run — MIL-23).
  const tag = `(log #${log.id})`;
  const costRows = (await trx('milling_costs').where({ batch_id: batch.id, category: 'packaging' }))
    .filter((r) => (r.source === 'packing_run' && same(r.source_id, log.id))
      || (r.source == null && String(r.notes || '').includes(tag)));
  const [costRow, ...dupes] = costRows;
  for (const d of dupes) await trx('milling_costs').where({ id: d.id }).del();
  if (newTotal > 0) {
    const notes = `Packing: ${next.breakdown} ${tag}`;
    const patch = { amount: newTotal, notes, source: 'packing_run', source_id: log.id };
    if (costRow) await trx('milling_costs').where({ id: costRow.id }).update({ ...patch, updated_at: trx.fn.now() });
    else await trx('milling_costs').insert({ batch_id: batch.id, category: 'packaging', currency: 'PKR', created_by: userId || null, ...patch });
  } else if (costRow) {
    await trx('milling_costs').where({ id: costRow.id }).del();
  }

  const journal = await postPackingDelta(trx, {
    batch, delta: costDelta, userId,
    what: next ? `Packing run #${log.id} corrected (${next.breakdown})` : `Packing run #${log.id} deleted`,
  });

  return { stock, costBefore: oldTotal, costAfter: newTotal, costDelta, journalId: journal ? journal.id : null };
}

// Signed-delta journal for a packing-cost change, on the accounts the run
// posted: DR 6000 / CR 1250 for an increase, DR 1250 / CR 6000 for a cut.
// Never reverse + repost. A cut is booked only when the batch has a posted
// packing journal to cut from.
async function postPackingDelta(trx, { batch, delta, userId, what }) {
  if (Math.abs(delta) <= 0.01) return null;
  const refNo = batch.batch_no || `BATCH-${batch.id}`;
  if (delta < 0) {
    const posted = await trx('journal_entries').where({ ref_type: 'Mill Packing', ref_no: refNo, status: 'Posted' }).first();
    if (!posted) return null;
  }
  const amt = round2(Math.abs(delta));
  return postStoreJournal(trx, {
    amount: delta,
    refType: 'Mill Packing',
    refNo,
    description: `${what} for batch ${refNo} — Rs ${Math.round(amt).toLocaleString('en-PK')} ${delta > 0 ? 'added' : 'reduced'}`,
    userId,
    what: 'The packing change',
  });
}

// A yielded batch: re-cost its outputs when the cost moved, and re-run the
// katta reconcile — it re-reads the runs (katta counts, the packed bag size)
// and is idempotent, so a corrected katta count moves katta exactly once.
async function afterRunChange(trx, batch, userId, costDelta) {
  // A corrected / deleted run after the completion: absorb the change into
  // (or back out of) finished stock — the 6000/1250 delta above moved the
  // expense side.
  await postProcessingDelta(trx, accountingService, { batch, delta: num(costDelta), label: 'packaging (packing run corrected)', userId });
  if (!(num(batch.actual_finished_kg) > 0)) return;
  if (Math.abs(num(costDelta)) > 0.01) {
    await inventoryService.recomputeBatchOutputsAfterPriceChange(trx, batch.id, { userId });
  }
  await inventoryService.reconcileBatchKatta(trx, batch.id, userId);
}

module.exports = packingService;
