import React, { useState, useEffect } from 'react';

function VoiceTab() {
  const [isListening, setIsListening] = useState(false);
  const [lastCommand, setLastCommand] = useState('');
  const [parsedResult, setParsedResult] = useState(null);
  const [serverStatus, setServerStatus] = useState('checking');
  const [testMode, setTestMode] = useState(false);

  // Check server status on mount
  useEffect(() => {
    checkServerStatus();
    const interval = setInterval(checkServerStatus, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, []);

  const checkServerStatus = async () => {
    try {
      const response = await fetch('http://localhost:3000/health');
      if (response.ok) {
        setServerStatus('connected');
      } else {
        setServerStatus('error');
      }
    } catch (error) {
      setServerStatus('offline');
    }
  };

  const startVoiceControl = () => {
    // Send message to background script to activate voice control
    chrome.runtime.sendMessage(
      { type: 'TOGGLE_VOICE_CONTROL', active: true },
      (response) => {
        if (response?.success) {
          setIsListening(true);
          console.log('✅ Voice control activated via background script');
        } else {
          console.error('❌ Failed to activate voice control');
        }
      }
    );
  };

  const stopVoiceControl = () => {
    // Send message to background script to deactivate voice control
    chrome.runtime.sendMessage(
      { type: 'TOGGLE_VOICE_CONTROL', active: false },
      (response) => {
        if (response?.success) {
          setIsListening(false);
          console.log('✅ Voice control deactivated via background script');
        } else {
          console.error('❌ Failed to deactivate voice control');
        }
      }
    );
  };

  const testCommand = async (command) => {
    setLastCommand(command);
    try {
      const response = await fetch('http://localhost:3000/api/voice/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: command })
      });
      
      const result = await response.json();
      setParsedResult(result.data);
    } catch (error) {
      console.error('Error testing command:', error);
      setParsedResult({ error: error.message });
    }
  };

  const testCommands = [
    "show all buttons",
    "click the first link",
    "scroll down",
    "go back",
    "highlight all input fields",
    "find images on this page"
  ];

  return (
    <div className="voice-tab">
      {/* Server Status */}
      <div className={`status-card ${serverStatus}`}>
        <div className="status-indicator">
          {serverStatus === 'connected' && '🟢'}
          {serverStatus === 'offline' && '🔴'}
          {serverStatus === 'checking' && '🟡'}
          {serverStatus === 'error' && '⚠️'}
        </div>
        <div className="status-text">
          <strong>NLP Server Status:</strong>
          {serverStatus === 'connected' && ' Connected (http://localhost:3000)'}
          {serverStatus === 'offline' && ' Offline - Please start servers'}
          {serverStatus === 'checking' && ' Checking...'}
          {serverStatus === 'error' && ' Error connecting'}
        </div>
      </div>

      {serverStatus === 'offline' && (
        <div className="alert alert-warning">
          <strong>⚠️ Servers not running!</strong>
          <p>Please start the backend servers:</p>
          <code>START_SERVERS.bat</code>
        </div>
      )}

      {/* Voice Control */}
      <div className="control-section">
        <h3>🎤 Voice Recognition</h3>
        <div className="button-group">
          <button
            className={`btn btn-primary ${isListening ? 'btn-active' : ''}`}
            onClick={startVoiceControl}
            disabled={serverStatus !== 'connected'}
          >
            {isListening ? '🔴 Listening...' : '🎤 Start Voice Control'}
          </button>
          {isListening && (
            <button className="btn btn-secondary" onClick={stopVoiceControl}>
              ⏹️ Stop
            </button>
          )}
        </div>
        <p className="help-text">
          Click to inject voice control into the current page. Say commands like "show all buttons" or "scroll down".
        </p>
      </div>

      {/* Test Mode */}
      <div className="control-section">
        <div className="section-header">
          <h3>🧪 Test NLP Parser</h3>
          <label className="toggle">
            <input
              type="checkbox"
              checked={testMode}
              onChange={(e) => setTestMode(e.target.checked)}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        {testMode && (
          <div className="test-mode">
            <div className="test-buttons">
              {testCommands.map((cmd, idx) => (
                <button
                  key={idx}
                  className="btn btn-test"
                  onClick={() => testCommand(cmd)}
                  disabled={serverStatus !== 'connected'}
                >
                  "{cmd}"
                </button>
              ))}
            </div>

            {lastCommand && (
              <div className="test-result">
                <h4>📝 Command: "{lastCommand}"</h4>
                {parsedResult && !parsedResult.error && (
                  <div className="parsed-data">
                    <div className="data-row">
                      <span className="label">🎯 Action:</span>
                      <span className="value">{parsedResult.action || 'None'}</span>
                    </div>
                    <div className="data-row">
                      <span className="label">🎪 Target:</span>
                      <span className="value">{parsedResult.target || 'None'}</span>
                    </div>
                    <div className="data-row">
                      <span className="label">➡️ Direction:</span>
                      <span className="value">{parsedResult.direction || 'None'}</span>
                    </div>
                    <div className="data-row">
                      <span className="label">🔢 Number:</span>
                      <span className="value">{parsedResult.number || 'None'}</span>
                    </div>
                    <div className="data-row">
                      <span className="label">📊 Confidence:</span>
                      <span className="value confidence">
                        {parsedResult.confidence}%
                        <div className="confidence-bar">
                          <div
                            className="confidence-fill"
                            style={{ width: `${parsedResult.confidence}%` }}
                          ></div>
                        </div>
                      </span>
                    </div>
                  </div>
                )}
                {parsedResult?.error && (
                  <div className="alert alert-error">
                    Error: {parsedResult.error}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Commands Guide */}
      <div className="commands-guide">
        <h3>💡 Example Commands</h3>
        <div className="command-examples">
          <div className="command-category">
            <strong>Navigation:</strong>
            <ul>
              <li>"scroll down"</li>
              <li>"go back"</li>
              <li>"refresh page"</li>
            </ul>
          </div>
          <div className="command-category">
            <strong>Elements:</strong>
            <ul>
              <li>"show all buttons"</li>
              <li>"click first link"</li>
              <li>"highlight inputs"</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VoiceTab;
