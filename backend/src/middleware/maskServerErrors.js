/**
 * P1-16 (TEC-06) — no database or code internals in 5xx responses.
 *
 * About 260 route handlers answer a failure with
 * `res.status(500).json({ success: false, message: err.message })`, which sends
 * Postgres text (table/column names, constraint names, SQL) or JS internals to
 * the browser. Rewriting every handler is a large, risky diff; this one layer
 * wraps `res.json` so any 5xx body whose message looks technical is replaced by a
 * generic message plus a reference id, and the original is logged server-side.
 *
 * Business messages that some handlers send with a 500 by mistake
 * ("Lot L-12: only 400 kg available…") are left alone — users need them, and they
 * disclose nothing. Only text matching the patterns below is masked.
 */
const crypto = require('crypto');
const winston = require('winston');
const { pathOnly } = require('./requestLogger');

const logger = winston.createLogger({
  level: 'error',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

// Postgres / knex / driver / runtime phrasing. Case-insensitive.
const TECHNICAL = [
  /\brelation "[^"]+"/i,
  /\bcolumn "[^"]+"/i,
  /\bconstraint "[^"]+"/i,
  /violates (foreign key|unique|check|not-null) constraint/i,
  /duplicate key value/i,
  /null value in column/i,
  /invalid input (syntax|value) for/i,
  /syntax error at or near/i,
  /\b(insert into|update|delete from|select)\b[\s\S]*\b(from|set|values|where)\b/i,
  /\bpg_|\bknex\b|\bECONN(REFUSED|RESET)|\bETIMEDOUT\b|connection terminated|too many clients/i,
  /current transaction is aborted/i,
  /\bdeadlock detected\b/i,
  /cannot read propert(y|ies) of (undefined|null)/i,
  /is not a function|is not defined|is not iterable|Unexpected token/i,
  /\bat .+\.js:\d+/, // stack frame
];

function looksTechnical(message) {
  return typeof message === 'string' && TECHNICAL.some((re) => re.test(message));
}

function maskServerErrors(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500 && body && typeof body === 'object') {
      const fields = ['message', 'error', 'detail'].filter((k) => looksTechnical(body[k]));
      if (fields.length) {
        const ref = crypto.randomBytes(4).toString('hex');
        logger.error({
          ref,
          method: req.method,
          url: pathOnly(req.originalUrl),
          status: res.statusCode,
          masked: Object.fromEntries(fields.map((k) => [k, body[k]])),
        });
        const safe = { ...body };
        for (const k of fields) delete safe[k];
        safe.message = `Something went wrong on the server. Please try again, or quote reference ${ref} to support.`;
        safe.ref = ref;
        return json(safe);
      }
    }
    return json(body);
  };
  next();
}

module.exports = maskServerErrors;
module.exports.looksTechnical = looksTechnical;
