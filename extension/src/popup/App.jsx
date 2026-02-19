import React, { useState } from 'react';
import './App.css';
import VoiceTab from './tabs/VoiceTab';
import HomeTab from './tabs/HomeTab';
import SettingsTab from './tabs/SettingsTab';
import FormFillTab from './tabs/FormFillTab';

function App() {
  const [activeTab, setActiveTab] = useState('voice');

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎤 WebSense-AI Voice Control</h1>
        <p className="subtitle">Powered by spaCy NLP</p>
      </header>

      <nav className="tab-nav">
        <button
          className={`tab-button ${activeTab === 'home' ? 'active' : ''}`}
          onClick={() => setActiveTab('home')}
        >
          🏠 Home
        </button>
        <button
          className={`tab-button ${activeTab === 'voice' ? 'active' : ''}`}
          onClick={() => setActiveTab('voice')}
        >
          🎤 Voice Control
        </button>
        <button
          className={`tab-button ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          ⚙️ Settings
        </button>
        <button
          className={`tab-button ${activeTab === 'formfill' ? 'active' : ''}`}
          onClick={() => setActiveTab('formfill')}
        >
          📝 Form Fill
        </button>
      </nav>

      <main className="app-content">
        {activeTab === 'home' && <HomeTab />}
        {activeTab === 'voice' && <VoiceTab />}
        {activeTab === 'settings' && <SettingsTab />}
        {activeTab === 'formfill' && <FormFillTab />}
      </main>

      <footer className="app-footer">
        <small>WebSense-AI v1.0 | Voice Navigation</small>
      </footer>
    </div>
  );
}

export default App;
