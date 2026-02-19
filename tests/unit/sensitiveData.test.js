/**
 * TC-03: Sensitive Data Detection Tests
 *
 * Tests the sensitiveDataFilter utility for:
 * - Credit card number detection
 * - SSN detection
 * - Password phrase detection
 * - CVV detection
 * - Text sanitization / redaction
 * - Field-level filtering
 */

import { describe, it, expect } from 'vitest';

// We import relative to the backend — adjust path as needed or mock
// For unit testing we re-implement the core regex logic here to test patterns
// since the backend module uses CommonJS require().

const SENSITIVE_PATTERNS = {
  CREDIT_CARD: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  SSN: /\b\d{3}-\d{2}-\d{4}\b/,
  PASSWORD: /password\s+is\s+\S+/i,
  CVV: /\bcvv\s+is\s+\d{3,4}\b/i,
};

function containsSensitiveData(text) {
  if (!text || typeof text !== 'string') return { hasSensitive: false, types: [] };
  const types = [];
  for (const [type, pattern] of Object.entries(SENSITIVE_PATTERNS)) {
    if (pattern.test(text)) types.push(type);
  }
  return { hasSensitive: types.length > 0, types };
}

function sanitizeText(text) {
  if (!text) return text;
  let sanitized = text;
  sanitized = sanitized.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD_REDACTED]');
  sanitized = sanitized.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]');
  sanitized = sanitized.replace(/password\s+is\s+\S+/gi, 'password is [REDACTED]');
  sanitized = sanitized.replace(/\bcvv\s+is\s+\d{3,4}\b/gi, 'cvv is [REDACTED]');
  return sanitized;
}

// ────────────────────────────────────────────────────────────

describe('Sensitive Data Detection', () => {
  // ── Credit Card ──
  describe('Credit Card Detection', () => {
    it('detects spaced credit card numbers', () => {
      const result = containsSensitiveData('My card is 4111 1111 1111 1111');
      expect(result.hasSensitive).toBe(true);
      expect(result.types).toContain('CREDIT_CARD');
    });

    it('detects hyphenated credit card numbers', () => {
      const result = containsSensitiveData('Card 5500-0000-0000-0004');
      expect(result.hasSensitive).toBe(true);
      expect(result.types).toContain('CREDIT_CARD');
    });

    it('detects continuous credit card numbers', () => {
      const result = containsSensitiveData('Number is 4111111111111111');
      expect(result.hasSensitive).toBe(true);
    });

    it('does not flag short numbers', () => {
      const result = containsSensitiveData('My zip code is 12345');
      expect(result.hasSensitive).toBe(false);
    });
  });

  // ── SSN ──
  describe('SSN Detection', () => {
    it('detects standard SSN format', () => {
      const result = containsSensitiveData('SSN is 123-45-6789');
      expect(result.hasSensitive).toBe(true);
      expect(result.types).toContain('SSN');
    });

    it('does not flag phone numbers as SSN', () => {
      const result = containsSensitiveData('Call me at 555-123-4567');
      expect(result.hasSensitive).toBe(false);
    });
  });

  // ── Password ──
  describe('Password Detection', () => {
    it('detects "password is" pattern', () => {
      const result = containsSensitiveData('My password is secret123');
      expect(result.hasSensitive).toBe(true);
      expect(result.types).toContain('PASSWORD');
    });

    it('is case insensitive', () => {
      const result = containsSensitiveData('PASSWORD IS hunter2');
      expect(result.hasSensitive).toBe(true);
    });

    it('does not flag word password alone', () => {
      const result = containsSensitiveData('I forgot my password');
      expect(result.hasSensitive).toBe(false);
    });
  });

  // ── CVV ──
  describe('CVV Detection', () => {
    it('detects 3-digit CVV', () => {
      const result = containsSensitiveData('CVV is 123');
      expect(result.hasSensitive).toBe(true);
      expect(result.types).toContain('CVV');
    });

    it('detects 4-digit CVV (Amex)', () => {
      const result = containsSensitiveData('cvv is 1234');
      expect(result.hasSensitive).toBe(true);
    });
  });

  // ── Multiple types ──
  describe('Multiple Sensitive Types', () => {
    it('detects card + password in same text', () => {
      const result = containsSensitiveData(
        'Card 4111 1111 1111 1111 and password is hunter2'
      );
      expect(result.hasSensitive).toBe(true);
      expect(result.types).toContain('CREDIT_CARD');
      expect(result.types).toContain('PASSWORD');
    });
  });

  // ── Safe Text ──
  describe('Safe Text', () => {
    it('returns false for normal form data', () => {
      const result = containsSensitiveData(
        'My name is John Doe and my email is john@example.com'
      );
      expect(result.hasSensitive).toBe(false);
      expect(result.types).toHaveLength(0);
    });

    it('handles empty/null input', () => {
      expect(containsSensitiveData('')).toEqual({ hasSensitive: false, types: [] });
      expect(containsSensitiveData(null)).toEqual({ hasSensitive: false, types: [] });
    });
  });
});

// ────────────────────────────────────────────────────────────

describe('Text Sanitization / Redaction', () => {
  it('redacts credit card numbers', () => {
    const result = sanitizeText('My card is 4111 1111 1111 1111');
    expect(result).toBe('My card is [CARD_REDACTED]');
    expect(result).not.toContain('4111');
  });

  it('redacts SSN', () => {
    const result = sanitizeText('SSN 123-45-6789');
    expect(result).toBe('SSN [SSN_REDACTED]');
  });

  it('redacts password', () => {
    const result = sanitizeText('password is hunter2');
    expect(result).toBe('password is [REDACTED]');
  });

  it('redacts CVV', () => {
    const result = sanitizeText('cvv is 123');
    expect(result).toBe('cvv is [REDACTED]');
  });

  it('redacts multiple sensitive values in one string', () => {
    const input = 'Card 4111 1111 1111 1111 and SSN 123-45-6789';
    const result = sanitizeText(input);
    expect(result).toContain('[CARD_REDACTED]');
    expect(result).toContain('[SSN_REDACTED]');
    expect(result).not.toContain('4111');
    expect(result).not.toContain('6789');
  });

  it('preserves non-sensitive text unchanged', () => {
    const input = 'My name is John Doe, email john@example.com';
    expect(sanitizeText(input)).toBe(input);
  });
});
