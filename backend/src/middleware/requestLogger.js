const morgan = require('morgan');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, message }) => {
      return `${timestamp} ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, message }) => {
          return `${timestamp} ${message}`;
        })
      ),
    }),
  ],
});

const stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

// Log the PATH only — never the query string. Query strings can carry
// credentials (stream tickets, legacy ?token=, reset tokens) and search terms.
function pathOnly(url) {
  const s = String(url || '');
  const i = s.indexOf('?');
  return i === -1 ? s : s.slice(0, i);
}
morgan.token('path', (req) => pathOnly(req.originalUrl || req.url));

// :path (not :url) — see pathOnly above.
const FORMAT = ':method :path :status :response-time ms';
const requestLogger = morgan(FORMAT, { stream });

module.exports = requestLogger;
module.exports.pathOnly = pathOnly;
module.exports.FORMAT = FORMAT;
