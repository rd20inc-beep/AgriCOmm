/**
 * Money utility functions — single source of truth for financial rounding and comparison.
 * Extracted from exportOrderWorkflowService.js
 */

const MONEY_EPSILON = 0.01;

/**
 * Round a monetary value to 2 decimal places safely.
 * Handles float precision issues (e.g., 0.1 + 0.2 !== 0.3).
 */
function settledAmount(value) {
  return Math.round((parseFloat(value || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * Check if two monetary amounts are effectively equal (within epsilon).
 */
function moneyEqual(a, b) {
  return settledAmount(Math.abs(settledAmount(a) - settledAmount(b))) <= MONEY_EPSILON;
}

/**
 * Check if amount a is greater than or equal to amount b (within epsilon).
 */
function moneyGte(a, b) {
  return settledAmount(a) >= settledAmount(b) - MONEY_EPSILON;
}

/**
 * Safe monetary addition.
 */
function moneyAdd(a, b) {
  return settledAmount(settledAmount(a) + settledAmount(b));
}

/**
 * Safe monetary subtraction.
 */
function moneySubtract(a, b) {
  return settledAmount(settledAmount(a) - settledAmount(b));
}

module.exports = {
  MONEY_EPSILON,
  settledAmount,
  moneyEqual,
  moneyGte,
  moneyAdd,
  moneySubtract,
};
