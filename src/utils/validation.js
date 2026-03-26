/**
 * RiceFlow ERP — Frontend Validation Utilities
 * Prevents invalid financial states before API submission.
 */

// ===================== FIELD VALIDATORS =====================

export function required(value, fieldName = 'Field') {
  if (value === null || value === undefined || String(value).trim() === '') {
    return `${fieldName} is required`;
  }
  return null;
}

export function positiveNumber(value, fieldName = 'Amount') {
  const num = parseFloat(value);
  if (isNaN(num)) return `${fieldName} must be a valid number`;
  if (num < 0) return `${fieldName} cannot be negative`;
  return null;
}

export function positiveNonZero(value, fieldName = 'Amount') {
  const num = parseFloat(value);
  if (isNaN(num)) return `${fieldName} must be a valid number`;
  if (num <= 0) return `${fieldName} must be greater than zero`;
  return null;
}

export function maxAmount(value, max, fieldName = 'Amount') {
  const num = parseFloat(value);
  if (isNaN(num)) return null;
  if (num > max) return `${fieldName} cannot exceed ${max.toLocaleString()}`;
  return null;
}

export function validDate(value, fieldName = 'Date') {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return `${fieldName} is not a valid date`;
  return null;
}

export function notFutureDate(value, fieldName = 'Date') {
  if (!value) return null;
  const d = new Date(value);
  if (d > new Date()) return `${fieldName} cannot be in the future`;
  return null;
}

export function dateNotInClosedPeriod(value, closedBefore) {
  if (!value || !closedBefore) return null;
  if (new Date(value) < new Date(closedBefore)) {
    return `Cannot post to closed accounting period (before ${closedBefore})`;
  }
  return null;
}

export function validEmail(value, fieldName = 'Email') {
  if (!value) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `${fieldName} is not a valid email`;
  return null;
}

// ===================== BUSINESS RULE VALIDATORS =====================

/** Payment cannot exceed outstanding amount */
export function paymentNotExceedOutstanding(paymentAmount, outstanding) {
  const payment = parseFloat(paymentAmount);
  const out = parseFloat(outstanding);
  if (isNaN(payment) || isNaN(out)) return null;
  if (payment > out + 0.01) {
    return `Payment ($${payment.toLocaleString()}) exceeds outstanding amount ($${out.toLocaleString()})`;
  }
  return null;
}

/** Debit and credit must balance in journal entries */
export function journalMustBalance(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return 'Journal entry must have at least one line';
  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const diff = Math.abs(totalDebit - totalCredit);
  if (diff > 0.01) {
    return `Journal is unbalanced: Debit $${totalDebit.toFixed(2)} vs Credit $${totalCredit.toFixed(2)} (diff: $${diff.toFixed(2)})`;
  }
  return null;
}

/** Quantity check — prevent negative stock dispatch */
export function stockSufficient(dispatchQty, availableQty, itemName = 'Item') {
  const dispatch = parseFloat(dispatchQty);
  const available = parseFloat(availableQty);
  if (isNaN(dispatch) || isNaN(available)) return null;
  if (dispatch > available) {
    return `Insufficient stock for ${itemName}: Requested ${dispatch} MT but only ${available} MT available`;
  }
  return null;
}

/** Contract value must match qty * price */
export function contractValueConsistent(qty, pricePerMT, contractValue) {
  const expected = parseFloat(qty) * parseFloat(pricePerMT);
  const actual = parseFloat(contractValue);
  if (isNaN(expected) || isNaN(actual)) return null;
  if (Math.abs(expected - actual) > 1) {
    return `Contract value ($${actual.toLocaleString()}) doesn't match Qty (${qty}) x Price ($${pricePerMT}/MT) = $${expected.toLocaleString()}`;
  }
  return null;
}

// ===================== FORM VALIDATION RUNNER =====================

/**
 * Run multiple validators on a form data object.
 * @param {Object} data - form data
 * @param {Object} rules - { fieldName: [validator1, validator2, ...] }
 * @returns {{ valid: boolean, errors: Object }} - errors keyed by field name
 *
 * Usage:
 *   const { valid, errors } = validateForm(data, {
 *     amount: [() => required(data.amount, 'Amount'), () => positiveNonZero(data.amount, 'Amount')],
 *     customer: [() => required(data.customer, 'Customer')],
 *   });
 */
export function validateForm(data, rules) {
  const errors = {};
  let valid = true;

  for (const [field, validators] of Object.entries(rules)) {
    for (const validator of validators) {
      const error = validator();
      if (error) {
        errors[field] = error;
        valid = false;
        break; // stop at first error per field
      }
    }
  }

  return { valid, errors };
}

// ===================== SCHEMA-BASED FORM VALIDATION =====================

/**
 * Validate form data against a declarative schema.
 * Each schema key maps to an array of rules with a `test` function and `message`.
 *
 * @param {Object} schema - validation schema
 * @param {Object} data   - form data to validate
 * @returns {{ isValid: boolean, errors: Object }} errors keyed by field name
 *
 * Example:
 *   const schema = {
 *     buyer_name: [
 *       { test: (v) => v != null && String(v).trim() !== '', message: 'Buyer name is required' },
 *       { test: (v) => String(v).length <= 200, message: 'Buyer name must be 200 characters or fewer' },
 *     ],
 *     quantity_mt: [
 *       { test: (v) => v != null && String(v).trim() !== '', message: 'Quantity is required' },
 *       { test: (v) => parseFloat(v) > 0, message: 'Quantity must be greater than zero' },
 *     ],
 *     email: [
 *       { test: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), message: 'Invalid email address' },
 *     ],
 *   };
 *
 *   const { isValid, errors } = validateFormSchema(schema, formData);
 *   if (!isValid) {
 *     // errors = { buyer_name: 'Buyer name is required', quantity_mt: 'Quantity must be greater than zero' }
 *   }
 *
 * NOTE: CSRF protection is handled server-side via the SameSite cookie attribute
 * and the Authorization header (Bearer token). The API client in api/client.js
 * attaches the token automatically. No additional CSRF tokens are needed for
 * JSON API requests that use Authorization headers, but ensure the backend
 * validates the Origin/Referer header for cookie-authenticated endpoints.
 */
export function validateFormSchema(schema, data) {
  const errors = {};
  let isValid = true;

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    for (const rule of rules) {
      if (!rule.test(value)) {
        errors[field] = rule.message;
        isValid = false;
        break; // stop at first error per field
      }
    }
  }

  return { isValid, errors };
}

// ===================== ERROR MESSAGE FORMATTING =====================

/** Convert API error response to user-friendly message */
export function formatApiError(error) {
  if (!error) return 'An unknown error occurred';

  // ApiError from client.js
  if (error.data?.errors && Array.isArray(error.data.errors)) {
    return error.data.errors.map(e => e.message || e.field).join('. ');
  }
  if (error.data?.message) return error.data.message;
  if (error.message) {
    // Clean up common backend error messages
    if (error.message.includes('violates unique constraint')) return 'A record with this value already exists';
    if (error.message.includes('violates foreign key')) return 'Referenced record does not exist';
    if (error.message.includes('violates not-null')) return 'Required field is missing';
    if (error.message.includes('timeout')) return 'Request timed out. Please try again';
    if (error.message.includes('Network error')) return 'Unable to connect to server. Check your internet connection';
    return error.message;
  }
  return 'Something went wrong. Please try again';
}
