// Automatic CUSTOMER emails — opt-in per event (P5-12 / PLT-14). Saved under
// system_settings.customer_email_events; every event is OFF until switched on
// here. Read by backend communications/customerEmailPolicy.js, which also holds
// each email until its transaction has committed. Keys must match
// CUSTOMER_EMAIL_EVENTS there.
export const CUSTOMER_EMAIL_EVENTS = [
  { key: 'advance_confirmed', label: 'Advance receipt confirmed', hint: 'Payment confirmation to the buyer, in the order\'s currency' },
  { key: 'balance_confirmed', label: 'Balance receipt confirmed', hint: 'Payment confirmation to the buyer, in the order\'s currency' },
  { key: 'shipment_departed', label: 'Shipment departed', hint: 'Shipment notice (vessel, ETA) to the buyer' },
  { key: 'bl_draft_approved', label: 'BL draft approved', hint: 'Balance reminder to the buyer' },
  { key: 'overdue_advance', label: 'Overdue advance (scheduled scan)', hint: 'Advance request to the buyer' },
  { key: 'overdue_balance', label: 'Overdue balance (scheduled scan)', hint: 'Balance reminder to the buyer' },
];
