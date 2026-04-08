/**
 * Currency constants used across the system.
 */

const CURRENCIES = {
  USD: 'USD',
  PKR: 'PKR',
  EUR: 'EUR',
  GBP: 'GBP',
};

const BASE_CURRENCY = CURRENCIES.PKR;
const DEFAULT_EXPORT_CURRENCY = CURRENCIES.USD;

module.exports = { CURRENCIES, BASE_CURRENCY, DEFAULT_EXPORT_CURRENCY };
