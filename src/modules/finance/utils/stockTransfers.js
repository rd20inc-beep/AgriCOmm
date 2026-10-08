import { perMtToPerKg } from '../../../shared/utils/unitConversion';
import { transferKg } from '../../inventory/utils/stockMath';

// One transfer row as the page shows it. The API row is internal_transfers.*
// (camelCased): quantity in KG, the transfer price per MT (the export-side
// document unit), shown here per kg like every other mill-side figure.
export function stockTransferView(t) {
  return {
    key: t.id,
    transferNo: t.transferNo || t.id,
    date: t.dispatchDate || t.createdAt,
    batchNo: t.batchNo || '—',
    orderNo: t.exportOrderNo || '—',
    product: t.productName || 'Finished Rice',
    kg: transferKg(t),
    pricePerKg: perMtToPerKg(t.transferPricePkr),
    totalPkr: parseFloat(t.totalValuePkr) || 0,
    usd: parseFloat(t.usdEquivalent) || 0,
    pkrRate: t.pkrRate,
    status: t.status,
  };
}
