import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Scissors } from 'lucide-react';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useOwnerAuth } from '../../../context/OwnerAuthContext';
import useConfirm from '../../../hooks/useConfirm';
import { invalidateMoney } from '../../../components/payments/invalidateMoney';
import { queryKeys } from '../../../api/queryClient';

// Owner decision D-8: once the order has sailed, a balance the buyer will not
// pay — bank deductions nobody entered on the receipt, a short payment — is
// written off with the Owner's approval. The server books it to 6200 Bank
// Charges up to the tolerance (USD 50 by default) and to the account the
// accountant names above that (refused until one is named), always against
// 1110 at the booked rate. Only the outstanding balance can go.
export default function ShortBalanceWriteOff({ order, formatCurrency, addToast }) {
  const { hasPermission } = useAuth();
  const { requestOwnerApproval } = useOwnerAuth();
  const [confirm, confirmDialog] = useConfirm();
  const qc = useQueryClient();
  const orderId = order?.dbId || order?.id;
  const outstanding = Math.round(((parseFloat(order?.balanceExpected) || 0) - (parseFloat(order?.balanceReceived) || 0)) * 100) / 100;
  const shipped = ['Shipped', 'Arrived'].includes(order?.status);
  if (!shipped || outstanding <= 0.01 || !hasPermission('finance', 'confirm_payment')) return null;

  async function writeOff() {
    const ok = await confirm({
      title: `Write off the balance still owed on ${order.orderNo || order.id}?`,
      consequence: 'The buyer is treated as having settled the balance. Up to the bank-charge tolerance it is booked to Bank Charges; above it, to the write-off account Finance has set. An Owner must approve.',
      amount: formatCurrency(outstanding),
      reason: 'required',
      confirmLabel: 'Write off',
      cancelLabel: 'Go back',
    });
    if (!ok) return;
    try {
      await requestOwnerApproval((ownerId) => api.post(`/api/export-orders/${orderId}/write-off-balance`, {
        reason: ok.reason, authorized_by_owner_id: ownerId,
      }));
      invalidateMoney(qc);
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) });
      addToast?.('Balance written off', 'success');
    } catch (e) {
      if (e?.message !== 'Owner authorization cancelled') addToast?.(e?.data?.message || e?.response?.data?.message || e.message || 'Write-off failed', 'error');
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex items-center justify-between gap-4">
      {confirmDialog}
      <div>
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Short balance</h3>
        <p className="text-sm text-gray-600 mt-1">{formatCurrency(outstanding)} still owed after shipment. If the buyer will not pay it, write it off with the Owner&apos;s approval.</p>
      </div>
      <button type="button" onClick={writeOff}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100">
        <Scissors className="w-4 h-4" /> Write off
      </button>
    </div>
  );
}
