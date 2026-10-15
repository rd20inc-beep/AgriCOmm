/**
 * The ONE hook layer for report endpoints (P4-05, TEC-12).
 *
 * Contract:
 *   - every report hook goes through useReport → reportingApi → /api/reporting
 *   - CASING: what a hook returns is ALWAYS camelCase (transformKeys) — no
 *     consumer reads snake_case or writes `a.fooBar ?? a.foo_bar`
 *   - a LIST report returns the envelope { rows, totals, pagination, meta }:
 *       rows        the rows the server sent (one page when paged)
 *       totals      server aggregates over the WHOLE filter (null if none)
 *       pagination  { page, limit, total, totalPages, returned, truncated }
 *       meta        { from, to, allTime, asOf, unit, currency, basis }
 *     so a screen can never show a page as if it were everything
 *   - an OBJECT report returns the camelCased body
 *   - params follow the server contract (backend analytics/reportContract.js):
 *     from_date / to_date / entity / page / limit — never dateFrom or from
 *
 * The old copies in api/queries.js are re-exported from here, and the dead
 * api/hooks.js (useApi / useReport with mock fallback, no importers) is gone.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { reportingApi } from './services';
import { transformKeys } from '../../../api/transforms';

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** Normalise any list-report body into { rows, totals, pagination, meta } (camelCase). Pure. */
export function reportEnvelope(res, listKey) {
  const body = isObj(res) ? res : (Array.isArray(res) ? { data: res } : {});
  const inner = isObj(body.data) ? body.data : body;
  const candidates = [
    listKey && inner[listKey], listKey && body[listKey],
    inner.rows, body.rows,
    Array.isArray(body.data) ? body.data : null,
    inner.data,
  ];
  const rows = candidates.find(Array.isArray) || [];
  const pick = (k) => (inner[k] !== undefined ? inner[k] : (body[k] !== undefined ? body[k] : null));
  return transformKeys({ rows, totals: pick('totals'), pagination: pick('pagination'), meta: pick('meta') });
}

/** An object report's body, camelCased. Pure. */
export function reportObject(res) {
  if (!isObj(res)) return {};
  return transformKeys(res.data !== undefined && !Array.isArray(res.data) ? (res.data || {}) : res);
}

/** Drop blank params so the cache key and the URL agree. */
export function cleanParams(params = {}) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') out[k] = v;
  return out;
}

/**
 * @param name  reportingApi method
 * @param params  query (server contract names)
 * @param opts { list, listKey, enabled, staleTime }
 */
export function useReport(name, params = {}, { list = false, listKey, enabled = true, staleTime = 30 * 1000 } = {}) {
  const p = cleanParams(params);
  return useQuery({
    queryKey: ['report', name, p],
    queryFn: async () => {
      const res = await reportingApi[name](p);
      return list ? reportEnvelope(res, listKey) : reportObject(res);
    },
    enabled,
    staleTime,
    placeholderData: list ? keepPreviousData : undefined,
  });
}

/**
 * Page number that resets to 1 whenever the filters change — without a
 * setState-in-effect: the page is remembered together with the filters it
 * was chosen for.
 */
export function usePageFor(filters) {
  const key = JSON.stringify(filters || {});
  const [state, setState] = useState({ key, page: 1 });
  const page = state.key === key ? state.page : 1;
  return [page, (p) => setState({ key, page: Math.max(1, p) })];
}

// ── Hub tiles / tabs ─────────────────────────────────────────────────────
export const useExecutiveSummary = (params) => useReport('executiveSummary', params);
export const useOrderProfitability = (params) => useReport('orderProfitability', params, { list: true });
export const useCustomerProfitability = (params) => useReport('customerProfitability', params, { list: true });
export const useCountryAnalysis = (params) => useReport('countryAnalysis', params, { list: true });
export const useLotTracker = (params) => useReport('lotTracker', params, { list: true, staleTime: 10 * 1000 });
export const useSalesTracker = (params) => useReport('salesTracker', params, { list: true, staleTime: 10 * 1000 });
export const useBatchMargin = (params) => useReport('batchMargin', params, { list: true, listKey: 'batches', staleTime: 10 * 1000 });
export const useLocalSalesReport = (params, opts = {}) => useReport('localSales', params, { list: true, ...opts });
export const useStockAgingReport = () => useReport('stockAging', {}, { list: true, listKey: 'aging' });
export const usePrintableStock = (groupBy = 'product', status = 'Available') =>
  useReport('printableStock', { group_by: groupBy, status });
export const useSupplierQualityRanking = (params) => useReport('supplierQualityRanking', params, { list: true, listKey: 'suppliers' });
export const useCashForecast = (params) => useReport('cashForecast', params);
export const useKpiBenchmarks = (params) => useReport('kpiBenchmarks', params, { list: true });
export const useMillEfficiency = (params) => useReport('millEfficiency', params, { list: true });
export const useRecoveryLeaderboard = (params) => useReport('recoveryLeaderboard', params, { list: true });
export const useStockValuation = (params) => useReport('stockValuation', params);
export const useStockTurnover = (params) => useReport('stockTurnover', params);
export const useOperatorProductivity = (params) => useReport('operatorProductivity', params, { list: true });
export const useUtilityConsumption = (params) => useReport('utilityConsumption', params);
export const useRecoveryByVariety = (params) => useReport('recoveryByVariety', params, { list: true });

// ── Saved views ──────────────────────────────────────────────────────────
export const useSavedReports = () => useReport('savedReports', {}, { list: true, listKey: 'reports' });

export function useSaveReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => reportingApi.saveReport(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report', 'savedReports'] }),
  });
}

export function useDeleteSavedReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => reportingApi.deleteSavedReport(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report', 'savedReports'] }),
  });
}
