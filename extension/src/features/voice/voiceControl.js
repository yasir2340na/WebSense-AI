// This script will be injected into the active tab to handle voice commands.
// It creates a floating UI and manages speech recognition.

(function() {
  // CRITICAL: Prevent duplicate injections
  if (window.wsVoiceControlActive) {
    console.log("⚠️ Voice control already active, skipping duplicate injection");
    return;
  }
  window.wsVoiceControlActive = true;

  // Cleanup function to properly stop everything
  const cleanup = () => {
    console.log("🧹 Cleaning up voice control");
    if (window.wsRecognitionInstance) {
      try {
        window.wsRecognitionInstance.stop();
        window.wsRecognitionInstance.abort();
      } catch (e) {
        console.log("Recognition cleanup error (normal):", e.message);
      }
      window.wsRecognitionInstance = null;
    }
    
    // Cancel any speech
    try {
      window.speechSynthesis.cancel();
    } catch (e) {
      console.log("Speech cleanup error:", e.message);
    }
    
    // Remove all highlights from page
    try {
      document.querySelectorAll('.ws-highlight').forEach(h => {
        if (h._updatePosition) {
          window.removeEventListener('scroll', h._updatePosition, true);
          window.removeEventListener('resize', h._updatePosition);
        }
        h.remove();
      });
      console.log("✅ Removed all highlights");
    } catch (e) {
      console.log("Highlight cleanup error:", e.message);
    }
    
    window.wsVoiceControlActive = false;
  };

  // Handle page hide/visibility changes - cleanup when page is hidden
  // Note: beforeunload is deprecated and violates Chrome's permissions policy
  window.addEventListener('pagehide', () => {
    console.log("📄 Page hiding - cleaning up voice control");
    cleanup();
  });
  
  // Also handle visibility change for better cleanup
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.log("👁️ Page hidden - pausing voice control");
      if (window.wsRecognitionInstance) {
        try {
          window.wsRecognitionInstance.stop();
        } catch (e) {
          console.log("Recognition pause error:", e.message);
        }
      }
    }
  });

  // Remove old UI if exists (for re-injection on navigation)
  const oldWrapper = document.getElementById('ws-voice-wrapper');
  if (oldWrapper) {
    console.log("🔄 Removing old voice control UI from previous page");
    cleanup(); // Clean up old instance first
    oldWrapper.remove();
  }

  console.log("WebSense-AI Voice Control Injected ✅");

  // --- Enhanced Context Manager for Conversational Memory ---
  const contextManager = {
    lastAction: null,
    lastTarget: null,
    lastElements: [],
    lastClickedElement: null, // Track last clicked element for "click it again"
    lastSpokenText: null, // Track last TTS output for "what did you say"
    recentPages: [],
    conversationHistory: [],
    pendingScrollDirection: null,
    corrections: [], // Track user corrections like "no, not that one"
    
    remember(action, target, elements = [], metadata = {}) {
      this.lastAction = action;
      this.lastTarget = target;
      this.lastElements = elements.slice(0, 10); // Keep max 10
      
      // Store clicked element reference
      if (action === 'click' && elements.length > 0) {
        this.lastClickedElement = elements[0];
      }
      
      this.conversationHistory.push({
        action,
        target,
        elementCount: elements.length,
        metadata,
        timestamp: Date.now()
      });
      
      // Keep only last 30 interactions for better context
      if (this.conversationHistory.length > 30) {
        this.conversationHistory.shift();
      }
      
      console.log('🧠 Context updated:', action, target, `(${elements.length} elements)`);
    },
    
    rememberSpoken(text) {
      this.lastSpokenText = text;
    },
    
    addCorrection(correctionType, data) {
      this.corrections.push({
        type: correctionType,
        data,
        timestamp: Date.now()
      });
      if (this.corrections.length > 10) {
        this.corrections.shift();
      }
    },
    
    getContext() {
      return {
        lastAction: this.lastAction,
        lastTarget: this.lastTarget,
        hasElements: this.lastElements.length > 0,
        lastClickedElement: this.lastClickedElement,
        lastSpokenText: this.lastSpokenText,
        recentCommands: this.conversationHistory.slice(-5),
        canRepeat: this.lastClickedElement !== null,
        canCorrect: this.corrections.length > 0
      };
    },
    
    clear() {
      this.lastAction = null;
      this.lastTarget = null;
      this.lastElements = [];
      this.pendingScrollDirection = null;
      // Keep lastClickedElement and corrections for references
      console.log('🧹 Context partially cleared');
    },
    
    fullClear() {
      // Complete reset
      this.lastAction = null;
      this.lastTarget = null;
      this.lastElements = [];
      this.lastClickedElement = null;
      this.lastSpokenText = null;
      this.conversationHistory = [];
      this.corrections = [];
      this.pendingScrollDirection = null;
      console.log('🧹 Context fully cleared');
    }
  };

  // --- UI Creation & Dragging ---
  const createUI = () => {
    const wrapper = document.createElement('div');
    wrapper.id = 'ws-voice-wrapper';
    wrapper.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: center;
      user-select: none;
    `;

    // Drag handle (invisible area around button for dragging)
    const dragHandle = document.createElement('div');
    dragHandle.id = 'ws-drag-handle';
    dragHandle.style.cssText = `
      padding: 15px;
      cursor: grab;
      border-radius: 50%;
      transition: background 0.2s ease;
    `;

    const micButton = document.createElement('button');
    micButton.id = 'ws-voice-btn';
    micButton.innerHTML = '🎤';
    micButton.style.cssText = `
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background-color: #007bff;
      color: white;
      font-size: 30px;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      transition: all 0.2s ease;
      position: relative;
      z-index: 10;
    `;
    micButton.addEventListener('mouseenter', () => {
      if (!isDragging) micButton.style.transform = 'scale(1.1)';
    });
    micButton.addEventListener('mouseleave', () => {
      if (!isDragging) micButton.style.transform = 'scale(1)';
    });

    const statusPopup = document.createElement('div');
    statusPopup.id = 'ws-voice-status';
    statusPopup.style.cssText = `
        position: absolute;
        bottom: 100%;
        margin-bottom: 10px;
        background-color: rgba(0,0,0,0.85);
        color: white;
        padding: 10px 18px;
        border-radius: 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        font-weight: 500;
        opacity: 0;
        transition: opacity 0.3s ease;
        visibility: hidden;
        white-space: nowrap;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;

    dragHandle.appendChild(micButton);
    wrapper.appendChild(statusPopup);
    wrapper.appendChild(dragHandle);
    document.body.appendChild(wrapper);

    // --- Dragging Logic ---
    let isDragging = false;
    let hasDragged = false;
    let offsetX, offsetY;
    let startX, startY;

    dragHandle.addEventListener('mousedown', (e) => {
      // Prevent dragging if clicking directly on the button
      if (e.target === micButton) {
        return;
      }
      
      isDragging = true;
      hasDragged = false;
      startX = e.clientX;
      startY = e.clientY;
      offsetX = e.clientX - wrapper.getBoundingClientRect().left;
      offsetY = e.clientY - wrapper.getBoundingClientRect().top;
      dragHandle.style.cursor = 'grabbing';
      dragHandle.style.background = 'rgba(255,255,255,0.1)';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const deltaX = Math.abs(e.clientX - startX);
        const deltaY = Math.abs(e.clientY - startY);
        
        // Consider it a drag if moved more than 5 pixels
        if (deltaX > 5 || deltaY > 5) {
          hasDragged = true;
        }

        let newX = e.clientX - offsetX;
        let newY = e.clientY - offsetY;

        // Constrain to viewport
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const rect = wrapper.getBoundingClientRect();

        if (newX < 0) newX = 0;
        if (newY < 0) newY = 0;
        if (newX + rect.width > vw) newX = vw - rect.width;
        if (newY + rect.height > vh) newY = vh - rect.height;

        wrapper.style.left = `${newX}px`;
        wrapper.style.top = `${newY}px`;
        wrapper.style.right = 'auto';
        wrapper.style.bottom = 'auto';
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        dragHandle.style.cursor = 'grab';
        dragHandle.style.background = 'transparent';
        
        // Small delay to prevent click event if dragged
        if (hasDragged) {
          setTimeout(() => { hasDragged = false; }, 100);
        }
      }
    });

    return { micButton, statusPopup, wrapper, dragHandle };
  };

  const { micButton, statusPopup, wrapper, dragHandle } = createUI();
  let isListening = false;
  let isDragging = false;
  let isSpeaking = false; // Track if TTS is currently speaking
  
  // Load voices for speech synthesis
  let voicesLoaded = false;
  const loadVoices = () => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      voicesLoaded = true;
      console.log("✅ Voices loaded:", voices.length);
    }
  };
  
  // Load voices on page load
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }
  loadVoices(); // Try loading immediately
  
  // Store detected elements for smart selection
  let awaitingSelection = false;
  let selectionType = '';
  let selectionContext = [];
  let pendingConfirmation = null; // Stores element waiting for user confirmation
  
  // Action history for undo/redo
  const actionHistory = [];
  const MAX_HISTORY = 20;
  
  const recordAction = (type, data) => {
    actionHistory.push({
      type,
      data,
      timestamp: Date.now()
    });
    if (actionHistory.length > MAX_HISTORY) {
      actionHistory.shift();
    }
    console.log('📝 Recorded action:', type, data);
  };
  
  // Backend API configuration
  const BACKEND_API = 'http://localhost:3000/api/voice/parse';
  const BACKEND_NAVIGATE_API = 'http://localhost:3000/api/voice/navigate';
  const USE_NLP_BACKEND = true; // Set to false to use old pattern matching
  const USE_SMART_NAVIGATE = true; // Use intelligent element matching with /navigate endpoint

  // Helper function to get visible, clickable elements
  const getVisibleElements = (selector) => {
    return Array.from(document.querySelectorAll(selector)).filter(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && 
             rect.height > 0 && 
             style.display !== 'none' && 
             style.visibility !== 'hidden' &&
             style.opacity !== '0';
    });
  };

  // Cache for dynamic elements
  let elementCache = {
    buttons: [],
    links: [],
    clickables: [],
    lastUpdate: 0
  };

  // Debounced update timer
  let updateCacheTimer = null;

  // MutationObserver to watch for dynamic DOM changes
  const setupDOMObserver = () => {
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      let hasImportantChange = false;
      
      for (const mutation of mutations) {
        // Check if nodes were added or removed
        if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
          // Check if added nodes contain interactive elements
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) { // Element node
              const elem = node;
              // Check for any potentially clickable element
              if (elem.matches('button, a, [role="button"], [onclick], nav, menu, [role="menu"], [role="dialog"], [role="tab"], [role="menuitem"], div[class*="click"], span[class*="click"], [data-action], [aria-haspopup]')) {
                hasImportantChange = true;
                shouldUpdate = true;
                break;
              }
              // Check if it contains interactive elements
              if (elem.querySelectorAll && elem.querySelectorAll('button, a, [role="button"], [onclick], div[class*="click"], span[class*="click"]').length > 0) {
                hasImportantChange = true;
                shouldUpdate = true;
                break;
              }
            }
          }
          if (hasImportantChange) break;
          shouldUpdate = true;
        }
        
        // Check if attributes changed on interactive elements
        if (mutation.type === 'attributes' && mutation.target) {
          const target = mutation.target;
          if (target.matches('button, a, [role="button"], [onclick], [role="menu"], [role="dialog"], div[class*="click"], span[class*="click"], [data-action]')) {
            shouldUpdate = true;
            // Style/class changes might affect visibility - important
            if (mutation.attributeName === 'style' || mutation.attributeName === 'class') {
              hasImportantChange = true;
            }
            break;
          }
        }
      }
      
      if (shouldUpdate) {
        // Clear any pending update
        if (updateCacheTimer) {
          clearTimeout(updateCacheTimer);
        }
        
        // If important change (new menu, dialog, etc.), update immediately
        if (hasImportantChange) {
          console.log('⚡ Important DOM change detected - updating cache immediately');
          updateElementCache();
          elementCache.lastUpdate = Date.now();
        } else {
          // Otherwise debounce for 200ms for better performance
          updateCacheTimer = setTimeout(() => {
            const now = Date.now();
            if (now - elementCache.lastUpdate > 200) {
              console.log('🔄 DOM changed, updating element cache...');
              updateElementCache();
              elementCache.lastUpdate = now;
            }
            updateCacheTimer = null;
          }, 200); // Faster debounce - was 500ms
        }
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'disabled', 'aria-hidden']
    });
    
    console.log('👁️ MutationObserver activated for dynamic DOM watching');
    return observer;
  };

  // Update element cache with performance optimization
  const updateElementCache = () => {
    const startTime = performance.now();
    
    // Traditional buttons and button-like elements
    elementCache.buttons = getVisibleElements('button, [role="button"], input[type="submit"], input[type="button"], .btn, [class*="button"], [class*="Button"]');
    
    // Links
    elementCache.links = getVisibleElements('a[href], [role="link"]');
    
    // ALL other clickable elements (modern web apps use divs, spans, etc.)
    elementCache.clickables = getVisibleElements([
      '[onclick]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[role="option"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="treeitem"]',
      '[role="gridcell"]',
      '[tabindex]:not([tabindex="-1"])',
      'div[class*="click"]',
      'div[class*="Click"]',
      'span[class*="click"]',
      'span[class*="Click"]',
      'div[class*="btn"]',
      'div[class*="Btn"]',
      'span[class*="btn"]',
      'span[class*="Btn"]',
      '[data-action]',
      '[data-click]',
      '[data-handler]',
      '[data-testid*="button"]',
      '[data-testid*="click"]',
      '[aria-haspopup]',
      '[aria-expanded]',
      '[class*="interactive"]',
      '[class*="Interactive"]',
      '[class*="selectable"]',
      '[class*="Selectable"]',
      'li[class*="item"]',
      'li[class*="Item"]',
      '[class*="card"]',
      '[class*="Card"]',
      '[class*="tile"]',
      '[class*="Tile"]'
    ].join(', '));
    
    // Also detect elements with cursor:pointer style (common for clickables)
    const allElements = document.querySelectorAll('div, span, p, li, label');
    const pointerElements = Array.from(allElements).filter(el => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.cursor === 'pointer' && 
             rect.width > 0 && 
             rect.height > 0 && 
             style.display !== 'none' && 
             style.visibility !== 'hidden' &&
             style.opacity !== '0' &&
             // Has some text content or child elements
             (el.textContent.trim().length > 0 || el.children.length > 0);
    });
    
    // Merge pointer elements with clickables (avoid duplicates)
    const existingClickables = new Set(elementCache.clickables);
    pointerElements.forEach(el => {
      if (!existingClickables.has(el)) {
        elementCache.clickables.push(el);
      }
    });
    
    const duration = performance.now() - startTime;
    console.log(`📦 Cache updated in ${duration.toFixed(2)}ms: ${elementCache.buttons.length} buttons, ${elementCache.links.length} links, ${elementCache.clickables.length} other clickables`);
  };

  // Force cache update (can be called manually)
  const forceUpdateCache = () => {
    console.log('🔄 Forcing cache update...');
    updateElementCache();
    elementCache.lastUpdate = Date.now();
  };

  // Initialize observer
  const domObserver = setupDOMObserver();
  
  // Initial cache update
  updateElementCache();
  
  // Update cache when page fully loads (for lazy-loaded content)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('📄 DOMContentLoaded - updating cache');
      setTimeout(forceUpdateCache, 500); // Wait for lazy content
    });
  }
  
  // Also update on window load (for images and heavy content)
  window.addEventListener('load', () => {
    console.log('🌐 Window loaded - updating cache');
    setTimeout(forceUpdateCache, 1000); // Wait for everything
  });
  
  // Update cache on scroll (for infinite scroll / lazy loading)
  let scrollUpdateTimer = null;
  window.addEventListener('scroll', () => {
    if (scrollUpdateTimer) clearTimeout(scrollUpdateTimer);
    scrollUpdateTimer = setTimeout(() => {
      const now = Date.now();
      if (now - elementCache.lastUpdate > 2000) { // Only if not updated recently
        console.log('📜 Scroll detected - checking for new content');
        forceUpdateCache();
      }
    }, 1000); // Debounce scroll events
  }, { passive: true });

  // Track mouse position and last clicked element for smart scroll
  let lastMouseX = 0;
  let lastMouseY = 0;
  let lastClickedElement = null;

  // Track mouse movements
  document.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }, { passive: true });

  // Track clicks to remember context and trigger cache update on expandable elements
  document.addEventListener('click', (e) => {
    lastClickedElement = e.target;
    console.log("🖱️ Last clicked element:", lastClickedElement);
    
    // Check if clicked element might trigger new content (dropdown, accordion, etc.)
    const target = e.target.closest('[role="button"], [aria-expanded], [aria-controls], .dropdown, .accordion, details, summary');
    if (target) {
      console.log('🎯 Clicked expandable element - scheduling cache update');
      // Wait a bit for animation/content to load, then update cache
      setTimeout(() => {
        console.log('⚡ Updating cache after expandable element click');
        updateElementCache();
        elementCache.lastUpdate = Date.now();
      }, 300); // Wait for animations
    }
  }, { passive: true });

  // Smart scroll detection - finds scrollable container at mouse position or last click
  const getSmartScrollTarget = () => {
    let targetElement = null;
    
    // Priority 1: Element at mouse position
    const elementAtMouse = document.elementFromPoint(lastMouseX, lastMouseY);
    if (elementAtMouse) {
      console.log("🎯 Element at mouse:", elementAtMouse);
      targetElement = elementAtMouse;
    }
    
    // Priority 2: Last clicked element
    if (!targetElement && lastClickedElement) {
      console.log("🎯 Using last clicked element:", lastClickedElement);
      targetElement = lastClickedElement;
    }
    
    // Priority 3: Body/document
    if (!targetElement) {
      targetElement = document.body;
    }
    
    // Find the nearest scrollable parent
    let current = targetElement;
    while (current && current !== document.documentElement) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;
      
      // Check if this element is scrollable
      if ((overflowY === 'auto' || overflowY === 'scroll' || 
           overflowX === 'auto' || overflowX === 'scroll') &&
          (current.scrollHeight > current.clientHeight || 
           current.scrollWidth > current.clientWidth)) {
        
        console.log("✅ Found scrollable parent:", {
          element: current,
          tag: current.tagName,
          id: current.id,
          class: current.className,
          scrollHeight: current.scrollHeight,
          clientHeight: current.clientHeight
        });
        
        return {
          element: current,
          name: current.id || current.className || current.tagName,
          isWindow: false
        };
      }
      
      current = current.parentElement;
    }
    
    // Fallback to main window scroll
    if (document.documentElement.scrollHeight > window.innerHeight) {
      console.log("✅ Using main window scroll");
      return {
        element: document.documentElement,
        name: 'Main Page',
        isWindow: true
      };
    }
    
    console.log("❌ No scrollable area found");
    return null;
  };

  // Scroll a specific container
  const scrollContainer = (container, direction, amount = 0.7) => {
    if (container.isWindow) {
      switch(direction) {
        case 'down':
          window.scrollBy({ top: window.innerHeight * amount, behavior: 'smooth' });
          break;
        case 'up':
          window.scrollBy({ top: -window.innerHeight * amount, behavior: 'smooth' });
          break;
        case 'top':
          window.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        case 'bottom':
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          break;
      }
    } else {
      const el = container.element;
      switch(direction) {
        case 'down':
          el.scrollBy({ top: el.clientHeight * amount, behavior: 'smooth' });
          break;
        case 'up':
          el.scrollBy({ top: -el.clientHeight * amount, behavior: 'smooth' });
          break;
        case 'top':
          el.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        case 'bottom':
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          break;
      }
    }
  };

  // Removed continuous scrolling functions - keeping only simple scroll

  // Clean command - remove filler words and extract intent
  const cleanCommand = (command) => {
    // Remove common filler words, articles, and helping verbs
    const fillerWords = [
      'could you', 'would you', 'can you', 'will you', 'please', 'kindly',
      'i want to', 'i would like to', 'i need to', 'i want',
      'the', 'a', 'an', 'this', 'that', 'these', 'those',
      'just', 'maybe', 'perhaps', 'possibly',
      'go ahead and', 'please go ahead and'
    ];
    
    let cleaned = command.toLowerCase().trim();
    
    // Remove filler phrases
    fillerWords.forEach(filler => {
      const regex = new RegExp(`\\b${filler}\\b`, 'gi');
      cleaned = cleaned.replace(regex, ' ');
    });
    
    // Remove extra spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    console.log("Original command:", command);
    console.log("Cleaned command:", cleaned);
    
    return cleaned;
  };

  // Fuzzy match function for natural language element selection
  const fuzzyMatch = (text, query) => {
    if (!text || !query) return 0;
    
    text = text.toLowerCase().trim();
    query = query.toLowerCase().trim();
    
    // Exact match
    if (text === query) return 1.0;
    
    // Contains match
    if (text.includes(query)) return 0.9;
    
    // Word-by-word partial matching
    const textWords = text.split(/\s+/);
    const queryWords = query.split(/\s+/);
    let matchCount = 0;
    
    for (const qw of queryWords) {
      if (textWords.some(tw => tw.includes(qw) || qw.includes(tw))) {
        matchCount++;
      }
    }
    
    const wordScore = matchCount / queryWords.length;
    if (wordScore > 0.5) return 0.7 * wordScore;
    
    // Character-level similarity (Levenshtein-like)
    let matches = 0;
    for (let i = 0; i < query.length; i++) {
      if (text.includes(query[i])) matches++;
    }
    
    return (matches / query.length) * 0.5;
  };

  // Smart element finder with fuzzy matching
  const findBestElement = (elements, descriptor) => {
    if (!descriptor || elements.length === 0) return null;
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const el of elements) {
      const desc = getElementDescription(el);
      const score = fuzzyMatch(desc, descriptor);
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = el;
      }
    }
    
    // Only return if confidence is high enough
    return bestScore >= 0.5 ? bestMatch : null;
  };

  // Parse command using spaCy NLP backend
  const parseCommandWithNLP = async (text) => {
    try {
      console.log("📡 Sending to NLP backend:", text);
      
      const response = await fetch(BACKEND_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const parsed = await response.json();
      console.log("🧠 NLP parsed:", parsed);
      
      return parsed;

    } catch (error) {
      console.warn("⚠️  NLP backend error:", error.message);
      console.log("Falling back to pattern matching");
      return null; // Will fall back to old method
    }
  };

  // Smart navigate with intelligent element matching
  const navigateWithSmartMatch = async (command) => {
    try {
      console.log("🎯 Using smart navigate for:", command);
      
      // Ensure cache is updated
      const cacheAge = Date.now() - elementCache.lastUpdate;
      if (cacheAge > 5000) {
        console.log('🔄 Refreshing element cache before smart navigate...');
        updateElementCache();
      }
      
      // Collect all interactive page elements
      const pageElements = [];
      let idCounter = 0;
      
      // Get buttons from cache
      if (elementCache.buttons && elementCache.buttons.length > 0) {
        elementCache.buttons.forEach(btn => {
          const text = btn.innerText?.trim() || btn.value || btn.ariaLabel || '';
          if (text) {  // Only include if has text
            pageElements.push({
              id: idCounter++,
              text: text,
              type: 'button',
              selector: `button:nth-of-type(${Array.from(document.querySelectorAll('button')).indexOf(btn) + 1})`
            });
          }
        });
      }
      
      // Get links from cache
      if (elementCache.links && elementCache.links.length > 0) {
        elementCache.links.forEach(link => {
          const text = link.innerText?.trim() || link.title || link.ariaLabel || '';
          if (text) {  // Only include if has text
            pageElements.push({
              id: idCounter++,
              text: text,
              type: 'link',
              selector: `a:nth-of-type(${Array.from(document.querySelectorAll('a')).indexOf(link) + 1})`
            });
          }
        });
      }
      
      // Get inputs
      const inputs = getVisibleElements('input:not([type="hidden"]), textarea, select');
      if (inputs && inputs.length > 0) {
        inputs.forEach(input => {
          const text = input.placeholder || input.name || input.ariaLabel || input.title || '';
          if (text) {  // Only include if has identifying text
            pageElements.push({
              id: idCounter++,
              text: text,
              type: 'input',
              selector: `input:nth-of-type(${Array.from(document.querySelectorAll('input')).indexOf(input) + 1})`
            });
          }
        });
      }
      
      console.log(`📦 Collected ${pageElements.length} page elements`);
      
      // Call navigate endpoint
      const response = await fetch(BACKEND_NAVIGATE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          command,
          page_elements: pageElements
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      console.log("🎯 Smart navigate result:", result);
      
      return result;

    } catch (error) {
      console.warn("⚠️  Smart navigate error:", error.message);
      return null;
    }
  };

  // Smart speak function with recognition management and context memory
  const smartSpeak = (text, callback = null, userGesture = false) => {
    console.log("🔊 smartSpeak called with:", text, "[userGesture:", userGesture, "]");
    console.log("📊 Voices loaded:", voicesLoaded, "Available voices:", window.speechSynthesis.getVoices().length);
    
    if (!text || text.trim() === '') {
      console.log("⚠️ Empty text, skipping speech");
      if (callback) callback();
      return;
    }
    
    if (!('speechSynthesis' in window)) {
      console.log("❌ Speech synthesis not available");
      if (callback) callback();
      return;
    }

    try {
      // Remember what we're saying for "what did you say" commands
      contextManager.rememberSpoken(text);
      
      console.log("🛑 Canceling any ongoing speech");
      window.speechSynthesis.cancel();
      
      // Create utterance immediately - no delay
      console.log("📢 Creating utterance for:", text);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.volume = 1.0;
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';
      
      // Try to set a voice
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const englishVoice = voices.find(v => v.lang.includes('en')) || voices[0];
        utterance.voice = englishVoice;
        console.log("🎤 Using voice:", englishVoice.name);
      } else {
        console.log("⚠️ No voices available yet");
      }
      
      utterance.onstart = () => {
        console.log("✅ TTS STARTED:", text);
        isSpeaking = true;
      };
      
      utterance.onend = () => {
        console.log("✅ TTS ENDED");
        isSpeaking = false;
        if (callback) callback();
      };
      
      utterance.onerror = (event) => {
        // Handle different error types appropriately
        if (event.error === 'interrupted') {
          // Interrupted is normal - happens when new speech starts or page navigates
          console.log("⏸️ TTS interrupted (normal - new speech starting or navigation)");
        } else if (event.error === 'canceled') {
          // Canceled is normal - user or code stopped speech
          console.log("🚫 TTS canceled (normal)");
        } else if (event.error === 'not-allowed' && !userGesture) {
          // Not-allowed without user gesture is expected
          console.log("⚠️ TTS blocked (requires user gesture) - this is normal on page load");
          showStatus("🔇 Voice ready. Click mic to hear welcome.", 3000);
        } else {
          // Only log unexpected errors
          console.warn("⚠️ TTS ERROR:", event.error, event);
        }
        
        isSpeaking = false;
        if (callback) callback();
      };
      
      console.log("🚀 Calling window.speechSynthesis.speak() [userGesture:", userGesture, "]");
      window.speechSynthesis.speak(utterance);
      
      // Verify it's speaking
      setTimeout(() => {
        console.log("📊 Speech status - speaking:", window.speechSynthesis.speaking, "pending:", window.speechSynthesis.pending);
      }, 100);
      
    } catch (e) {
      console.error("💥 Error with speech synthesis:", e);
      isSpeaking = false;
      if (callback) callback();
    }
  };

  // Get element description with semantic matching
  const getElementDescription = (el) => {
    let desc = el.innerText?.trim().substring(0, 50) || 
               el.getAttribute('aria-label') || 
               el.getAttribute('title') || 
               el.getAttribute('placeholder') ||
               el.name ||
               el.id ||
               'unnamed';
    
    // Semantic synonyms for better matching
    const synonymMap = {
      'login': ['sign in', 'log in', 'signin', 'enter', 'access'],
      'signup': ['sign up', 'register', 'join', 'create account'],
      'search': ['find', 'look for', 'query', 'explore'],
      'submit': ['send', 'go', 'confirm', 'ok', 'done'],
      'cancel': ['close', 'dismiss', 'exit', 'quit', 'back'],
      'menu': ['navigation', 'nav', 'options', 'hamburger'],
      'profile': ['account', 'user', 'settings', 'me'],
      'cart': ['shopping', 'basket', 'bag', 'checkout'],
      'home': ['main', 'index', 'start', 'dashboard']
    };
    
    desc = desc.toLowerCase();
    
    // Add semantic variations for better matching
    for (const [key, synonyms] of Object.entries(synonymMap)) {
      if (desc.includes(key)) {
        desc += ' ' + synonyms.join(' ');
      }
    }
    
    return desc;
  };

  // Highlight elements with numbers - FIXED positioning
  const highlightElements = (elements, color = '#ff0') => {
    // Remove old highlights
    document.querySelectorAll('.ws-highlight').forEach(h => h.remove());
    
    elements.forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      const highlight = document.createElement('div');
      highlight.className = 'ws-highlight';
      
      // Use fixed positioning to follow viewport, not document
      highlight.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        border: 3px solid ${color};
        background: ${color === '#0f0' ? 'rgba(0, 255, 0, 0.15)' : 'rgba(255, 255, 0, 0.1)'};
        z-index: 999998;
        pointer-events: none;
        box-sizing: border-box;
        transition: all 0.3s ease;
      `;
      
      const label = document.createElement('div');
      label.style.cssText = `
        position: absolute;
        top: -25px;
        left: 0;
        background: ${color};
        color: ${color === '#0f0' ? '#fff' : '#000'};
        padding: 4px 8px;
        border-radius: 4px;
        font-weight: bold;
        font-size: 14px;
        font-family: Arial, sans-serif;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      `;
      label.textContent = `${index + 1}`;
      highlight.appendChild(label);
      document.body.appendChild(highlight);
      
      // Update position on scroll
      const updatePosition = () => {
        const newRect = el.getBoundingClientRect();
        highlight.style.left = `${newRect.left}px`;
        highlight.style.top = `${newRect.top}px`;
        highlight.style.width = `${newRect.width}px`;
        highlight.style.height = `${newRect.height}px`;
      };
      
      // Store the update function so we can remove it later
      highlight._updatePosition = updatePosition;
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
    });
  };

  // Remove highlights - ENHANCED cleanup
  const removeHighlights = () => {
    document.querySelectorAll('.ws-highlight').forEach(h => {
      // Remove event listeners
      if (h._updatePosition) {
        window.removeEventListener('scroll', h._updatePosition, true);
        window.removeEventListener('resize', h._updatePosition);
      }
      h.remove();
    });
  };

  // Smart element detection - identifies what something is by analyzing it
  const identifyElementType = (element) => {
    // Check button
    if (element.matches('button, [role="button"], input[type="submit"], input[type="button"]')) {
      return 'button';
    }
    // Check link
    if (element.matches('a[href]')) {
      return 'link';
    }
    // Check input
    if (element.matches('input, textarea, select')) {
      return 'input';
    }
    // Check clickable
    if (element.onclick || element.matches('[onclick], [role="link"]')) {
      return 'clickable';
    }
    return 'element';
  };

  // Smart search - finds element by text regardless of type
  const smartFindElement = (searchText) => {
    const allInteractive = [
      ...elementCache.buttons,
      ...elementCache.links,
      ...elementCache.clickables
    ];
    
    const matches = [];
    const searchLower = searchText.toLowerCase();
    
    for (const el of allInteractive) {
      const text = (el.textContent || el.value || el.placeholder || el.title || el.alt || '').toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      
      if (text.includes(searchLower) || ariaLabel.includes(searchLower)) {
        const type = identifyElementType(el);
        matches.push({ element: el, type, text: text.trim().substring(0, 50) });
      }
    }
    
    return matches;
  };

  // Detect and list elements with performance optimization
  const detectElements = (type) => {
    console.log(`🔍 Detecting ${type}...`);
    const startTime = performance.now();
    
    let elements = [];
    let message = '';
    
    // Use cached elements for better performance (refresh if stale)
    const cacheAge = Date.now() - elementCache.lastUpdate;
    const CACHE_EXPIRY = 5000; // 5 seconds
    
    if (cacheAge > CACHE_EXPIRY) {
      console.log('🔄 Cache stale, refreshing...');
      updateElementCache();
    }
    
    switch(type) {
      case 'buttons':
        elements = elementCache.buttons.length > 0 ? elementCache.buttons : 
                   getVisibleElements('button, [role="button"], input[type="submit"], input[type="button"], .btn, [class*="button"]');
        message = `Found ${elements.length} buttons`;
        break;
        
      case 'links':
        elements = elementCache.links.length > 0 ? elementCache.links :
                   getVisibleElements('a[href]');
        message = `Found ${elements.length} links`;
        break;
        
      case 'menus':
        elements = getVisibleElements('nav, [role="navigation"], [role="menu"], .menu, .nav, select, [class*="dropdown"]');
        message = `Found ${elements.length} menus`;
        break;
        
      case 'inputs':
        elements = getVisibleElements('input:not([type="hidden"]), textarea, select');
        message = `Found ${elements.length} input fields`;
        break;
        
      case 'clickables':
      case 'all':
        // Smart detection - find ALL interactive elements
        elements = [
          ...elementCache.buttons,
          ...elementCache.links,
          ...elementCache.clickables
        ];
        // Remove duplicates using Map for O(n) performance
        const elementMap = new Map();
        elements.forEach(el => elementMap.set(el, true));
        elements = Array.from(elementMap.keys());
        message = `Found ${elements.length} clickable elements`;
        break;
    }
    
    const elapsed = performance.now() - startTime;
    console.log(`⚡ Detection completed in ${elapsed.toFixed(2)}ms`);
    
    if (elements.length > 0) {
      highlightElements(elements);
      selectionContext = elements;
      selectionType = type;
      awaitingSelection = true;
      
      // List first few elements with their types
      const preview = elements.slice(0, 5).map((el, i) => {
        const elType = identifyElementType(el);
        return `${i + 1}. ${elType}: ${getElementDescription(el)}`;
      }).join(', ');
      
      showStatus(`${message}. Say number to select. ${preview}${elements.length > 5 ? '...' : ''}`, 10000);
      
      // Speak using smart speak function
      smartSpeak(`${message}. Say the number. I'll describe it before clicking.`);
    } else {
      showStatus(`No ${type} found on this page`, 3000);
    }
  };

  // Handle number selection
  const handleSelection = (number) => {
    if (!awaitingSelection || !selectionContext.length) {
      return false;
    }
    
    const index = number - 1;
    if (index >= 0 && index < selectionContext.length) {
      const element = selectionContext[index];
      removeHighlights();
      
      // Click or focus the element
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        element.click();
        showStatus(`✅ Clicked ${selectionType} #${number}: ${getElementDescription(element)}`, 3000);
      }, 500);
      
      awaitingSelection = false;
      selectionContext = [];
      return true;
    }
    return false;
  };

  // Handle element inquiry with confirmation
  const handleElementInquiry = (number) => {
    if (!awaitingSelection || !selectionContext.length) {
      return false;
    }
    
    const index = number - 1;
    if (index >= 0 && index < selectionContext.length) {
      const element = selectionContext[index];
      
      // Handle scroll area selection differently
      const description = getElementDescription(element);
      const elementType = selectionType.slice(0, -1); // Remove 's' from 'buttons', 'links', etc.
      
      // Store for confirmation
      pendingConfirmation = {
        element: element,
        number: number,
        type: elementType,
        description: description
      };
      
      // Highlight just this element
      removeHighlights();
      highlightElements([element], '#0f0'); // Green highlight
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Announce the element - simpler message
      const message = `${elementType} ${number} is "${description}". Click it? Say yes or no.`;
      showStatus(`🔍 ${message}`, 15000);
      
      // Speak using smart speak function
      smartSpeak(message);
      
      return true;
    }
    return false;
  };

  // Undo last action
  const undoLastAction = () => {
    if (actionHistory.length === 0) {
      showStatus('❌ No actions to undo', 2000);
      smartSpeak('Nothing to undo');
      return false;
    }
    
    const lastAction = actionHistory.pop();
    console.log('⏪ Undoing action:', lastAction);
    
    switch(lastAction.type) {
      case 'click':
        // For clicks, we can try to navigate back if it caused navigation
        const { element, description } = lastAction.data;
        showStatus(`⏪ Undoing click on: ${description}`, 3000);
        smartSpeak(`Undoing last click. Going back.`);
        
        // Try to go back in history
        setTimeout(() => {
          window.history.back();
        }, 500);
        return true;
        
      case 'scroll':
        // Undo scroll by scrolling opposite direction
        const { direction, amount } = lastAction.data;
        const oppositeDir = direction === 'down' ? 'up' : direction === 'up' ? 'down' : 
                           direction === 'left' ? 'right' : 'left';
        showStatus(`⏪ Scrolling ${oppositeDir} to undo`, 2000);
        smartSpeak(`Scrolling ${oppositeDir}`);
        
        if (direction === 'down' || direction === 'up') {
          window.scrollBy({ top: direction === 'down' ? -amount : amount, behavior: 'smooth' });
        } else {
          window.scrollBy({ left: direction === 'right' ? -amount : amount, behavior: 'smooth' });
        }
        return true;
        
      case 'input':
        // Restore previous value
        const { inputElement, oldValue } = lastAction.data;
        if (inputElement && document.contains(inputElement)) {
          inputElement.value = oldValue;
          showStatus('⏪ Restored input value', 2000);
          smartSpeak('Restored text');
        }
        return true;
        
      default:
        showStatus('⏪ Undo not supported for this action', 2000);
        return false;
    }
  };

  // Handle confirmation response
  const handleConfirmation = (confirmed) => {
    if (!pendingConfirmation) {
      return false;
    }
    
    if (confirmed) {
      // User said yes - click the element
      const { element, number, type, description } = pendingConfirmation;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        // Record action for undo
        recordAction('click', { element, description, number, type });
        
        element.click();
        showStatus(`✅ Clicked ${type} #${number}: ${description}`, 3000);
        smartSpeak(`Clicked ${description}`);
      }, 500);
    } else {
      // User said no - cancel
      showStatus(`❌ Cancelled clicking ${pendingConfirmation.type} #${pendingConfirmation.number}`, 2000);
      smartSpeak("Okay, cancelled");
    }
    
    // Clean up state - CRITICAL: Reset all flags
    removeHighlights();
    pendingConfirmation = null;
    // DON'T reset awaitingSelection - keep context for more commands
    // User can still select other buttons after confirmation
    return true;
  };

  // --- Speech Recognition ---
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showStatus("❌ Speech recognition not supported by this browser.");
    micButton.disabled = true;
    return;
  }
  
  // Store recognition instance globally to prevent duplicates
  const recognition = new SpeechRecognition();
  window.wsRecognitionInstance = recognition;
  
  recognition.continuous = true; // Keep listening even after a result
  recognition.interimResults = false; // We only want final results
  recognition.lang = 'en-US';

  const showStatus = (text, duration = 3000) => {
    console.log("📢 Showing status:", text);
    statusPopup.textContent = text;
    statusPopup.style.opacity = '1';
    statusPopup.style.visibility = 'visible';
    statusPopup.style.display = 'block';
    
    if (duration > 0) {
      setTimeout(() => {
        statusPopup.style.opacity = '0';
        statusPopup.style.visibility = 'hidden';
      }, duration);
    }
  };

  recognition.onstart = () => {
    console.log("🎤 Voice recognition started. isListening:", isListening);
    isListening = true; // Ensure flag is set
    
    // Update button to red (wrapper stays visible)
    micButton.innerHTML = '🔴';
    micButton.style.backgroundColor = '#dc3545'; // Red for listening (recording)
    console.log("🎤 Button updated: 🔴 RED");
    showStatus("🎙️ Listening...", 5000);
    
    // Update storage to sync with popup
    chrome.storage.local.set({ isVoiceListening: true });
  };

  recognition.onend = () => {
    console.log("🔴 Voice recognition ended. isListening:", isListening, "isSpeaking:", isSpeaking);
    
    // If user manually stopped (isListening = false), don't restart
    if (!isListening) {
      console.log("🛑 User stopped manually - NOT restarting");
      chrome.storage.local.set({ isVoiceListening: false });
      
      // Cancel any ongoing speech
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        console.log("Speech cancel error:", e.message);
      }
      isSpeaking = false;
      
      // Update button to gray (wrapper stays visible)
      micButton.innerHTML = '🎤';
      micButton.style.backgroundColor = '#6c757d';
      console.log("✅ Recognition fully stopped, will NOT restart");
      return; // EXIT - do not restart
    }
    
    // Don't restart if we're currently speaking
    if (isSpeaking) {
      console.log("Not restarting - currently speaking");
      return;
    }
    
    // Auto-restart for continuous listening ONLY if isListening is still true
    console.log("🔁 Auto-restarting recognition (isListening is still true)...");
    try {
      setTimeout(() => {
        // Double-check isListening hasn't changed
        if (isListening && !isSpeaking) {
          try {
            recognition.start();
            console.log("✅ Restarted recognition automatically");
          } catch (startError) {
            console.log("Recognition already started or error:", startError.message);
          }
        } else {
          console.log("⛔ NOT restarting - isListening:", isListening, "isSpeaking:", isSpeaking);
        }
      }, 100);
    } catch (e) {
      console.error("Error restarting recognition:", e);
    }
  };

  recognition.onerror = (event) => {
    // Log abort and network errors as info, not errors (they're normal)
    if (event.error === 'aborted' || event.error === 'no-speech' || event.error === 'network') {
      console.log("🔵 Speech recognition:", event.error, "(normal behavior)");
    } else {
      console.warn("⚠️ Speech recognition error:", event.error);
    }
    
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      showStatus("🎤 Mic access denied. Please allow in browser settings.", 5000);
      isListening = false; // Stop trying to restart
      micButton.innerHTML = '🎤';
      micButton.style.backgroundColor = '#dc3545'; // Red for error
      
    } else if (event.error === 'no-speech') {
      // No speech detected - this is normal, just continue listening
      // (already logged above as info)
      
    } else if (event.error === 'aborted') {
      // Aborted - usually during page navigation or manual stop
      // (already logged above as info)
      // Don't try to restart if page is unloading
      if (!document.hidden && isListening) {
        console.log("🔄 Will restart recognition after abort...");
        setTimeout(() => {
          if (isListening && !isSpeaking && !document.hidden) {
            try {
              recognition.start();
              console.log("✅ Restarted after abort");
            } catch (e) {
              console.log("Could not restart:", e.message);
            }
          }
        }, 500);
      }
      
    } else if (event.error === 'network') {
      // Network error - retry after delay
      console.log("🌐 Network error, will retry in 2 seconds...");
      showStatus("🌐 Network error, retrying...", 2000);
      if (isListening) {
        setTimeout(() => {
          if (isListening) {
            try {
              recognition.start();
              console.log("🔄 Retried after network error");
            } catch (e) {
              console.log("Retry failed:", e.message);
            }
          }
        }, 2000);
      }
      
    } else if (event.error === 'audio-capture') {
      // Microphone issue
      console.log("🎤 Audio capture error");
      showStatus("🎤 Microphone error. Check device.", 3000);
      isListening = false;
      micButton.innerHTML = '❌';
      micButton.style.backgroundColor = '#dc3545';
      
    } else {
      // Other errors - show but keep trying
      console.log("⚠️ Recognition error, will retry:", event.error);
      showStatus(`⚠️ Error: ${event.error}`, 2000);
    }
  };

  recognition.onresult = (event) => {
    const rawCommand = event.results[event.results.length - 1][0].transcript.trim();
    console.log("Raw command received:", rawCommand);
    
    // Execute command with error handling
    try {
      executeCommand(rawCommand);
    } catch (error) {
      console.error("Error executing command:", error);
      showStatus("❌ Error processing command", 2000);
    }
  };

  // --- Smart Command Execution with NLP ---
  const executeCommandWithNLP = async (rawCommand, parsed) => {
    console.log("=== Executing with NLP ===");
    console.log("Parsed:", parsed);
    
    let feedback = "";
    let commandExecuted = true;
    
    // Handle confirmation responses
    if (parsed.confirmation) {
      if (pendingConfirmation) {
        handleConfirmation(parsed.confirmation === 'yes');
        return;
      }
    }
    
    // Handle number selection if awaiting
    if (awaitingSelection && parsed.number) {
      console.log("Number selection:", parsed.number);
      if (handleElementInquiry(parsed.number)) {
        return;
      }
    }
    
    // Route based on action + target combination
    const action = parsed.action;
    const target = parsed.target;
    const direction = parsed.direction;
    const descriptor = parsed.descriptor;
    
    // GREET command - friendly greeting response
    if (action === 'greet') {
      const greetings = [
        "Hello! How can I help you?",
        "Hi there! What would you like to do?",
        "Hey! I'm ready to assist!",
        "Greetings! What can I do for you?",
        "Hello! Ready when you are!",
        "Hi! Let me know what you need!"
      ];
      const msg = greetings[Math.floor(Math.random() * greetings.length)];
      feedback = "👋 " + msg;
      smartSpeak(msg);
      showStatus(feedback, 2000);
      return;
    }
    
    // THANK command - polite response
    if (action === 'thank') {
      const responses = [
        "You're welcome!",
        "Happy to help!",
        "My pleasure!",
        "Anytime!",
        "Glad I could help!",
        "No problem at all!",
        "You're very welcome!",
        "Always here to help!"
      ];
      const msg = responses[Math.floor(Math.random() * responses.length)];
      feedback = "😊 " + msg;
      smartSpeak(msg);
      showStatus(feedback, 2000);
      return;
    }
    
    // CONFIRM command - acknowledgment (when not in confirmation dialog)
    if (action === 'confirm' && !pendingConfirmation) {
      const confirmations = ["Got it!", "Okay!", "Understood!", "Perfect!", "Alright!", "Confirmed!"];
      const msg = confirmations[Math.floor(Math.random() * confirmations.length)];
      feedback = "✅ " + msg;
      smartSpeak(msg);
      showStatus(feedback, 2000);
      return;
    }
    
    // DENY command - acknowledgment (when not in confirmation dialog)
    if (action === 'deny' && !pendingConfirmation) {
      const denials = ["Okay, got it", "No problem", "Understood", "Alright", "Okay then"];
      const msg = denials[Math.floor(Math.random() * denials.length)];
      feedback = "👌 " + msg;
      smartSpeak(msg);
      showStatus(feedback, 2000);
      return;
    }
    
    // HELP command - show available commands
    if (action === 'help') {
      const helpMessages = [
        "I can show buttons, links, and menus. Say 'show buttons' or 'show links', then say a number to click.",
        "Try saying 'scroll down', 'go back', 'zoom in', 'show links', or 'click button'.",
        "You can say 'show buttons', 'show links', 'scroll down', 'go back', 'reload page', and much more!",
        "Just tell me what you want to do! Show elements, click things, scroll, navigate - I'm here to help!"
      ];
      feedback = "💡 Available commands";
      smartSpeak(helpMessages[Math.floor(Math.random() * helpMessages.length)]);
      showStatus(feedback, 3000);
      return;
    }
    
    // CANCEL command - hide all highlights and reset state
    if (action === 'cancel') {
      removeHighlights();
      awaitingSelection = false;
      currentDetectedElements = [];
      feedback = "❌ Cancelled";
      smartSpeak("Cancelled");
      showStatus(feedback, 2000);
      return;
    }
    
    // UNDO command - rollback last action (multiple variations)
    if (action === 'undo' || action === 'revert') {
      undoLastAction();
      return;
    }
    
    // FIND/SEARCH command - smart search for any element by text
    if (action === 'find' || action === 'search' || action === 'locate') {
      if (descriptor) {
        const matches = smartFindElement(descriptor);
        if (matches.length > 0) {
          const elements = matches.map(m => m.element);
          highlightElements(elements);
          selectionContext = elements;
          selectionType = 'found';
          awaitingSelection = true;
          
          const preview = matches.slice(0, 5).map((m, i) => 
            `${i + 1}. ${m.type}: ${m.text.substring(0, 30)}`
          ).join(', ');
          
          feedback = `🔍 Found ${matches.length} matches for "${descriptor}". ${preview}${matches.length > 5 ? '...' : ''}`;
          smartSpeak(`Found ${matches.length} items matching ${descriptor}. Say the number.`);
          showStatus(feedback, 10000);
        } else {
          feedback = `❌ Nothing found for "${descriptor}"`;
          smartSpeak(`Could not find ${descriptor}`);
          showStatus(feedback, 3000);
        }
        return;
      } else {
        feedback = "🔍 What do you want to find? Say 'find' followed by the text.";
        smartSpeak("What should I find?");
        showStatus(feedback, 3000);
        return;
      }
    }
    
    // SHOW ALL - smart detection of all clickable elements
    if (action === 'show' && (target === 'all' || target === 'everything' || target === 'clickable')) {
      detectElements('all');
      feedback = "👁️ Showing all clickable elements";
      return;
    }
    
    // SHOW commands - display elements
    if (action === 'show' && target === 'button') {
      const elements = detectElements('buttons');
      contextManager.remember(action, target, elements);
      feedback = "🔘 Showing all buttons";
    } else if (action === 'show' && target === 'link') {
      const elements = detectElements('links');
      contextManager.remember(action, target, elements);
      feedback = "🔗 Showing all links";
    } else if (action === 'show' && target === 'menu') {
      const elements = detectElements('menus');
      contextManager.remember(action, target, elements);
      feedback = "📋 Showing all menus";
    } else if (action === 'show' && target === 'input') {
      const elements = detectElements('inputs');
      contextManager.remember(action, target, elements);
      feedback = "📝 Showing all input fields";
    }
    
    // CLICK commands with fuzzy matching
    else if (action === 'click' && target === 'button') {
      if (descriptor) {
        const buttons = getVisibleElements('button, [role="button"], input[type="submit"]');
        const button = findBestElement(buttons, descriptor);
        if (button) {
          contextManager.remember(action, target, [button]);
          button.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => button.click(), 500);
          const desc = getElementDescription(button);
          feedback = `✅ Clicked button: ${desc.substring(0, 30)}`;
          smartSpeak(`Clicked ${desc.substring(0, 20)}`);
        } else {
          feedback = `❌ Button "${descriptor}" not found`;
          smartSpeak(`Could not find ${descriptor} button`);
        }
      } else if (direction === 'first') {
        const buttons = getVisibleElements('button, [role="button"]');
        if (buttons[0]) {
          buttons[0].click();
          feedback = `✅ Clicked first button`;
          smartSpeak(`Clicked first button`);
        }
      } else if (direction === 'last') {
        const buttons = getVisibleElements('button, [role="button"]');
        if (buttons.length > 0) {
          buttons[buttons.length - 1].click();
          feedback = `✅ Clicked last button`;
          smartSpeak(`Clicked last button`);
        }
      } else {
        detectElements('buttons');
        feedback = "🔘 Which button? Say the number.";
      }
    } else if (action === 'click' && target === 'link') {
      if (descriptor) {
        const links = getVisibleElements('a[href]');
        const link = findBestElement(links, descriptor);
        if (link) {
          link.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => link.click(), 500);
          const desc = getElementDescription(link);
          feedback = `🔗 Clicked link: ${desc.substring(0, 30)}`;
          smartSpeak(`Clicked ${desc.substring(0, 20)}`);
        } else {
          feedback = `❌ Link "${descriptor}" not found`;
          smartSpeak(`Could not find ${descriptor} link`);
        }
      } else if (direction === 'first') {
        const links = getVisibleElements('a[href]');
        if (links[0]) {
          links[0].click();
          feedback = `✅ Clicked first link`;
          smartSpeak(`Clicked first link`);
        }
      } else {
        detectElements('links');
        feedback = "🔗 Which link? Say the number.";
      }
    }
    
    // SCROLL commands with smart detection (mouse position or last click)
    else if (action === 'scroll') {
      const target = getSmartScrollTarget();
      
      if (!target) {
        feedback = "❌ No scrollable content found";
        const variations = ["Nothing to scroll", "No scrollable content", "Can't scroll this page"];
        smartSpeak(variations[Math.floor(Math.random() * variations.length)]);
      } else {
        // Scroll the detected container immediately
        scrollContainer(target, direction || 'down');
        
        const dirText = direction || 'down';
        feedback = `⬇️ Scrolling ${dirText} on ${target.name}`;
        const variations = [
          `Scrolling ${dirText}`,
          `Moving ${dirText}`,
          `Going ${dirText}`,
          `Scrolled ${dirText}`
        ];
        smartSpeak(variations[Math.floor(Math.random() * variations.length)]);
        contextManager.remember('scroll', target.name);
        console.log(`✅ Smart scrolled ${target.name} ${dirText} (mouse at ${lastMouseX},${lastMouseY})`);
      }
    }
    
    // NAVIGATION commands - Enhanced with multiple keyword variations
    else if (action === 'back' || action === 'previous' || rawCommand.match(/\b(go back|previous page|back page|navigate back|return)\b/i)) {
      const responses = [
        "Going back",
        "Heading back",
        "Back we go",
        "Returning to previous page",
        "Navigating backwards"
      ];
      const msg = responses[Math.floor(Math.random() * responses.length)];
      feedback = "⬅️ " + msg + "...";
      smartSpeak(msg);
      showStatus(feedback, 2000);
      setTimeout(() => {
        window.history.back();
        console.log("✅ Navigated back in history");
      }, 300);
    } else if (action === 'forward' || action === 'next' || rawCommand.match(/\b(go forward|next page|forward page|navigate forward|advance)\b/i)) {
      const responses = [
        "Going forward",
        "Moving forward",
        "Forward we go",
        "Advancing to next page",
        "Navigating forward"
      ];
      const msg = responses[Math.floor(Math.random() * responses.length)];
      feedback = "➡️ " + msg + "...";
      smartSpeak(msg);
      showStatus(feedback, 2000);
      setTimeout(() => {
        window.history.forward();
        console.log("✅ Navigated forward in history");
      }, 300);
    } else if (action === 'reload' || action === 'refresh' || rawCommand.match(/\b(reload page|refresh page|reload this|refresh this|update page)\b/i)) {
      const responses = [
        "Reloading page",
        "Refreshing page",
        "Updating page",
        "Reloading this page"
      ];
      const msg = responses[Math.floor(Math.random() * responses.length)];
      feedback = "🔄 " + msg + "...";
      smartSpeak(msg);
      showStatus(feedback, 2000);
      setTimeout(() => {
        window.location.reload();
        console.log("✅ Page reloaded");
      }, 500);
    }
    
    // TAB commands
    else if (action === 'open' && target === 'tab') {
      feedback = "➕ Opening new tab...";
      chrome.runtime.sendMessage({ type: 'NEW_TAB' }, (response) => {
        if (response && response.success) {
          showStatus("✅ New tab opened!", 2000);
          smartSpeak("New tab opened");
        }
      });
    } else if (action === 'close' && target === 'tab') {
      feedback = "❌ Closing tab...";
      chrome.runtime.sendMessage({ type: 'CLOSE_TAB' }, (response) => {
        if (response && response.success) {
          showStatus("✅ Tab closed!", 2000);
        }
      });
    } else if (action === 'duplicate' || /duplicate|copy|clone|same/.test(rawCommand.toLowerCase() + ' ' + (target || ''))) {
      feedback = "📋 Duplicating tab...";
      console.log("📋 Sending DUPLICATE_TAB message");
      chrome.runtime.sendMessage({ type: 'DUPLICATE_TAB' }, (response) => {
        console.log("📋 Duplicate tab response:", response);
        if (response && response.success) {
          showStatus("✅ Tab duplicated!", 2000);
          const variations = [
            "Tab duplicated",
            "Created a copy of this tab",
            "Cloned this tab",
            "Made a duplicate"
          ];
          smartSpeak(variations[Math.floor(Math.random() * variations.length)]);
        } else {
          showStatus("❌ Failed to duplicate tab", 2000);
          smartSpeak("Couldn't duplicate tab");
        }
      });
    }
    
    // ZOOM commands
    else if (action === 'zoom') {
      if (rawCommand.includes('in') || rawCommand.includes('bigger')) {
        document.body.style.zoom = (parseFloat(document.body.style.zoom || 1) + 0.1).toString();
        feedback = "🔍 Zoomed In";
        smartSpeak("Zoomed in");
      } else if (rawCommand.includes('out') || rawCommand.includes('smaller')) {
        document.body.style.zoom = (parseFloat(document.body.style.zoom || 1) - 0.1).toString();
        feedback = "🔍 Zoomed Out";
        smartSpeak("Zoomed out");
      } else if (rawCommand.includes('reset')) {
        document.body.style.zoom = "1";
        feedback = "🔍 Zoom Reset";
        smartSpeak("Zoom reset");
      }
    }
    
    // HELP command
    else if (action === 'help') {
      feedback = "💡 Say: 'show buttons', 'show links', 'scroll down', 'click button', numbers to select, etc.";
      smartSpeak("I can show buttons, links, and menus. Say a number to click. You can also scroll, zoom, and navigate.");
    }
    
    // STOP command
    else if (action === 'stop') {
      feedback = "🛑 Stopping...";
      isListening = false;
      recognition.stop();
      removeHighlights();
      awaitingSelection = false;
      selectionContext = [];
      pendingConfirmation = null;
      chrome.storage.local.set({ isVoiceControlActive: false });
    }
    
    // NATURAL LANGUAGE NAVIGATION - Smart context-aware commands
    else if (descriptor && !target) {
      // Try to find ANY element matching the description
      console.log("🎯 Smart element search for:", descriptor);
      
      const allInteractive = getVisibleElements('button, a, [role="button"], input[type="submit"], [onclick]');
      const bestMatch = findBestElement(allInteractive, descriptor);
      
      if (bestMatch) {
        bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          bestMatch.click();
          const desc = getElementDescription(bestMatch);
          feedback = `✨ Found and clicked: ${desc.substring(0, 30)}`;
          smartSpeak(`Clicked ${desc.substring(0, 20)}`);
        }, 500);
        commandExecuted = true;
      } else {
        feedback = `🔍 Searching for "${descriptor}"...`;
        smartSpeak(`Looking for ${descriptor}`);
        
        // Try semantic search across page text
        const pageText = document.body.innerText.toLowerCase();
        if (pageText.includes(descriptor.toLowerCase())) {
          feedback = `📍 Found "${descriptor}" on page but not clickable`;
        } else {
          feedback = `❌ Could not find "${descriptor}"`;
        }
      }
    }
    
    // CONTEXTUAL "IT" REFERENCES - Enhanced with multiple variations
    else if (rawCommand.match(/\b(click it|do that|do it|that one|repeat|again|same thing|once more)\b/i)) {
      const ctx = contextManager.getContext();
      
      // Priority 1: Last clicked element
      if (ctx.lastClickedElement && document.contains(ctx.lastClickedElement)) {
        const element = ctx.lastClickedElement;
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          recordAction('click', { element, description: getElementDescription(element) });
          element.click();
          const desc = getElementDescription(element);
          feedback = `✅ Clicked again: ${desc}`;
          smartSpeak(`Clicked ${desc} again`);
          showStatus(feedback, 3000);
        }, 300);
        return;
      }
      
      // Priority 2: Last elements in context
      if (ctx.hasElements && ctx.lastElements.length > 0) {
        const element = ctx.lastElements[0];
        if (document.contains(element)) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            recordAction('click', { element, description: getElementDescription(element) });
            element.click();
            feedback = `✅ Clicked remembered element`;
            smartSpeak('Clicked it');
            showStatus(feedback, 3000);
          }, 300);
          return;
        }
      }
      
      feedback = `❓ What should I click? No previous context.`;
      smartSpeak('What should I click?');
      showStatus(feedback, 3000);
      return;
    }
    
    // Correction handling: "no", "not that"
    else if (rawCommand.match(/\b(no|nope|not that|wrong|incorrect)\b/i) && !rawCommand.match(/\b(yes|yeah)\b/i)) {
      if (pendingConfirmation) {
        handleConfirmation(false);
        contextManager.addCorrection('rejected_element', pendingConfirmation);
        return;
      } else {
        feedback = `ℹ️ Okay. What should I do?`;
        smartSpeak('Okay, what should I do?');
        showStatus(feedback, 3000);
        removeHighlights();
        awaitingSelection = false;
        return;
      }
    }
    
    // "What did you say" - repeat last speech
    else if (rawCommand.match(/\b(what did you say|repeat that|say again|what was that)\b/i)) {
      const ctx = contextManager.getContext();
      if (ctx.lastSpokenText) {
        feedback = `💬 "${ctx.lastSpokenText}"`;
        showStatus(feedback, 5000);
        smartSpeak(ctx.lastSpokenText);
      } else {
        smartSpeak('I haven\'t said anything yet');
      }
      return;
    }
    
    // COUNT ELEMENTS
    else if (action === 'count') {
      const buttons = getVisibleElements('button, [role="button"]').length;
      const links = getVisibleElements('a[href]').length;
      const inputs = getVisibleElements('input, textarea').length;
      
      feedback = `📊 Found ${buttons} buttons, ${links} links, ${inputs} inputs`;
      smartSpeak(`${buttons} buttons, ${links} links, ${inputs} inputs`);
    }
    
    // READ PAGE TITLE OR HEADINGS
    else if (action === 'read') {
      if (target === 'heading' || target === 'title') {
        const heading = document.querySelector('h1, h2');
        if (heading) {
          const text = heading.innerText;
          feedback = `📖 "${text}"`;
          smartSpeak(text);
        } else {
          feedback = `📖 "${document.title}"`;
          smartSpeak(document.title);
        }
      } else if (target === 'page') {
        feedback = `📖 "${document.title}"`;
        smartSpeak(document.title);
      }
    }
    
    // SMART SEARCH - Natural language page search
    else if (action === 'search' || action === 'find') {
      if (descriptor) {
        const searchBox = document.querySelector('input[type="search"], input[name*="search"], input[placeholder*="search" i], input[aria-label*="search" i]');
        if (searchBox) {
          searchBox.value = descriptor;
          searchBox.focus();
          feedback = `🔍 Typed "${descriptor}" in search box`;
          smartSpeak(`Searching for ${descriptor}`);
          
          // Try to submit
          const form = searchBox.closest('form');
          if (form) {
            setTimeout(() => form.submit(), 500);
          }
        } else {
          // Use browser find
          window.find(descriptor);
          feedback = `🔍 Finding "${descriptor}" on page`;
        }
      }
    }
    
    // Command not recognized
    else {
      commandExecuted = false;
      feedback = `❓ Not sure what to do. Confidence: ${(parsed.confidence * 100).toFixed(0)}%. Try "help"`;
    }
    
    if (commandExecuted) {
      console.log("✅ Executed:", feedback);
      showStatus(feedback);
    } else {
      console.log("❌ Not recognized");
      showStatus(feedback, 3000);
    }
  };

  // --- Command Execution ---
  const executeCommand = async (rawCommand) => {
    // Try smart navigate first (best matching with context awareness)
    if (USE_SMART_NAVIGATE && USE_NLP_BACKEND) {
      try {
        const result = await navigateWithSmartMatch(rawCommand);
        
        // Check if result exists and has expected properties
        if (result && typeof result === 'object' && result.success) {
          console.log("🎯 Using smart navigate");
          
          // Show human response
          if (result.human_response) {
            smartSpeak(result.human_response);
            showStatus(`💬 ${result.human_response}`);
          }
          
          // Execute matched action
          if (result.matched_element) {
            const elem = document.querySelector(result.matched_element.selector);
            if (elem) {
              console.log("✅ Element found:", result.matched_element);
              
              // Highlight the element
              highlightElement(elem);
              
              // Perform action based on type
              if (result.action === 'click') {
                setTimeout(() => {
                  elem.click();
                  console.log("🖱️ Clicked element");
                }, 500);
              } else if (result.action === 'fill' && elem.tagName === 'INPUT') {
                elem.focus();
                console.log("📝 Focused input");
              }
              
              return;
            }
          }
          
          // Handle simple navigation actions
          if (result.action === 'scroll') {
            const direction = result.direction || 'down';
            const scrollAmount = direction === 'up' ? -300 : 300;
            window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            return;
          }
          
          if (result.action === 'back') {
            window.history.back();
            return;
          }
          
          if (result.action === 'forward') {
            window.history.forward();
            return;
          }
          
          if (result.action === 'reload') {
            window.location.reload();
            return;
          }
          
          // Show clarification if needed
          if (result.needs_clarification) {
            smartSpeak(result.message);
            showStatus(`❓ ${result.message}`);
            if (result.options && result.options.length > 0) {
              console.log("Options:", result.options);
            }
            return;
          }
        }
      } catch (error) {
        console.warn("Smart navigate failed:", error);
      }
    }
    
    // Fallback to NLP parsing
    if (USE_NLP_BACKEND) {
      try {
        const parsed = await parseCommandWithNLP(rawCommand);
        
        if (parsed && parsed.success) {
          console.log("🧠 Using NLP-based execution");
          await executeCommandWithNLP(rawCommand, parsed);
          return;
        }
      } catch (error) {
        console.warn("NLP execution failed, falling back to pattern matching:", error);
      }
    }
    
    // Final fallback to original pattern matching
    console.log("Using pattern matching execution");
    executeCommandLegacy(rawCommand);
  };

  // Legacy pattern-matching command execution (original implementation)
  const executeCommandLegacy = (rawCommand) => {
    // Clean the command to extract intent
    const command = cleanCommand(rawCommand);
    
    console.log("=== Executing Command ===");
    console.log("Raw:", rawCommand);
    console.log("Cleaned:", command);
    console.log("awaitingSelection:", awaitingSelection);
    console.log("pendingConfirmation:", pendingConfirmation);
    console.log("selectionContext.length:", selectionContext.length);
    
    let feedback = "";
    let commandExecuted = true;

    // Helper function to check if command contains any of the patterns
    const containsAny = (text, patterns) => {
      return patterns.some(pattern => text.includes(pattern));
    };

    // Handle pending confirmation (yes/no responses)
    if (pendingConfirmation) {
      console.log("Waiting for confirmation, command:", command);
      
      // More aggressive yes/no detection - check if ANY yes/no word appears
      const yesWords = ['yes', 'yep', 'yeah', 'yup', 'sure', 'okay', 'ok', 'go ahead', 'do it', 'click it', 'affirmative', 'confirm', 'proceed', 'absolutely', 'definitely', 'correct'];
      const noWords = ['no', 'nope', 'nah', 'never', 'dont', "don't", 'cancel', 'negative', 'abort', 'skip', 'pass', 'not now', 'wrong', 'incorrect'];
      
      // Check if command contains any yes word
      const hasYes = yesWords.some(word => command.includes(word));
      const hasNo = noWords.some(word => command.includes(word));
      
      if (hasYes && !hasNo) {
        console.log("Detected YES confirmation");
        handleConfirmation(true);
        return;
      }
      else if (hasNo && !hasYes) {
        console.log("Detected NO confirmation");
        handleConfirmation(false);
        return;
      }
      // If both or neither, ask again
      showStatus("Please say 'yes' or 'no'", 2000);
      smartSpeak("Please say yes or no");
      return;
    }

    // Handle number selection if awaiting - more conversational
    if (awaitingSelection) {
      console.log("Awaiting selection, command:", command);
      
      // First check for cancel/stop commands (but only "stop listening" should actually stop voice control)
      if (containsAny(command, ['cancel', 'clear', 'hide', 'no thanks', 'forget it', 'nevermind', 'never mind']) || 
          (command.includes('close') && !command.includes('tab'))) {
        removeHighlights();
        awaitingSelection = false;
        selectionContext = [];
        pendingConfirmation = null;
        showStatus('❌ Selection cancelled', 2000);
        return;
      }
      
      // Check if command contains a number (support up to 50)
      // ALL number selections now go through inquiry/confirmation - NO direct clicking
      const numberMatch = command.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\b/);
      if (numberMatch) {
        const numberWords = {
          'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
          'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
          'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
          'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
          'thirty': 30, 'forty': 40, 'fifty': 50
        };
        const num = numberWords[numberMatch[1].toLowerCase()] || parseInt(numberMatch[1]);
        console.log("Number detected:", num, "- Showing confirmation");
        
        // ALWAYS ask for confirmation - describe the element first
        if (handleElementInquiry(num)) {
          return; // Inquiry handled, waiting for yes/no
        }
      }
    }

    // Smart element detection commands - very conversational
    if (containsAny(command, ['show button', 'list button', 'find button', 'see button', 'display button', 'what button', 'where button', 'all button', 'get button', 'give me button'])) {
      detectElements('buttons');
      feedback = "🔘 Showing all buttons";
    } else if (containsAny(command, ['show link', 'list link', 'find link', 'see link', 'display link', 'what link', 'where link', 'all link', 'get link', 'give me link'])) {
      detectElements('links');
      feedback = "🔗 Showing all links";
    } else if (containsAny(command, ['show menu', 'list menu', 'find menu', 'see menu', 'display menu', 'what menu', 'where menu', 'all menu', 'dropdown', 'get menu', 'give me menu'])) {
      detectElements('menus');
      feedback = "📋 Showing all menus";
    } else if (containsAny(command, ['show input', 'list input', 'find input', 'see input', 'display input', 'what input', 'where input', 'all input', 'show field', 'list field', 'find field', 'get input', 'give me input'])) {
      detectElements('inputs');
      feedback = "📝 Showing all input fields";
    } else if (containsAny(command, ['show all', 'show everything', 'list all', 'find all', 'see everything', 'display all', 'what can i click', 'show me everything'])) {
      const allElements = [
        ...getVisibleElements('button, [role="button"]'),
        ...getVisibleElements('a[href]'),
        ...getVisibleElements('input, textarea, select')
      ];
      highlightElements(allElements, '#0ff');
      showStatus(`Found ${allElements.length} interactive elements. Say "show buttons", "show links", or "show inputs" to filter.`, 8000);
      feedback = "🎯 Showing all interactive elements";
    } else if (containsAny(command, ['clear selection', 'hide highlight', 'clear highlight', 'remove highlight', 'hide number', 'clear number', 'remove number'])) {
      removeHighlights();
      awaitingSelection = false;
      selectionContext = [];
      feedback = "✨ Highlights cleared";
    }
    
    // Click specific elements by text - more conversational
    else if (containsAny(command, ['click button', 'press button', 'tap button', 'select button', 'push button', 'hit button', 'activate button'])) {
      const buttonText = command.replace(/click button|press button|tap button|select button|push button|hit button|activate button|could you|please|would you/gi, '').trim();
      if (buttonText) {
        const buttons = getVisibleElements('button, [role="button"], input[type="submit"]');
        const button = buttons.find(b => getElementDescription(b).includes(buttonText));
        if (button) {
          button.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => button.click(), 500);
          feedback = `✅ Clicked button: ${buttonText}`;
        } else {
          feedback = `❌ Button "${buttonText}" not found`;
        }
      } else {
        detectElements('buttons');
        feedback = "🔘 Which button? Say the number.";
      }
    } else if (containsAny(command, ['click link', 'open link', 'follow link', 'go to link', 'visit link', 'navigate link'])) {
      const linkText = command.replace(/click link|open link|follow link|go to link|visit link|navigate link|could you|please|would you/gi, '').trim();
      if (linkText) {
        const links = getVisibleElements('a[href]');
        const link = links.find(l => getElementDescription(l).includes(linkText));
        if (link) {
          link.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => link.click(), 500);
          feedback = `🔗 Clicked link: ${linkText}`;
        } else {
          feedback = `❌ Link "${linkText}" not found`;
        }
      } else {
        detectElements('links');
        feedback = "🔗 Which link? Say the number.";
      }
    } else if (containsAny(command, ['click menu', 'open menu', 'expand menu', 'show menu dropdown'])) {
      const menuText = command.replace(/click menu|open menu|expand menu|show menu dropdown|could you|please|would you/gi, '').trim();
      if (menuText) {
        const menus = getVisibleElements('nav, [role="navigation"], [role="menu"], .menu, select');
        const menu = menus.find(m => getElementDescription(m).includes(menuText));
        if (menu) {
          menu.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => menu.click(), 500);
          feedback = `📋 Opened menu: ${menuText}`;
        } else {
          feedback = `❌ Menu "${menuText}" not found`;
        }
      } else {
        detectElements('menus');
        feedback = "📋 Which menu? Say the number.";
      }
    }
    
    // Navigation shortcuts - conversational
    else if (containsAny(command, ['click first button', 'press first button', 'first button'])) {
      const buttons = getVisibleElements('button, [role="button"]');
      if (buttons[0]) {
        const desc = getElementDescription(buttons[0]);
        buttons[0].click();
        feedback = `✅ Clicked: ${desc}`;
        smartSpeak(`Clicked first button: ${desc}`);
      }
    } else if (containsAny(command, ['click last button', 'press last button', 'last button'])) {
      const buttons = getVisibleElements('button, [role="button"]');
      if (buttons.length > 0) {
        const desc = getElementDescription(buttons[buttons.length - 1]);
        buttons[buttons.length - 1].click();
        feedback = `✅ Clicked: ${desc}`;
        smartSpeak(`Clicked last button: ${desc}`);
      }
    } else if (containsAny(command, ['click first link', 'open first link', 'first link'])) {
      const links = getVisibleElements('a[href]');
      if (links[0]) {
        const desc = getElementDescription(links[0]);
        links[0].click();
        feedback = `✅ Clicked: ${desc}`;
        smartSpeak(`Clicked first link: ${desc}`);
      }
    }
    
    // Scroll commands - very conversational and flexible
    else if (containsAny(command, ['scroll down', 'go down', 'move down', 'down', 'page down'])) {
      window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' });
      feedback = "⬇️ Scrolling Down";
      smartSpeak("Scrolled down");
    } else if (containsAny(command, ['scroll up', 'go up', 'move up', 'up', 'page up'])) {
      window.scrollBy({ top: -window.innerHeight * 0.7, behavior: 'smooth' });
      feedback = "⬆️ Scrolling Up";
      smartSpeak("Scrolled up");
    } 
    // Scroll commands - horizontal - conversational
    else if (containsAny(command, ['scroll left', 'go left', 'move left', 'left', 'swipe left'])) {
      window.scrollBy({ left: -window.innerWidth * 0.5, behavior: 'smooth' });
      feedback = "⬅️ Scrolling Left";
      smartSpeak("Scrolled left");
    } else if (containsAny(command, ['scroll right', 'go right', 'move right', 'right', 'swipe right'])) {
      window.scrollBy({ left: window.innerWidth * 0.5, behavior: 'smooth' });
      feedback = "➡️ Scrolling Right";
      smartSpeak("Scrolled right");
    }
    // Position commands - conversational
    else if (containsAny(command, ['go to top', 'top', 'scroll to top', 'top of page', 'beginning', 'start of page'])) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      feedback = "🔝 Going to Top";
      smartSpeak("At the top");
    } else if (containsAny(command, ['go to bottom', 'bottom', 'scroll to bottom', 'bottom of page', 'end of page', 'end'])) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      feedback = "⏬ Going to Bottom";
      smartSpeak("At the bottom");
    }
    // Browser navigation - very conversational
    else if (containsAny(command, ['reload', 'refresh', 'refresh page', 'reload page', 'update page', 'refresh this'])) {
      feedback = "🔄 Reloading page...";
      smartSpeak("Reloading page");
      setTimeout(() => location.reload(), 500);
    } else if (containsAny(command, ['go back', 'back', 'previous page', 'last page', 'return', 'navigate back'])) {
      feedback = "⬅️ Going back...";
      smartSpeak("Going back");
      setTimeout(() => history.back(), 300);
    } else if (containsAny(command, ['go forward', 'forward', 'next page', 'navigate forward', 'advance'])) {
      feedback = "➡️ Going forward...";
      smartSpeak("Going forward");
      setTimeout(() => history.forward(), 300);
    } 
    // Tab/Window commands - ENHANCED with more conversational variations
    else if (containsAny(command, ['new tab', 'open new tab', 'create tab', 'add tab', 'open tab', 'make tab', 'start tab'])) {
      feedback = "➕ Opening new tab...";
      chrome.runtime.sendMessage({ type: 'NEW_TAB' }, (response) => {
        if (response && response.success) {
          showStatus("✅ New tab opened!", 2000);
          smartSpeak("New tab opened");
        }
      });
    } else if (containsAny(command, ['close tab', 'close this tab', 'close this', 'shut tab', 'exit tab', 'remove tab', 'delete tab'])) {
      feedback = "❌ Closing tab...";
      chrome.runtime.sendMessage({ type: 'CLOSE_TAB' }, (response) => {
        if (response && response.success) {
          showStatus("✅ Tab closed!", 2000);
        }
      });
    } else if (containsAny(command, ['new window', 'open new window', 'create window', 'make window'])) {
      feedback = "🪟 Opening new window...";
      window.open('', '_blank', 'width=1200,height=800');
      showStatus("✅ New window opened!", 2000);
      smartSpeak("New window opened");
    } else if (containsAny(command, [
      'duplicate tab', 'copy tab', 'clone tab', 'duplicate this', 
      'same tab', 'another tab', 'same page', 'replicate tab',
      'open same tab', 'copy this tab', 'clone this tab', 
      'duplicate current tab', 'make copy', 'create copy',
      'i want same tab opened now', 'open this again', 
      'open another', 'make another copy'
    ])) {
      feedback = "📋 Duplicating tab...";
      chrome.runtime.sendMessage({ type: 'DUPLICATE_TAB' }, (response) => {
        if (response && response.success) {
          showStatus("✅ Tab duplicated!", 2000);
          smartSpeak("Tab duplicated");
        }
      });
    }
    // Zoom commands - conversational
    else if (containsAny(command, ['zoom in', 'bigger', 'enlarge', 'increase size', 'magnify'])) {
      document.body.style.zoom = (parseFloat(document.body.style.zoom || 1) + 0.1).toString();
      feedback = "🔍 Zoomed In";
      smartSpeak("Zoomed in");
    } else if (containsAny(command, ['zoom out', 'smaller', 'decrease size', 'shrink', 'reduce'])) {
      document.body.style.zoom = (parseFloat(document.body.style.zoom || 1) - 0.1).toString();
      feedback = "🔍 Zoomed Out";
      smartSpeak("Zoomed out");
    } else if (containsAny(command, ['reset zoom', 'default zoom', 'normal size', 'original size'])) {
      document.body.style.zoom = "1";
      feedback = "🔍 Zoom Reset";
      smartSpeak("Zoom reset");
    }
    // Content navigation - conversational
    else if (containsAny(command, ['next heading', 'next header', 'forward heading', 'heading down'])) {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      if (headings.length > 0) {
        const nextHeading = headings.find(h => h.getBoundingClientRect().top > 100);
        if (nextHeading) {
          nextHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
          feedback = "📑 Next heading";
          const headingText = nextHeading.textContent.trim().substring(0, 50);
          smartSpeak(`Next heading: ${headingText}`);
        } else {
          feedback = "No more headings below";
          smartSpeak("No more headings");
        }
      } else {
        feedback = "No headings found";
        smartSpeak("No headings found");
      }
    } else if (containsAny(command, ['previous heading', 'previous header', 'back heading', 'heading up', 'last heading'])) {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).reverse();
      if (headings.length > 0) {
        const prevHeading = headings.find(h => h.getBoundingClientRect().top < -100);
        if (prevHeading) {
          prevHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
          feedback = "📑 Previous heading";
          const headingText = prevHeading.textContent.trim().substring(0, 50);
          smartSpeak(`Previous heading: ${headingText}`);
        } else {
          feedback = "No more headings above";
          smartSpeak("No more headings");
        }
      } else {
        feedback = "No headings found";
        smartSpeak("No headings found");
      }
    }
    // Page information - conversational
    else if (containsAny(command, ['page title', 'what is this page', 'what page', 'page name', 'title'])) {
      feedback = `📄 ${document.title}`;
      smartSpeak(document.title);
    } else if (containsAny(command, ['where am i', 'current page', 'what site', 'which page', 'what website'])) {
      const pageName = document.title || 'Unknown page';
      feedback = `📍 You are on: ${pageName}`;
      smartSpeak(`You are on ${pageName}`);
    }
    // Help command - conversational
    else if (containsAny(command, ['help', 'what can you do', 'commands', 'what can i say', 'how does this work', 'guide me', 'assist me'])) {
      feedback = "💡 Say: 'show buttons', 'show links', 'show menus', 'click button [name]', or numbers to select";
      smartSpeak("I can show buttons, links, and menus. Just say show buttons, show links, or show menus. Then say a number to click. You can also say scroll down, go back, zoom in, and much more.");
    }
    // Stop listening command - conversational (only stop if explicitly saying "stop listening")
    else if (containsAny(command, ['stop listening', 'pause listening', 'deactivate', 'turn off', 'shut up', 'be quiet', 'silence'])) {
      feedback = "🛑 Stopping voice control...";
      console.log("🛑 Voice command to stop listening received");
      
      // Set flag BEFORE stopping to prevent auto-restart
      isListening = false;
      
      try {
        recognition.stop();
      } catch (e) {
        console.log("Recognition already stopped:", e.message);
      }
      
      // Update UI
      micButton.innerHTML = '🎤';
      micButton.style.backgroundColor = '#007bff';
      
      // Clean up
      removeHighlights();
      awaitingSelection = false;
      selectionContext = [];
      pendingConfirmation = null;
      
      // Update storage
      chrome.storage.local.set({ 
        isVoiceControlActive: false,
        isVoiceListening: false 
      });
      
      smartSpeak("Stopping voice control");
    } else {
      commandExecuted = false;
    }

    if (commandExecuted) {
      console.log("Executing:", feedback);
      showStatus(feedback);
    } else {
      console.log(`Command not recognized: "${command}"`);
      showStatus(`❓ "${command}" - Try "help" for commands`, 2000);
    }
  };

  // --- Event Listeners ---
  micButton.addEventListener('click', () => {
    console.log("🖱️ Mic button clicked. Current state - isListening:", isListening);
    
    if (isListening) {
      // User wants to STOP listening (wrapper stays visible)
      console.log("🛑 User clicked STOP - stopping recognition");
      
      // Set flag FIRST to prevent any auto-restart
      isListening = false;
      isSpeaking = false;
      
      // Update UI immediately
      micButton.innerHTML = '🎤';
      micButton.style.backgroundColor = '#6c757d';
      
      // Cancel any ongoing speech
      try {
        window.speechSynthesis.cancel();
        console.log("🔇 Speech cancelled");
      } catch (e) {
        console.log("Speech cancel error:", e.message);
      }
      
      // ABORT recognition immediately (stronger than stop)
      try {
        recognition.abort();
        console.log("⛔ Recognition ABORTED - will not restart");
      } catch (e) {
        console.log("Recognition abort:", e.message);
      }
      
      // Also try stop as backup
      try {
        recognition.stop();
      } catch (e) {
        console.log("Recognition stop:", e.message);
      }
      
      chrome.storage.local.set({ 
        isVoiceListening: false
      });
      
      showStatus("🛑 Stopped listening", 2000);
      
    } else {
      // User wants to START listening (wrapper already visible)
      console.log("🎤 User clicked START - starting recognition");
      
      // Set flag FIRST
      isListening = true;
      
      // Speak welcome on first mic click (user gesture allows TTS)
      const currentDomain = window.location.hostname;
      chrome.storage.local.get(['micClickedDomains'], (result) => {
        const clickedDomains = result.micClickedDomains || [];
        
        if (!clickedDomains.includes(currentDomain)) {
          // First time clicking mic on this domain - speak welcome
          setTimeout(() => {
            smartSpeak("Voice control activated. How can I help you?", null, true);
          }, 500);
          
          // Mark this domain
          clickedDomains.push(currentDomain);
          const recentDomains = clickedDomains.slice(-50);
          chrome.storage.local.set({ micClickedDomains: recentDomains });
          console.log("🎉 Welcome speech will play (first mic click on domain)");
        }
      });
      
      try {
        recognition.start();
        console.log("✅ Recognition start called");
        // UI will be updated by onstart event
        showStatus("🎤 Voice control starting...", 2000);
      } catch (e) {
        console.error("❌ Could not start recognition:", e);
        isListening = false;
        micButton.innerHTML = '❌';
        micButton.style.backgroundColor = '#dc3545';
        showStatus("❌ Failed to start. Check mic permissions.", 3000);
      }
    }
  });

  // Automatically start listening when the script is injected
  chrome.storage.local.get(['isVoiceControlActive', 'isVoiceListening'], (data) => {
    console.log("📊 Voice control state on load:", data);
    
    // Auto-start listening when injected (user activated voice control for this domain)
    try {
      console.log("🎤 Auto-starting voice recognition on page load...");
      
      // Track if this is first activation (for welcome message)
      let hasSpokenWelcome = false;
      
      // Wait for voices to load before starting
      const startWithSpeech = () => {
        console.log("🚀 Starting voice control (wrapper already visible)...");
        isListening = true; // Set flag first
        
        // Show welcome message only on first user interaction
        const currentDomain = window.location.hostname;
        chrome.storage.local.get(['welcomedDomains'], (result) => {
          const welcomedDomains = result.welcomedDomains || [];
          const alreadyWelcomed = welcomedDomains.includes(currentDomain);
          
          if (!alreadyWelcomed && !hasSpokenWelcome) {
            // Show welcome in status immediately (visual feedback)
            showStatus("🎤 Voice ready! Click mic to start & hear welcome.", 4000);
            hasSpokenWelcome = true;
            
            // Mark this domain as welcomed
            welcomedDomains.push(currentDomain);
            // Keep only last 50 domains to avoid storage bloat
            const recentDomains = welcomedDomains.slice(-50);
            chrome.storage.local.set({ welcomedDomains: recentDomains }, () => {
              console.log("📝 Domain marked as welcomed:", currentDomain);
            });
          } else {
            console.log("🔇 Skipping welcome message - already welcomed on this domain");
          }
        });
        
        try {
          recognition.start();
          console.log("✅ Recognition started");
        } catch (e) {
          console.error("❌ Recognition start error:", e);
          // Show error on UI
          micButton.innerHTML = '❌';
          micButton.style.backgroundColor = '#dc3545';
        }
      };
      
      // Check if voices are loaded
      if (voicesLoaded || window.speechSynthesis.getVoices().length > 0) {
        console.log("✅ Voices already loaded, starting immediately");
        startWithSpeech();
      } else {
        console.log("⏳ Waiting for voices to load...");
        // Wait up to 2 seconds for voices
        const voiceCheckInterval = setInterval(() => {
          if (window.speechSynthesis.getVoices().length > 0) {
            console.log("✅ Voices loaded, starting now");
            voicesLoaded = true;
            clearInterval(voiceCheckInterval);
            startWithSpeech();
          }
        }, 100);
        
        setTimeout(() => {
          clearInterval(voiceCheckInterval);
          if (!isListening) {
            console.log("⚠️ Starting without voices loaded");
            startWithSpeech();
          }
        }, 2000);
      }
    } catch (e) {
      console.error("Auto-start failed:", e);
      isListening = false;
      micButton.innerHTML = '🎤';
      micButton.style.backgroundColor = '#007bff';
    }
  });

  // Listen for messages from background script to toggle voice control
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOGGLE_VOICE_CONTROL') {
      console.log("📨 Received TOGGLE_VOICE_CONTROL message:", message);
      
      if (message.active) {
        // Activate - start listening (wrapper already visible)
        console.log("Activating voice control via message");
        
        if (!isListening) {
          isListening = true;
          try {
            recognition.start();
          } catch (e) {
            console.error("Failed to start:", e);
          }
        }
      } else {
        // Deactivate - stop listening (wrapper stays visible)
        console.log("Deactivating voice control via message");
        isListening = false; // Set flag first to prevent restart
        isSpeaking = false;
        
        // Cancel speech
        try {
          window.speechSynthesis.cancel();
        } catch (e) {
          console.log("Speech cancel:", e.message);
        }
        
        // Abort recognition
        try {
          recognition.abort();
          console.log("⛔ Recognition aborted via message");
        } catch (e) {
          console.log("Recognition abort:", e.message);
        }
        
        // Also stop as backup
        try {
          recognition.stop();
        } catch (e) {
          console.log("Recognition stop:", e.message);
        }
        
        removeHighlights();
        
        // Update button to gray
        micButton.innerHTML = '🎤';
        micButton.style.backgroundColor = '#6c757d';
        
        chrome.storage.local.set({ isVoiceListening: false });
      }
    }
    sendResponse({ success: true });
    return true; // Keep channel open for async
  });

  // Handle tab visibility changes - pause when tab is hidden, resume when visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.log("📴 Tab hidden - pausing recognition to save resources");
      if (isListening) {
        try {
          recognition.stop(); // Will auto-restart when tab becomes visible
        } catch (e) {
          console.log("Stop on hide:", e.message);
        }
      }
    } else {
      console.log("👁️ Tab visible - resuming recognition");
      if (isListening && !isSpeaking) {
        // Small delay to ensure tab is fully active
        setTimeout(() => {
          if (isListening) {
            try {
              recognition.start();
              console.log("✅ Resumed recognition after tab became visible");
            } catch (e) {
              console.log("Resume error:", e.message);
            }
          }
        }, 300);
      }
    }
  });

  console.log("✅ Voice control fully initialized and ready");

})();
