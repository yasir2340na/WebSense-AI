// Global state to track if voice control is active
let isVoiceControlActive = false;

chrome.runtime.onInstalled.addListener(() => {
  console.log("WebSense-AI Extension Installed ✅");
  // Initialize state in storage
  chrome.storage.local.set({ isVoiceControlActive: false });
});

// Function to inject the voice control script
const injectVoiceControl = (tabId) => {
  if (!isVoiceControlActive) return;
  console.log(`Injecting voice control into tab ${tabId}`);
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['voiceControl.js'],
  }).catch(err => console.error("Failed to inject script:", err));
};

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TOGGLE_VOICE_CONTROL') {
    isVoiceControlActive = message.active;
    chrome.storage.local.set({ isVoiceControlActive: isVoiceControlActive });
    console.log(`Voice control active state set to: ${isVoiceControlActive}`);
    
    if (isVoiceControlActive) {
      // Inject script when activating
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          injectVoiceControl(tabs[0].id);
        }
      });
    } else {
      // Remove UI when deactivating
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
              const wrapper = document.getElementById('ws-voice-wrapper');
              if (wrapper) {
                wrapper.remove();
              }
              window.ws_voice_injected = false;
            }
          }).catch(err => console.error("Failed to remove UI:", err));
        }
      });
    }
    
    sendResponse({ success: true, active: isVoiceControlActive });
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
        chrome.tabs.duplicate(tabs[0].id, (newTab) => {
          console.log("Tab duplicated via voice command");
          sendResponse({ success: true });
        });
      }
    });
  }
  
  return true; // Keep message channel open for async response
});

// Listens for navigation events to reinject the script if voice control is active.
chrome.webNavigation.onCompleted.addListener((details) => {
  // Ignore sub-frame navigations
  if (details.frameId !== 0) {
    return;
  }

  chrome.storage.local.get('isVoiceControlActive', (data) => {
    if (data.isVoiceControlActive) {
      console.log(`WebSense-AI: Re-injecting script on navigation to ${details.url}`);
      chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ['voiceControl.js'],
      }).catch(err => console.error("Failed to inject script on navigation:", err));
    }
  });
}, { url: [{ schemes: ['http', 'https'] }] });
