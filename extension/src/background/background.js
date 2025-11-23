// Global state to track if voice control is active and active domains
let isVoiceControlActive = false;
let activeDomains = new Set(); // Track domains where voice control is active
let isInitialized = false; // Track if we've loaded from storage

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

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    chrome.tabs.create({}, (tab) => {
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
});
