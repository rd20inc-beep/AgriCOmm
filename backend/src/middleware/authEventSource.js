const jwt = require('jsonwebtoken');
const config = require('../config');

function authenticateEventSource(req, res, next) {
  const token = req.query.token || null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.',
    });
  }

  try {
    req.user = jwt.verify(token, config.jwt.secret);
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.',
    });
  }
}

module.exports = authenticateEventSource;
