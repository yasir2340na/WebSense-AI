/**
 * WebSense-AI — Sliding Chat Panel for Voice Form Filling
 *
 * A chatbot-style sliding panel injected into every HTTPS page.
 * This is a THIN CLIENT — all conversation orchestration (confirm, correct,
 * spell) is handled by the LangGraph backend.  This panel only:
 *   - Sends every user message to the backend
 *   - Renders the returned bot_response.message
 *   - Handles bot_response.action (fill DOM, spell aloud, etc.)
 *
 * Features:
 *   - Detects all types of form fields on the page automatically
 *   - Persistent conversational chat that survives open/close
 *   - Uses Shadow DOM for full style isolation
 *   - Voice input via Web Speech API
 *   - TTS feedback + letter-by-letter spelling
 *
 * Architecture:
 *   formChatPanel.js (this) ←→ background.js ←→ formFilling.js ←→ Python LangGraph chain
 *                            ←→ content.js (scanPageFields, fillFormFields)
 */

(() => {
  'use strict';

  // Prevent double-injection
  if (document.getElementById('ws-chat-root')) return;

  // ============================================================
  // CONSTANTS
  // ============================================================

  const PANEL_WIDTH = 380;
  const ANIM_DURATION = 300;
  const MIC_TIMEOUT = 60000; // 60s max listen time
  const DEBOUNCE_MS = 600;
  const TTS_SPELL_DELAY = 500; // ms between letters when spelling aloud

  // ============================================================
  // STATE
  // ============================================================

  let panelOpen = false;
  let isListening = false;
  let recognition = null;
  let micTimer = null;
  let sessionId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let detectedFields = [];
  let filledFields = {};
  let hasGreeted = false; // persistent chat: only greet once
  let savedProfile = null; // loaded from encrypted storage
  let tempDataOnly = false; // if true, clear data on submit/close

  // ── Field-by-field mode state ──
  let fieldByFieldMode = false;        // true when walking through fields one by one
  let essentialFields = [];             // filtered list of essential fields to fill
  let currentFieldIndex = -1;           // index into essentialFields currently being asked
  let awaitingFieldInput = false;       // true when waiting for user to answer current field

  // ============================================================
  // SAFE MESSAGE HELPER
  // ============================================================

  /**
   * Safely sends a message to the background service worker.
   * Returns a Promise that resolves with the response or null on error.
   * Handles:
   *   - chrome.runtime disconnected (extension reloaded)
   *   - Service worker inactive (Manifest V3)
   *   - chrome.runtime.lastError
   */
  function safeSendMessage(msg) {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime?.id) {
          console.warn('WebSense: Extension context invalidated');
          resolve(null);
          return;
        }
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn('WebSense sendMessage error:', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          resolve(resp);
        });
      } catch (err) {
        console.warn('WebSense sendMessage threw:', err.message);
        resolve(null);
      }
    });
  }

  // ============================================================
  // SHADOW DOM HOST
  // ============================================================

  const hostEl = document.createElement('div');
  hostEl.id = 'ws-chat-root';
  hostEl.style.cssText = 'all:initial; position:fixed; z-index:2147483647; top:0; right:0; bottom:0; pointer-events:none;';
  document.documentElement.appendChild(hostEl);

  const shadow = hostEl.attachShadow({ mode: 'closed' });

  // ============================================================
  // STYLES (inside shadow DOM — fully isolated)
  // ============================================================

  const style = document.createElement('style');
  style.textContent = `
    /* ---- Reset ---- */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ---- Toggle FAB ---- */
    .ws-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      border: none;
      color: #fff;
      font-size: 24px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(99,102,241,.45);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform .2s, box-shadow .2s;
      pointer-events: auto;
      z-index: 10;
    }
    .ws-fab:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 20px rgba(99,102,241,.55);
    }
    .ws-fab.has-form {
      animation: ws-pulse 2s infinite;
    }
    @keyframes ws-pulse {
      0%,100% { box-shadow: 0 4px 14px rgba(99,102,241,.45); }
      50% { box-shadow: 0 4px 24px rgba(99,102,241,.7), 0 0 0 8px rgba(99,102,241,.15); }
    }
    .ws-fab .ws-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      border-radius: 10px;
      background: #ef4444;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
    }

    /* ---- Panel ---- */
    .ws-panel {
      position: fixed;
      top: 0;
      right: 0;
      width: ${PANEL_WIDTH}px;
      height: 100vh;
      background: #fafbfc;
      box-shadow: -4px 0 24px rgba(0,0,0,.12);
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform ${ANIM_DURATION}ms cubic-bezier(.4,0,.2,1);
      pointer-events: auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      font-size: 14px;
      color: #1e293b;
      z-index: 9;
    }
    .ws-panel.open { transform: translateX(0); }

    /* Header */
    .ws-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      flex-shrink: 0;
    }
    .ws-header-icon { font-size: 22px; }
    .ws-header-title { font-weight: 700; font-size: 15px; flex: 1; }
    .ws-header-btn {
      background: rgba(255,255,255,.18);
      border: none;
      color: #fff;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 15px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background .15s;
    }
    .ws-header-btn:hover { background: rgba(255,255,255,.3); }

    /* Chat area */
    .ws-chat {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .ws-chat::-webkit-scrollbar { width: 5px; }
    .ws-chat::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }

    /* Messages */
    .ws-msg {
      max-width: 88%;
      padding: 10px 14px;
      border-radius: 14px;
      line-height: 1.45;
      word-break: break-word;
      animation: ws-fadein .25s ease;
    }
    @keyframes ws-fadein { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
    .ws-msg.bot {
      align-self: flex-start;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-bottom-left-radius: 4px;
    }
    .ws-msg.user {
      align-self: flex-end;
      background: #6366f1;
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .ws-msg .ws-ts {
      display: block;
      font-size: 10px;
      opacity: .55;
      margin-top: 4px;
      text-align: right;
    }

    /* Field chips */
    .ws-fields {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .ws-chip {
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      border: 1.5px solid;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .ws-chip.empty {
      background: #f8fafc;
      border-color: #cbd5e1;
      color: #64748b;
    }
    .ws-chip.filled {
      background: #ecfdf5;
      border-color: #34d399;
      color: #059669;
    }
    .ws-chip.required::after {
      content: '*';
      color: #ef4444;
      font-weight: 800;
    }

    /* Typing indicator */
    .ws-typing {
      display: flex;
      gap: 4px;
      padding: 10px 16px;
      align-self: flex-start;
    }
    .ws-typing span {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #94a3b8;
      animation: ws-bounce .6s infinite alternate;
    }
    .ws-typing span:nth-child(2) { animation-delay: .15s; }
    .ws-typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes ws-bounce { to { transform: translateY(-6px); opacity:.4; } }

    /* ---- Input bar ---- */
    .ws-inputbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 14px;
      border-top: 1px solid #e2e8f0;
      background: #fff;
      flex-shrink: 0;
    }
    .ws-inputbar input {
      flex: 1;
      padding: 10px 14px;
      border: 1.5px solid #e2e8f0;
      border-radius: 24px;
      font-size: 13px;
      outline: none;
      transition: border-color .15s;
      font-family: inherit;
      color: #1e293b;
      background: #f8fafc;
    }
    .ws-inputbar input:focus { border-color: #6366f1; background: #fff; }
    .ws-inputbar input::placeholder { color: #94a3b8; }

    .ws-mic-btn {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: none;
      background: #6366f1;
      color: #fff;
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background .15s, transform .1s;
      flex-shrink: 0;
    }
    .ws-mic-btn:hover { background: #4f46e5; }
    .ws-mic-btn:active { transform: scale(.93); }
    .ws-mic-btn.listening {
      background: #ef4444;
      animation: ws-mic-pulse 1s infinite;
    }
    @keyframes ws-mic-pulse {
      0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,.4); }
      50% { box-shadow: 0 0 0 10px rgba(239,68,68,0); }
    }

    .ws-send-btn {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: none;
      background: #6366f1;
      color: #fff;
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background .15s;
      flex-shrink: 0;
    }
    .ws-send-btn:hover { background: #4f46e5; }
    .ws-send-btn:disabled { background: #cbd5e1; cursor: default; }

    /* Status bar */
    .ws-status {
      padding: 6px 14px;
      font-size: 11px;
      text-align: center;
      color: #64748b;
      background: #f1f5f9;
      flex-shrink: 0;
    }
    .ws-status.error { color: #ef4444; background: #fef2f2; }
    .ws-status.success { color: #059669; background: #ecfdf5; }

    /* Rescan button */
    .ws-rescan {
      background: none;
      border: 1px solid #6366f1;
      color: #6366f1;
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 6px;
      transition: background .15s;
    }
    .ws-rescan:hover { background: #eef2ff; }

    /* Summary card */
    .ws-summary {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 12px;
      margin-top: 6px;
    }
    .ws-summary-row {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
      border-bottom: 1px solid #f1f5f9;
      font-size: 13px;
    }
    .ws-summary-row:last-child { border-bottom: none; }
    .ws-summary-row .label { color: #64748b; }
    .ws-summary-row .value { font-weight: 600; color: #1e293b; }
  `;
  shadow.appendChild(style);

  // ============================================================
  // DOM CONSTRUCTION
  // ============================================================

  // Toggle FAB
  const fab = document.createElement('button');
  fab.className = 'ws-fab';
  fab.setAttribute('aria-label', 'Toggle WebSense-AI Form Assistant');
  fab.innerHTML = `<span>📝</span>`;
  shadow.appendChild(fab);

  // Panel
  const panel = document.createElement('div');
  panel.className = 'ws-panel';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'WebSense-AI Form Assistant');
  panel.innerHTML = `
    <div class="ws-header">
      <span class="ws-header-icon">🤖</span>
      <span class="ws-header-title">WebSense Form Assistant</span>
      <button class="ws-header-btn" data-action="rescan" title="Re-scan form fields">🔄</button>
      <button class="ws-header-btn" data-action="close" title="Close panel">✕</button>
    </div>
    <div class="ws-chat" id="ws-chat-area"></div>
    <div class="ws-status" id="ws-status"></div>
    <div class="ws-inputbar">
      <input type="text" id="ws-text-input" placeholder="Type or use the mic 🎤" autocomplete="off" />
      <button class="ws-mic-btn" id="ws-mic-btn" title="Hold to speak">🎤</button>
      <button class="ws-send-btn" id="ws-send-btn" title="Send" disabled>➤</button>
    </div>
  `;
  shadow.appendChild(panel);

  // Grab refs
  const chatArea = shadow.getElementById('ws-chat-area');
  const statusBar = shadow.getElementById('ws-status');
  const textInput = shadow.getElementById('ws-text-input');
  const micBtn = shadow.getElementById('ws-mic-btn');
  const sendBtn = shadow.getElementById('ws-send-btn');

  // ============================================================
  // HELPERS
  // ============================================================

  function timeStamp() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function scrollBottom() {
    requestAnimationFrame(() => {
      chatArea.scrollTop = chatArea.scrollHeight;
    });
  }

  /** Adds a chat bubble AND optionally speaks it via TTS */
  function addMessage(text, role = 'bot', extras = '', shouldSpeak = false) {
    const div = document.createElement('div');
    div.className = `ws-msg ${role}`;
    div.innerHTML = `${text}${extras}<span class="ws-ts">${timeStamp()}</span>`;
    chatArea.appendChild(div);
    scrollBottom();
    if (shouldSpeak && role === 'bot') {
      // Strip HTML tags for TTS
      const plain = text.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
      speak(plain);
    }
    return div;
  }

  /** Adds a typing indicator and returns a remove function */
  function showTyping() {
    const div = document.createElement('div');
    div.className = 'ws-typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    chatArea.appendChild(div);
    scrollBottom();
    return () => div.remove();
  }

  function setStatus(text, type = '') {
    statusBar.textContent = text;
    statusBar.className = `ws-status ${type}`;
  }

  /** Builds field chip badges HTML */
  function buildFieldChips(fields) {
    if (!fields || fields.length === 0) return '';
    const chips = fields.map((f) => {
      const name = f.label || f.name || f.id || f.placeholder || 'Unknown';
      const isFilled = filledFields[f.name] || filledFields[f.id];
      const cls = isFilled ? 'filled' : 'empty';
      const req = f.isRequired ? ' required' : '';
      const icon = isFilled ? '✓' : '○';
      return `<span class="ws-chip ${cls}${req}">${icon} ${name}</span>`;
    }).join('');
    return `<div class="ws-fields">${chips}</div>`;
  }

  /** Pretty-print a field name */
  function prettyName(raw) {
    // First, try to find the actual label from detected page fields
    if (detectedFields && detectedFields.length > 0) {
      for (const f of detectedFields) {
        if ((f.id && f.id === raw) || (f.name && f.name === raw)) {
          const label = f.label || f.placeholder || f.ariaLabel;
          if (label) return label.replace(/\s*\*\s*$/, '').trim(); // strip trailing asterisk
        }
      }
    }
    // Fallback: basic formatting
    return raw
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // ============================================================
  // TEXT-TO-SPEECH (TTS) ENGINE
  // ============================================================

  const synth = window.speechSynthesis;

  /** Speak a text string aloud */
  function speak(text, rate = 1.0) {
    if (!synth) return Promise.resolve();
    return new Promise((resolve) => {
      // Cancel any current speech
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = rate;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      utterance.onend = resolve;
      utterance.onerror = resolve;
      synth.speak(utterance);
    });
  }

  /**
   * Spell a value letter-by-letter via TTS with visual display.
   * Speaks each character slowly: "A ... H ... M ... E ... D"
   * Also displays the letters in the chat as they are spoken.
   */
  async function spellAloud(fieldName, value) {
    const prettyField = prettyName(fieldName);
    const letters = value.split('');

    addMessage(`🔤 Spelling <b>${prettyField}</b>: "<b>${value}</b>"`, 'bot', '', false);

    // Create a live-updating spelling display
    const spellingDiv = document.createElement('div');
    spellingDiv.className = 'ws-msg bot';
    spellingDiv.innerHTML = `<span style="font-family:monospace;font-size:16px;letter-spacing:4px;"></span><span class="ws-ts">${timeStamp()}</span>`;
    chatArea.appendChild(spellingDiv);
    scrollBottom();

    const letterSpan = spellingDiv.querySelector('span');
    let displayed = '';

    for (let i = 0; i < letters.length; i++) {
      const char = letters[i];
      const spokenChar = char === ' ' ? 'space'
        : char === '@' ? 'at'
        : char === '.' ? 'dot'
        : char === '-' ? 'dash'
        : char === '_' ? 'underscore'
        : char.toUpperCase();

      displayed += `<b>${char}</b> `;
      letterSpan.innerHTML = displayed;
      scrollBottom();

      await speak(spokenChar, 0.8);
      // Small pause between letters
      await new Promise((r) => setTimeout(r, TTS_SPELL_DELAY));
    }

    await speak(`That spells: ${value}`, 1.0);
  }

  // ============================================================
  // FORM DETECTION (comprehensive)
  // ============================================================

  /**
   * Scans the page for ALL types of forms and fields.
   * Covers: standard forms, formless inputs, shadow DOM,
   * iframes (same-origin), contenteditable, ARIA roles, etc.
   */
  function deepScanFields() {
    const fields = [];
    const seen = new WeakSet();

    // Sensitive filters (same as content.js)
    const sensitiveTypes = ['password', 'hidden'];
    const sensitiveNames = [
      'password', 'passwd', 'pwd', 'secret',
      'creditcard', 'cardnumber', 'ccnum',
      'cvv', 'cvc', 'securitycode',
      'ssn', 'socialsecurity',
    ];

    function isSensitive(el) {
      const type = (el.type || '').toLowerCase();
      if (sensitiveTypes.includes(type)) return true;
      const id = (el.id || '').toLowerCase();
      const name = (el.name || '').toLowerCase();
      return sensitiveNames.some((p) => id.includes(p) || name.includes(p));
    }

    function processElement(el) {
      if (seen.has(el)) return;
      seen.add(el);
      if (isSensitive(el)) return;

      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const isVisible = rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden';

      // Label
      let label = '';
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) label = lbl.textContent.trim();
      }
      if (!label && el.closest('label')) {
        label = el.closest('label').textContent.trim();
      }
      if (!label && el.getAttribute('aria-label')) {
        label = el.getAttribute('aria-label');
      }
      if (!label && el.placeholder) {
        label = el.placeholder;
      }

      // Selector
      let selector = '';
      if (el.id) selector = `#${CSS.escape(el.id)}`;
      else if (el.name) selector = `[name="${el.name}"]`;
      else if (el.getAttribute('aria-label')) selector = `[aria-label="${el.getAttribute('aria-label')}"]`;
      else if (el.placeholder) selector = `[placeholder="${el.placeholder}"]`;

      fields.push({
        id: el.id || '',
        name: el.name || '',
        type: (el.type || el.tagName || 'text').toLowerCase(),
        placeholder: el.placeholder || '',
        label,
        ariaLabel: el.getAttribute('aria-label') || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        selector,
        isRequired: el.required || el.getAttribute('aria-required') === 'true',
        isVisible,
        tagName: el.tagName.toLowerCase(),
        currentValue: el.value || '',
        formId: el.form ? (el.form.id || el.form.getAttribute('name') || '') : '',
      });
    }

    // 1. Standard inputs, selects, textareas
    document.querySelectorAll('input, select, textarea').forEach(processElement);

    // 2. Elements with contenteditable
    document.querySelectorAll('[contenteditable="true"], [contenteditable=""]').forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      let label = el.getAttribute('aria-label') || el.getAttribute('data-placeholder') || '';
      fields.push({
        id: el.id || '',
        name: el.getAttribute('name') || '',
        type: 'contenteditable',
        placeholder: el.getAttribute('data-placeholder') || '',
        label,
        ariaLabel: el.getAttribute('aria-label') || '',
        autocomplete: '',
        selector: el.id ? `#${CSS.escape(el.id)}` : '',
        isRequired: el.getAttribute('aria-required') === 'true',
        isVisible: true,
        tagName: el.tagName.toLowerCase(),
        currentValue: el.textContent || '',
        formId: '',
      });
    });

    // 3. ARIA role=textbox / role=combobox (custom components)
    document.querySelectorAll('[role="textbox"], [role="combobox"], [role="searchbox"], [role="spinbutton"]').forEach((el) => {
      if (seen.has(el) || el.matches('input, select, textarea')) return;
      seen.add(el);
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      fields.push({
        id: el.id || '',
        name: el.getAttribute('name') || '',
        type: el.getAttribute('role'),
        placeholder: el.getAttribute('aria-placeholder') || '',
        label: el.getAttribute('aria-label') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        autocomplete: '',
        selector: el.id ? `#${CSS.escape(el.id)}` : `[role="${el.getAttribute('role')}"]`,
        isRequired: el.getAttribute('aria-required') === 'true',
        isVisible: true,
        tagName: el.tagName.toLowerCase(),
        currentValue: el.textContent || '',
        formId: '',
      });
    });

    // 4. Same-origin iframes
    try {
      document.querySelectorAll('iframe').forEach((iframe) => {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iframeDoc) return;
          iframeDoc.querySelectorAll('input, select, textarea').forEach((el) => {
            if (isSensitive(el)) return;
            let label = '';
            if (el.id) {
              const lbl = iframeDoc.querySelector(`label[for="${el.id}"]`);
              if (lbl) label = lbl.textContent.trim();
            }
            fields.push({
              id: el.id || '',
              name: el.name || '',
              type: (el.type || 'text').toLowerCase(),
              placeholder: el.placeholder || '',
              label,
              ariaLabel: el.getAttribute('aria-label') || '',
              autocomplete: el.getAttribute('autocomplete') || '',
              selector: el.id ? `#${CSS.escape(el.id)}` : (el.name ? `[name="${el.name}"]` : ''),
              isRequired: el.required,
              isVisible: true,
              tagName: el.tagName.toLowerCase(),
              currentValue: el.value || '',
              formId: '',
              inIframe: true,
            });
          });
        } catch { /* cross-origin — skip */ }
      });
    } catch { /* safety */ }

    return fields;
  }

  // ============================================================
  // FIELD FILTER — ALL VISIBLE FIELDS FOR FIELD-BY-FIELD MODE
  // ============================================================

  /**
   * Returns ALL visible form fields for field-by-field guided filling.
   * Each field gets a pretty _essentialLabel derived from its label/placeholder/name/id.
   * Hidden fields and submit/button fields are excluded.
   */
  function getAllFormFields(allFields) {
    const visible = allFields.filter((f) => f.isVisible);
    return visible.map((f) => ({
      ...f,
      _essentialLabel: prettyName(f.label || f.placeholder || f.name || f.id || 'Field'),
    }));
  }

  /**
   * Classifies what kind of form this is based on detected fields.
   */
  function classifyForm(fields) {
    const names = fields.map((f) =>
      (f.label + ' ' + f.name + ' ' + f.id + ' ' + f.placeholder + ' ' + f.autocomplete)
        .toLowerCase()
    );
    const has = (keyword) => names.some((n) => n.includes(keyword));

    if (has('login') || (has('password') && fields.length <= 3)) return { type: 'Login', icon: '🔐' };
    if (has('register') || has('signup') || has('sign up') || has('create account')) return { type: 'Registration', icon: '📋' };
    if (has('checkout') || has('payment') || has('billing') || has('card')) return { type: 'Checkout', icon: '💳' };
    if (has('search') || (fields.length === 1 && has('search'))) return { type: 'Search', icon: '🔍' };
    if (has('contact') || has('message') || has('inquiry')) return { type: 'Contact', icon: '✉️' };
    if (has('subscribe') || has('newsletter')) return { type: 'Newsletter', icon: '📰' };
    if (has('shipping') || has('delivery')) return { type: 'Shipping', icon: '📦' };
    if (has('profile') || has('settings') || has('account')) return { type: 'Profile', icon: '👤' };
    if (has('survey') || has('feedback') || has('rating')) return { type: 'Survey', icon: '📊' };
    if (has('apply') || has('application') || has('resume') || has('cover letter')) return { type: 'Application', icon: '📄' };
    if (has('booking') || has('reservation') || has('appointment')) return { type: 'Booking', icon: '📅' };
    if (has('comment') || has('reply') || has('review')) return { type: 'Comment', icon: '💬' };
    if (fields.length >= 3) return { type: 'Data Entry', icon: '📝' };
    if (fields.length >= 1) return { type: 'Form', icon: '📝' };
    return { type: 'Unknown', icon: '❓' };
  }

  // ============================================================
  // PANEL OPEN / CLOSE (persistent — chat is NOT cleared on close)
  // ============================================================

  function openPanel() {
    panelOpen = true;
    panel.classList.add('open');
    fab.style.display = 'none';

    // Only scan & greet on first open; keeps chat persistent after that
    if (!hasGreeted) {
      doFormScan();
      hasGreeted = true;
    } else {
      scrollBottom();
    }
  }

  function closePanel() {
    panelOpen = false;
    panel.classList.remove('open');
    stopListening();
    synth.cancel(); // stop any TTS
    setTimeout(() => {
      fab.style.display = 'flex';
    }, ANIM_DURATION);
  }

  // ============================================================
  // FORM SCANNING + GREETING
  // ============================================================

  function doFormScan() {
    chatArea.innerHTML = '';
    filledFields = {};
    detectedFields = deepScanFields();

    if (detectedFields.length === 0) {
      addMessage(
        `👋 Hi! I'm your <b>Form Assistant</b>.<br><br>` +
        `I couldn't detect any fillable form fields on this page.<br><br>` +
        `Try navigating to a page with a form, then click <b>🔄</b> to re-scan.`,
        'bot', '', true
      );
      setStatus('No form fields detected', 'error');
      return;
    }

    const visibleFields = detectedFields.filter((f) => f.isVisible);
    const formInfo = classifyForm(visibleFields);
    const fieldCount = visibleFields.length;

    // Pre-fill filledFields with any already-filled values
    visibleFields.forEach((f) => {
      if (f.currentValue) {
        const key = f.name || f.id;
        if (key) filledFields[key] = f.currentValue;
      }
    });

    setStatus(`${formInfo.icon} ${formInfo.type} Form · ${fieldCount} fields detected`);
    updateFabBadge(fieldCount);

    // Compute all form fields for field-by-field mode
    essentialFields = getAllFormFields(detectedFields);
    currentFieldIndex = -1;
    fieldByFieldMode = false;
    awaitingFieldInput = false;

    // Build the field list for the greeting
    const essentialNames = essentialFields.map(f => f._essentialLabel).join(', ');

    // SRS Flow: Check for saved profile first
    safeSendMessage({ type: 'LOAD_FORM_PROFILE', userId: 'default_user' }).then((resp) => {
      if (resp && resp.success && resp.profile && Object.keys(resp.profile).length > 0) {
        savedProfile = resp.profile;
        const greeting =
          `👋 Hi! I'm your <b>Form Assistant</b>.<br><br>` +
          `${formInfo.icon} I detected a <b>${formInfo.type} Form</b> with <b>${fieldCount} field${fieldCount > 1 ? 's' : ''}</b>.<br><br>` +
          `I found these important fields: <b>${essentialNames}</b><br><br>` +
          `✅ I have your details saved from last time!`;

        addMessage(greeting + buildFieldChips(visibleFields), 'bot', '', true);

        const summaryLines = Object.entries(savedProfile).map(
          ([k, v]) => `• <b>${prettyName(k)}</b>: ${v}`
        ).join('<br>');

        addMessage(
          `📋 Saved details:<br><br>${summaryLines}<br><br>` +
          `👉 <b>Should I fill the form with these saved details?</b><br>` +
          `Say <b>"yes"</b> to auto-fill, <b>"no"</b> to enter new data, or <b>"by voice"</b> to fill by voice.`,
          'bot', '', true
        );
        savedProfilePendingDecision = true;
      } else {
        savedProfile = null;
        const greeting =
          `👋 Hi! I'm your <b>Form Assistant</b>.<br><br>` +
          `${formInfo.icon} I detected a <b>${formInfo.type} Form</b> with <b>${fieldCount} field${fieldCount > 1 ? 's' : ''}</b>.<br><br>` +
          `I found these fields: <b>${essentialNames}</b>`;

        addMessage(greeting + buildFieldChips(visibleFields), 'bot', '', true);

        // Auto-start field-by-field mode immediately
        startFieldByField();
      }
    });
  }

  // Track whether we're waiting for saved-profile decision
  let savedProfilePendingDecision = false;

  // ============================================================
  // FIELD-BY-FIELD HELPERS
  // ============================================================

  /**
   * Starts the field-by-field guided fill mode.
   * Asks the user for the first essential field.
   */
  function startFieldByField() {
    fieldByFieldMode = true;
    currentFieldIndex = 0;
    awaitingFieldInput = false;

    if (essentialFields.length === 0) {
      addMessage('⚠️ I couldn\'t identify any fillable fields on this form.', 'bot', '', true);
      fieldByFieldMode = false;
      return;
    }

    askCurrentField();
  }

  /**
   * Asks the user for the value of the current field.
   * Skips fields that already have a value.
   */
  function askCurrentField() {
    // Skip already-filled fields
    while (currentFieldIndex < essentialFields.length) {
      const f = essentialFields[currentFieldIndex];
      const key = f.name || f.id;
      if (f.currentValue || filledFields[key]) {
        // Already has a value — skip silently
        if (!filledFields[key] && f.currentValue) filledFields[key] = f.currentValue;
        currentFieldIndex++;
        continue;
      }
      break;
    }

    if (currentFieldIndex >= essentialFields.length) {
      // All fields done!
      onAllFieldsFilled();
      return;
    }

    const field = essentialFields[currentFieldIndex];
    const label = field._essentialLabel;
    const stepText = `${currentFieldIndex + 1}/${essentialFields.length}`;

    let askText;
    if (currentFieldIndex === 0) {
      askText =
        `📝 Let's fill your form step by step! (${stepText})<br><br>` +
        `👉 I'm now on the <b>${label}</b> field.<br>` +
        `What is your <b>${label}</b>?`;
    } else {
      const prevField = essentialFields[currentFieldIndex - 1];
      askText =
        `✅ I've filled <b>${prevField._essentialLabel}</b>.<br><br>` +
        `👉 Now I'm on the <b>${label}</b> field. (${stepText})<br>` +
        `What is your <b>${label}</b>?`;
    }

    addMessage(askText, 'bot', '', true);
    setStatus(`Step ${stepText}: ${label}`);
    awaitingFieldInput = true;
  }

  /**
   * Fills a single field in the DOM by sending it through the background → content.js pipeline.
   */
  async function fillSingleField(field, value) {
    const key = field.name || field.id;
    const fieldsToFill = {
      [key]: {
        value,
        confidence: 1.0,
        selectors: field.selector ? [field.selector] : _buildSelectorsForKey(key),
      },
    };

    const fillResp = await safeSendMessage({
      type: 'EXECUTE_CHAT_FILL',
      fieldsToFill,
      summary: { [key]: value },
      tabId: 'current',
    });
    if (!fillResp) {
      console.warn('WebSense: fillSingleField — no response from background');
    }

    // Track locally
    filledFields[key] = value;
  }

  /**
   * Called when all essential fields have been filled.
   */
  function onAllFieldsFilled() {
    fieldByFieldMode = false;
    awaitingFieldInput = false;
    currentFieldIndex = -1;

    const visibleFields = detectedFields.filter((f) => f.isVisible);

    // Show summary of what was filled
    const summaryLines = essentialFields.map((f) => {
      const key = f.name || f.id;
      return `✅ <b>${f._essentialLabel}</b>: ${filledFields[key] || '(empty)'}`;
    }).join('<br>');

    addMessage(
      `🎉 <b>Form successfully filled!</b><br><br>${summaryLines}` +
      buildFieldChips(visibleFields),
      'bot', '', true
    );
    setStatus('Form successfully filled ✓', 'success');

    // SRS: ask to save
    addMessage(
      '💾 <b>Would you like to save these details for future forms?</b><br><br>' +
      'Say <b>"yes"</b> to securely store in encrypted local storage, or <b>"no"</b> to use temporarily.',
      'bot', '', true
    );
    awaitingSaveDecision = true;
  }

  /**
   * Build CSS selectors for a field key when auto-filling from saved profile.
   * Matches against detected page fields.
   */
  function _buildSelectorsForKey(key) {
    const selectors = [];
    const keyLower = key.toLowerCase();
    for (const f of detectedFields) {
      const matchTargets = [
        f.name?.toLowerCase(), f.id?.toLowerCase(),
        f.placeholder?.toLowerCase(), f.label?.toLowerCase(),
        f.autocomplete?.toLowerCase(), f.ariaLabel?.toLowerCase(),
      ].filter(Boolean);

      const keyVariants = [
        keyLower, keyLower.replace(/_/g, ''), keyLower.replace(/[_-]/g, ' '),
      ];

      const matched = matchTargets.some(t =>
        keyVariants.some(kv => t.includes(kv) || kv.includes(t))
      );

      if (matched && f.selector) {
        selectors.push(f.selector);
      }
    }
    // Fallback generic selectors
    if (selectors.length === 0) {
      selectors.push(
        `[name*="${key}" i]`, `[id*="${key}" i]`,
        `[placeholder*="${key}" i]`, `[aria-label*="${key}" i]`
      );
    }
    return selectors;
  }

  /**
   * Sets up listeners to clear temporary data on form submit or tab close.
   */
  function setupTempDataCleanup() {
    // Clear on form submit
    const forms = document.querySelectorAll('form');
    forms.forEach((form) => {
      form.addEventListener('submit', () => {
        if (tempDataOnly) {
          filledFields = {};
          addMessage('🗑️ Temporary data cleared after form submission.', 'bot', '', false);
          // Notify background to clear session
          safeSendMessage({ type: 'CLEAR_FORM_SESSION', sessionId });
        }
      }, { once: true });
    });

    // Clear on visibility change (tab close handled by background.js)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && tempDataOnly) {
        filledFields = {};
        safeSendMessage({ type: 'CLEAR_FORM_SESSION', sessionId });
      }
    });
  }

  function updateFabBadge(count) {
    let badge = fab.querySelector('.ws-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'ws-badge';
        fab.appendChild(badge);
      }
      badge.textContent = count;
      fab.classList.add('has-form');
    } else {
      if (badge) badge.remove();
      fab.classList.remove('has-form');
    }
  }

  // ============================================================
  // VOICE RECOGNITION (Web Speech API)
  // ============================================================

  function initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    let finalTranscript = '';
    let debounceTimer = null;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalTranscript += t + ' ';
        } else {
          interim = t;
        }
      }

      // Show interim in text input
      textInput.value = finalTranscript + interim;
      textInput.style.fontStyle = interim ? 'italic' : 'normal';

      // Debounce: send after user pauses speaking
      clearTimeout(debounceTimer);
      if (finalTranscript.trim()) {
        debounceTimer = setTimeout(() => {
          const toSend = finalTranscript.trim();
          finalTranscript = '';
          if (toSend) {
            processUserInput(toSend);
            textInput.value = '';
          }
        }, DEBOUNCE_MS);
      }
    };

    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('WebSense voice error:', e.error);
      setStatus(`Mic error: ${e.error}`, 'error');
      stopListening();
    };

    rec.onend = () => {
      // If still in listening mode, restart (chrome stops after silence)
      if (isListening) {
        try { rec.start(); } catch { stopListening(); }
      }
    };

    return rec;
  }

  function startListening() {
    if (isListening) return;
    if (!recognition) recognition = initRecognition();
    if (!recognition) {
      addMessage('⚠️ Your browser does not support voice input. Please type instead.');
      return;
    }

    isListening = true;
    micBtn.classList.add('listening');
    micBtn.title = 'Click to stop';
    setStatus('🎤  Listening... speak now', '');

    try {
      recognition.start();
    } catch {
      // Already started
    }

    // Safety timeout
    micTimer = setTimeout(() => {
      stopListening();
      addMessage('⏱️ Mic timed out after 60 seconds. Click 🎤 to start again.');
    }, MIC_TIMEOUT);
  }

  function stopListening() {
    isListening = false;
    clearTimeout(micTimer);
    micBtn.classList.remove('listening');
    micBtn.title = 'Hold to speak';
    textInput.style.fontStyle = 'normal';

    if (recognition) {
      try { recognition.stop(); } catch { /* ok */ }
    }

    if (detectedFields.length > 0) {
      const filledCount = Object.keys(filledFields).length;
      const total = detectedFields.filter((f) => f.isVisible).length;
      setStatus(`${filledCount}/${total} fields filled`);
    }
  }

  // ============================================================
  // PROCESS USER INPUT — Thin Client (all logic on backend)
  // ============================================================

  let processingLock = false;
  let awaitingSaveDecision = false; // track if we're waiting for save yes/no

  async function processUserInput(text) {
    if (!text.trim() || processingLock) return;
    processingLock = true;

    // Show user message (never TTS the user's own words)
    addMessage(text, 'user');
    textInput.value = '';
    sendBtn.disabled = true;

    const lower = text.toLowerCase().trim();

    // ── Handle "save for future?" decision ──
    if (awaitingSaveDecision) {
      awaitingSaveDecision = false;
      const isYes = ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'save', 'yes please'].some(w => lower.includes(w));
      const isNo = ['no', 'nope', 'nah', 'don\'t', 'not', 'skip', 'no thanks'].some(w => lower.includes(w));

      if (isYes) {
        // Save profile encrypted
        tempDataOnly = false;
        safeSendMessage({
          type: 'SAVE_FORM_PROFILE',
          userId: 'default_user',
          profileData: { ...filledFields },
        }).then((resp) => {
          if (resp && resp.success) {
            addMessage('✅ <b>Details saved securely!</b> Your data is encrypted and stored locally. It will be available for future forms.', 'bot', '', true);
          } else {
            addMessage('⚠️ Could not save data. Please try again.', 'bot', '', true);
          }
        });
        setStatus('Profile saved ✓', 'success');
      } else {
        // Temporary only — will clear on submit/tab close
        tempDataOnly = true;
        addMessage(
          '👍 No problem! Your data will be used <b>temporarily</b> and cleared after the form is submitted or the tab is closed.',
          'bot', '', true
        );
        setStatus('Temporary data — will clear on submit/close');

        // Set up form submit listener to clear temp data
        setupTempDataCleanup();
      }

      processingLock = false;
      return;
    }

    // ── Handle saved-profile decision (yes/no/voice) ──
    if (savedProfilePendingDecision) {
      savedProfilePendingDecision = false;
      const isYes = ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'fill', 'autofill', 'auto'].some(w => lower.includes(w));
      const isVoice = ['voice', 'speak', 'mic', 'microphone', 'by voice'].some(w => lower.includes(w));
      const isNo = ['no', 'nope', 'nah', 'new', 'different', 'manual', 'type', 'fresh'].some(w => lower.includes(w));

      if (isYes && savedProfile) {
        // Auto-fill from saved profile
        addMessage('⏳ Filling form with saved details...', 'bot', '', true);

        // Build fill payload from saved profile
        const fieldsToFill = {};
        for (const [key, value] of Object.entries(savedProfile)) {
          fieldsToFill[key] = {
            value,
            confidence: 1.0,
            selectors: _buildSelectorsForKey(key),
          };
        }

        await executeFill(fieldsToFill, savedProfile);
        addMessage('✅ <b>Form successfully filled</b> using your saved details!', 'bot', '', true);
        setStatus('Form filled from saved profile ✓', 'success');

        processingLock = false;
        return;
      } else if (isVoice || isNo) {
        // User wants to enter new data — start field-by-field mode
        addMessage(
          `🎤 <b>Great!</b> I'll walk you through each field one by one.<br>` +
          `Speak or type your answer for each field.`,
          'bot', '', true
        );
        startFieldByField();
        processingLock = false;
        return;
      }
      // If unclear input, fall through to normal processing
    }

    // ── Handle field-by-field input ──
    if (awaitingFieldInput && fieldByFieldMode) {
      awaitingFieldInput = false;
      const field = essentialFields[currentFieldIndex];
      const value = text.trim();

      // Allow skipping optional fields
      if (['skip', 'next', 'pass', 'leave blank', 'leave empty'].some(w => lower.includes(w))) {
        addMessage(`⏭️ Skipping <b>${field._essentialLabel}</b>.`, 'bot', '', true);
        currentFieldIndex++;
        askCurrentField();
        processingLock = false;
        return;
      }

      if (!value) {
        addMessage('⚠️ Please provide a value for <b>' + field._essentialLabel + '</b>, or say <b>"skip"</b> to leave it blank.', 'bot', '', true);
        awaitingFieldInput = true;
        processingLock = false;
        return;
      }

      // Fill this single field in the DOM
      await fillSingleField(field, value);

      // Move to next field
      currentFieldIndex++;
      askCurrentField();
      processingLock = false;
      return;
    }

    // ── If not in field-by-field mode but we have form fields, auto-start it ──
    if (!fieldByFieldMode && essentialFields.length > 0) {
      startFieldByField();
      processingLock = false;
      return;
    }

    if (detectedFields.length === 0) {
      addMessage('⚠️ No form fields detected on this page. Click 🔄 to scan again.', 'bot', '', true);
      processingLock = false;
      return;
    }

    const removeTyping = showTyping();
    setStatus('🔄 Processing…', '');

    try {
      // Send message to the backend — the LangGraph router decides what to do
      const response = await safeSendMessage({
        type: 'CHAT_FORM_FILL',
        transcript: text,
        sessionId,
        pageFields: detectedFields.filter((f) => f.isVisible),
      });

      removeTyping();

      if (!response || response.action === 'error') {
        const errMsg = response?.message || 'Something went wrong';
        addMessage(`⚠️ ${errMsg}`, 'bot', '', true);
        setStatus('Error', 'error');
        processingLock = false;
        return;
      }

      // ── Render the bot message ──
      if (response.message) {
        const shouldSpeak = !!response.speak_text;
        addMessage(response.message, 'bot', '', shouldSpeak);
      }

      // ── Update status bar ──
      if (response.status_text) {
        setStatus(response.status_text);
      }

      // ── Handle action-specific behaviour ──
      switch (response.action) {
        case 'execute_fill':
          await executeFill(response.fields_to_fill, response.summary || response.fields_summary || {});
          break;

        case 'spell_readout':
          if (response.spell_aloud) {
            await spellAloud(response.spell_aloud.field, response.spell_aloud.value);
          }
          break;

        case 'ask_spelling':
        case 'confirm_spelling':
          // Optionally spell aloud the current / new value
          if (response.spell_aloud) {
            await spellAloud(response.spell_aloud.field, response.spell_aloud.value);
          }
          break;

        case 'confirm_fill':
        case 'ask_correction':
        case 'show_fields':
          // Message already displayed — nothing extra to do
          break;

        default:
          // Unknown action — message already shown
          break;
      }

    } catch (err) {
      removeTyping();
      console.error('WebSense chat error:', err);
      addMessage(`❌ Error: ${err.message || 'Connection failed'}`, 'bot', '', true);
      setStatus('Connection error', 'error');
    }

    processingLock = false;
  }

  // ============================================================
  // EXECUTE FILL (fill DOM fields via background → content.js)
  // ============================================================

  async function executeFill(fieldsToFill, summary) {
    if (!fieldsToFill || Object.keys(fieldsToFill).length === 0) {
      addMessage("⚠️ Nothing to fill.", 'bot', '', true);
      return;
    }

    setStatus('🔄 Filling form…');

    let fillResult;
    fillResult = await safeSendMessage({
      type: 'EXECUTE_CHAT_FILL',
      fieldsToFill,
      summary,
      tabId: 'current',
    });
    if (!fillResult) {
      addMessage('⚠️ Could not communicate with the extension. Please reload the page and try again.', 'bot', '', true);
      setStatus('Connection error', 'error');
      return;
    }

    // Update local tracking
    for (const [key, data] of Object.entries(fieldsToFill)) {
      const val = typeof data === 'object' ? data.value : data;
      if (val) filledFields[key] = val;
    }

    // Show remaining unfilled fields
    const visibleFields = detectedFields.filter((f) => f.isVisible);
    const unfilledFields = visibleFields.filter((f) => {
      const key = f.name || f.id;
      return key && !filledFields[key];
    });

    if (unfilledFields.length > 0) {
      const names = unfilledFields.map((f) => prettyName(f.label || f.name || f.id || 'Unknown')).join(', ');
      addMessage(
        `📝 Still remaining: <b>${names}</b><br>Keep speaking or type to fill them!` +
        buildFieldChips(visibleFields),
        'bot', '', false
      );
    } else {
      // SRS: "Form successfully filled."
      addMessage(
        '🎉 <b>Form successfully filled!</b>' +
        buildFieldChips(visibleFields),
        'bot', '', true
      );
      setStatus('Form successfully filled ✓', 'success');

      // SRS: "Would you like to save these details for future forms?"
      addMessage(
        '💾 <b>Would you like to save these details for future forms?</b><br><br>' +
        'Say <b>"yes"</b> to securely store in encrypted local storage, or <b>"no"</b> to use temporarily (cleared after submit/tab close).',
        'bot', '', true
      );
      awaitingSaveDecision = true;
    }

    // Warn about not-found fields
    if (fillResult && fillResult.notFound && fillResult.notFound.length > 0) {
      const missed = fillResult.notFound.map((f) => prettyName(f.fieldName)).join(', ');
      addMessage(`⚠️ Could not locate on page: <b>${missed}</b>. These may need manual entry.`, 'bot', '', true);
    }
  }

  // ============================================================
  // EVENT LISTENERS
  // ============================================================

  // FAB toggle
  fab.addEventListener('click', () => {
    if (panelOpen) closePanel();
    else openPanel();
  });

  // Header buttons
  panel.querySelector('[data-action="close"]').addEventListener('click', closePanel);
  panel.querySelector('[data-action="rescan"]').addEventListener('click', () => {
    sessionId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    filledFields = {};
    hasGreeted = false;
    savedProfile = null;
    savedProfilePendingDecision = false;
    awaitingSaveDecision = false;
    tempDataOnly = false;
    fieldByFieldMode = false;
    essentialFields = [];
    currentFieldIndex = -1;
    awaitingFieldInput = false;
    synth.cancel();
    doFormScan();
    hasGreeted = true;
  });

  // Mic button
  micBtn.addEventListener('click', () => {
    if (isListening) stopListening();
    else startListening();
  });

  // Text input
  textInput.addEventListener('input', () => {
    sendBtn.disabled = !textInput.value.trim();
  });

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && textInput.value.trim()) {
      e.preventDefault();
      processUserInput(textInput.value.trim());
    }
  });

  // Send button
  sendBtn.addEventListener('click', () => {
    if (textInput.value.trim()) {
      processUserInput(textInput.value.trim());
    }
  });

  // Keyboard shortcut (Ctrl+Shift+F)
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      if (panelOpen) closePanel();
      else openPanel();
    }
  });

  // Listen for toggle messages from popup or background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'TOGGLE_FORM_CHAT') {
      if (panelOpen) closePanel();
      else openPanel();
      sendResponse({ open: panelOpen });
    }
    if (msg.type === 'OPEN_FORM_CHAT') {
      if (!panelOpen) openPanel();
      sendResponse({ open: true });
    }
  });

  // ============================================================
  // AUTO-DETECT ON LOAD
  // ============================================================

  // Defer initial scan to after page settles
  setTimeout(() => {
    const fields = deepScanFields();
    if (fields.length > 0) {
      updateFabBadge(fields.length);
      // SRS: Auto-open panel when a signup/booking form is detected (3+ fields)
      if (fields.length >= 3 && !panelOpen) {
        openPanel();
      }
    }
  }, 1500);

})();
