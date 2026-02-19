/**
 * WebSense-AI Sensitive Data Filter Utilities
 * 
 * Provides regex-based detection and filtering of sensitive data patterns
 * (credit cards, SSNs, passwords, CVVs) to prevent logging or transmission
 * of personally identifiable information (PII).
 */

/**
 * Regex patterns for detecting sensitive data in text.
 * These patterns match common PII formats in natural speech and form data.
 */
const SENSITIVE_PATTERNS = {
  CREDIT_CARD: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
  PASSWORD: /password\s+is\s+\S+/gi,
  CVV: /\bcvv\s+is\s+\d{3,4}\b/gi,
};

/**
 * Field type patterns that should never be sent to AI backend.
 * These are filtered at the Node.js layer as a secondary security measure.
 */
const SENSITIVE_FIELD_TYPES = [
  'password',
  'creditCardNumber',
  'cardNumber',
  'ccNumber',
  'cvv',
  'cvc',
  'securityCode',
  'ssn',
  'socialSecurity',
];

/**
 * Detects whether text contains any sensitive data patterns.
 * 
 * @param {string} text - The text to scan for sensitive data.
 * @returns {boolean} True if any sensitive pattern is detected.
 */
function containsSensitiveData(text) {
  if (!text || typeof text !== 'string') return false;

  for (const pattern of Object.values(SENSITIVE_PATTERNS)) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitizes text by replacing sensitive patterns with [TYPE_REDACTED] markers.
 * 
 * @param {string} text - The text to sanitize.
 * @returns {string} Sanitized text with sensitive data replaced.
 */
function sanitizeText(text) {
  if (!text || typeof text !== 'string') return text;

  let sanitized = text;

  for (const [type, pattern] of Object.entries(SENSITIVE_PATTERNS)) {
    sanitized = sanitized.replace(pattern, `[${type}_REDACTED]`);
  }

  return sanitized;
}

/**
 * Filters page fields array to remove sensitive field types.
 * 
 * Double security layer: prevents password/credit card fields from
 * being sent to the Python chain even if the content script missed them.
 * 
 * @param {Array<Object>} pageFields - Array of form field metadata.
 * @returns {Array<Object>} Filtered array with sensitive fields removed.
 */
function filterSensitiveFields(pageFields) {
  if (!Array.isArray(pageFields)) return [];

  return pageFields.filter(field => {
    const fieldType = (field.type || '').toLowerCase();
    const fieldName = (field.name || '').toLowerCase();
    const fieldId = (field.id || '').toLowerCase();

    // Check if field type is in the sensitive list
    if (SENSITIVE_FIELD_TYPES.includes(fieldType)) {
      return false;
    }

    // Check if field name/id contains sensitive keywords
    for (const sensitiveType of SENSITIVE_FIELD_TYPES) {
      if (fieldName.includes(sensitiveType.toLowerCase()) || 
          fieldId.includes(sensitiveType.toLowerCase())) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Validates that required fields are present in the request body.
 * 
 * @param {Object} body - Request body object.
 * @param {Array<string>} requiredFields - Array of required field names.
 * @returns {{valid: boolean, missing: Array<string>}} Validation result.
 */
function validateRequiredFields(body, requiredFields) {
  const missing = [];

  for (const field of requiredFields) {
    if (!body[field] || (typeof body[field] === 'string' && !body[field].trim())) {
      missing.push(field);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

module.exports = {
  SENSITIVE_PATTERNS,
  SENSITIVE_FIELD_TYPES,
  containsSensitiveData,
  sanitizeText,
  filterSensitiveFields,
  validateRequiredFields,
};
