/**
 * WebSense-AI Secure Logger
 * 
 * Logging utility that ensures sensitive user data is NEVER logged.
 * All logs are sanitized to remove PII before writing to console.
 */

const { sanitizeText } = require('./sensitiveDataFilter');

/**
 * Log levels with severity ordering.
 */
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

/**
 * Current log level from environment or default to INFO.
 */
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

/**
 * Fields that should never be logged, even in sanitized form.
 */
const BLACKLIST_FIELDS = [
  'transcript',
  'rawTranscript',
  'raw_transcript',
  'sanitizedTranscript',
  'sanitized_transcript',
  'userResponse',
  'user_response',
  'fieldValue',
  'field_value',
  'value',
];

/**
 * Sanitizes an object for logging by removing blacklisted fields
 * and sanitizing string values.
 * 
 * @param {any} obj - The object to sanitize.
 * @returns {any} Sanitized copy safe for logging.
 */
function sanitizeForLogging(obj) {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    return sanitizeText(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForLogging(item));
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Skip blacklisted fields entirely
      if (BLACKLIST_FIELDS.some(field => lowerKey.includes(field.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      // Recursively sanitize nested objects
      sanitized[key] = sanitizeForLogging(value);
    }

    return sanitized;
  }

  return obj;
}

/**
 * Formats a log message with timestamp and level.
 * 
 * @param {string} level - Log level (ERROR, WARN, INFO, DEBUG).
 * @param {string} message - Log message.
 * @returns {string} Formatted log string.
 */
function formatMessage(level, message) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] ${message}`;
}

/**
 * Logs an error message with sanitized data.
 * 
 * @param {string} message - Error message.
 * @param {any} data - Additional data to log (will be sanitized).
 */
function error(message, data = null) {
  if (CURRENT_LEVEL >= LOG_LEVELS.ERROR) {
    console.error(formatMessage('ERROR', message));
    if (data) {
      console.error(sanitizeForLogging(data));
    }
  }
}

/**
 * Logs a warning message with sanitized data.
 * 
 * @param {string} message - Warning message.
 * @param {any} data - Additional data to log (will be sanitized).
 */
function warn(message, data = null) {
  if (CURRENT_LEVEL >= LOG_LEVELS.WARN) {
    console.warn(formatMessage('WARN', message));
    if (data) {
      console.warn(sanitizeForLogging(data));
    }
  }
}

/**
 * Logs an info message with sanitized data.
 * 
 * @param {string} message - Info message.
 * @param {any} data - Additional data to log (will be sanitized).
 */
function info(message, data = null) {
  if (CURRENT_LEVEL >= LOG_LEVELS.INFO) {
    console.log(formatMessage('INFO', message));
    if (data) {
      console.log(sanitizeForLogging(data));
    }
  }
}

/**
 * Logs a debug message with sanitized data.
 * Only appears when LOG_LEVEL=DEBUG is set.
 * 
 * @param {string} message - Debug message.
 * @param {any} data - Additional data to log (will be sanitized).
 */
function debug(message, data = null) {
  if (CURRENT_LEVEL >= LOG_LEVELS.DEBUG) {
    console.log(formatMessage('DEBUG', message));
    if (data) {
      console.log(sanitizeForLogging(data));
    }
  }
}

/**
 * Logs request metadata without sensitive content.
 * 
 * @param {Object} req - Express request object.
 * @param {string} action - Action being performed.
 */
function logRequest(req, action) {
  const metadata = {
    action,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    timestamp: new Date().toISOString(),
  };

  info(`Request: ${action}`, metadata);
}

/**
 * Logs response metadata and timing.
 * 
 * @param {string} action - Action that was performed.
 * @param {number} statusCode - HTTP status code.
 * @param {number} durationMs - Request duration in milliseconds.
 */
function logResponse(action, statusCode, durationMs) {
  const metadata = {
    action,
    statusCode,
    durationMs,
    timestamp: new Date().toISOString(),
  };

  if (statusCode >= 500) {
    error(`Response: ${action}`, metadata);
  } else if (statusCode >= 400) {
    warn(`Response: ${action}`, metadata);
  } else {
    info(`Response: ${action}`, metadata);
  }
}

module.exports = {
  error,
  warn,
  info,
  debug,
  logRequest,
  logResponse,
  sanitizeForLogging,
};
