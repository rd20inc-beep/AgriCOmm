import ContraTransferDrawer from './ContraTransferDrawer';

/**
 * Head Office ⇄ Mill money transfer — kept as a name for its callers (Mill
 * Finance › Send Funds to Head Office), but it IS the one transfer flow now
 * (W08–W10): ContraTransferDrawer with the direction locked. That gives it the
 * same account validation, the review step before anything is sent, the
 * remembered source/destination and the duplicate guard (client_ref) that the
 * old hand-written form lacked. It posts to the same contra endpoint
 * (POST /finance/contra-transfers) as before.
 *
 * `defaultDirection` without `lockDirection` opens the free contra form (the
 * accounts decide the direction).
 */
export default function TransferFundsDrawer({ open, onClose, lockDirection = null, onDone }) {
  return <ContraTransferDrawer open={open} onClose={onClose} onDone={onDone} lockDirection={lockDirection} />;
}
