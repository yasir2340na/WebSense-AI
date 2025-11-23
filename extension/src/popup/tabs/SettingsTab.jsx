import React, { useState, useEffect } from 'react';

function SettingsTab() {
  const [settings, setSettings] = useState({
    nlpBackendUrl: 'http://localhost:3000',
    useNlpBackend: true,
    autoStart: false,
    showConfidence: true,
    minConfidence: 50,
    voiceLanguage: 'en-US'
  });

  useEffect(() => {
    // Load settings from chrome.storage
    chrome.storage.sync.get(['voiceSettings'], (result) => {
      if (result.voiceSettings) {
        setSettings({ ...settings, ...result.voiceSettings });
      }
    });
  }, []);

  const saveSettings = () => {
    chrome.storage.sync.set({ voiceSettings: settings }, () => {
      alert('✅ Settings saved successfully!');
    });
  };

  const resetSettings = () => {
    const defaultSettings = {
      nlpBackendUrl: 'http://localhost:3000',
      useNlpBackend: true,
      autoStart: false,
      showConfidence: true,
      minConfidence: 50,
      voiceLanguage: 'en-US'
    };
    setSettings(defaultSettings);
    chrome.storage.sync.set({ voiceSettings: defaultSettings });
  };

  const testConnection = async () => {
    try {
      const response = await fetch(`${settings.nlpBackendUrl}/health`);
      if (response.ok) {
        alert('✅ Connected successfully!');
      } else {
        alert('⚠️ Server responded but with error');
      }
    } catch (error) {
      alert('❌ Cannot connect to server. Make sure it\'s running.');
    }
  };

  return (
    <div className="settings-tab">
      <h2>⚙️ Settings</h2>

      <div className="settings-section">
        <h3>🌐 Backend Configuration</h3>
        
        <div className="setting-item">
          <label>
            <strong>NLP Backend URL:</strong>
            <input
              type="text"
              value={settings.nlpBackendUrl}
              onChange={(e) => setSettings({ ...settings, nlpBackendUrl: e.target.value })}
              placeholder="http://localhost:3000"
            />
          </label>
          <button className="btn btn-sm" onClick={testConnection}>
            Test Connection
          </button>
        </div>

        <div className="setting-item">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.useNlpBackend}
              onChange={(e) => setSettings({ ...settings, useNlpBackend: e.target.checked })}
            />
            <span>Use NLP Backend (recommended for better accuracy)</span>
          </label>
          <p className="help-text">
            When enabled, uses spaCy NLP for ~85% accuracy. When disabled, falls back to pattern matching (~43% accuracy).
          </p>
        </div>
      </div>

      <div className="settings-section">
        <h3>🎤 Voice Recognition</h3>
        
        <div className="setting-item">
          <label>
            <strong>Language:</strong>
            <select
              value={settings.voiceLanguage}
              onChange={(e) => setSettings({ ...settings, voiceLanguage: e.target.value })}
            >
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="en-AU">English (Australia)</option>
              <option value="en-CA">English (Canada)</option>
            </select>
          </label>
        </div>

        <div className="setting-item">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.autoStart}
              onChange={(e) => setSettings({ ...settings, autoStart: e.target.checked })}
            />
            <span>Auto-start voice control on page load</span>
          </label>
        </div>
      </div>

      <div className="settings-section">
        <h3>📊 Display Options</h3>
        
        <div className="setting-item">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={settings.showConfidence}
              onChange={(e) => setSettings({ ...settings, showConfidence: e.target.checked })}
            />
            <span>Show confidence scores</span>
          </label>
        </div>

        <div className="setting-item">
          <label>
            <strong>Minimum Confidence Threshold:</strong>
            <div className="range-container">
              <input
                type="range"
                min="0"
                max="100"
                value={settings.minConfidence}
                onChange={(e) => setSettings({ ...settings, minConfidence: parseInt(e.target.value) })}
              />
              <span className="range-value">{settings.minConfidence}%</span>
            </div>
          </label>
          <p className="help-text">
            Commands below this confidence threshold will ask for confirmation.
          </p>
        </div>
      </div>

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={saveSettings}>
          💾 Save Settings
        </button>
        <button className="btn btn-secondary" onClick={resetSettings}>
          🔄 Reset to Defaults
        </button>
      </div>

      <div className="info-box">
        <h4>ℹ️ Server Status</h4>
        <p>Backend servers must be running for NLP features:</p>
        <ul>
          <li>Node.js API: <code>http://localhost:3000</code></li>
          <li>spaCy NLP: <code>http://localhost:5001</code></li>
        </ul>
        <p>Start with: <code>START_SERVERS.bat</code></p>
      </div>
    </div>
  );
}

export default SettingsTab;
