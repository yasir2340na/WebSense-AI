/* global chrome */
console.log("WebSense-AI content script active on page!");

// ============================================================
// FORM FILLING — CONSTANTS
// ============================================================

/** CSS class prefix to avoid conflicts with page styles */
const WS_PREFIX = 'ws-formfill';

/** Correction keywords that trigger correction mode */
const CORRECTION_KEYWORDS = [
  'wait', 'change', 'update', 'actually',
  'no', 'wrong', 'fix', 'correct',
];

/** Sensitive field types that should NEVER be sent to backend */
const SENSITIVE_FIELD_TYPES = ['password', 'hidden'];

/** Sensitive name/id patterns to filter out */
const SENSITIVE_NAME_PATTERNS = [
  'password', 'passwd', 'pwd', 'secret',
  'creditcard', 'cardnumber', 'ccnum',
  'cvv', 'cvc', 'securitycode',
  'ssn', 'socialsecurity',
];

// ============================================================
// FORM FILLING — scanPageFields()
// ============================================================

/**
 * Scans the current page for all fillable form fields.
 * Extracts metadata for each input, select, and textarea element.
 *
 * Security:
 * - FILTERS OUT type="password" fields — never sent to backend.
 * - FILTERS OUT type="hidden" fields.
 * - FILTERS OUT fields with sensitive name/id patterns.
 *
 * @returns {Array<Object>} Array of safe field descriptor objects.
 */
function scanPageFields() {
  const fields = [];
  const elements = document.querySelectorAll('input, select, textarea');

  elements.forEach((el) => {
    const type = (el.type || 'text').toLowerCase();
    const name = el.name || '';
    const id = el.id || '';

    // Filter out sensitive field types
    if (SENSITIVE_FIELD_TYPES.includes(type)) {
      return;
    }

    // Filter out sensitive name/id patterns
    const lowerName = name.toLowerCase();
    const lowerId = id.toLowerCase();
    const isSensitive = SENSITIVE_NAME_PATTERNS.some(
      (pattern) => lowerName.includes(pattern) || lowerId.includes(pattern)
    );
    if (isSensitive) {
      return;
    }

    // Check visibility (skip completely invisible elements)
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const isVisible = rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' && style.visibility !== 'hidden';

    // Get associated label text
    let labelText = '';
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) labelText = label.textContent.trim();
    }
    if (!labelText && el.closest('label')) {
      labelText = el.closest('label').textContent.trim();
    }

    // Build a reliable CSS selector for this element
    let selector = '';
    if (el.id) {
      selector = `#${el.id}`;
    } else if (el.name) {
      selector = `[name="${el.name}"]`;
    } else if (el.getAttribute('aria-label')) {
      selector = `[aria-label="${el.getAttribute('aria-label')}"]`;
    } else if (el.placeholder) {
      selector = `[placeholder="${el.placeholder}"]`;
    }

    fields.push({
      id: el.id || '',
      name: el.name || '',
      type,
      placeholder: el.placeholder || '',
      label: labelText,
      ariaLabel: el.getAttribute('aria-label') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      selector,
      isRequired: el.required || el.getAttribute('aria-required') === 'true',
      isVisible,
      tagName: el.tagName.toLowerCase(),
      currentValue: el.value || '',
    });
  });

  return fields;
}

/**
 * Sets up a MutationObserver to detect dynamically added form fields
 * (common in React/Vue/Angular apps). Re-scans when new inputs appear.
 *
 * @param {Function} callback - Called with updated fields when DOM changes.
 * @returns {MutationObserver} The observer instance (call .disconnect() to stop).
 */
function observeDynamicFields(callback) {
  let debounceTimer = null;

  const observer = new MutationObserver((mutations) => {
    const hasNewInputs = mutations.some((mutation) =>
      Array.from(mutation.addedNodes).some((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        return node.matches?.('input, select, textarea') ||
          node.querySelector?.('input, select, textarea');
      })
    );

    if (hasNewInputs) {
      // Debounce to avoid multiple rapid re-scans
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const updatedFields = scanPageFields();
        callback(updatedFields);
      }, 300);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return observer;
}

// ============================================================
// FORM FILLING — fillFormFields()
// ============================================================

/**
 * Fills form fields on the page using the payload from the backend.
 *
 * For each field:
 * 1. Tries CSS selectors in priority order until an element is found.
 * 2. Sets the element's value.
 * 3. Dispatches 'input' event (for React) and 'change' event (for Vue).
 * 4. Adds a visual green highlight with animation.
 *
 * @param {Object} fieldsPayload - Map of fieldName -> { value, selectors, confidence }.
 * @returns {{ filled: Array, notFound: Array }} Report of what was and wasn't filled.
 */
function fillFormFields(fieldsPayload) {
  const filled = [];
  const notFound = [];

  for (const [fieldName, fieldData] of Object.entries(fieldsPayload)) {
    const { value, selectors = [], confidence = 0 } = fieldData;

    if (!value) continue;

    let element = null;

    // Try each selector in priority order
    for (const selector of selectors) {
      try {
        element = document.querySelector(selector);
        if (element) break;
      } catch {
        // Invalid selector, continue to next
      }
    }

    if (element) {
      // Set the value
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;

      if (element.tagName === 'SELECT') {
        // For select elements, find and set the matching option
        const option = Array.from(element.options).find(
          (opt) => opt.value.toLowerCase() === value.toLowerCase() ||
            opt.textContent.trim().toLowerCase() === value.toLowerCase()
        );
        if (option) {
          element.value = option.value;
        } else {
          element.value = value;
        }
      } else if (element.tagName === 'TEXTAREA' && nativeTextAreaValueSetter) {
        nativeTextAreaValueSetter.call(element, value);
      } else if (nativeInputValueSetter) {
        nativeInputValueSetter.call(element, value);
      } else {
        element.value = value;
      }

      // Dispatch events for React/Vue/Angular compatibility
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));

      // Visual highlight with animation
      addFillHighlight(element, confidence);

      filled.push({
        fieldName,
        value,
        selector: selectors.find((s) => { try { return document.querySelector(s) === element; } catch { return false; } }) || '',
        confidence,
      });
    } else {
      notFound.push({
        fieldName,
        value,
        selectors,
      });
    }
  }

  // Highlight unfilled fields
  if (notFound.length > 0) {
    highlightUnrecognizedFields(notFound);
  }

  return { filled, notFound };
}

/**
 * Adds a green highlight border and fade-in animation to a filled field.
 *
 * @param {HTMLElement} element - The form element to highlight.
 * @param {number} confidence - Confidence score (affects border color).
 */
function addFillHighlight(element, confidence) {
  const color = confidence >= 0.85 ? '#4CAF50' : '#FF9800'; // Green or orange

  // Store original styles
  const originalBorder = element.style.border;
  const originalTransition = element.style.transition;
  const originalBackground = element.style.backgroundColor;

  // Apply highlight
  element.style.transition = 'all 0.2s ease-in';
  element.style.border = `2px solid ${color}`;
  element.style.backgroundColor = color === '#4CAF50'
    ? 'rgba(76, 175, 80, 0.08)'
    : 'rgba(255, 152, 0, 0.08)';

  // Remove highlight after 5 seconds
  setTimeout(() => {
    element.style.border = originalBorder;
    element.style.backgroundColor = originalBackground;
    element.style.transition = originalTransition;
  }, 5000);
}

/**
 * Highlights fields that could not be filled with orange dashed borders
 * and shows a tooltip indicating manual fill is needed.
 *
 * @param {Array} notFoundList - Array of { fieldName, selectors } objects.
 */
function highlightUnrecognizedFields(notFoundList) {
  notFoundList.forEach(({ fieldName }) => {
    // Try to find a field that loosely matches the field name
    const possibleSelectors = [
      `[name*="${fieldName}" i]`,
      `[id*="${fieldName}" i]`,
      `[placeholder*="${fieldName}" i]`,
    ];

    for (const sel of possibleSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          el.style.border = '2px dashed #FF9800';
          el.title = `Please fill manually: ${fieldName}`;
          break;
        }
      } catch {
        // Invalid selector, continue
      }
    }
  });
}

// ============================================================
// FORM FILLING — Confirmation Panel
// ============================================================

/**
 * Injects a sidebar confirmation panel into the page DOM.
 * Shows all filled values for user review with Confirm/Edit buttons.
 *
 * Non-destructive: panel can be dismissed without affecting the page.
 *
 * @param {Object} summary - Map of fieldName -> filled value.
 * @param {{ filled: Array, notFound: Array }} fillReport - Fill results.
 */
function showFillConfirmationPanel(summary, fillReport) {
  // Remove existing panel if present
  const existing = document.getElementById(`${WS_PREFIX}-panel`);
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = `${WS_PREFIX}-panel`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'WebSense-AI Form Fill Confirmation');
  panel.style.cssText = `
    position: fixed; top: 10px; right: 10px; width: 320px;
    max-height: 80vh; overflow-y: auto;
    background: #fff; border: 1px solid #ddd; border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px; color: #333; padding: 0;
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 14px 16px; background: linear-gradient(135deg, #4CAF50, #2196F3);
    color: #fff; border-radius: 12px 12px 0 0;
    display: flex; align-items: center; justify-content: space-between;
  `;
  header.innerHTML = `
    <span style="font-weight: 600; font-size: 15px;">📝 Form Fill Review</span>
    <button id="${WS_PREFIX}-close" aria-label="Close panel" style="
      background: none; border: none; color: #fff; font-size: 18px; cursor: pointer;
      padding: 0 4px; line-height: 1;
    ">&times;</button>
  `;
  panel.appendChild(header);

  // Body — filled fields
  const body = document.createElement('div');
  body.style.cssText = 'padding: 12px 16px;';

  const filledCount = fillReport.filled?.length || 0;
  const missedCount = fillReport.notFound?.length || 0;

  body.innerHTML += `
    <div style="margin-bottom: 10px; font-size: 13px; color: #666;">
      ✅ ${filledCount} filled &nbsp; ⚠️ ${missedCount} not found
    </div>
  `;

  for (const [fieldName, value] of Object.entries(summary)) {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 0; border-bottom: 1px solid #f0f0f0;
    `;
    row.innerHTML = `
      <span style="font-weight: 500; color: #555; text-transform: capitalize;">
        ${fieldName.replace(/_/g, ' ')}
      </span>
      <span style="color: #222; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${value}
      </span>
    `;
    body.appendChild(row);
  }

  // Missed fields
  if (missedCount > 0) {
    const missedContainer = document.createElement('div');
    missedContainer.style.cssText = 'margin-top: 10px; padding: 8px; background: #fff3e0; border-radius: 6px;';
    const missedNames = fillReport.notFound.map((f) => f.fieldName).join(', ');
    missedContainer.innerHTML = `
      <div style="font-size: 12px; color: #e65100;">
        ⚠️ Could not fill: <strong>${missedNames}</strong>
        <div style="margin-top: 4px; color: #999;">Please fill these manually</div>
      </div>
    `;
    body.appendChild(missedContainer);
  }

  panel.appendChild(body);

  // Actions
  const actions = document.createElement('div');
  actions.style.cssText = `
    padding: 12px 16px; display: flex; gap: 8px;
    border-top: 1px solid #eee;
  `;
  actions.innerHTML = `
    <button id="${WS_PREFIX}-confirm" aria-label="Confirm filled values" style="
      flex: 1; padding: 10px; background: #4CAF50; color: #fff; border: none;
      border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px;
    ">✓ Confirm</button>
    <button id="${WS_PREFIX}-edit" aria-label="Edit filled values" style="
      flex: 1; padding: 10px; background: #FF9800; color: #fff; border: none;
      border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px;
    ">✏️ Edit</button>
  `;
  panel.appendChild(actions);

  document.body.appendChild(panel);

  // Event listeners
  document.getElementById(`${WS_PREFIX}-close`)?.addEventListener('click', () => {
    panel.remove();
  });

  document.getElementById(`${WS_PREFIX}-confirm`)?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'FILL_CONFIRMED',
      summary,
      fillReport,
    });
    panel.remove();
  });

  document.getElementById(`${WS_PREFIX}-edit`)?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'VOICE_CORRECTION',
      correctionTranscript: '',
      sessionId: '',
    });
    panel.innerHTML = '';
    panel.style.cssText += 'padding: 20px; text-align: center;';
    panel.innerHTML = `
      <div style="font-size: 14px; color: #555;">
        🎤 <strong>Correction Mode</strong><br>
        <span style="font-size: 12px; color: #999; margin-top: 8px; display: block;">
          Open the extension popup and speak your correction,<br>
          e.g. "Change my name to Muhammad Khan"
        </span>
        <button id="${WS_PREFIX}-dismiss" style="
          margin-top: 12px; padding: 8px 16px; background: #eee; border: none;
          border-radius: 6px; cursor: pointer; font-size: 13px;
        ">Dismiss</button>
      </div>
    `;
    document.getElementById(`${WS_PREFIX}-dismiss`)?.addEventListener('click', () => {
      panel.remove();
    });
  });
}

/**
 * Removes the confirmation panel from the DOM.
 */
function removeFillConfirmationPanel() {
  const panel = document.getElementById(`${WS_PREFIX}-panel`);
  if (panel) panel.remove();
}

// ============================================================
// FORM FILLING — Message Listener
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Security: Only accept messages from our own extension
  if (sender.id !== chrome.runtime.id) {
    console.warn('⚠️ Blocked message from unknown sender');
    return;
  }

  /**
   * GET_PAGE_FIELDS
   * Called by background.js to scan the page for fillable fields.
   */
  if (message.type === 'GET_PAGE_FIELDS') {
    const fields = scanPageFields();

    // Set up observer for dynamically loaded fields
    observeDynamicFields((updatedFields) => {
      // Notify background of updated fields (optional, for React/Vue apps)
      chrome.runtime.sendMessage({
        type: 'PAGE_FIELDS_UPDATED',
        fields: updatedFields,
      });
    });

    sendResponse({ fields });
    return;
  }

  /**
   * EXECUTE_FORM_FILL
   * Called by background.js when the chain returns ready payload.
   * Fills form fields and shows confirmation panel.
   */
  if (message.type === 'EXECUTE_FORM_FILL') {
    const { fieldsToFill, summary, confidence } = message;

    if (!fieldsToFill || Object.keys(fieldsToFill).length === 0) {
      sendResponse({
        success: false,
        error: 'No fields to fill',
      });
      return;
    }

    const fillReport = fillFormFields(fieldsToFill);

    // Show confirmation panel with actual summary
    const displaySummary = summary || {};
    // If summary is empty, build it from fieldsToFill
    if (Object.keys(displaySummary).length === 0) {
      for (const [fieldName, fieldData] of Object.entries(fieldsToFill)) {
        displaySummary[fieldName] = typeof fieldData === 'object' ? fieldData.value : fieldData;
      }
    }

    showFillConfirmationPanel(displaySummary, fillReport);

    sendResponse({
      success: true,
      filled: fillReport.filled,
      notFound: fillReport.notFound,
    });
    return;
  }

  /**
   * REMOVE_FILL_PANEL
   * Removes the confirmation panel (called on tab navigation, reset, etc.)
   */
  if (message.type === 'REMOVE_FILL_PANEL') {
    removeFillConfirmationPanel();
    sendResponse({ success: true });
    return;
  }
});
