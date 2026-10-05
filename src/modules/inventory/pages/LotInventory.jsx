import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PartyLink from '../../../shared/components/PartyLink';
import {
  Package, Search, Plus, Eye, RefreshCw, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useLotInventoryPage, useLotInventoryTotals } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';
import { LoadingSpinner, ErrorState, EmptyState } from '../../../components/LoadingState';
import StatusBadge from '../../../components/StatusBadge';
import PurchaseLotDrawer from '../components/PurchaseLotDrawer';
import useCanSeeCost from '../../../hooks/useCanSeeCost';
import { fromKg, UNITS } from '../../../shared/utils/unitConversion';

// Lots per page. Filters, search and the KPI totals all run on the server, so
// a page only bounds what is drawn — never what is counted.
const PAGE_SIZE = 100;

const STATUS_TABS = ['All', 'Available', 'Reserved', 'Closed'];
const TYPE_TABS = ['All', 'raw', 'finished', 'byproduct'];
const ENTITY_TABS = ['All', 'mill', 'export'];

// Subtype = what the byproduct actually is. Derived from item_name (and
// grade for broken). Lets the user filter byproducts to just "Sortex
// Rejects" or "Broken B2" instead of the whole bucket.
const SUBTYPE_OPTIONS = [
  { value: 'All',           label: 'All' },
  { value: 'finished',      label: 'Finished Rice' },
  { value: 'rice-in',       label: 'Incoming Rice' },
  { value: 'broken-b1',     label: 'B1' },
  { value: 'broken-b2',     label: 'B2' },
  { value: 'broken-b3',     label: 'B3' },
  { value: 'broken-csr',    label: 'CSR' },
  { value: 'broken-sg',     label: 'Short Grain' },
  { value: 'broken',        label: 'Broken (ungraded)' },
  { value: 'sortex',        label: 'Sortex' },
  { value: 'powder',        label: 'Powder' },
  { value: 'sweeping',      label: 'Sweeping' },
  { value: 'choba',         label: 'Choba' },
];

// A blended broken lot carries a batch-scoped grade ('M-033-B1'); strip the
// blend_batch_no prefix to recover the bare grade so it still classifies as B1.
function baseGrade(l) {
  const g = l.grade || '';
  if (l.processingType === 'blended' && l.blendBatchNo && g.startsWith(`${l.blendBatchNo}-`)) {
    return g.slice(l.blendBatchNo.length + 1);
  }
  return g;
}
function lotSubtype(l) {
  const name = (l.itemName || '').toLowerCase();
  const grade = baseGrade(l).toLowerCase();
  if (l.type === 'finished') return 'finished';
  if (l.type === 'raw') return 'rice-in';
  // Grade lots are named by grade (B1/B2/CSR/…) with the grade on the lot;
  // classify by grade first, then a legacy generic "broken" lot.
  if (grade === 'b1') return 'broken-b1';
  if (grade === 'b2') return 'broken-b2';
  if (grade === 'b3') return 'broken-b3';
  if (grade === 'csr') return 'broken-csr';
  if (grade === 'short grain' || grade === 'sg') return 'broken-sg';
  if (name.includes('broken')) return 'broken';
  if (name.includes('sortex')) return 'sortex';
  if (name.includes('powder')) return 'powder';
  if (name.includes('sweeping')) return 'sweeping';
  if (name.includes('choba')) return 'choba';
  if (name.includes('bran')) return 'bran';
  if (name.includes('husk')) return 'husk';
  return 'other';
}

function subtypeBadgeClass(s) {
  if (s === 'finished')        return 'bg-blue-50 text-blue-700';
  if (s === 'rice-in')         return 'bg-slate-50 text-slate-700';
  if (s && s.startsWith('broken')) return 'bg-amber-50 text-amber-700';
  if (s === 'sortex')          return 'bg-amber-50 text-amber-700';
  if (s === 'choba')           return 'bg-teal-50 text-teal-700';
  if (s === 'bran')            return 'bg-emerald-50 text-emerald-700';
  if (s === 'husk')            return 'bg-purple-50 text-purple-700';
  return 'bg-gray-50 text-gray-600';
}

function subtypeLabel(s) {
  const opt = SUBTYPE_OPTIONS.find(o => o.value === s);
  return opt ? opt.label.trim() : s;
}

function fmtPKR(v) { return 'Rs ' + (parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Heuristic mirroring the backend deriveProductCode — strings that
// look like auto-generated SKUs (PRD-DATETIME-…, PROD-…, long-digit IDs)
// are hidden from the variety badge so old data doesn't clutter the table.
// NB: no length cap — real rice variety names ("Super Fine Long Grain White
// Rice") run well over 18 chars and must NOT be mistaken for a SKU.
function looksLikeAutoSku(s) {
  if (!s) return false;
  const u = s.toUpperCase();
  if (/^PRD[-_]\d{6,}/.test(u)) return true;
  if (/^PROD[-_]/.test(u)) return true;
  if (/\d{8,}/.test(u)) return true;
  return false;
}

// Human-readable rice type for a lot: a real variety, else the product NAME
// (e.g. "1121 Basmati White Rice"), and only an auto-generated product code
// (PRD-…) as a last resort — so the UI shows the name, not the SKU.
function riceTypeName(lot) {
  const v = lot.variety;
  if (v && !looksLikeAutoSku(v)) return v;
  if (lot.productName) return lot.productName;
  if (lot.productCode && !looksLikeAutoSku(lot.productCode)) return lot.productCode;
  return lot.itemName || v || lot.productCode || null;
}

/**
 * Single-lot row renderer — used by both flat view and the expanded
 * children inside grouped view (with a slight indent in the latter).
 */
function renderLotRow(lot, displayUnit, navigate, indented, showCost = true) {
  const netKg = parseFloat(lot.netWeightKg) || parseFloat(lot.qty) || 0;
  const availKg = (parseFloat(lot.availableQty) || 0);
  const bw = parseFloat(lot.bagWeightKg) || 50;
  const variety = riceTypeName(lot);
  const grade = lot.grade;
  // By-products are named by category in item_name (B1, Powder, …) which already
  // shows in the Subtype column. The "Item / Variety" column should show the rice
  // TYPE the by-product came from (its variety), so it reads as a name, not "B1".
  const displayName = lot.type === 'byproduct' ? (variety || lot.itemName) : lot.itemName;
  const itemLower = (displayName || '').toLowerCase();
  const varLower = (variety || '').toLowerCase();
  const varIsRedundant = !variety
    || looksLikeAutoSku(variety)
    || varLower === itemLower
    || itemLower.includes(varLower) || varLower.includes(itemLower);
  const s = lotSubtype(lot);
  return (
    <tr
      key={lot.id}
      className={`cursor-pointer hover:bg-gray-50 group ${indented ? 'bg-slate-50/40' : ''}`}
      onClick={() => navigate(`/lot-inventory/${lot.lotNo || lot.id}`)}
    >
      <td data-label="Lot No" className={`font-medium text-blue-600 whitespace-nowrap ${indented ? 'pl-8' : ''}`}>{lot.lotNo}</td>
      <td data-label="Subtype" className="mob-hide">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${subtypeBadgeClass(s)}`}>
          {subtypeLabel(s)}
        </span>
      </td>
      <td data-label="Item / Variety" className="max-w-[16rem]">
        <div className="text-gray-900 font-medium truncate flex items-center gap-1.5" title={displayName}>
          <span className="truncate">{displayName}</span>
          {lot.ownership === 'client' && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 whitespace-nowrap shrink-0"
              title={`Service Milling — client-owned stock${lot.ownerCustomerName ? ` (${lot.ownerCustomerName})` : ''}. Not company inventory.`}
            >
              SERVICE{lot.ownerCustomerName ? ` · ${lot.ownerCustomerName}` : ''}
            </span>
          )}
        </div>
        {(!varIsRedundant || grade || lot.processingType === 'blended') && (
          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1 flex-wrap">
            {lot.processingType === 'blended' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700" title={lot.blendBatchNo ? `Blended — ${lot.blendBatchNo}` : 'Blended'}>
                BLENDED{lot.blendBatchNo ? ` · ${lot.blendBatchNo}` : ''}
              </span>
            )}
            {!varIsRedundant && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 truncate max-w-[10rem]" title={variety}>
                {variety}
              </span>
            )}
            {grade && <span className="text-gray-400">({grade})</span>}
          </div>
        )}
      </td>
      <td data-label="Supplier" className="mob-hide text-gray-600 max-w-[10rem] truncate" title={lot.supplierName || ''}><PartyLink type="supplier" id={lot.supplierId} name={lot.supplierName} /></td>
      <td data-label="Warehouse" className="mob-hide text-gray-600 text-xs max-w-[8rem] truncate" title={lot.warehouseName || ''}>{lot.warehouseName || '—'}</td>
      <td data-label="Stock" className="text-right font-medium tabular-nums">{fromKg(netKg, displayUnit, bw).toLocaleString()}</td>
      <td data-label="Available" className="text-right tabular-nums text-emerald-600 font-medium">{fromKg(availKg, displayUnit, bw).toLocaleString()}</td>
      {showCost && <td data-label="Landed/KG" className="mob-hide text-right tabular-nums text-xs font-medium">{fmtPKR(lot.landedCostPerKg)}</td>}
      {showCost && <td data-label="Value" className="text-right tabular-nums font-medium">{fmtPKR(lot.landedCostTotal)}</td>}
      <td data-label="Quality" className="mob-hide text-center">
        <div className="flex items-center justify-center gap-1 text-xs whitespace-nowrap">
          {lot.moisturePct && <span className="text-blue-600" title="Moisture">{lot.moisturePct}%M</span>}
          {lot.brokenPct && <span className="text-amber-600" title="Broken">{lot.brokenPct}%B</span>}
        </div>
      </td>
      <td data-label="Status" className="text-center"><StatusBadge status={lot.status} /></td>
      <td className={`mob-hide text-center sticky right-0 group-hover:bg-gray-50 shadow-[inset_1px_0_0_rgba(0,0,0,0.06)] z-10 ${indented ? 'bg-slate-50/40' : 'bg-white'}`}>
        <button onClick={e => { e.stopPropagation(); navigate(`/lot-inventory/${lot.lotNo || lot.id}`); }} className="btn btn-ghost btn-sm">
          <Eye className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}

export default function LotInventory() {
  const { addToast, suppliersList, warehousesList, productsList } = useApp();
  const navigate = useNavigate();
  // Landed cost / value / "capital locked" are hidden from roles without
  // reports.view_cost (Mill Operator, QC Analyst); the API nulls them too.
  const showCost = useCanSeeCost();
  const [statusFilter, setStatusFilter] = useState('Available');
  const [typeFilter, setTypeFilter] = useState('All');
  const [subtypeFilter, setSubtypeFilter] = useState('All');
  const [entityFilter, setEntityFilter] = useState('All');
  // Ownership scope: 'company' (default — company-owned only), 'client'
  // (service-milling client stock only), 'all'. Sent to the API so client-owned
  // stock never mixes into the default company inventory view.
  const [ownershipFilter, setOwnershipFilter] = useState('company');
  const [processingFilter, setProcessingFilter] = useState('All'); // All | single_variety | blended
  const [searchTerm, setSearchTerm] = useState('');
  // Grouped vs flat view. Grouped collapses output lots (finished /
  // broken grades / sortex / bran / husk) into one summary row per
  // (subtype, variety) — raw rice lots stay as individual rows because
  // each is a distinct purchase.
  // Grouping mode: 'rice-type' (one row per rice variety — every subtype of that
  // rice together), 'subtype' (one row per category — all B1 together, all B2…),
  // or 'flat' (every lot on its own row).
  const [viewMode, setViewMode] = useState('subtype');
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [displayUnit, setDisplayUnit] = useState('katta');
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Allow ?action=new (used by the Finance Purchases "+Add Purchase"
  // dropdown) to deep-link straight into the create modal.
  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setShowPurchaseModal(true);
      const next = new URLSearchParams(searchParams);
      next.delete('action');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Search is sent to the server (it searches every lot, not just one page);
  // debounce so each keystroke doesn't fire a request.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);
  // Any change of filter starts again from the first page: the page number is
  // remembered against the filters it was chosen under.
  const filterKey = JSON.stringify([statusFilter, typeFilter, subtypeFilter, entityFilter, ownershipFilter, processingFilter, debouncedSearch]);
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (fn) => setPageState({ key: filterKey, page: typeof fn === 'function' ? fn(page) : fn });

  const { data: pageData, isLoading, isFetching, error, refetch } = useLotInventoryPage({
    page,
    limit: PAGE_SIZE,
    ...(statusFilter !== 'All' && { status: statusFilter }),
    ...(ownershipFilter !== 'company' && { ownership: ownershipFilter }),
    ...(typeFilter !== 'All' && { type: typeFilter }),
    ...(entityFilter !== 'All' && { entity: entityFilter }),
    ...(processingFilter !== 'All' && { processing_type: processingFilter }),
    ...(subtypeFilter !== 'All' && { subtype: subtypeFilter }),
    ...(debouncedSearch && { search: debouncedSearch }),
  });
  const filtered = useMemo(() => pageData?.lots || [], [pageData]);
  const pagination = pageData?.pagination || { page: 1, totalPages: 1, total: filtered.length };

  // Summary KPIs — totalled on the server over EVERY lot in the status /
  // ownership scope, not over the page of lots that happens to be loaded.
  const { data: kpis = { totalLots: 0, totalKg: 0, availKg: 0, reservedKg: 0, soldKg: 0, totalValue: 0 } } = useLotInventoryTotals({
    status: statusFilter === 'All' ? 'all' : statusFilter,
    ...(ownershipFilter !== 'company' && { ownership: ownershipFilter }),
  });

  function toggleGroup(key) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function getDisplayQty(kg) { return fromKg(kg, displayUnit); }
  function getUnitLabel() { return displayUnit === 'katta' ? 'Katta' : displayUnit === 'maund' ? 'Maund' : displayUnit === 'ton' ? 'Ton' : 'KG'; }

  // Collapse lots into expandable groups along the chosen dimension:
  //  • 'rice-type' — one row per rice variety (its finished + every by-product
  //    grade + raw lots together), blends kept separate per recipe.
  //  • 'subtype'   — one row per category (all B1 across rice types, all B2, …).
  // Only unclassifiable ('other') lots stay standalone.
  const visualGroups = useMemo(() => {
    if (viewMode === 'flat') return { groups: [], standalone: filtered };
    const byRiceType = viewMode === 'rice-type';
    const map = new Map();
    const standalone = [];
    for (const lot of filtered) {
      const s = lotSubtype(lot);
      if (s === 'other') { standalone.push(lot); continue; }
      const variety = riceTypeName(lot) || '—';
      // Blended output is grouped per recipe (blend_batch_no) in rice-type mode,
      // so each blend batch stays its own row and never merges with pure rice.
      const blended = lot.processingType === 'blended';
      const blendKey = blended ? (lot.blendBatchNo || 'blend') : 'pure';
      // By Rice Type → key on the variety (every B1/B2/finished of that rice
      // together). By Subtype → key on the category (all B1 across rice types).
      const key = byRiceType ? `${variety}|${blendKey}` : s;
      if (!map.has(key)) {
        map.set(key, {
          key,
          subtype: byRiceType ? null : s,
          variety: byRiceType ? variety : null,
          lots: [],
          blended: byRiceType ? blended : false,
          blendBatchNo: (byRiceType && blended) ? lot.blendBatchNo : null,
        });
      }
      map.get(key).lots.push(lot);
    }
    const groups = Array.from(map.values()).map((g) => {
      const totalKg = g.lots.reduce((s, l) => s + (parseFloat(l.netWeightKg) || 0), 0);
      const availKg = g.lots.reduce((s, l) => s + ((parseFloat(l.availableQty) || 0)), 0);
      const totalValue = g.lots.reduce((s, l) => s + (parseFloat(l.landedCostTotal) || 0), 0);
      const weightedLanded = totalKg > 0
        ? g.lots.reduce((s, l) => s + ((parseFloat(l.landedCostPerKg) || 0) * (parseFloat(l.netWeightKg) || 0)), 0) / totalKg
        : 0;
      const batchRefSet = new Set();
      for (const l of g.lots) {
        const m = (l.batchRef || '').match(/batch-(\d+)/);
        if (m) batchRefSet.add(parseInt(m[1], 10));
      }
      // Distinct rice types / categories inside the group, for the header when
      // the grouping dimension leaves the other column mixed.
      const varieties = Array.from(new Set(g.lots.map(l => riceTypeName(l) || '—')));
      const subtypes = Array.from(new Set(g.lots.map(l => subtypeLabel(lotSubtype(l)))));
      return {
        ...g,
        totalKg,
        availKg,
        totalValue,
        weightedLanded,
        lotCount: g.lots.length,
        batchIds: Array.from(batchRefSet).sort((a, b) => a - b),
        varieties,
        subtypes,
      };
    });
    // Sort groups: lots-out-of-stock at the bottom, otherwise by total qty desc
    groups.sort((a, b) => (b.availKg + b.totalKg / 1000) - (a.availKg + a.totalKg / 1000));
    return { groups, standalone };
  }, [filtered, viewMode]);

  if (isLoading) return <LoadingSpinner message="Loading lot inventory..." />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  return (
    <div className="space-y-5 pb-4">
      {/* ─── HERO BAND ────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500 p-4 sm:p-6 text-white shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, white 0%, transparent 60%)' }} />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-80 mb-1">
              <Package size={14} /> Lot inventory{showCost ? ' · Capital locked' : ''}
            </div>
            <div className="text-2xl sm:text-4xl font-bold leading-tight tabular-nums break-words">
              {showCost ? fmtPKR(kpis.totalValue) : `${Math.round(kpis.totalKg).toLocaleString()} kg`}
            </div>
            <div className="text-xs opacity-90 mt-1">
              {kpis.totalLots} lots · {Math.round(kpis.totalKg).toLocaleString()} kg total
              {kpis.availKg    > 0 && <> · Available {Math.round(kpis.availKg).toLocaleString()} kg</>}
              {kpis.reservedKg > 0 && <> · Reserved {Math.round(kpis.reservedKg).toLocaleString()} kg</>}
              {kpis.soldKg     > 0 && <> · Sold {Math.round(kpis.soldKg).toLocaleString()} kg</>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowPurchaseModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white text-blue-700 hover:bg-blue-50 transition-colors shadow-sm">
              <Plus size={13} /> New Purchase Lot
            </button>
            <button onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 ring-1 ring-white/30 transition-colors">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* KPI Summary — hidden on phones (the hero band above already shows these
          numbers); the extra 6 cards would just make the page scroll forever. */}
      <div className="hidden sm:grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Lots</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{kpis.totalLots}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Total Stock</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{getDisplayQty(kpis.totalKg).toLocaleString()} <span className="text-sm font-normal text-gray-400">{getUnitLabel()}</span></p>
          <p className="text-xs text-gray-400">{Math.round(kpis.totalKg).toLocaleString()} kg</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-4">
          <p className="text-xs font-medium text-emerald-600 uppercase">Available</p>
          <p className="text-xl font-bold text-emerald-700 mt-1">{getDisplayQty(kpis.availKg).toLocaleString()} <span className="text-sm font-normal text-emerald-500">{getUnitLabel()}</span></p>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-100 p-4">
          <p className="text-xs font-medium text-amber-600 uppercase">Reserved</p>
          <p className="text-xl font-bold text-amber-700 mt-1">{getDisplayQty(kpis.reservedKg).toLocaleString()} <span className="text-sm font-normal text-amber-500">{getUnitLabel()}</span></p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
          <p className="text-xs font-medium text-blue-600 uppercase">Sold / Dispatched</p>
          <p className="text-xl font-bold text-blue-700 mt-1">{getDisplayQty(kpis.soldKg).toLocaleString()} <span className="text-sm font-normal text-blue-500">{getUnitLabel()}</span></p>
        </div>
        {showCost && (
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-medium text-gray-500 uppercase">Total Value</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{fmtPKR(kpis.totalValue)}</p>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Status */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {STATUS_TABS.map(tab => (
              <button key={tab} onClick={() => setStatusFilter(tab)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${statusFilter === tab ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}>
                {tab}
              </button>
            ))}
          </div>
          {/* Type */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {TYPE_TABS.map(tab => (
              <button key={tab} onClick={() => setTypeFilter(tab)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap capitalize ${typeFilter === tab ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}>
                {tab === 'All' ? 'All Types' : tab === 'raw' ? 'Raw Rice' : tab === 'finished' ? 'Finished Rice' : 'Byproducts'}
              </button>
            ))}
          </div>
          {/* Pure vs Blended */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {[['All', 'All Stock'], ['single_variety', 'Pure'], ['blended', 'Blended']].map(([val, label]) => (
              <button key={val} onClick={() => setProcessingFilter(val)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${processingFilter === val ? (val === 'blended' ? 'bg-white text-purple-600 shadow-sm' : 'bg-white text-blue-600 shadow-sm') : 'text-gray-600 hover:text-gray-800'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* Subtype (more granular than Type — drills into broken grades, sortex, etc.) */}
          <select
            value={subtypeFilter}
            onChange={(e) => setSubtypeFilter(e.target.value)}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 bg-white text-gray-700 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            {SUBTYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {/* Entity/Location */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {ENTITY_TABS.map(tab => (
              <button key={tab} onClick={() => setEntityFilter(tab)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap capitalize ${entityFilter === tab ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}>
                {tab === 'All' ? 'All Locations' : tab === 'mill' ? 'Mill' : 'Export Warehouse'}
              </button>
            ))}
          </div>
          {/* Ownership scope — keep client-owned Service Milling stock out of the
              default company view; switch to see client stock or everything. */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {[
              { v: 'company', l: 'Company' },
              { v: 'client', l: 'Service (Client)' },
              { v: 'all', l: 'All' },
            ].map(o => (
              <button key={o.v} onClick={() => setOwnershipFilter(o.v)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${ownershipFilter === o.v ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}>
                {o.l}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search lots, supplier, variety, warehouse..." className="form-input pl-9 py-1.5 text-sm w-full" />
          </div>
          <span className="text-xs text-gray-400 whitespace-nowrap">
            {pagination.total.toLocaleString()} {pagination.total === 1 ? 'lot' : 'lots'}{isFetching ? ' · loading…' : ''}
          </span>
          {/* Grouping dimension: By Rice Type (one row per variety) or By
              Subtype (one row per category — all B1 together, …); each group
              expands to its underlying lots. "All lots" disables grouping. */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {[
              { v: 'rice-type', l: 'By Rice Type' },
              { v: 'subtype',   l: 'By Subtype' },
              { v: 'flat',      l: 'All lots' },
            ].map(o => (
              <button key={o.v} onClick={() => setViewMode(o.v)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${viewMode === o.v ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
                {o.l}
              </button>
            ))}
          </div>
          {/* Unit toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5 ml-auto">
            {UNITS.map(u => (
              <button key={u} onClick={() => setDisplayUnit(u)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${displayUnit === u ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
                {u === 'katta' ? 'Katta' : u === 'maund' ? 'Maund' : u === 'ton' ? 'Ton' : 'KG'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lot Table */}
      {filtered.length === 0 ? (
        <EmptyState icon={Package} title="No lots found" description="Create a purchase lot to get started." />
      ) : (
        <div className="table-container mobile-cards">
          <div className="table-scroll relative">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left">Lot No</th>
                  <th className="text-left">Subtype</th>
                  <th className="text-left">Item / Variety</th>
                  <th className="text-left">Supplier</th>
                  <th className="text-left">Warehouse</th>
                  <th className="text-right">Stock ({getUnitLabel()})</th>
                  <th className="text-right">Available</th>
                  {showCost && <th className="text-right">Landed/KG</th>}
                  {showCost && <th className="text-right">Value</th>}
                  <th className="text-center">Quality</th>
                  <th className="text-center">Status</th>
                  {/* Actions sticks to the right edge so the Eye icon
                      is always visible without horizontal scrolling. */}
                  <th className="text-center sticky right-0 bg-white shadow-[inset_1px_0_0_rgba(0,0,0,0.06)] z-10">Actions</th>
                </tr>
              </thead>
              <tbody>
                {viewMode === 'flat'
                  ? filtered.map((lot) => renderLotRow(lot, displayUnit, navigate, false, showCost))
                  : (
                    <>
                      {/* Standalone lots (raw rice purchases) — each one
                          is a distinct receipt, never grouped. */}
                      {visualGroups.standalone.map((lot) => renderLotRow(lot, displayUnit, navigate, false, showCost))}
                      {/* One summary row per (subtype, variety) group;
                          click to expand the individual lots beneath. */}
                      {visualGroups.groups.map((g) => {
                        const open = expandedGroups.has(g.key);
                        const bw = 50;
                        return (
                          <React.Fragment key={g.key}>
                            <tr
                              className={`cursor-pointer hover:bg-blue-50 group bg-gradient-to-r from-slate-50 to-white border-l-4 ${open ? 'border-blue-500' : 'border-transparent'}`}
                              onClick={() => toggleGroup(g.key)}
                            >
                              <td data-label="Group" className="font-medium text-slate-700 whitespace-nowrap">
                                <span className="inline-flex items-center gap-1">
                                  <span className="text-gray-400">{open ? '▾' : '▸'}</span>
                                  {g.lotCount} {g.lotCount === 1 ? 'lot' : 'lots'}
                                </span>
                              </td>
                              <td data-label="Subtype" className="mob-hide">
                                {g.subtype ? (
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap ${subtypeBadgeClass(g.subtype)}`}>
                                    {subtypeLabel(g.subtype)}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap bg-gray-100 text-gray-600" title={g.subtypes.join(', ')}>
                                    {g.subtypes.length <= 2 ? g.subtypes.join(' · ') : `${g.subtypes.length} categories`}
                                  </span>
                                )}
                              </td>
                              <td data-label="Rice type" className="max-w-[16rem]">
                                <div className="text-gray-900 font-semibold truncate flex items-center gap-1.5" title={(g.variety || g.varieties.join(', '))}>
                                  {g.blended && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700 shrink-0" title={g.blendBatchNo ? `Blended — ${g.blendBatchNo}` : 'Blended'}>
                                      BLENDED{g.blendBatchNo ? ` · ${g.blendBatchNo}` : ''}
                                    </span>
                                  )}
                                  <span className="truncate">{g.variety || (g.varieties.length === 1 ? g.varieties[0] : `${g.varieties.length} rice types`)}</span>
                                </div>
                                {g.batchIds.length > 0 && (
                                  <div className="text-[11px] text-gray-500 mt-0.5 truncate" title={`From batches: ${g.batchIds.join(', ')}`}>
                                    from {g.batchIds.length} batch{g.batchIds.length === 1 ? '' : 'es'}
                                  </div>
                                )}
                              </td>
                              <td className="mob-hide text-gray-400 text-xs">—</td>
                              <td className="mob-hide text-gray-400 text-xs">—</td>
                              <td data-label="Stock" className="text-right font-semibold tabular-nums">{fromKg(g.totalKg, displayUnit, bw).toLocaleString()}</td>
                              <td data-label="Available" className="text-right tabular-nums text-emerald-700 font-semibold">{fromKg(g.availKg, displayUnit, bw).toLocaleString()}</td>
                              {showCost && <td className="mob-hide text-right tabular-nums text-xs">{g.weightedLanded ? fmtPKR(g.weightedLanded) : '—'}</td>}
                              {showCost && <td data-label="Value" className="text-right tabular-nums font-semibold">{fmtPKR(g.totalValue)}</td>}
                              <td className="mob-hide text-center text-xs text-gray-400">—</td>
                              <td className="mob-hide text-center text-[11px] text-gray-500">{open ? 'expanded' : 'click to expand'}</td>
                              <td className="mob-hide text-center sticky right-0 bg-gradient-to-r from-slate-50 to-white group-hover:bg-blue-50 shadow-[inset_1px_0_0_rgba(0,0,0,0.06)] z-10">
                                <span className="text-gray-400 text-xs">{open ? '▾' : '▸'}</span>
                              </td>
                            </tr>
                            {open && g.lots.map((lot) => renderLotRow(lot, displayUnit, navigate, true, showCost))}
                          </React.Fragment>
                        );
                      })}
                    </>
                  )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm text-gray-600">
          <span className="text-xs text-gray-500">
            Showing {((pagination.page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(pagination.page * PAGE_SIZE, pagination.total).toLocaleString()} of {pagination.total.toLocaleString()} lots
          </span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              className="btn btn-ghost btn-sm disabled:opacity-40" aria-label="Previous page">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs tabular-nums px-1">Page {pagination.page} of {pagination.totalPages}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))} disabled={page >= pagination.totalPages}
              className="btn btn-ghost btn-sm disabled:opacity-40" aria-label="Next page">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Purchase Lot Drawer (modern slide-from-right UX) */}
      <PurchaseLotDrawer
        isOpen={showPurchaseModal}
        onClose={() => setShowPurchaseModal(false)}
        suppliers={suppliersList}
        warehouses={warehousesList}
        products={productsList}
        addToast={addToast}
        onSuccess={refetch}
      />
    </div>
  );
}
