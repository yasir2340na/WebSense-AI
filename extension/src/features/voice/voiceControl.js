// This script will be injected into the active tab to handle voice commands.
// It creates a floating UI and manages speech recognition.

(function() {
  // Ensure the script runs only once
  if (window.ws_voice_injected) {
    return;
  }
  window.ws_voice_injected = true;

  console.log("WebSense-AI Voice Control Injected");

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
  
  // Store detected elements for smart selection
  let awaitingSelection = false;
  let selectionType = '';
  let selectionContext = [];
  let pendingConfirmation = null; // Stores element waiting for user confirmation

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

  // Smart speak function with recognition management
  const smartSpeak = (text, callback) => {
    if (!('speechSynthesis' in window)) {
      console.log("Speech synthesis not available");
      if (callback) callback();
      return;
    }

    try {
      console.log("smartSpeak called with:", text);
      
      // Cancel any ongoing speech - with small delay to prevent race condition
      window.speechSynthesis.cancel();
      
      // Small delay before starting new speech
      setTimeout(() => {
        // Pause recognition while speaking to prevent echo
        isSpeaking = true;
        console.log("Starting TTS, pausing recognition");
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.volume = 1.0;
        utterance.pitch = 1.0;
        utterance.lang = 'en-US';
        
        utterance.onstart = () => {
          console.log("TTS started speaking:", text);
          isSpeaking = true;
        };
        
        utterance.onend = () => {
          console.log("TTS finished speaking");
          isSpeaking = false;
          
          // Force restart recognition after speaking
          setTimeout(() => {
            if (isListening && !isSpeaking) {
              try {
                recognition.stop();
                setTimeout(() => {
                  if (isListening) {
                    recognition.start();
                    console.log("Recognition restarted after TTS");
                  }
                }, 100);
              } catch (e) {
                console.log("Recognition restart after TTS:", e.message);
              }
            }
            if (callback) callback();
          }, 200);
        };
        
        utterance.onerror = (event) => {
          console.error("TTS error:", event.error);
          isSpeaking = false;
          if (callback) callback();
        };
        
        console.log("Calling speechSynthesis.speak()");
        window.speechSynthesis.speak(utterance);
      }, 50); // Small delay to ensure cancel completes
    } catch (e) {
      console.error("Error with speech synthesis:", e);
      isSpeaking = false;
      if (callback) callback();
    }
  };

  // Get element description
  const getElementDescription = (el) => {
    let desc = el.innerText?.trim().substring(0, 50) || 
               el.getAttribute('aria-label') || 
               el.getAttribute('title') || 
               el.getAttribute('placeholder') ||
               el.name ||
               el.id ||
               'unnamed';
    return desc.toLowerCase();
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

  // Detect and list elements
  const detectElements = (type) => {
    let elements = [];
    let message = '';
    
    switch(type) {
      case 'buttons':
        elements = getVisibleElements('button, [role="button"], input[type="submit"], input[type="button"], .btn, [class*="button"]');
        message = `Found ${elements.length} buttons`;
        break;
        
      case 'links':
        elements = getVisibleElements('a[href]');
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
    }
    
    if (elements.length > 0) {
      highlightElements(elements);
      selectionContext = elements;
      selectionType = type;
      awaitingSelection = true;
      
      // List first few elements
      const preview = elements.slice(0, 5).map((el, i) => 
        `${i + 1}. ${getElementDescription(el)}`
      ).join(', ');
      
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
  const recognition = new SpeechRecognition();
  recognition.continuous = true; // Keep listening even after a result
  recognition.interimResults = false; // We only want final results
  recognition.lang = 'en-US';

  const showStatus = (text, duration = 3000) => {
    statusPopup.textContent = text;
    statusPopup.style.opacity = '1';
    statusPopup.style.visibility = 'visible';
    setTimeout(() => {
      statusPopup.style.opacity = '0';
      statusPopup.style.visibility = 'hidden';
    }, duration);
  };

  recognition.onstart = () => {
    console.log("Voice recognition started.");
    isListening = true;
    micButton.innerHTML = '🔴';
    micButton.style.backgroundColor = '#dc3545'; // Red for listening
    showStatus("🎙️ Listening...", 5000);
    
    // Update storage to sync with popup
    chrome.storage.local.set({ isVoiceListening: true });
  };

  recognition.onend = () => {
    console.log("Voice recognition ended. isListening:", isListening, "isSpeaking:", isSpeaking);
    
    // Don't restart if we're currently speaking
    if (isSpeaking) {
      console.log("Not restarting - currently speaking");
      return;
    }
    
    if (isListening) {
      // Always restart if we want continuous listening
      try {
        setTimeout(() => {
          if (isListening && !isSpeaking) {
            try {
              recognition.start();
              console.log("Restarted recognition automatically");
            } catch (startError) {
              console.log("Recognition already started or error:", startError.message);
            }
          }
        }, 100); // Reduced delay for faster restart
      } catch (e) {
        console.error("Error restarting recognition:", e);
      }
    } else {
      micButton.innerHTML = '🎤';
      micButton.style.backgroundColor = '#007bff'; // Blue for inactive
      showStatus("🛑 Stopped.", 2000);
      
      // Update storage to sync with popup
      chrome.storage.local.set({ isVoiceListening: false });
    }
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      showStatus("🎤 Mic access denied. Please allow in browser settings.", 5000);
      isListening = false; // Stop trying to restart
      micButton.innerHTML = '🎤';
      micButton.style.backgroundColor = '#dc3545'; // Red for error
    } else if (event.error === 'no-speech') {
      // No speech detected - this is normal, just continue listening
      console.log("No speech detected, continuing...");
      showStatus("👂 Still listening...", 2000);
    } else if (event.error === 'aborted') {
      // Aborted - user stopped it
      console.log("Recognition aborted");
    } else {
      // Other errors - show but keep trying
      console.log("Recognition error, will retry:", event.error);
      showStatus("⚠️ Error, retrying...", 2000);
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

  // --- Command Execution ---
  const executeCommand = (rawCommand) => {
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
      feedback = "🛑 Stopping...";
      isListening = false;
      recognition.stop();
      removeHighlights();
      awaitingSelection = false;
      selectionContext = [];
      pendingConfirmation = null;
      chrome.storage.local.set({ isVoiceControlActive: false });
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
    if (isListening) {
      isListening = false;
      recognition.stop();
      console.log("Manually stopping voice recognition.");
    } else {
      try {
        recognition.start();
      } catch (e) {
        console.error("Could not start recognition:", e);
        // This can happen if it's already started and errored.
        isListening = false;
      }
    }
  });

  // Automatically start listening when the script is injected
  try {
    recognition.start();
    console.log("Auto-starting voice recognition...");
  } catch (e) {
    console.error("Auto-start failed:", e);
  }

  // Listen for messages from background script to toggle voice control
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOGGLE_VOICE_CONTROL') {
      if (message.active) {
        // Already active, do nothing
        console.log("Voice control already active");
      } else {
        // Deactivate - remove UI and stop listening
        console.log("Deactivating voice control");
        isListening = false;
        recognition.stop();
        removeHighlights();
        wrapper.remove();
      }
    }
  });

})();
