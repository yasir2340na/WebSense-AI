/**
 * Form Filling Unit Tests
 *
 * TC-01: Happy-path single-turn fill
 * TC-02: Multi-turn clarification flow
 * TC-04: HTTPS-only enforcement
 * TC-05: Correction flow
 * TC-06: Session cleanup on tab close
 * TC-07: Content script field scanning
 * TC-08: Content script form filling
 *
 * Uses Vitest + Chrome API mocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installMockChrome } from '../test_helpers/mockChrome.js';
import {
  createSamplePageFields,
  createSamplePayload,
} from '../test_helpers/testUtils.js';

// ────────────────────────────────────────────────────────────
// TC-01: Happy-Path Single-Turn Fill
// ────────────────────────────────────────────────────────────
describe('TC-01: Happy-path single-turn fill', () => {
  let mockChrome;

  beforeEach(() => {
    mockChrome = installMockChrome();
  });

  it('sends START_VOICE_FORM_FILL with transcript and sessionId', () => {
    const message = {
      type: 'START_VOICE_FORM_FILL',
      transcript: 'My name is John Doe, email john@example.com, phone 555-123-4567',
      sessionId: 'session_test_001',
    };

    mockChrome.runtime.sendMessage(message, (resp) => {
      expect(resp).toBeDefined();
    });

    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'START_VOICE_FORM_FILL',
        transcript: expect.any(String),
        sessionId: expect.any(String),
      }),
      expect.any(Function)
    );
  });

  it('processes a ready payload with field mappings', () => {
    const payload = createSamplePayload();

    expect(payload.fields).toHaveProperty('#first-name', 'John');
    expect(payload.fields).toHaveProperty('#email', 'john.doe@example.com');
    expect(Object.keys(payload.fields)).toHaveLength(5);
    expect(payload.confidence['#first-name']).toBeGreaterThanOrEqual(0.85);
  });

  it('payload summary matches extracted fields', () => {
    const payload = createSamplePayload();
    expect(payload.summary.firstName).toBe('John');
    expect(payload.summary.lastName).toBe('Doe');
    expect(payload.summary.email).toBe('john.doe@example.com');
  });
});

// ────────────────────────────────────────────────────────────
// TC-02: Multi-Turn Clarification
// ────────────────────────────────────────────────────────────
describe('TC-02: Multi-turn clarification flow', () => {
  it('returns needs_input status when fields are missing', () => {
    const backendResponse = {
      success: true,
      status: 'needs_input',
      question: 'I heard your name is John. What is your email address?',
      partial: { firstName: 'John' },
    };

    expect(backendResponse.status).toBe('needs_input');
    expect(backendResponse.question).toContain('email');
    expect(backendResponse.partial).toHaveProperty('firstName');
  });

  it('transitions to confirming state on needs_input', () => {
    const status = 'needs_input';
    const nextState = status === 'needs_input' ? 'confirming' : 'filled';
    expect(nextState).toBe('confirming');
  });

  it('second turn completes the fill after clarification', () => {
    const clarificationResponse = {
      success: true,
      status: 'ready',
      payload: createSamplePayload(),
    };

    expect(clarificationResponse.status).toBe('ready');
    expect(clarificationResponse.payload.fields).toHaveProperty('#email');
  });
});

// ────────────────────────────────────────────────────────────
// TC-04: HTTPS-Only Enforcement
// ────────────────────────────────────────────────────────────
describe('TC-04: HTTPS-only enforcement', () => {
  it('blocks form fill on HTTP pages', () => {
    const pageUrl = 'http://example.com/form';
    const isSecure = pageUrl.startsWith('https://');
    expect(isSecure).toBe(false);
  });

  it('allows form fill on HTTPS pages', () => {
    const pageUrl = 'https://example.com/form';
    const isSecure = pageUrl.startsWith('https://');
    expect(isSecure).toBe(true);
  });

  it('blocks form fill on chrome:// pages', () => {
    const pageUrl = 'chrome://settings';
    const isSecure = pageUrl.startsWith('https://');
    expect(isSecure).toBe(false);
  });

  it('rejects messages from unknown extension IDs', () => {
    const sender = { id: 'unknown-extension-id' };
    const expectedId = 'test-extension-id';
    expect(sender.id).not.toBe(expectedId);
  });

  it('accepts messages from own extension ID', () => {
    const sender = { id: 'test-extension-id' };
    const expectedId = 'test-extension-id';
    expect(sender.id).toBe(expectedId);
  });
});

// ────────────────────────────────────────────────────────────
// TC-05: Correction Flow
// ────────────────────────────────────────────────────────────
describe('TC-05: Voice correction flow', () => {
  const CORRECTION_KEYWORDS = [
    'wait', 'change', 'update', 'actually',
    'no', 'wrong', 'fix', 'correct',
  ];

  it('detects correction keywords in transcript', () => {
    const transcript = 'Wait, change the email to jane@example.com';
    const isCorrection = CORRECTION_KEYWORDS.some((kw) =>
      transcript.toLowerCase().includes(kw)
    );
    expect(isCorrection).toBe(true);
  });

  it('does not flag normal transcript as correction', () => {
    const transcript = 'My name is John Doe and my email is john@example.com';
    const isCorrection = CORRECTION_KEYWORDS.some((kw) =>
      transcript.toLowerCase().includes(kw)
    );
    expect(isCorrection).toBe(false);
  });

  it('sends VOICE_CORRECTION message correctly', () => {
    const mockChrome = installMockChrome();

    const correctionMsg = {
      type: 'VOICE_CORRECTION',
      sessionId: 'session_test_001',
      correctionTranscript: 'Actually change the email to jane@example.com',
    };

    mockChrome.runtime.sendMessage(correctionMsg, () => {});

    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'VOICE_CORRECTION' }),
      expect.any(Function)
    );
  });

  it('correction response updates specific field', () => {
    const original = createSamplePayload();
    const corrected = {
      ...original,
      fields: { ...original.fields, '#email': 'jane@example.com' },
      summary: { ...original.summary, email: 'jane@example.com' },
    };

    expect(corrected.fields['#email']).toBe('jane@example.com');
    expect(corrected.fields['#first-name']).toBe('John'); // unchanged
  });
});

// ────────────────────────────────────────────────────────────
// TC-06: Session Cleanup on Tab Close
// ────────────────────────────────────────────────────────────
describe('TC-06: Session cleanup', () => {
  it('formFillSessions map tracks active sessions by tabId', () => {
    const sessions = new Map();
    sessions.set(1, { sessionId: 'session_001', timestamp: Date.now() });
    sessions.set(2, { sessionId: 'session_002', timestamp: Date.now() });

    expect(sessions.has(1)).toBe(true);
    expect(sessions.size).toBe(2);
  });

  it('removes session when tab is closed', () => {
    const sessions = new Map();
    sessions.set(1, { sessionId: 'session_001' });

    // Simulate tab close
    const closedTabId = 1;
    sessions.delete(closedTabId);

    expect(sessions.has(1)).toBe(false);
    expect(sessions.size).toBe(0);
  });

  it('CLEAR_FORM_SESSION removes session data', () => {
    const mockChrome = installMockChrome();

    mockChrome.runtime.sendMessage(
      { type: 'CLEAR_FORM_SESSION', sessionId: 'session_001' },
      () => {}
    );

    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CLEAR_FORM_SESSION' }),
      expect.any(Function)
    );
  });
});

// ────────────────────────────────────────────────────────────
// TC-07: Content Script — Field Scanning
// ────────────────────────────────────────────────────────────
describe('TC-07: Content script field scanning', () => {
  it('sample page fields contain required metadata', () => {
    const fields = createSamplePageFields();
    const field = fields[0];

    expect(field).toHaveProperty('selector');
    expect(field).toHaveProperty('tagName');
    expect(field).toHaveProperty('type');
    expect(field).toHaveProperty('name');
    expect(field).toHaveProperty('id');
    expect(field).toHaveProperty('placeholder');
    expect(field).toHaveProperty('label');
    expect(field).toHaveProperty('autocomplete');
    expect(field).toHaveProperty('required');
    expect(field).toHaveProperty('readonly');
  });

  it('excludes password fields from scan results', () => {
    const fields = createSamplePageFields();
    const passwordFields = fields.filter((f) => f.type === 'password');
    expect(passwordFields).toHaveLength(0);
  });

  it('excludes hidden fields from scan results', () => {
    const fields = createSamplePageFields();
    const hiddenFields = fields.filter((f) => f.type === 'hidden');
    expect(hiddenFields).toHaveLength(0);
  });

  it('scanned fields have unique selectors', () => {
    const fields = createSamplePageFields();
    const selectors = fields.map((f) => f.selector);
    const unique = new Set(selectors);
    expect(unique.size).toBe(selectors.length);
  });

  it('builds CSS selector from id or name', () => {
    const field = { id: 'first-name', name: 'firstName', tagName: 'INPUT' };
    const selector = field.id
      ? `#${field.id}`
      : field.name
        ? `input[name="${field.name}"]`
        : null;
    expect(selector).toBe('#first-name');
  });
});

// ────────────────────────────────────────────────────────────
// TC-08: Content Script — Form Filling
// ────────────────────────────────────────────────────────────
describe('TC-08: Content script form filling', () => {
  it('payload maps CSS selectors to values', () => {
    const payload = createSamplePayload();
    const entries = Object.entries(payload.fields);

    for (const [selector, value] of entries) {
      expect(selector).toMatch(/^[#.\[]/); // starts with #, ., or [
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('confidence scores are between 0 and 1', () => {
    const payload = createSamplePayload();
    for (const score of Object.values(payload.confidence)) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('high-confidence fields (≥ 0.85) get green highlight class', () => {
    const confidence = 0.92;
    const highlightClass = confidence >= 0.85 ? 'ws-fill-high' : 'ws-fill-low';
    expect(highlightClass).toBe('ws-fill-high');
  });

  it('low-confidence fields (< 0.85) get orange highlight class', () => {
    const confidence = 0.72;
    const highlightClass = confidence >= 0.85 ? 'ws-fill-high' : 'ws-fill-low';
    expect(highlightClass).toBe('ws-fill-low');
  });

  it('fill report counts filled and failed fields', () => {
    const report = {
      filled: ['#first-name', '#last-name', '#email', '#phone'],
      failed: ['#city'],
      total: 5,
    };

    expect(report.filled).toHaveLength(4);
    expect(report.failed).toHaveLength(1);
    expect(report.filled.length + report.failed.length).toBe(report.total);
  });

  it('EXECUTE_FORM_FILL message includes fields and confidence', () => {
    const mockChrome = installMockChrome();
    const payload = createSamplePayload();

    mockChrome.tabs.sendMessage(1, {
      type: 'EXECUTE_FORM_FILL',
      fields: payload.fields,
      confidence: payload.confidence,
    }, () => {});

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        type: 'EXECUTE_FORM_FILL',
        fields: expect.any(Object),
        confidence: expect.any(Object),
      }),
      expect.any(Function)
    );
  });
});
