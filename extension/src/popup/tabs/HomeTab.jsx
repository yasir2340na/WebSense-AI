import React from 'react';

function HomeTab() {
  return (
    <div className="home-tab">
      <div className="welcome-section">
        <h2>Welcome to WebSense-AI! 🎉</h2>
        <p>
          Your intelligent voice-controlled web assistant powered by advanced
          spaCy NLP for natural language understanding.
        </p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">🎯</div>
          <div className="stat-value">~85%</div>
          <div className="stat-label">NLP Accuracy</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-value">~50ms</div>
          <div className="stat-label">Parse Time</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🧠</div>
          <div className="stat-value">200+</div>
          <div className="stat-label">Commands</div>
        </div>
      </div>

      <div className="feature-section">
        <h3>✨ Key Features</h3>
        <div className="features-list">
          <div className="feature-item">
            <span className="feature-icon">🎤</span>
            <div>
              <strong>Natural Voice Control</strong>
              <p>Speak naturally - our NLP understands context and intent</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon">🔍</span>
            <div>
              <strong>Smart Element Detection</strong>
              <p>Find buttons, links, inputs, and more with voice commands</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon">🎯</span>
            <div>
              <strong>High Accuracy Parsing</strong>
              <p>85% accuracy vs 43% with pattern matching</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon">🚀</span>
            <div>
              <strong>Fast Response</strong>
              <p>~150ms end-to-end processing time</p>
            </div>
          </div>
        </div>
      </div>

      <div className="quick-start">
        <h3>🚀 Quick Start</h3>
        <ol>
          <li>Make sure backend servers are running (<code>START_SERVERS.bat</code>)</li>
          <li>Go to the <strong>Voice Control</strong> tab</li>
          <li>Click <strong>"Start Voice Control"</strong></li>
          <li>Say a command like "show all buttons"</li>
          <li>Watch the magic happen! ✨</li>
        </ol>
      </div>

      <div className="info-section">
        <h3>📊 System Architecture</h3>
        <div className="architecture-diagram">
          <div className="arch-layer">
            <div className="arch-box">Browser Extension</div>
            <div className="arch-arrow">↓ Voice Command</div>
          </div>
          <div className="arch-layer">
            <div className="arch-box">Node.js API (Port 3000)</div>
            <div className="arch-arrow">↓ HTTP POST</div>
          </div>
          <div className="arch-layer">
            <div className="arch-box">spaCy NLP (Port 5001)</div>
            <div className="arch-arrow">↓ Parsed Intent</div>
          </div>
          <div className="arch-layer">
            <div className="arch-box">Action Execution</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomeTab;
