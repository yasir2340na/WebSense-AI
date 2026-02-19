import React, { useState } from 'react';
import useVoiceFormFill from '../hooks/useVoiceFormFill';
import './FormFillTab.css';

/**
 * FormFillTab — Voice-based form filling UI component.
 *
 * States: idle → listening → processing → confirming → filled → correcting
 * Includes: mic button, transcript display, status messages,
 *           clarification Q&A, fill summary, correction mode,
 *           sensitive data warning, save prompt.
 */
function FormFillTab() {
  const {
    listeningState,
    transcript,
    clarificationQuestion,
    filledSummary,
    fillReport,
    isSensitiveDetected,
    errorMessage,
    isHttpPage,
    startListening,
    stopListening,
    processTranscript,
    resetSession,
    saveProfile,
    startCorrection,
  } = useVoiceFormFill();

  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [textInput, setTextInput] = useState('');

  /**
   * Handles text-based input as a fallback for microphone.
   */
  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (textInput.trim()) {
      processTranscript(textInput.trim());
      setTextInput('');
    }
  };

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="formfill-tab" role="region" aria-label="Voice Form Filling">

      {/* HTTP Security Warning */}
      {isHttpPage && (
        <div className="formfill-banner formfill-banner--danger" role="alert">
          <span className="formfill-banner__icon">🔒</span>
          <div>
            <strong>Unsafe Page Detected</strong>
            <p>Voice form fill is disabled on HTTP pages for your security. Use HTTPS sites only.</p>
          </div>
        </div>
      )}

      {/* Sensitive Data Warning */}
      {isSensitiveDetected && (
        <div className="formfill-banner formfill-banner--warning" role="alert" aria-live="polite">
          <span className="formfill-banner__icon">⚠️</span>
          <div>
            <strong>Sensitive Data Detected</strong>
            <p>Passwords and card numbers are automatically redacted and never sent to AI.</p>
          </div>
        </div>
      )}

      {/* ── Microphone Section ── */}
      <div className="formfill-mic-section">
        <button
          className={`formfill-mic-btn ${listeningState === 'listening' ? 'formfill-mic-btn--active' : ''}`}
          onClick={listeningState === 'listening' ? stopListening : startListening}
          disabled={isHttpPage || listeningState === 'processing'}
          aria-label={listeningState === 'listening' ? 'Stop listening' : 'Start voice form fill'}
        >
          {listeningState === 'listening' ? (
            <>
              <span className="formfill-mic-btn__pulse" />
              <span className="formfill-mic-btn__icon">🔴</span>
            </>
          ) : (
            <span className="formfill-mic-btn__icon">🎤</span>
          )}
        </button>

        <div className="formfill-status" aria-live="polite">
          {listeningState === 'idle' && 'Tap the mic and describe the form data'}
          {listeningState === 'listening' && '🔴 Listening... (auto-stops in 15s)'}
          {listeningState === 'processing' && '⏳ Processing your input...'}
          {listeningState === 'confirming' && '❓ Please answer the question below'}
          {listeningState === 'filled' && '✅ Form filled successfully!'}
          {listeningState === 'correcting' && '✏️ Say what you want to change'}
          {listeningState === 'error' && '❌ Something went wrong'}
        </div>
      </div>

      {/* ── Live Transcript ── */}
      {(listeningState === 'listening' || transcript) && (
        <div className="formfill-transcript" aria-live="polite" aria-label="Voice transcript">
          <div className="formfill-transcript__label">📝 Transcript</div>
          <div className="formfill-transcript__text">
            {transcript || <span className="formfill-transcript__placeholder">Listening...</span>}
          </div>
        </div>
      )}

      {/* ── Processing Spinner ── */}
      {listeningState === 'processing' && (
        <div className="formfill-processing">
          <div className="formfill-spinner" aria-label="Processing" />
          <span>Analyzing your input with AI...</span>
        </div>
      )}

      {/* ── Clarification Question ── */}
      {listeningState === 'confirming' && clarificationQuestion && (
        <div className="formfill-clarification">
          <div className="formfill-clarification__question">
            <span className="formfill-clarification__icon">🤖</span>
            <p>{clarificationQuestion}</p>
          </div>
          <div className="formfill-clarification__actions">
            <button
              className="formfill-btn formfill-btn--primary"
              onClick={startListening}
              aria-label="Answer with voice"
            >
              🎤 Answer with Voice
            </button>
            <form onSubmit={handleTextSubmit} className="formfill-text-input">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Or type your answer..."
                aria-label="Type your answer"
                className="formfill-text-input__field"
              />
              <button
                type="submit"
                className="formfill-btn formfill-btn--small"
                disabled={!textInput.trim()}
                aria-label="Submit text answer"
              >
                ➜
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Fill Summary ── */}
      {listeningState === 'filled' && filledSummary && (
        <div className="formfill-summary">
          <h4 className="formfill-summary__title">📋 Filled Fields</h4>
          <div className="formfill-summary__list">
            {Object.entries(filledSummary).map(([field, value]) => (
              <div key={field} className="formfill-summary__row">
                <span className="formfill-summary__field">
                  {field.replace(/_/g, ' ')}
                </span>
                <span className="formfill-summary__value">{value}</span>
              </div>
            ))}
          </div>

          {/* Fill report stats */}
          {fillReport && (
            <div className="formfill-summary__stats">
              <span className="formfill-stat formfill-stat--success">
                ✅ {fillReport.filled?.length || 0} filled
              </span>
              {fillReport.notFound?.length > 0 && (
                <span className="formfill-stat formfill-stat--warning">
                  ⚠️ {fillReport.notFound.length} not found
                </span>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="formfill-summary__actions">
            <button
              className="formfill-btn formfill-btn--secondary"
              onClick={startCorrection}
              aria-label="Edit filled values"
            >
              ✏️ Edit
            </button>
            <button
              className="formfill-btn formfill-btn--primary"
              onClick={() => setShowSavePrompt(true)}
              aria-label="Save profile for next time"
            >
              💾 Save for Next Time
            </button>
          </div>
        </div>
      )}

      {/* ── Save Prompt ── */}
      {showSavePrompt && (
        <div className="formfill-save-prompt">
          <p>Save this profile for faster form filling next time?</p>
          <div className="formfill-save-prompt__actions">
            <button
              className="formfill-btn formfill-btn--primary"
              onClick={() => {
                saveProfile();
                setShowSavePrompt(false);
              }}
              aria-label="Yes, save profile"
            >
              ✅ Yes, Save
            </button>
            <button
              className="formfill-btn formfill-btn--ghost"
              onClick={() => setShowSavePrompt(false)}
              aria-label="No, don't save"
            >
              No Thanks
            </button>
          </div>
        </div>
      )}

      {/* ── Correction Mode ── */}
      {listeningState === 'correcting' && (
        <div className="formfill-correction">
          <div className="formfill-correction__header">
            <span>✏️</span>
            <strong>Correction Mode</strong>
          </div>
          <p className="formfill-correction__hint">
            Say what to change, e.g. &quot;Change my name to Muhammad Khan&quot;
          </p>
          <div className="formfill-correction__actions">
            <button
              className="formfill-btn formfill-btn--primary"
              onClick={startListening}
              aria-label="Speak correction"
            >
              🎤 Speak Correction
            </button>
            <form onSubmit={handleTextSubmit} className="formfill-text-input">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Or type correction..."
                aria-label="Type correction"
                className="formfill-text-input__field"
              />
              <button
                type="submit"
                className="formfill-btn formfill-btn--small"
                disabled={!textInput.trim()}
                aria-label="Submit correction"
              >
                ➜
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Error Display ── */}
      {listeningState === 'error' && errorMessage && (
        <div className="formfill-error" role="alert" aria-live="assertive">
          <span className="formfill-error__icon">❌</span>
          <p>{errorMessage}</p>
          <button
            className="formfill-btn formfill-btn--ghost"
            onClick={resetSession}
            aria-label="Try again"
          >
            Try Again
          </button>
        </div>
      )}

      {/* ── Reset Button ── */}
      {listeningState !== 'idle' && listeningState !== 'listening' && (
        <div className="formfill-reset">
          <button
            className="formfill-btn formfill-btn--ghost formfill-btn--full"
            onClick={resetSession}
            aria-label="Clear and reset form fill"
          >
            🗑️ Clear &amp; Reset
          </button>
        </div>
      )}

      {/* ── Help Text ── */}
      {listeningState === 'idle' && !isHttpPage && (
        <div className="formfill-help">
          <h4>💡 How to Use</h4>
          <ol>
            <li>Open a page with a form (registration, contact, etc.)</li>
            <li>Click the microphone button above</li>
            <li>Say your details: <em>&quot;My name is Ahmed, email ahmed@test.com&quot;</em></li>
            <li>AI will fill the form fields automatically</li>
            <li>Review and confirm the filled values</li>
          </ol>
          <p className="formfill-help__shortcut">
            ⌨️ Keyboard shortcut: <kbd>Ctrl+Shift+F</kbd>
          </p>
        </div>
      )}
    </div>
  );
}

export default FormFillTab;
