/**
 * Common test utilities for WebSense-AI form filling tests.
 */

/**
 * Creates a sample page fields array (mimics content.js scanPageFields output).
 */
export function createSamplePageFields() {
  return [
    {
      selector: '#first-name',
      tagName: 'INPUT',
      type: 'text',
      name: 'firstName',
      id: 'first-name',
      placeholder: 'First Name',
      label: 'First Name',
      ariaLabel: '',
      autocomplete: 'given-name',
      required: true,
      readonly: false,
      currentValue: '',
    },
    {
      selector: '#last-name',
      tagName: 'INPUT',
      type: 'text',
      name: 'lastName',
      id: 'last-name',
      placeholder: 'Last Name',
      label: 'Last Name',
      ariaLabel: '',
      autocomplete: 'family-name',
      required: true,
      readonly: false,
      currentValue: '',
    },
    {
      selector: '#email',
      tagName: 'INPUT',
      type: 'email',
      name: 'email',
      id: 'email',
      placeholder: 'Email Address',
      label: 'Email',
      ariaLabel: '',
      autocomplete: 'email',
      required: true,
      readonly: false,
      currentValue: '',
    },
    {
      selector: '#phone',
      tagName: 'INPUT',
      type: 'tel',
      name: 'phone',
      id: 'phone',
      placeholder: '(555) 123-4567',
      label: 'Phone',
      ariaLabel: '',
      autocomplete: 'tel',
      required: false,
      readonly: false,
      currentValue: '',
    },
    {
      selector: '#city',
      tagName: 'INPUT',
      type: 'text',
      name: 'city',
      id: 'city',
      placeholder: 'City',
      label: 'City',
      ariaLabel: '',
      autocomplete: 'address-level2',
      required: false,
      readonly: false,
      currentValue: '',
    },
  ];
}

/**
 * Creates a sample form fill payload (mimics LangGraph output).
 */
export function createSamplePayload() {
  return {
    fields: {
      '#first-name': 'John',
      '#last-name': 'Doe',
      '#email': 'john.doe@example.com',
      '#phone': '555-123-4567',
      '#city': 'Austin',
    },
    confidence: {
      '#first-name': 0.95,
      '#last-name': 0.95,
      '#email': 0.92,
      '#phone': 0.88,
      '#city': 0.90,
    },
    summary: {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      phone: '555-123-4567',
      city: 'Austin',
    },
  };
}

/**
 * Creates a mock SpeechRecognition class.
 */
export function createMockSpeechRecognition() {
  class MockSpeechRecognition {
    constructor() {
      this.continuous = false;
      this.interimResults = false;
      this.lang = '';
      this.maxAlternatives = 1;
      this.onstart = null;
      this.onresult = null;
      this.onend = null;
      this.onerror = null;
    }

    start() {
      if (this.onstart) this.onstart();
    }

    stop() {
      if (this.onend) this.onend();
    }

    abort() {
      if (this.onend) this.onend();
    }

    /**
     * Simulate a speech result.
     * @param {string} text - The recognized text.
     * @param {boolean} [isFinal=true] - Whether result is final.
     */
    _simulateResult(text, isFinal = true) {
      if (this.onresult) {
        this.onresult({
          resultIndex: 0,
          results: [
            {
              isFinal,
              0: { transcript: text, confidence: 0.95 },
              length: 1,
            },
          ],
        });
      }
    }

    /**
     * Simulate a speech error.
     * @param {string} error - Error type.
     */
    _simulateError(error) {
      if (this.onerror) {
        this.onerror({ error });
      }
    }
  }

  return MockSpeechRecognition;
}

/**
 * Wait for a specified number of milliseconds.
 */
export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
