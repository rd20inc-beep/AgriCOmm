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

const requestLogger = morgan(
  ':method :url :status :response-time ms',
  { stream }
);

module.exports = requestLogger;
