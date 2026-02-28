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
      // Collect <option> values for <select> dropdowns
      options: el.tagName === 'SELECT'
        ? Array.from(el.options)
            .filter(opt => opt.value && opt.value !== '' && !opt.disabled)
            .map(opt => ({ value: opt.value, text: opt.textContent.trim() }))
        : undefined,
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
async function fillFormFields(fieldsPayload) {
  const filled = [];
  const notFound = [];

  const querySelectorEverywhere = (selector) => {
    if (!selector) return null;

    try {
      const direct = document.querySelector(selector);
      if (direct) return direct;
    } catch {
      // invalid selector for this context
    }

    // Same-origin iframe lookup
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) continue;
        const el = iframeDoc.querySelector(selector);
        if (el) return el;
      } catch {
        // Cross-origin iframe; skip
      }
    }

    // Open shadow root lookup
    const allElements = document.querySelectorAll('*');
    for (const node of allElements) {
      const shadowRoot = node.shadowRoot;
      if (!shadowRoot) continue;
      try {
        const el = shadowRoot.querySelector(selector);
        if (el) return el;
      } catch {
        // invalid selector in shadow root
      }
    }

    return null;
  };

  const normalizeToken = (value) =>
    String(value || '')
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

  const findByFieldNameFallback = (fieldName) => {
    const normalizedField = normalizeToken(fieldName);
    if (!normalizedField) return null;

    const candidates = [];
    const pushInputsFromRoot = (root) => {
      try {
        root.querySelectorAll('input, select, textarea, [role="textbox"], [role="combobox"]').forEach((el) => {
          candidates.push(el);
        });
      } catch {
        // ignore root query errors
      }
    };

    pushInputsFromRoot(document);

    document.querySelectorAll('iframe').forEach((iframe) => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) pushInputsFromRoot(iframeDoc);
      } catch {
        // cross-origin
      }
    });

    document.querySelectorAll('*').forEach((node) => {
      if (node.shadowRoot) pushInputsFromRoot(node.shadowRoot);
    });

    // Separate native elements from ARIA elements — prefer native
    const nativeCandidates = [];
    const ariaCandidates = [];
    for (const el of candidates) {
      if (el.matches('input, select, textarea')) {
        nativeCandidates.push(el);
      } else {
        ariaCandidates.push(el);
      }
    }

    // Search native elements first, then ARIA elements
    const matchCandidate = (el) => {
      const id = normalizeToken(el.id || '');
      const name = normalizeToken(el.getAttribute('name') || '');
      const placeholder = normalizeToken(el.getAttribute('placeholder') || '');
      const ariaLabel = normalizeToken(el.getAttribute('aria-label') || '');
      const auto = normalizeToken(el.getAttribute('autocomplete') || '');

      let label = '';
      if (el.id) {
        try {
          const rootDoc = el.ownerDocument || document;
          const lbl = rootDoc.querySelector(`label[for="${el.id}"]`);
          if (lbl) label = lbl.textContent || '';
        } catch {
          // ignore
        }
      }
      if (!label && el.closest && el.closest('label')) {
        label = el.closest('label').textContent || '';
      }
      const labelNorm = normalizeToken(label);

      const values = [id, name, placeholder, ariaLabel, auto, labelNorm].filter(Boolean);
      return values.some((v) => v.includes(normalizedField) || normalizedField.includes(v));
    };

    // Prefer native <input>/<select>/<textarea> over ARIA role elements
    for (const el of nativeCandidates) {
      if (matchCandidate(el)) return el;
    }
    for (const el of ariaCandidates) {
      if (matchCandidate(el)) return el;
    }

    return null;
  };

  console.log('%c[WebSense FILL DEBUG] ======= fillFormFields called =======', 'color: #FF6600; font-weight: bold;');
  console.log('[WebSense FILL DEBUG] fieldsPayload:', JSON.stringify(fieldsPayload, null, 2));

  for (const [fieldName, fieldData] of Object.entries(fieldsPayload)) {
    const { value, selectors = [], confidence = 0, fieldType = '' } = fieldData;

    console.log(`%c[WebSense FILL DEBUG] --- Processing field: "${fieldName}" ---`, 'color: #0099FF; font-weight: bold;');
    console.log(`[WebSense FILL DEBUG]   value: "${value}", fieldType: "${fieldType}", selectors:`, selectors);

    if (!value) {
      console.warn(`[WebSense FILL DEBUG]   SKIPPED — no value`);
      continue;
    }

    // Special handling for radio-group: find all radios by name and match value
    if (fieldType === 'radio-group') {
      console.log(`[WebSense FILL DEBUG]   Branch: radio-group`);
      const lowerVal = value.toLowerCase().trim();
      const radios = document.querySelectorAll(`input[type="radio"][name="${fieldName}"]`);
      let matched = false;
      for (const radio of radios) {
        const radioVal = (radio.value || '').toLowerCase();
        let radioLabel = '';
        if (radio.id) {
          const lbl = document.querySelector(`label[for="${radio.id}"]`);
          if (lbl) radioLabel = lbl.textContent.trim().toLowerCase();
        }
        if (!radioLabel && radio.closest('label')) {
          radioLabel = radio.closest('label').textContent.trim().toLowerCase();
        }
        if (radioVal === lowerVal || radioLabel === lowerVal ||
            radioLabel.includes(lowerVal) || radioVal.includes(lowerVal)) {
          radio.focus();
          radio.click();
          radio.checked = true;
          // Reset React's value tracker so it sees the change
          const tracker = radio._valueTracker;
          if (tracker) tracker.setValue('');
          radio.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          radio.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          addFillHighlight(radio, confidence);
          filled.push({ fieldName, value, selector: '', confidence });
          matched = true;
          break;
        }
      }
      if (!matched && radios.length > 0) {
        console.warn(`[WebSense FILL DEBUG]   radio-group: NO match found among ${radios.length} radios`);
        notFound.push({ fieldName, value, selectors });
      }
      continue;
    }

    let element = null;
    let foundBy = 'none';

    // Try each selector in priority order
    for (const selector of selectors) {
      element = querySelectorEverywhere(selector);
      if (element) {
        foundBy = `selector: ${selector}`;
        break;
      }
    }

    // Fallback match by field name semantics when selectors miss
    if (!element) {
      element = findByFieldNameFallback(fieldName);
      if (element) foundBy = `fallback by name: ${fieldName}`;
    }

    if (!element) {
      console.error(`[WebSense FILL DEBUG]   ❌ ELEMENT NOT FOUND for "${fieldName}". Tried selectors:`, selectors);
    }

    if (element) {
      console.log(`[WebSense FILL DEBUG]   ✅ Element FOUND via ${foundBy}`);
      console.log(`[WebSense FILL DEBUG]   Element details:`, {
        tagName: element.tagName,
        type: element.type,
        id: element.id,
        name: element.getAttribute('name'),
        role: element.getAttribute('role'),
        contentEditable: element.getAttribute('contenteditable'),
        'instanceof HTMLInputElement': element instanceof HTMLInputElement,
        'instanceof HTMLSelectElement': element instanceof HTMLSelectElement,
        'instanceof HTMLTextAreaElement': element instanceof HTMLTextAreaElement,
        currentValue: element.value,
        currentTextContent: (element.textContent || '').substring(0, 100),
        hasValueTracker: !!element._valueTracker,
        optionsCount: element.options ? element.options.length : 'N/A',
      });
      // Native prototype setters — required for React/Vue/Angular compatibility.
      // These frameworks override element.value setters; using the HTMLElement
      // prototype setter bypasses the framework's interception.
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype, 'value'
      )?.set;

      /**
       * Helper: trigger the full event sequence React/Vue/Angular expect.
       * React 16+ listens on the document for events with the SyntheticEvent
       * system, but it also checks the element's internal value tracker.
       * We reset that tracker so React sees the value as "new".
       */
      const triggerReactChange = (el) => {
        // Reset React's internal value tracker so it detects the change
        // React stores the last known value on a property like _valueTracker
        const tracker = el._valueTracker;
        if (tracker) {
          tracker.setValue('');  // make React think the old value was different
        }

        // Dispatch the events React listens for
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
      };

      let branchTaken = 'unknown';
      try {

      if (element.tagName === 'SELECT') {
        branchTaken = 'SELECT';
        // For select elements, find and set the matching option
        element.focus();
        const lowerVal = value.toLowerCase().trim();
        console.log(`[WebSense FILL DEBUG]   Branch: SELECT — looking for value "${lowerVal}" among ${element.options.length} options`);
        console.log(`[WebSense FILL DEBUG]   SELECT options:`, Array.from(element.options).map(o => `${o.value}="${o.textContent.trim()}"`));
        let option = Array.from(element.options).find(
          (opt) => opt.value.toLowerCase() === lowerVal ||
            opt.textContent.trim().toLowerCase() === lowerVal
        );
        // Try numeric match (user says "15", option value might be "15" or text "15")
        if (!option && /^\d+$/.test(lowerVal)) {
          option = Array.from(element.options).find(
            (opt) => opt.value === lowerVal || opt.textContent.trim() === lowerVal
          );
        }
        // Try partial/contains match (user says "jan", option says "January")
        if (!option) {
          option = Array.from(element.options).find(
            (opt) => opt.textContent.trim().toLowerCase().includes(lowerVal) ||
              opt.value.toLowerCase().includes(lowerVal)
          );
        }
        // Try starts-with match
        if (!option) {
          option = Array.from(element.options).find(
            (opt) => opt.textContent.trim().toLowerCase().startsWith(lowerVal) ||
              opt.value.toLowerCase().startsWith(lowerVal)
          );
        }
        const finalVal = option ? option.value : value;
        console.log(`[WebSense FILL DEBUG]   SELECT option matched:`, option ? `value="${option.value}" text="${option.textContent.trim()}"` : 'NONE — using raw value');
        console.log(`[WebSense FILL DEBUG]   SELECT finalVal: "${finalVal}", valueBefore: "${element.value}"`);
        // Use native HTMLSelectElement setter to bypass React's interception
        if (nativeSelectValueSetter) {
          nativeSelectValueSetter.call(element, finalVal);
          console.log(`[WebSense FILL DEBUG]   SELECT used nativeSelectValueSetter`);
        } else {
          element.value = finalVal;
          console.log(`[WebSense FILL DEBUG]   SELECT used direct assignment (no native setter!)`);
        }
        console.log(`[WebSense FILL DEBUG]   SELECT valueAfterSet: "${element.value}", hasTracker: ${!!element._valueTracker}`);
        triggerReactChange(element);
        console.log(`[WebSense FILL DEBUG]   SELECT valueAfterReactChange: "${element.value}"`);
      } else if (element.tagName === 'INPUT' && element.type === 'radio') {
        branchTaken = 'INPUT-radio';
        console.log(`[WebSense FILL DEBUG]   Branch: INPUT-radio`);
        // For radio buttons, find the radio in the same name group with matching value
        const radioName = element.getAttribute('name');
        if (radioName) {
          const lowerVal = value.toLowerCase().trim();
          const radios = document.querySelectorAll(`input[type="radio"][name="${radioName}"]`);
          let matched = false;
          for (const radio of radios) {
            const radioVal = (radio.value || '').toLowerCase();
            let radioLabel = '';
            if (radio.id) {
              const lbl = document.querySelector(`label[for="${radio.id}"]`);
              if (lbl) radioLabel = lbl.textContent.trim().toLowerCase();
            }
            if (!radioLabel && radio.closest('label')) {
              radioLabel = radio.closest('label').textContent.trim().toLowerCase();
            }
            if (radioVal === lowerVal || radioLabel === lowerVal ||
                radioLabel.includes(lowerVal) || radioVal.includes(lowerVal)) {
              radio.focus();
              radio.click();
              radio.checked = true;
              triggerReactChange(radio);
              addFillHighlight(radio, confidence);
              matched = true;
              break;
            }
          }
          if (!matched) {
            element.click();
            element.checked = true;
          }
        } else {
          element.click();
          element.checked = true;
        }
      } else if (element.tagName === 'INPUT' && element.type === 'checkbox') {
        branchTaken = 'INPUT-checkbox';
        console.log(`[WebSense FILL DEBUG]   Branch: INPUT-checkbox`);
        const lowerVal = value.toLowerCase().trim();
        element.focus();
        element.checked = ['true', 'yes', '1', 'on', 'checked'].includes(lowerVal);
        triggerReactChange(element);
      } else if (element.tagName === 'TEXTAREA') {
        branchTaken = 'TEXTAREA';
        console.log(`[WebSense FILL DEBUG]   Branch: TEXTAREA`);
        element.focus();
        if (nativeTextAreaValueSetter) {
          nativeTextAreaValueSetter.call(element, value);
        } else {
          element.value = value;
        }
        triggerReactChange(element);
        console.log(`[WebSense FILL DEBUG]   TEXTAREA valueAfter: "${element.value}"`);
      } else if (element instanceof HTMLInputElement) {
        branchTaken = 'HTMLInputElement';
        console.log(`[WebSense FILL DEBUG]   Branch: HTMLInputElement (input type: ${element.type})`);
        // Real <input> element — use native setter for React compatibility
        element.focus();
        console.log(`[WebSense FILL DEBUG]   INPUT valueBefore: "${element.value}"`);
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(element, value);
          console.log(`[WebSense FILL DEBUG]   INPUT used nativeInputValueSetter`);
        } else {
          element.value = value;
          console.log(`[WebSense FILL DEBUG]   INPUT used direct assignment (no native setter!)`);
        }
        console.log(`[WebSense FILL DEBUG]   INPUT valueAfterSet: "${element.value}", hasTracker: ${!!element._valueTracker}`);
        triggerReactChange(element);
        console.log(`[WebSense FILL DEBUG]   INPUT valueAfterReactChange: "${element.value}"`);
      } else if (element.getAttribute &&
                 (element.getAttribute('contenteditable') === 'true' ||
                  element.getAttribute('role') === 'textbox')) {
        branchTaken = 'contenteditable/textbox';
        console.log(`[WebSense FILL DEBUG]   Branch: contenteditable/ARIA-textbox`);
        console.log(`[WebSense FILL DEBUG]   contenteditable=${element.getAttribute('contenteditable')}, role=${element.getAttribute('role')}`);
        // Contenteditable / ARIA textbox (Facebook-style custom input fields)
        element.focus();
        element.textContent = '';
        // execCommand triggers React/framework synthetic events reliably
        const execResult = document.execCommand('insertText', false, value);
        console.log(`[WebSense FILL DEBUG]   execCommand('insertText') returned: ${execResult}, textContent after: "${element.textContent}"`);
      } else if (element.getAttribute &&
                 (element.getAttribute('role') === 'combobox' ||
                  element.getAttribute('role') === 'listbox' ||
                  element.getAttribute('role') === 'menu' ||
                  element.getAttribute('role') === 'menubutton' ||
                  element.getAttribute('aria-haspopup') === 'listbox' ||
                  element.getAttribute('aria-haspopup') === 'true' ||
                  element.getAttribute('aria-expanded') != null ||
                  element.getAttribute('aria-controls') != null ||
                  element.classList.contains('select') ||
                  (element.getAttribute('class') || '').match(/select|dropdown|combobox/i) ||
                  (element.getAttribute('data-testid') || '').match(/select|dropdown/i) ||
                  fieldType === 'combobox' ||
                  fieldType === 'select-custom')) {
        branchTaken = 'combobox/listbox';
        const elRole = element.getAttribute('role') || 'none';
        console.log(`[WebSense FILL DEBUG]   Branch: combobox/listbox (role=${elRole}, fieldType=${fieldType}, tag=${element.tagName})`);

        // ARIA combobox/listbox (e.g. Facebook date selects, gender selector)
        const lowerVal = value.toLowerCase().trim();
        let matched = false;

        /**
         * Simulate a real user click on a DOM element.
         * Facebook React listens for pointer/mouse events with proper coordinates,
         * not just bare .click() calls. This dispatches the full event sequence:
         * pointerdown → mousedown → pointerup → mouseup → click
         */
        const simulateRealClick = (target) => {
          const rect = target.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const eventOpts = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: 0,
            buttons: 1,
          };

          target.dispatchEvent(new PointerEvent('pointerdown', { ...eventOpts, pointerId: 1, pointerType: 'mouse' }));
          target.dispatchEvent(new MouseEvent('mousedown', eventOpts));
          target.dispatchEvent(new PointerEvent('pointerup', { ...eventOpts, pointerId: 1, pointerType: 'mouse' }));
          target.dispatchEvent(new MouseEvent('mouseup', eventOpts));
          target.dispatchEvent(new MouseEvent('click', eventOpts));
          console.log(`[WebSense FILL DEBUG]   simulateRealClick on <${target.tagName}> "${target.textContent.trim().substring(0, 40)}" at (${Math.round(x)},${Math.round(y)})`);
        };

        // FAST PATH: Check if there's a native <select> inside or near this combobox wrapper
        let nativeSelect = element.querySelector('select');
        if (!nativeSelect && element.parentElement) {
          nativeSelect = element.parentElement.querySelector('select');
        }
        if (!nativeSelect) {
          // Check siblings
          const siblings = element.parentElement ? element.parentElement.children : [];
          for (const sib of siblings) {
            if (sib.tagName === 'SELECT') { nativeSelect = sib; break; }
            const inner = sib.querySelector && sib.querySelector('select');
            if (inner) { nativeSelect = inner; break; }
          }
        }

        if (nativeSelect) {
          console.log(`[WebSense FILL DEBUG]   combobox: Found NATIVE <select> nearby! id=${nativeSelect.id}, options=${nativeSelect.options.length}`);
          console.log(`[WebSense FILL DEBUG]   combobox: <select> options:`, Array.from(nativeSelect.options).slice(0, 15).map(o => `${o.value}="${o.textContent.trim()}"`));
          nativeSelect.focus();
          let option = Array.from(nativeSelect.options).find(
            (opt) => opt.value.toLowerCase() === lowerVal || opt.textContent.trim().toLowerCase() === lowerVal
          );
          if (!option && /^\d+$/.test(lowerVal)) {
            option = Array.from(nativeSelect.options).find(
              (opt) => opt.value === lowerVal || opt.textContent.trim() === lowerVal
            );
          }
          if (!option) {
            option = Array.from(nativeSelect.options).find(
              (opt) => opt.textContent.trim().toLowerCase().includes(lowerVal) || opt.value.toLowerCase().includes(lowerVal)
            );
          }
          if (!option) {
            option = Array.from(nativeSelect.options).find(
              (opt) => opt.textContent.trim().toLowerCase().startsWith(lowerVal) || opt.value.toLowerCase().startsWith(lowerVal)
            );
          }
          if (option) {
            const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
            if (selectSetter) {
              selectSetter.call(nativeSelect, option.value);
            } else {
              nativeSelect.value = option.value;
            }
            triggerReactChange(nativeSelect);
            console.log(`[WebSense FILL DEBUG]   combobox: Native <select> set to "${nativeSelect.value}" (wanted "${option.value}")`);
            matched = true;
          } else {
            console.warn(`[WebSense FILL DEBUG]   combobox: Native <select> found but no matching option for "${lowerVal}"`);
          }
        } else {
          console.log(`[WebSense FILL DEBUG]   combobox: No native <select> found nearby`);
        }

        // ── UNIVERSAL COMBOBOX/DROPDOWN HANDLER ──
        // Works for: React portals (Facebook, MUI, Ant Design), Headless UI, Radix,
        //            Chakra, native-like custom selects, ARIA combobox, etc.
        if (!matched) {
          // Step A: Collect ARIA option index (for keyboard fallback)
          const listboxId = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
          let optionIndex = -1;
          let ariaOptCount = 0;
          console.log(`[WebSense FILL DEBUG]   combobox: aria-controls/owns = "${listboxId}"`);
          if (listboxId) {
            const listbox = document.getElementById(listboxId);
            if (listbox) {
              const ariaOpts = listbox.querySelectorAll('[role="option"]');
              ariaOptCount = ariaOpts.length;
              console.log(`[WebSense FILL DEBUG]   combobox: ARIA listbox has ${ariaOpts.length} options`);
              for (let i = 0; i < ariaOpts.length; i++) {
                const optText = ariaOpts[i].textContent.trim().toLowerCase();
                if (optText === lowerVal || optText.includes(lowerVal)) {
                  optionIndex = i;
                  console.log(`[WebSense FILL DEBUG]   combobox: MATCHED in ARIA at index ${i}: "${ariaOpts[i].textContent.trim()}"`);
                  break;
                }
              }
            }
          }

          // Step B: Snapshot which option-like elements are ALREADY visible
          //         so after opening we can detect NEW ones
          const snapshotVisibleOptions = () => {
            const vis = new Set();
            for (const o of document.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"], [data-value]')) {
              const r = o.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) vis.add(o);
            }
            return vis;
          };
          const beforeOpen = snapshotVisibleOptions();

          // Step C: Click/focus the combobox to open the dropdown
          element.focus();
          simulateRealClick(element);
          console.log(`[WebSense FILL DEBUG]   combobox: Opened dropdown, scanning for visible options...`);

          // Step D: Universal visible-option finder
          //   Scans the ENTIRE DOM for visible elements matching our target text.
          //   Works with React portals, position:fixed overlays, shadow DOM, etc.
          const findVisibleOption = (strict) => {
            // Selectors for option-like elements across all frameworks
            const optionSelectors = [
              '[role="option"]',
              '[role="menuitem"]',
              '[role="menuitemradio"]',
              '[role="treeitem"]',
              '[data-value]',
              'li[id]',                    // Headless UI / custom lists
              '.option',                   // Generic CSS class
              '[class*="option"]',         // Class contains "option"
              '[class*="menu-item"]',      // Menu items
              '[class*="select-item"]',    // Custom select items
              '[class*="dropdown-item"]',  // Bootstrap dropdown items
              '[class*="listbox-option"]', // Listbox pattern
            ];
            const candidates = new Set();
            for (const sel of optionSelectors) {
              try {
                for (const el of document.querySelectorAll(sel)) {
                  candidates.add(el);
                }
              } catch { /* invalid selector */ }
            }

            // Also check any NEW visible elements that appeared after opening
            for (const o of document.querySelectorAll('[role="option"], [role="menuitem"], [data-value]')) {
              if (!beforeOpen.has(o)) candidates.add(o);
            }

            // Score and match candidates
            let bestMatch = null;
            let bestScore = 0;
            for (const opt of candidates) {
              const rect = opt.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) continue; // invisible
              const text = opt.textContent.trim().toLowerCase();
              const dataVal = (opt.getAttribute('data-value') || '').toLowerCase();

              let score = 0;
              if (text === lowerVal || dataVal === lowerVal) score = 10; // exact
              else if (text === lowerVal.replace(/^0+/, '') || dataVal === lowerVal.replace(/^0+/, '')) score = 9; // leading zeros
              else if (!strict && lowerVal.length > 1 && (text.includes(lowerVal) || dataVal.includes(lowerVal))) score = 5; // contains
              else if (!strict && lowerVal.length > 1 && (text.startsWith(lowerVal) || dataVal.startsWith(lowerVal))) score = 4; // starts with

              if (score > bestScore) {
                bestScore = score;
                bestMatch = opt;
              }
            }
            return bestMatch;
          };

          // Also search inside popup containers for leaf text nodes
          const findInPopupLayers = () => {
            const layerSelectors = [
              '[role="listbox"]', '[role="menu"]', '[role="dialog"]',
              '[role="presentation"]', '[data-testid]',
              '[style*="position: fixed"]', '[style*="position: absolute"]',
              '[class*="dropdown"]', '[class*="popup"]', '[class*="popover"]',
              '[class*="overlay"]', '[class*="portal"]', '[class*="menu"]',
            ];
            for (const sel of layerSelectors) {
              try {
                for (const layer of document.querySelectorAll(sel)) {
                  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_ELEMENT);
                  let node;
                  while ((node = walker.nextNode())) {
                    if (node.children.length > 0) continue; // leaf nodes only
                    const rect = node.getBoundingClientRect();
                    if (rect.width <= 0 || rect.height <= 0) continue;
                    const text = node.textContent.trim().toLowerCase();
                    if (text === lowerVal) return node;
                  }
                }
              } catch { /* skip */ }
            }
            return null;
          };

          // Step E: Poll up to 2s for the visual option to appear after opening
          const pollStart = Date.now();
          let visibleOpt = null;
          for (let attempt = 0; attempt < 20; attempt++) {
            await new Promise(r => setTimeout(r, 100));
            // Try strict match first, then loose
            visibleOpt = findVisibleOption(true) || findVisibleOption(false) || findInPopupLayers();
            if (visibleOpt) {
              const vr = visibleOpt.getBoundingClientRect();
              console.log(`[WebSense FILL DEBUG]   combobox: FOUND visible "${visibleOpt.textContent.trim()}" at (${Math.round(vr.left + vr.width/2)},${Math.round(vr.top + vr.height/2)}) in ${Date.now() - pollStart}ms [tag=${visibleOpt.tagName}, role=${visibleOpt.getAttribute('role')}, class=${(visibleOpt.className || '').toString().substring(0, 60)}]`);
              break;
            }
          }

          if (visibleOpt) {
            // Step F: Click the visible option
            visibleOpt.scrollIntoView({ block: 'nearest' });
            await new Promise(r => setTimeout(r, 30));
            simulateRealClick(visibleOpt);
            await new Promise(r => setTimeout(r, 80));
            if (visibleOpt.getAttribute('role') === 'option') {
              visibleOpt.setAttribute('aria-selected', 'true');
            }
            element.dispatchEvent(new Event('change', { bubbles: true }));
            matched = true;
            console.log(`[WebSense FILL DEBUG]   combobox: Clicked visible option ✅`);
          } else {
            // Step G: Keyboard fallback — universal across frameworks
            console.warn(`[WebSense FILL DEBUG]   combobox: No visible option after ${Date.now() - pollStart}ms — using keyboard navigation`);
            element.focus();

            if (optionIndex >= 0) {
              // Navigate by ArrowDown to the correct index, then Enter
              console.log(`[WebSense FILL DEBUG]   combobox keyboard: ArrowDown x${optionIndex + 1} then Enter`);
              for (let k = 0; k <= optionIndex; k++) {
                element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true }));
                element.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
                await new Promise(r => setTimeout(r, 40));
              }
              await new Promise(r => setTimeout(r, 80));
              element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
              element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              matched = true;
              console.log(`[WebSense FILL DEBUG]   combobox keyboard: Sent ✅`);
            } else {
              // No ARIA index — try typing the value to filter, then Enter
              console.log(`[WebSense FILL DEBUG]   combobox keyboard: Typing "${value}" to filter`);
              for (const char of value) {
                element.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
                element.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true }));
                element.dispatchEvent(new InputEvent('input', { data: char, inputType: 'insertText', bubbles: true }));
                element.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
                await new Promise(r => setTimeout(r, 50));
              }
              await new Promise(r => setTimeout(r, 200));
              // Select first visible result via Enter
              element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
              element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              matched = true;
              console.log(`[WebSense FILL DEBUG]   combobox keyboard: Typed + Enter ✅`);
            }
          }
        }
      } else {
        branchTaken = 'generic-fallback';
        const elRole = element.getAttribute && element.getAttribute('role');
        const elTag = element.tagName;
        console.log(`[WebSense FILL DEBUG]   Branch: GENERIC FALLBACK — tagName=${elTag}, type=${element.type}, role=${elRole}`);
        // Intelligent fallback: try the best approach for this element
        try {
          element.focus();
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            // Standard input/textarea that somehow ended up here
            const setter = element instanceof HTMLInputElement ? nativeInputValueSetter : nativeTextAreaValueSetter;
            if (setter) {
              setter.call(element, value);
            } else {
              element.value = value;
            }
            triggerReactChange(element);
          } else if (element.getAttribute && element.getAttribute('contenteditable') === 'true') {
            // Contenteditable
            element.textContent = '';
            document.execCommand('insertText', false, value);
          } else if ('value' in element) {
            element.value = value;
            triggerReactChange(element);
          } else {
            element.textContent = value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } catch (e) {
          console.warn(`[WebSense FILL DEBUG]   generic-fallback error:`, e);
          try { element.textContent = value; } catch { /* last resort */ }
        }
      }

      console.log(`%c[WebSense FILL DEBUG]   ✅ DONE field "${fieldName}" — branch: ${branchTaken}`, 'color: #00CC00;');

      } catch (fillError) {
        console.error(`[WebSense FILL DEBUG]   ❌ ERROR filling "${fieldName}" in branch "${branchTaken}":`, fillError);
        console.error(`[WebSense FILL DEBUG]   Error stack:`, fillError.stack);
      }

      // Visual highlight with animation
      addFillHighlight(element, confidence);

      filled.push({
        fieldName,
        value,
        selector: selectors.find((s) => { try { return querySelectorEverywhere(s) === element; } catch { return false; } }) || '',
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
  const findEverywhere = (selector) => {
    if (!selector) return null;
    try {
      const direct = document.querySelector(selector);
      if (direct) return direct;
    } catch {
      // ignore invalid
    }

    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) continue;
        const el = iframeDoc.querySelector(selector);
        if (el) return el;
      } catch {
        // cross-origin
      }
    }
    return null;
  };

  notFoundList.forEach(({ fieldName }) => {
    // Try to find a field that loosely matches the field name
    const possibleSelectors = [
      `[name*="${fieldName}" i]`,
      `[id*="${fieldName}" i]`,
      `[placeholder*="${fieldName}" i]`,
    ];

    for (const sel of possibleSelectors) {
      const el = findEverywhere(sel);
      if (el) {
        el.style.border = '2px dashed #FF9800';
        el.title = `Please fill manually: ${fieldName}`;
        break;
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
    }, () => { if (chrome.runtime.lastError) console.warn('WebSense: confirm msg failed'); });
    panel.remove();
  });

  document.getElementById(`${WS_PREFIX}-edit`)?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'VOICE_CORRECTION',
      correctionTranscript: '',
      sessionId: '',
    }, () => { if (chrome.runtime.lastError) console.warn('WebSense: correction msg failed'); });
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
      }, () => { if (chrome.runtime.lastError) { /* Background may not be listening yet */ } });
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

    // fillFormFields is async (combobox click-wait-click needs await)
    // Chrome message listeners need `return true` to keep port open for async sendResponse
    fillFormFields(fieldsToFill).then((fillReport) => {
      // Show confirmation panel with actual summary
      const displaySummary = summary || {};
      if (Object.keys(displaySummary).length === 0) {
        for (const [fieldName, fieldData] of Object.entries(fieldsToFill)) {
          displaySummary[fieldName] = typeof fieldData === 'object' ? fieldData.value : fieldData;
        }
      }

      showFillConfirmationPanel(displaySummary, fillReport);

      sendResponse({
        success: true,
        filled: fillReport?.filled || [],
        notFound: fillReport?.notFound || [],
      });
    }).catch((err) => {
      console.error('[WebSense FILL] fillFormFields error:', err);
      sendResponse({ success: false, error: err.message });
    });

    return true; // Keep message channel open for async sendResponse
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
