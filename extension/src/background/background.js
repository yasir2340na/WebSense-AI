// Global state to track if voice control is active and active domains
let isVoiceControlActive = false;
let activeDomains = new Set(); // Track domains where voice control is active
let isInitialized = false; // Track if we've loaded from storage

// ============================================================
// FORM FILLING STATE & CONFIGURATION
// ============================================================

/** @type {string} Backend API base URL (loaded from storage or default) */
let BACKEND_URL = 'http://localhost:3000';

/** @type {Map<number, string>} Maps tabId -> sessionId for active form fill sessions */
const formFillSessions = new Map();

/** @type {CryptoKey|null} AES-256-GCM encryption key for profile storage */
let encryptionKey = null;

/**
 * Loads or generates the AES-256-GCM encryption key.
 * Key is stored in chrome.storage.session (cleared when browser closes).
 * @returns {Promise<CryptoKey>} The encryption key.
 */
const getEncryptionKey = async () => {
  if (encryptionKey) return encryptionKey;

  return new Promise((resolve) => {
    chrome.storage.session.get(['encKeyData'], async (data) => {
      if (data.encKeyData) {
        // Import existing key
        const keyData = new Uint8Array(data.encKeyData);
        encryptionKey = await crypto.subtle.importKey(
          'raw', keyData, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
        );
      } else {
        // Generate new key on first use
        encryptionKey = await crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
        );
        // Export and store in session storage
        const exported = await crypto.subtle.exportKey('raw', encryptionKey);
        chrome.storage.session.set({ encKeyData: Array.from(new Uint8Array(exported)) });
      }
      resolve(encryptionKey);
    });
  });
};

/**
 * Encrypts data using AES-256-GCM before storing in chrome.storage.local.
 * @param {Object} data - The data object to encrypt.
 * @returns {Promise<{iv: number[], ciphertext: number[]}>} Encrypted payload.
 */
const encryptData = async (data) => {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, encoded
  );

  return {
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertext)),
  };
};

/**
 * Decrypts AES-256-GCM encrypted data from chrome.storage.local.
 * @param {{iv: number[], ciphertext: number[]}} encryptedPayload - Encrypted data.
 * @returns {Promise<Object>} Decrypted data object.
 */
const decryptData = async (encryptedPayload) => {
  const key = await getEncryptionKey();
  const iv = new Uint8Array(encryptedPayload.iv);
  const ciphertext = new Uint8Array(encryptedPayload.ciphertext);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, key, ciphertext
  );

  return JSON.parse(new TextDecoder().decode(decrypted));
};

/**
 * Checks whether a page URL uses HTTPS.
 * Form filling is disabled on insecure HTTP pages.
 * @param {string} url - The page URL to check.
 * @returns {boolean} True if the page is secure (HTTPS).
 */
const isPageSecure = (url) => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Calls the form filling backend API.
 * @param {string} endpoint - API endpoint path (e.g., '/api/form-fill').
 * @param {Object} body - Request body.
 * @returns {Promise<Object>} API response.
 */
const callFormFillAPI = async (endpoint, body) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { status: 'error', message: 'Processing took too long. Please try again.' };
    }
    return { status: 'error', message: 'AI service temporarily unavailable' };
  }
};

// Load backend URL from storage
chrome.storage.sync.get(['voiceSettings'], (result) => {
  if (result.voiceSettings?.nlpBackendUrl) {
    BACKEND_URL = result.voiceSettings.nlpBackendUrl;
  }
});

// Helper to extract domain from URL
const getDomain = (url) => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
};

// Load active domains from storage
const loadActiveDomains = () => {
  return new Promise((resolve) => {
    chrome.storage.local.get(['activeDomains'], (data) => {
      if (data.activeDomains && data.activeDomains.length > 0) {
        activeDomains = new Set(data.activeDomains);
        console.log('🔄 Loaded active domains:', Array.from(activeDomains));
      } else {
        activeDomains = new Set();
        console.log('📭 No active domains in storage');
      }
      isInitialized = true;
      resolve(activeDomains);
    });
  });
};

// Save active domains to storage
const saveActiveDomains = async () => {
  const domainsArray = Array.from(activeDomains);
  console.log('💾 Saving active domains to storage:', domainsArray);
  
  return new Promise((resolve) => {
    chrome.storage.local.set({ 
      activeDomains: domainsArray
    }, () => {
      console.log('✅ Saved to storage successfully');
      // Verify it was saved
      chrome.storage.local.get(['activeDomains'], (data) => {
        console.log('🔍 Verification - Storage now contains:', data.activeDomains);
        resolve();
      });
    });
  });
};

// Initialize on extension load
loadActiveDomains();

// Listen for keyboard command (Ctrl+Shift+V)
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-voice') {
    console.log('⌨️ Keyboard shortcut triggered: Ctrl+Shift+V');
    
    // Toggle voice control for current tab
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]) {
        const domain = getDomain(tabs[0].url);
        
        if (domain) {
          // Check if already active for this domain
          const wasActive = activeDomains.has(domain);
          
          if (wasActive) {
            // Deactivate
            activeDomains.delete(domain);
            await saveActiveDomains();
            console.log(`🚫 Voice control deactivated via keyboard for: ${domain}`);
            
            // Remove UI
            chrome.scripting.executeScript({
              target: { tabId: tabs[0].id },
              func: () => {
                const wrapper = document.getElementById('ws-voice-wrapper');
                if (wrapper) wrapper.remove();
              }
            }).catch(err => console.error("Failed to remove UI:", err));
          } else {
            // Activate
            activeDomains.add(domain);
            await saveActiveDomains();
            console.log(`✅ Voice control activated via keyboard for: ${domain}`);
            await injectVoiceControl(tabs[0].id, domain);
          }
          
          // Update storage
          chrome.storage.local.set({ isVoiceControlActive: !wasActive });
        }
      }
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("WebSense-AI Extension Installed ✅");
});

// Track recent injections to prevent duplicates
const recentInjections = new Map(); // tabId -> timestamp
const INJECTION_COOLDOWN = 2000; // 2 seconds cooldown

// Function to inject the voice control script
const injectVoiceControl = async (tabId, domain = null) => {
  // Ensure domains are loaded
  if (!isInitialized) {
    await loadActiveDomains();
  }
  
  console.log(`📌 Attempting to inject into tab ${tabId}, domain: ${domain}`);
  console.log(`📌 Active domains:`, Array.from(activeDomains));
  
  // If domain is provided, check if it's active
  if (domain && !activeDomains.has(domain)) {
    console.log(`⛔ Domain ${domain} not in active domains, skipping injection`);
    return;
  }
  
  // Check cooldown to prevent rapid duplicate injections
  const lastInjection = recentInjections.get(tabId);
  const now = Date.now();
  if (lastInjection && (now - lastInjection) < INJECTION_COOLDOWN) {
    console.log(`⏳ Skipping duplicate injection (cooldown active)`);
    return;
  }
  
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['voiceControl.js'],
    });
    recentInjections.set(tabId, now);
    console.log(`✅ Voice control injected into tab ${tabId} for domain ${domain}`);
    
    // Clean up old entries after 5 seconds
    setTimeout(() => recentInjections.delete(tabId), 5000);
  } catch (err) {
    console.error("❌ Failed to inject script:", err);
  }
};

// Listen for messages from the popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Security: Verify message origin
  if (sender.id !== chrome.runtime.id) {
    console.warn('⚠️ Blocked message from unknown sender:', sender.id);
    return;
  }

  if (message.type === 'TOGGLE_VOICE_CONTROL') {
    isVoiceControlActive = message.active;
    
    if (isVoiceControlActive) {
      // Inject script when activating and track domain
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs[0]) {
          const domain = getDomain(tabs[0].url);
          console.log('🎯 Activating voice control for tab:', tabs[0].id, 'domain:', domain);
          
          if (domain) {
            activeDomains.add(domain);
            console.log('➕ Added domain to Set:', domain);
            console.log('📋 Active domains Set now contains:', Array.from(activeDomains));
            
            await saveActiveDomains();
            
            console.log(`✅ Voice control activated for domain: ${domain}`);
            await injectVoiceControl(tabs[0].id, domain);
          } else {
            console.log('❌ No domain extracted from URL:', tabs[0].url);
          }
        }
        sendResponse({ success: true, active: isVoiceControlActive });
      });
      return true; // Keep channel open for async
    } else {
      // Remove UI when deactivating and remove domain
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs[0]) {
          const domain = getDomain(tabs[0].url);
          if (domain) {
            activeDomains.delete(domain);
            await saveActiveDomains();
            console.log(`🚫 Voice control deactivated for domain: ${domain}`);
            console.log(`📋 Remaining active domains:`, Array.from(activeDomains));
          }
          
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
              const wrapper = document.getElementById('ws-voice-wrapper');
              if (wrapper) {
                wrapper.remove();
              }
            }
          }).catch(err => console.error("Failed to remove UI:", err));
        }
        sendResponse({ success: true, active: isVoiceControlActive });
      });
      return true; // Keep channel open for async
    }
  }
  
  // Handle new tab command
  else if (message.type === 'NEW_TAB') {
    chrome.tabs.create({}, () => {
      console.log("New tab created via voice command");
      sendResponse({ success: true });
    });
  }
  
  // Handle close tab command
  else if (message.type === 'CLOSE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.remove(tabs[0].id, () => {
          console.log("Tab closed via voice command");
          sendResponse({ success: true });
        });
      }
    });
  }
  
  // Handle duplicate tab command
  else if (message.type === 'DUPLICATE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        console.log('📋 Duplicating tab:', tabs[0].id);
        chrome.tabs.duplicate(tabs[0].id, (newTab) => {
          if (chrome.runtime.lastError) {
            console.error('❌ Tab duplication failed:', chrome.runtime.lastError);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            console.log("✅ Tab duplicated successfully:", newTab.id);
            sendResponse({ success: true, newTabId: newTab.id });
          }
        });
      } else {
        console.error('❌ No active tab found for duplication');
        sendResponse({ success: false, error: 'No active tab' });
      }
    });
    return true; // Keep channel open for async
  }

  // ============================================================
  // FORM FILLING MESSAGE HANDLERS
  // ============================================================

  /**
   * START_VOICE_FORM_FILL
   * Triggered from Popup UI when user initiates voice form fill.
   * 1. Checks page security (HTTPS only)
   * 2. Sends GET_PAGE_FIELDS to content script
   * 3. Forwards transcript + fields to /api/form-fill
   * 4. Returns response to Popup UI
   */
  else if (message.type === 'START_VOICE_FORM_FILL') {
    const { transcript, sessionId, userId } = message;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab found' });
        return;
      }

      const tab = tabs[0];

      // Security: Block form fill on HTTP pages
      if (!isPageSecure(tab.url) && !tab.url.startsWith('chrome://')) {
        sendResponse({
          success: false,
          error: 'Form fill disabled on unsafe pages',
          message: 'Voice form fill is only available on HTTPS pages for your security.',
        });
        return;
      }

      try {
        // Track session for this tab
        formFillSessions.set(tab.id, sessionId);

        // Request page fields from content script
        const fieldResponse = await chrome.tabs.sendMessage(tab.id, {
          type: 'GET_PAGE_FIELDS',
        });

        if (!fieldResponse || !fieldResponse.fields || fieldResponse.fields.length === 0) {
          sendResponse({
            success: false,
            error: 'No fillable fields detected on this page',
            message: 'Try clicking inside a form first.',
          });
          return;
        }

        // Call backend API
        const apiResponse = await callFormFillAPI('/api/form-fill', {
          transcript,
          pageFields: fieldResponse.fields,
          sessionId,
          userId: userId || 'default_user',
        });

        sendResponse({ success: true, ...apiResponse });
      } catch (err) {
        console.error('❌ Form fill error:', err.message);
        sendResponse({
          success: false,
          error: 'Form filling unavailable',
          message: 'AI service temporarily unavailable',
        });
      }
    });
    return true; // Keep channel open for async
  }

  /**
   * FORM_FILL_RESPONSE
   * Handles the result from the backend.
   * - "needs_input": forwards clarification question to Popup
   * - "ready": sends EXECUTE_FORM_FILL to content script
   */
  else if (message.type === 'FORM_FILL_RESPONSE') {
    const { status, payload, question, partial } = message;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }

      try {
        if (status === 'ready' && payload) {
          // Send fill command to content script
          const fillResult = await chrome.tabs.sendMessage(tabs[0].id, {
            type: 'EXECUTE_FORM_FILL',
            fieldsToFill: payload.fields_to_fill,
            summary: payload.summary,
            confidence: payload.confidence || {},
          });

          sendResponse({
            success: true,
            fillReport: fillResult,
            summary: payload.summary,
          });
        } else if (status === 'needs_input') {
          // Forward clarification back to popup
          sendResponse({
            success: true,
            status: 'needs_input',
            question,
            partial,
          });
        } else {
          sendResponse({
            success: false,
            error: 'Unexpected response from backend',
          });
        }
      } catch (err) {
        console.error('❌ Form fill response error:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    });
    return true; // Keep channel open for async
  }

  /**
   * VOICE_CORRECTION
   * Receives correction transcript from Popup.
   * Calls /api/form-fill/correction to update specific fields.
   */
  else if (message.type === 'VOICE_CORRECTION') {
    const { sessionId, correctionTranscript } = message;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }

      try {
        // Get current page fields for context
        const fieldResponse = await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'GET_PAGE_FIELDS',
        });

        const apiResponse = await callFormFillAPI('/api/form-fill/correction', {
          sessionId,
          correctionTranscript,
          pageFields: fieldResponse?.fields || [],
        });

        sendResponse({ success: true, ...apiResponse });
      } catch (err) {
        console.error('❌ Voice correction error:', err.message);
        sendResponse({
          success: false,
          error: 'Could not process correction',
          message: 'Please try again.',
        });
      }
    });
    return true; // Keep channel open for async
  }

  /**
   * SAVE_FORM_PROFILE
   * Saves confirmed field values encrypted to chrome.storage.local.
   * Uses AES-256-GCM via Web Crypto API.
   */
  else if (message.type === 'SAVE_FORM_PROFILE') {
    const { userId, profileData } = message;

    (async () => {
      try {
        const encrypted = await encryptData(profileData);
        const storageKey = `userProfile_${userId || 'default'}`;

        chrome.storage.local.set({ [storageKey]: encrypted }, () => {
          console.log('✅ Profile saved (encrypted)');
          sendResponse({ success: true });
        });
      } catch (err) {
        console.error('❌ Profile encryption/save failed:', err.message);
        sendResponse({ success: false, error: 'Failed to save profile' });
      }
    })();
    return true; // Keep channel open for async
  }

  /**
   * LOAD_FORM_PROFILE
   * Loads and decrypts saved form profile from chrome.storage.local.
   */
  else if (message.type === 'LOAD_FORM_PROFILE') {
    const { userId } = message;
    const storageKey = `userProfile_${userId || 'default'}`;

    chrome.storage.local.get([storageKey], async (data) => {
      try {
        if (data[storageKey]) {
          const decrypted = await decryptData(data[storageKey]);
          sendResponse({ success: true, profile: decrypted });
        } else {
          sendResponse({ success: true, profile: null });
        }
      } catch (err) {
        console.error('❌ Profile decryption failed:', err.message);
        sendResponse({ success: false, error: 'Failed to load profile' });
      }
    });
    return true; // Keep channel open for async
  }

  /**
   * CHAT_FORM_FILL
   * Triggered from the sliding chat panel (formChatPanel.js).
   * Receives transcript + already-scanned page fields.
   * Forwards to /api/form-fill and returns result to chat panel.
   */
  else if (message.type === 'CHAT_FORM_FILL') {
    const { transcript, sessionId, pageFields } = message;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab found' });
        return;
      }

      const tab = tabs[0];

      if (!isPageSecure(tab.url) && !tab.url.startsWith('chrome://')) {
        sendResponse({
          success: false,
          error: 'Form fill disabled on unsafe pages',
          message: 'Voice form fill is only available on HTTPS pages.',
        });
        return;
      }

      try {
        formFillSessions.set(tab.id, sessionId);

        const apiResponse = await callFormFillAPI('/api/form-fill', {
          transcript,
          pageFields: pageFields || [],
          sessionId,
          userId: 'default_user',
        });

        if (apiResponse.status === 'ready' && apiResponse.payload) {
          sendResponse({ success: true, status: 'ready', payload: apiResponse.payload });
        } else if (apiResponse.status === 'needs_input') {
          sendResponse({
            success: true,
            status: 'needs_input',
            question: apiResponse.question,
            partial: apiResponse.partial || {},
            missing: apiResponse.missing || [],
          });
        } else {
          sendResponse({ success: false, error: 'Unexpected backend response' });
        }
      } catch (err) {
        console.error('❌ Chat form fill error:', err.message);
        sendResponse({
          success: false,
          error: 'Form filling unavailable',
          message: 'Backend service temporarily unavailable',
        });
      }
    });
    return true;
  }

  /**
   * EXECUTE_CHAT_FILL
   * Triggered from chat panel after backend returns ready payload.
   * Forwards EXECUTE_FORM_FILL to content.js to fill actual DOM fields.
   */
  else if (message.type === 'EXECUTE_CHAT_FILL') {
    const { fieldsToFill, summary } = message;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
      }

      try {
        const fillResult = await chrome.tabs.sendMessage(tabs[0].id, {
          type: 'EXECUTE_FORM_FILL',
          fieldsToFill,
          summary,
          confidence: {},
        });

        sendResponse({
          success: true,
          filled: fillResult?.filled || [],
          notFound: fillResult?.notFound || [],
        });
      } catch (err) {
        console.error('❌ Execute chat fill error:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    });
    return true;
  }

  /**
   * CLEAR_FORM_SESSION
   * Clears form fill session when user resets or tab navigates away.
   * Calls DELETE /api/form-fill/session/:sessionId on backend.
   */
  else if (message.type === 'CLEAR_FORM_SESSION') {
    const { sessionId } = message;

    if (sessionId) {
      // Call backend to clear session
      fetch(`${BACKEND_URL}/api/form-fill/session/${sessionId}`, {
        method: 'DELETE',
      }).catch(() => { /* Silent fail on cleanup */ });
    }

    sendResponse({ success: true });
  }

  return true; // Keep message channel open for async response
});

// Listens for navigation events to reinject the script if voice control is active for this domain.
chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Ignore sub-frame navigations
  if (details.frameId !== 0) {
    return;
  }

  // Ensure domains are loaded
  if (!isInitialized) {
    await loadActiveDomains();
  }

  const domain = getDomain(details.url);
  if (!domain) return;
  
  console.log(`🔍 Navigation completed to: ${domain}`);
  console.log(`🔍 Checking if ${domain} is in active domains:`, Array.from(activeDomains));
  
  // Check if this domain is active
  if (activeDomains.has(domain)) {
    console.log(`✨ Auto-injecting on navigation to ${details.url}`);
    await injectVoiceControl(details.tabId, domain);
  } else {
    console.log(`⏭️ Skipping injection - ${domain} not active`);
  }
}, { url: [{ schemes: ['http', 'https'] }] });

// Also listen for tab updates (catches more navigation events)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when page has finished loading
  if (changeInfo.status === 'complete' && tab.url) {
    // Ensure domains are loaded
    if (!isInitialized) {
      await loadActiveDomains();
    }
    
    const domain = getDomain(tab.url);
    if (!domain) return;
    
    console.log(`🔄 Tab ${tabId} updated to: ${domain}`);
    console.log(`🔄 Checking if ${domain} is in active domains:`, Array.from(activeDomains));
    
    if (activeDomains.has(domain)) {
      console.log(`✨ Auto-injecting on tab update to ${tab.url}`);
      await injectVoiceControl(tabId, domain);
    } else {
      console.log(`⏭️ Skipping injection - ${domain} not active`);
    }
  }
});

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (recentInjections.has(tabId)) {
    recentInjections.delete(tabId);
    console.log(`🗑️ Cleaned up tab ${tabId} from injection cache`);
  }

  // Clean up form fill session for this tab
  if (formFillSessions.has(tabId)) {
    const sessionId = formFillSessions.get(tabId);
    formFillSessions.delete(tabId);

    // Call backend to clear session state
    fetch(`${BACKEND_URL}/api/form-fill/session/${sessionId}`, {
      method: 'DELETE',
    }).catch(() => { /* Silent fail on cleanup */ });

    console.log(`🗑️ Cleared form fill session for tab ${tabId}`);
  }
});
