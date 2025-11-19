import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [isActive, setIsActive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // On component mount, check the global state from storage
  useEffect(() => {
    chrome.storage.local.get('isVoiceControlActive', (data) => {
      setIsActive(data.isVoiceControlActive || false);
      setIsLoading(false);
    });

    // Also listen for changes from other parts of the extension
    const handleStorageChange = (changes, area) => {
      if (area === 'local' && changes.isVoiceControlActive) {
        setIsActive(changes.isVoiceControlActive.newValue);
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const toggleVoiceControl = () => {
    const newState = !isActive;
    setIsLoading(true);

    // Send a message to the background script to update the global state
    // and inject/eject the script.
    chrome.runtime.sendMessage({ type: 'TOGGLE_VOICE_CONTROL', active: newState }, (response) => {
      if (response && response.success) {
        setIsActive(response.active);
      }
      setIsLoading(false);
      // Don't close the popup - let user see the result
    });
  };

  return (
    <div className="App">
      <header className="App-header">
        <img src="/icons/icon.svg" className="App-logo" alt="logo" />
        <h1>WebSense-AI</h1>
        <p>Talk naturally - I understand you! 💬</p>
        
        {isLoading ? (
          <p>Loading...</p>
        ) : (
          <button onClick={toggleVoiceControl} className={`toggle-btn ${isActive ? 'active' : ''}`}>
            {isActive ? 'Deactivate Voice Control' : 'Activate Voice Control'}
          </button>
        )}
        
        <div className="command-list">
          <h3>� Talk Naturally - Examples</h3>
          
          <div className="command-category">
            <h4>🎯 Smart Navigation with Auto-Confirmation</h4>
            <ul>
              <li>"Show me the buttons" or "What buttons?"</li>
              <li>"21" - I'll describe button 21 & ask to click!</li>
              <li><strong>ALL clicks require confirmation for safety!</strong></li>
              <li>"Find all links" or "Where are the links?"</li>
              <li>"Press button login" or "Tap the menu"</li>
              <li>"Yes/Yup/Sure" or "No/Nope/Never" for confirmations</li>
              <li>"Cancel" or "Never mind"</li>
            </ul>
          </div>
          
          <div className="command-category">
            <h4>� Scrolling (Be Natural!)</h4>
            <ul>
              <li>"Would you scroll down?" or just "Down"</li>
              <li>"Go up please" or "Move up"</li>
              <li>"Can you go to the top?" or "Beginning"</li>
              <li>"Bottom of page" or "End"</li>
              <li>"Swipe left" or "Move right"</li>
            </ul>
          </div>
          
          <div className="command-category">
            <h4>� Navigation (Your Way!)</h4>
            <ul>
              <li>"Go back please" or "Return"</li>
              <li>"Refresh this" or "Update page"</li>
              <li>"Forward" or "Advance"</li>
            </ul>
          </div>
          
          <div className="command-category">
            <h4>🪟 Tabs & Windows</h4>
            <ul>
              <li>"Open a new tab" or "Create tab"</li>
              <li>"Close this" or "Exit tab"</li>
              <li>"Duplicate this tab" or "Copy tab"</li>
            </ul>
          </div>
          
          <div className="command-category">
            <h4>🔍 View Controls</h4>
            <ul>
              <li>"Make it bigger" or "Zoom in"</li>
              <li>"Smaller" or "Reduce size"</li>
              <li>"Normal size" or "Reset zoom"</li>
            </ul>
          </div>
          
          <div className="command-category">
            <h4>ℹ️ Information</h4>
            <ul>
              <li>"Where am I?" or "What site is this?"</li>
              <li>"What's the page title?"</li>
              <li>"Help" or "What can you do?"</li>
            </ul>
          </div>
          
          <p className="tip">💡 Speak naturally! Use polite words like "please", "could you", "would you"</p>
          <p className="tip">🔍 SAFE MODE: Every button/link click requires YES confirmation!</p>
          <p className="tip">🎤 Say "stop", "pause", or "be quiet" to stop listening</p>
          <p className="tip">✨ Drag the mic button anywhere on screen!</p>
        </div>
        
        <div className="status-indicator">
          Voice Control is currently <strong>{isActive ? 'ON' : 'OFF'}</strong>
        </div>
      </header>
    </div>
  );
}

export default App;
