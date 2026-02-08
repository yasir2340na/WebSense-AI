import React from 'react';

function HomeTab() {
  return (
    <div className="home-tab">
      <div className="welcome-section">
        <h2>Voice Navigation Control 🎤</h2>
        <p>
          Navigate the web hands-free with intelligent voice commands
        </p>
      </div>

      <div className="activation-guide">
        <h3>🚀 How to Activate</h3>
        <div className="activation-steps">
          <div className="step-item">
            <div className="step-number">1</div>
            <div className="step-content">
              <strong>Press Ctrl+Shift+V</strong>
              <p>Activates voice control on any webpage</p>
            </div>
          </div>
          <div className="step-item">
            <div className="step-number">2</div>
            <div className="step-content">
              <strong>Look for the 🔴 Button</strong>
              <p>Appears at bottom-right when listening</p>
            </div>
          </div>
          <div className="step-item">
            <div className="step-number">3</div>
            <div className="step-content">
              <strong>Start Speaking</strong>
              <p>Say any command to navigate the page</p>
            </div>
          </div>
        </div>
      </div>

      <div className="voice-commands-section">
        <h3>🎯 Popular Voice Commands</h3>
        <div className="commands-grid">
          <div className="command-category">
            <div className="category-header">
              <span className="category-icon">👆</span>
              <strong>Click Elements</strong>
            </div>
            <ul className="command-list">
              <li>"click login"</li>
              <li>"show buttons"</li>
              <li>"click first link"</li>
              <li>"find settings"</li>
            </ul>
          </div>
          
          <div className="command-category">
            <div className="category-header">
              <span className="category-icon">📜</span>
              <strong>Scroll Page</strong>
            </div>
            <ul className="command-list">
              <li>"scroll down"</li>
              <li>"scroll up"</li>
              <li>"scroll left"</li>
              <li>"scroll right"</li>
            </ul>
          </div>
          
          <div className="command-category">
            <div className="category-header">
              <span className="category-icon">🧭</span>
              <strong>Navigate</strong>
            </div>
            <ul className="command-list">
              <li>"go back"</li>
              <li>"go forward"</li>
              <li>"reload page"</li>
              <li>"new tab"</li>
            </ul>
          </div>
          
          <div className="command-category">
            <div className="category-header">
              <span className="category-icon">🔍</span>
              <strong>Zoom & View</strong>
            </div>
            <ul className="command-list">
              <li>"zoom in"</li>
              <li>"zoom out"</li>
              <li>"reset zoom"</li>
              <li>"show all"</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="features-highlight">
        <h3>✨ Key Features</h3>
        <div className="features-list">
          <div className="feature-item">
            <span className="feature-icon">🎤</span>
            <div>
              <strong>Natural Speech Recognition</strong>
              <p>Speak naturally - no robotic commands needed</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon">🎯</span>
            <div>
              <strong>Smart Element Detection</strong>
              <p>Finds buttons, links, divs, spans - even cursor:pointer elements</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon">⚡</span>
            <div>
              <strong>Dynamic Content Support</strong>
              <p>Auto-detects dropdowns, menus, and lazy-loaded content</p>
            </div>
          </div>
          <div className="feature-item">
            <span className="feature-icon">🔄</span>
            <div>
              <strong>Auto Page Navigation</strong>
              <p>Continues working across page navigations</p>
            </div>
          </div>
        </div>
      </div>

      <div className="tips-section">
        <h3>💡 Pro Tips</h3>
        <div className="tips-list">
          <li><strong>Use "show buttons"</strong> to see all clickable buttons numbered</li>
          <li><strong>Say the number</strong> (e.g., "three") to click that element</li>
          <li><strong>Hover over areas</strong> before scrolling for smart scroll detection</li>
          <li><strong>Say "help"</strong> anytime to hear available commands</li>
          <li><strong>Click the 🔴 button</strong> to stop/start listening</li>
        </div>
      </div>
    </div>
  );
}

export default HomeTab;
