/**
 * WebSense-AI — Sliding Chat Panel for Voice Form Filling
 *
 * A chatbot-style sliding panel injected into every HTTPS page.
 * Features:
 *   - Detects all types of form fields on the page automatically
 *   - Persistent conversational chat that survives open/close
 *   - Confirmation step before filling ("Should I fill these?")
 *   - Voice correction: say "no" / "wrong" to fix a field
 *   - Spell-by-voice: bot asks you to spell, then confirms letter-by-letter
 *   - "Spell [field]" command: bot reads out any filled value letter-by-letter via TTS
 *   - Uses Shadow DOM for full style isolation
 *
 * Conversation States:
 *   IDLE        → waiting for user to speak/type form data
 *   CONFIRMING  → extracted fields shown, awaiting "yes" / "no"
 *   CORRECTING  → user said "no", bot asks which field is wrong
 *   SPELLING    → bot asked user to spell the correct value letter-by-letter
 *   SPELL_CONFIRM → bot spelled it back, awaiting "yes" / "no"
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
  const YES_WORDS = ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'correct', 'right', 'confirm', 'go ahead', 'fill it', 'do it', 'proceed'];
  const NO_WORDS = ['no', 'nope', 'nah', 'wrong', 'mistake', 'incorrect', 'not right', 'change', 'fix', 'wait', 'stop'];

  // Conversation states
  const STATE_IDLE = 'IDLE';
  const STATE_CONFIRMING = 'CONFIRMING';
  const STATE_CORRECTING = 'CORRECTING';
  const STATE_SPELLING = 'SPELLING';
  const STATE_SPELL_CONFIRM = 'SPELL_CONFIRM';

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

  // Conversation state machine
  let conversationState = STATE_IDLE;
  let pendingPayload = null;   // payload waiting for confirmation
  let correctingField = null;  // which field key is being corrected
  let spellingValue = '';       // accumulated spelled letters
  let lastPartialData = null;  // stored partial extraction from needs_input

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

  /** Check if text matches any word list */
  function matchesAny(text, wordList) {
    const lower = text.toLowerCase().trim();
    return wordList.some((w) => lower === w || lower.startsWith(w + ' ') || lower.endsWith(' ' + w) || lower.includes(w));
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
    conversationState = STATE_IDLE;
    pendingPayload = null;
    correctingField = null;
    spellingValue = '';
    lastPartialData = null;
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

    const greeting =
      `👋 Hi! I'm your <b>Form Assistant</b>.<br><br>` +
      `${formInfo.icon} I detected a <b>${formInfo.type} Form</b> with <b>${fieldCount} field${fieldCount > 1 ? 's' : ''}</b>:`;

    addMessage(greeting + buildFieldChips(visibleFields), 'bot', '', true);

    addMessage(
      `🎤 <b>Start speaking</b> to fill the form — for example:<br><br>` +
      `<i>"My name is Ahmed Khan and my email is ahmed@example.com"</i><br><br>` +
      `Or type your info below. I'll show you what I captured and ask for confirmation before filling!<br><br>` +
      `💡 <b>Tips:</b><br>` +
      `• Say <b>"spell name"</b> to hear any filled field spelled out<br>` +
      `• Say <b>"no"</b> after I show values to correct mistakes<br>` +
      `• I'll ask you to spell corrections letter by letter`,
      'bot', '', false
    );

    setStatus(`${formInfo.icon} ${formInfo.type} Form · ${fieldCount} fields detected`);
    updateFabBadge(fieldCount);
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
  // BUILD PAYLOAD FROM PARTIAL (convert needs_input partial to fill-ready payload)
  // ============================================================

  function buildPayloadFromPartial(partial) {
    const fieldsToFill = {};
    const summary = {};

    for (const [fieldName, fieldData] of Object.entries(partial)) {
      const value = typeof fieldData === 'object' ? (fieldData.value || '') : fieldData;
      if (!value) continue;

      fieldsToFill[fieldName] = typeof fieldData === 'object'
        ? { ...fieldData }
        : { value: fieldData, confidence: 0.8, selectors: [], source_text: '' };

      summary[fieldName] = value;
    }

    return {
      status: 'success',
      fields_to_fill: fieldsToFill,
      summary,
      missing_fields: [],
      needs_confirmation: false,
      sensitive_detected: false,
    };
  }

  // ============================================================
  // PROCESS USER INPUT — State Machine Router
  // ============================================================

  let processingLock = false;

  async function processUserInput(text) {
    if (!text.trim() || processingLock) return;
    processingLock = true;

    // Show user message (never TTS the user's own words)
    addMessage(text, 'user');
    textInput.value = '';
    sendBtn.disabled = true;

    if (detectedFields.length === 0) {
      addMessage('⚠️ No form fields detected on this page. Click 🔄 to scan again.', 'bot', '', true);
      processingLock = false;
      return;
    }

    const lower = text.toLowerCase().trim();

    // ---- Route based on conversation state ----

    if (conversationState === STATE_CONFIRMING) {
      await handleConfirmation(lower);
      processingLock = false;
      return;
    }

    if (conversationState === STATE_CORRECTING) {
      await handleCorrection(lower);
      processingLock = false;
      return;
    }

    if (conversationState === STATE_SPELLING) {
      await handleSpelling(lower);
      processingLock = false;
      return;
    }

    if (conversationState === STATE_SPELL_CONFIRM) {
      await handleSpellConfirm(lower);
      processingLock = false;
      return;
    }

    // ---- Check for "spell <field>" command in IDLE state ----
    const spellMatch = lower.match(/^spell\s+(.+)/);
    if (spellMatch) {
      await handleSpellCommand(spellMatch[1]);
      processingLock = false;
      return;
    }

    // ---- IDLE: user saying "yes"/"confirm" when we have partial data → fill with partial ----
    if (lastPartialData && matchesAny(lower, YES_WORDS)) {
      const payload = buildPayloadFromPartial(lastPartialData);
      lastPartialData = null;
      await showFillConfirmation(payload);
      processingLock = false;
      return;
    }

    // ---- Default: IDLE → send to backend for extraction ----
    const removeTyping = showTyping();
    setStatus('🔄 Processing your input...', '');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHAT_FORM_FILL',
        transcript: text,
        sessionId,
        pageFields: detectedFields.filter((f) => f.isVisible),
      });

      removeTyping();

      if (!response || !response.success) {
        const errMsg = response?.message || response?.error || 'Something went wrong';
        addMessage(`⚠️ ${errMsg}`, 'bot', '', true);
        setStatus('Error processing input', 'error');
        processingLock = false;
        return;
      }

      if (response.status === 'needs_input') {
        if (response.partial && Object.keys(response.partial).length > 0) {
          // Store partial so user can confirm it later
          lastPartialData = response.partial;
          showPartialFill(response.partial);
          addMessage(
            `👉 Say <b>"yes"</b> or <b>"confirm"</b> to fill with what I have, ` +
            `or provide the missing info.`,
            'bot', '', true
          );
        } else {
          addMessage(`🤔 ${response.question || 'Could you provide more details?'}`, 'bot', '', true);
        }
        setStatus('Waiting for more information...', '');
      } else if (response.status === 'ready') {
        // Don't fill yet — show summary and ask for confirmation
        await showFillConfirmation(response.payload);
      } else {
        addMessage('⚠️ Unexpected response. Please try again.', 'bot', '', true);
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
  // SHOW FILL CONFIRMATION (ask before filling)
  // ============================================================

  async function showFillConfirmation(payload) {
    const fieldsToFill = payload.fields_to_fill || {};
    const summary = payload.summary || {};
    const fieldCount = Object.keys(fieldsToFill).length;

    if (fieldCount === 0) {
      addMessage("⚠️ I couldn't map any values to form fields. Try being more specific.", 'bot', '', true);
      return;
    }

    // Store for later
    pendingPayload = payload;

    // Build summary preview
    const filledList = Object.entries(summary)
      .filter(([, v]) => v)
      .map(([k, v]) => `<div class="ws-summary-row"><span class="label">${prettyName(k)}</span><span class="value">${v}</span></div>`)
      .join('');

    addMessage(
      `📋 Here's what I captured (<b>${fieldCount}</b> field${fieldCount > 1 ? 's' : ''}):\n` +
      (filledList ? `<div class="ws-summary">${filledList}</div>` : '') +
      `<br>👉 <b>Should I fill these fields?</b> Say <b>yes</b> to fill, or <b>no</b> to correct.`,
      'bot', '', true
    );

    conversationState = STATE_CONFIRMING;
    setStatus('Waiting for confirmation…');
  }

  // ============================================================
  // HANDLE CONFIRMATION (yes → fill, no → correction mode)
  // ============================================================

  async function handleConfirmation(text) {
    if (matchesAny(text, YES_WORDS)) {
      conversationState = STATE_IDLE;
      await doActualFill(pendingPayload);
      pendingPayload = null;
    } else if (matchesAny(text, NO_WORDS)) {
      conversationState = STATE_CORRECTING;
      addMessage(
        `🔧 No problem! Which field is wrong?<br><br>` +
        `Tell me the field name — for example:<br>` +
        `<i>"name is wrong"</i> or <i>"fix email"</i> or just say the field name.`,
        'bot', '', true
      );
      setStatus('Correction mode — tell me which field');
    } else {
      addMessage(
        `🤔 I didn't catch that. Please say <b>yes</b> to fill or <b>no</b> to correct a mistake.`,
        'bot', '', true
      );
    }
  }

  // ============================================================
  // HANDLE CORRECTION (identify which field to fix)
  // ============================================================

  async function handleCorrection(text) {
    // Try to find the field name the user mentioned
    const summary = pendingPayload?.summary || {};
    const fieldsToFill = pendingPayload?.fields_to_fill || {};
    const allKeys = [...new Set([...Object.keys(summary), ...Object.keys(fieldsToFill)])];

    let matchedField = null;
    const lower = text.toLowerCase();

    // Direct key match
    for (const key of allKeys) {
      if (lower.includes(key.toLowerCase()) || lower.includes(prettyName(key).toLowerCase())) {
        matchedField = key;
        break;
      }
    }

    // Fuzzy match common words
    if (!matchedField) {
      const commonFieldWords = {
        name: ['name', 'username', 'first', 'last', 'full'],
        email: ['email', 'mail', 'e-mail'],
        phone: ['phone', 'mobile', 'tel', 'number'],
        password: ['password', 'pass'],
        address: ['address', 'street', 'city', 'zip'],
      };
      for (const key of allKeys) {
        const keyLower = key.toLowerCase();
        for (const [, words] of Object.entries(commonFieldWords)) {
          if (words.some((w) => keyLower.includes(w) && lower.includes(w))) {
            matchedField = key;
            break;
          }
        }
        if (matchedField) break;
      }
    }

    if (!matchedField) {
      // List available fields so user can pick
      const fieldList = allKeys.map((k) => {
        const val = summary[k] || '';
        return `• <b>${prettyName(k)}</b>: ${val}`;
      }).join('<br>');

      addMessage(
        `🤔 I'm not sure which field you mean. Here are the current values:<br><br>` +
        fieldList + `<br><br>Please say the field name you want to correct.`,
        'bot', '', true
      );
      return;
    }

    correctingField = matchedField;
    spellingValue = '';
    conversationState = STATE_SPELLING;

    const currentVal = summary[matchedField] || fieldsToFill[matchedField]?.value || fieldsToFill[matchedField] || '';

    // Spell out the current value so user knows what's there
    addMessage(
      `📝 Current value for <b>${prettyName(matchedField)}</b>: <b>${currentVal}</b><br><br>` +
      `Let me spell it out for you…`,
      'bot', '', true
    );

    await spellAloud(prettyName(matchedField), currentVal);

    addMessage(
      `🔤 Now please tell me the correct spelling, letter by letter.<br>` +
      `For example: <i>"A H M E D"</i><br><br>` +
      `When you're done, say <b>"done"</b> or <b>"finished"</b>.`,
      'bot', '', true
    );
    setStatus(`Spelling mode — correct "${prettyName(matchedField)}"`);
  }

  // ============================================================
  // HANDLE SPELLING (collect letters from user)
  // ============================================================

  async function handleSpelling(text) {
    const lower = text.toLowerCase().trim();

    // Check for "done" / "finished" to end spelling
    if (['done', 'finished', 'that is it', "that's it", 'stop', 'end', 'okay'].includes(lower)) {
      if (!spellingValue.trim()) {
        addMessage('⚠️ You haven\'t spelled anything yet. Please say the letters, or say <b>"cancel"</b> to go back.', 'bot', '', true);
        return;
      }

      conversationState = STATE_SPELL_CONFIRM;

      addMessage(
        `📝 I got: <b>${spellingValue.trim()}</b><br><br>` +
        `Let me spell it back for confirmation…`,
        'bot', '', true
      );

      await spellAloud(prettyName(correctingField), spellingValue.trim());

      addMessage(
        `👉 Is <b>${spellingValue.trim()}</b> correct? Say <b>yes</b> to apply or <b>no</b> to spell again.`,
        'bot', '', true
      );
      setStatus('Confirm spelling…');
      return;
    }

    // Check for "cancel"
    if (['cancel', 'back', 'never mind', 'nevermind'].includes(lower)) {
      conversationState = STATE_CONFIRMING;
      spellingValue = '';
      correctingField = null;
      addMessage('↩️ Cancelled. Should I fill the original values? Say <b>yes</b> or <b>no</b>.', 'bot', '', true);
      return;
    }

    // Parse letters: "A H M E D" or "a, h, m, e, d" or "ahmed" (whole word)
    const letters = text.replace(/[,.\s]+/g, ' ').trim();

    // If it looks like individual letters (single chars separated by spaces),
    // treat each as a letter; otherwise treat as a whole word replacement
    const parts = letters.split(/\s+/);
    const allSingleChars = parts.every((p) => p.length === 1);

    if (allSingleChars) {
      spellingValue += parts.join('');
      addMessage(`🔤 Got it: <b>${spellingValue}</b> (say more letters, or <b>"done"</b> when finished)`, 'bot', '', false);
    } else {
      // User said a whole word — replace entirely
      spellingValue = text.trim();
      conversationState = STATE_SPELL_CONFIRM;

      addMessage(
        `📝 I got: <b>${spellingValue}</b><br>Let me spell it back…`,
        'bot', '', true
      );
      await spellAloud(prettyName(correctingField), spellingValue);

      addMessage(
        `👉 Is <b>${spellingValue}</b> correct? Say <b>yes</b> or <b>no</b>.`,
        'bot', '', true
      );
      setStatus('Confirm spelling…');
    }
  }

  // ============================================================
  // HANDLE SPELL CONFIRM (yes → apply correction, no → re-spell)
  // ============================================================

  async function handleSpellConfirm(text) {
    if (matchesAny(text, YES_WORDS)) {
      // Apply correction to pending payload
      if (pendingPayload) {
        if (pendingPayload.summary && correctingField in pendingPayload.summary) {
          pendingPayload.summary[correctingField] = spellingValue.trim();
        }
        if (pendingPayload.fields_to_fill && correctingField in pendingPayload.fields_to_fill) {
          const entry = pendingPayload.fields_to_fill[correctingField];
          if (typeof entry === 'object') {
            entry.value = spellingValue.trim();
          } else {
            pendingPayload.fields_to_fill[correctingField] = spellingValue.trim();
          }
        }
      }

      addMessage(
        `✅ Updated <b>${prettyName(correctingField)}</b> to <b>${spellingValue.trim()}</b>!`,
        'bot', '', true
      );

      // Reset and go back to confirmation
      spellingValue = '';
      correctingField = null;
      conversationState = STATE_CONFIRMING;

      // Show updated summary
      const summary = pendingPayload?.summary || {};
      const filledList = Object.entries(summary)
        .filter(([, v]) => v)
        .map(([k, v]) => `<div class="ws-summary-row"><span class="label">${prettyName(k)}</span><span class="value">${v}</span></div>`)
        .join('');

      addMessage(
        `📋 Updated values:\n<div class="ws-summary">${filledList}</div><br>` +
        `👉 <b>Should I fill these now?</b> Say <b>yes</b> to fill or <b>no</b> to correct another field.`,
        'bot', '', true
      );
      setStatus('Waiting for confirmation…');

    } else if (matchesAny(text, NO_WORDS)) {
      spellingValue = '';
      conversationState = STATE_SPELLING;
      addMessage(
        `🔄 Let's try again. Please spell <b>${prettyName(correctingField)}</b> letter by letter.<br>` +
        `Say <b>"done"</b> when finished.`,
        'bot', '', true
      );
      setStatus(`Re-spelling "${prettyName(correctingField)}"…`);
    } else {
      addMessage('🤔 Please say <b>yes</b> to apply the correction, or <b>no</b> to spell again.', 'bot', '', true);
    }
  }

  // ============================================================
  // HANDLE "SPELL <field>" COMMAND (read filled value aloud)
  // ============================================================

  async function handleSpellCommand(fieldText) {
    const lower = fieldText.toLowerCase().trim();

    // Search through filled fields and pending payload
    const allData = { ...filledFields, ...(pendingPayload?.summary || {}) };
    let matchedKey = null;
    let matchedValue = null;

    for (const [key, val] of Object.entries(allData)) {
      if (key.toLowerCase().includes(lower) || prettyName(key).toLowerCase().includes(lower)) {
        matchedKey = key;
        matchedValue = typeof val === 'object' ? val.value : val;
        break;
      }
    }

    // Fuzzy fallback
    if (!matchedKey) {
      for (const [key, val] of Object.entries(allData)) {
        const kw = key.toLowerCase().replace(/[_-]/g, ' ');
        if (lower.split(/\s+/).some((w) => kw.includes(w))) {
          matchedKey = key;
          matchedValue = typeof val === 'object' ? val.value : val;
          break;
        }
      }
    }

    if (!matchedKey || !matchedValue) {
      const available = Object.entries(allData)
        .filter(([, v]) => v)
        .map(([k, v]) => {
          const val = typeof v === 'object' ? v.value : v;
          return `• <b>${prettyName(k)}</b>: ${val}`;
        }).join('<br>');

      addMessage(
        `🤔 I don't have a value for "<b>${fieldText}</b>".<br><br>` +
        (available ? `Here's what I have:<br>${available}<br><br>Try: <i>"spell name"</i>` : 'No fields have been filled yet.'),
        'bot', '', true
      );
      return;
    }

    addMessage(`🔤 Spelling <b>${prettyName(matchedKey)}</b>: <b>${matchedValue}</b>`, 'bot', '', true);
    await spellAloud(prettyName(matchedKey), matchedValue);
  }

  // ============================================================
  // ACTUALLY FILL THE FORM (called after confirmation)
  // ============================================================

  async function doActualFill(payload) {
    const fieldsToFill = payload.fields_to_fill || {};
    const summary = payload.summary || {};
    const fieldCount = Object.keys(fieldsToFill).length;

    if (fieldCount === 0) {
      addMessage("⚠️ Nothing to fill.", 'bot', '', true);
      return;
    }

    setStatus('🔄 Filling form…');

    const fillResult = await chrome.runtime.sendMessage({
      type: 'EXECUTE_CHAT_FILL',
      fieldsToFill,
      summary,
      tabId: 'current',
    });

    // Update tracking
    for (const [key, data] of Object.entries(fieldsToFill)) {
      const val = typeof data === 'object' ? data.value : data;
      if (val) filledFields[key] = val;
    }

    // Build summary
    const filledList = Object.entries(summary)
      .filter(([, v]) => v)
      .map(([k, v]) => `<div class="ws-summary-row"><span class="label">${prettyName(k)}</span><span class="value">${v}</span></div>`)
      .join('');

    addMessage(
      `✅ Filled <b>${fieldCount}</b> field${fieldCount > 1 ? 's' : ''}!` +
      (filledList ? `<div class="ws-summary">${filledList}</div>` : ''),
      'bot', '', true
    );

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
      addMessage('🎉 <b>All fields filled!</b> Review the form and submit when ready.' + buildFieldChips(visibleFields), 'bot', '', true);
      setStatus('All fields filled ✓', 'success');
    }

    // Notify about not-found fields
    if (fillResult && fillResult.notFound && fillResult.notFound.length > 0) {
      const missed = fillResult.notFound.map((f) => prettyName(f.fieldName)).join(', ');
      addMessage(`⚠️ Could not locate on page: <b>${missed}</b>. These may need manual entry.`, 'bot', '', true);
    }

    conversationState = STATE_IDLE;
  }

  function showPartialFill(partial) {
    const entries = Object.entries(partial).filter(([, v]) => {
      const val = typeof v === 'object' ? v.value : v;
      return val;
    });
    if (entries.length === 0) return;

    const rows = entries.map(([k, v]) => {
      const val = typeof v === 'object' ? v.value : v;
      return `<div class="ws-summary-row"><span class="label">${prettyName(k)}</span><span class="value">${val}</span></div>`;
    }).join('');

    addMessage(`📋 So far I've captured:<div class="ws-summary">${rows}</div>`, 'bot', '', false);
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
    conversationState = STATE_IDLE;
    pendingPayload = null;
    correctingField = null;
    spellingValue = '';
    lastPartialData = null;
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
    }
  }, 1500);

})();
