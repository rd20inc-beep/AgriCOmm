// Finance ▸ Accounting ▸ Stock transfers is the same page as /transfer (NAV-21):
// one Stock transfers screen — history, totals, detail drawer and the
// "New transfer" entry — instead of two lists of internal_transfers that
// drifted apart. It is rendered here (not redirected) because Finance roles
// hold finance.view but not inventory.view, which the /transfer route checks;
// the route-level redirect belongs in App.jsx (see the P5 clicks report).
export { default } from '../../inventory/pages/InternalTransfer';
