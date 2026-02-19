import { useState, useCallback, useRef, useEffect } from 'react';

// ============================================================
// CONSTANTS (hoisted outside component to keep refs stable)
// ============================================================

/** Sensitive data regex patterns (client-side pre-check) */
const SENSITIVE_PATTERNS = [
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,   // CREDIT_CARD
  /\b\d{3}-\d{2}-\d{4}\b/,                            // SSN
  /password\s+is\s+\S+/i,                              // PASSWORD
  /\bcvv\s+is\s+\d{3,4}\b/i,                           // CVV
];

/** Correction keywords */
const CORRECTION_KEYWORDS = [
  'wait', 'change', 'update', 'actually',
  'no', 'wrong', 'fix', 'correct',
];

/** Max listening duration in ms */
const MIC_TIMEOUT = 15000;

/**
 * Custom hook for managing voice-based form filling state and logic.
 *
 * Manages the full lifecycle: idle → listening → processing → confirming/filled/error.
 * Handles Web Speech API, backend communication, and session management.
 *
 * @returns {Object} Voice form fill state and control functions.
 */
export default function useVoiceFormFill() {
  // ============================================================
  // STATE
  // ============================================================

  /** @type {'idle'|'listening'|'processing'|'confirming'|'correcting'|'filled'|'error'} */
  const [listeningState, setListeningState] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [clarificationQuestion, setClarificationQuestion] = useState('');
  const [filledSummary, setFilledSummary] = useState(null);
  const [fillReport, setFillReport] = useState(null);
  const [isSensitiveDetected, setIsSensitiveDetected] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [partialFields, setPartialFields] = useState(null);
  const [sessionId] = useState(() => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  const [isHttpPage, setIsHttpPage] = useState(false);

  const recognitionRef = useRef(null);
  const autoStopTimerRef = useRef(null);
  const transcriptRef = useRef('');
  const listeningStateRef = useRef(listeningState);
  const filledSummaryRef = useRef(filledSummary);
  const processTranscriptRef = useRef(null);
  const processCorrectionRef = useRef(null);

  // Keep refs in sync with state
  useEffect(() => { listeningStateRef.current = listeningState; }, [listeningState]);
  useEffect(() => { filledSummaryRef.current = filledSummary; }, [filledSummary]);

  // ============================================================
  // CHECK PAGE SECURITY
  // ============================================================

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.url) {
          const isHttp = tabs[0].url.startsWith('http://');
          setIsHttpPage(isHttp);
        }
      });
    }
  }, []);

  // ============================================================
  // WEB SPEECH API
  // ============================================================

  /**
   * Starts the Web Speech API recognition.
   * Auto-stops after 15 seconds.
   */
  const startListening = useCallback(() => {
    if (isHttpPage) {
      setErrorMessage('Form fill disabled on unsafe pages. Use HTTPS sites only.');
      setListeningState('error');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorMessage('Speech recognition not supported in this browser.');
      setListeningState('error');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setListeningState('listening');
        setErrorMessage('');
        setTranscript('');
      };

      recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }

        const t = finalTranscript || interimTranscript;
        setTranscript(t);
        transcriptRef.current = t;
      };

      recognition.onend = () => {
        clearTimeout(autoStopTimerRef.current);
        recognitionRef.current = null;

        // Use ref to get latest transcript value
        const currentTranscript = transcriptRef.current;
        if (currentTranscript && currentTranscript.trim()) {
          // Check if this is a correction
          const isCorrection = CORRECTION_KEYWORDS.some(
            (keyword) => currentTranscript.toLowerCase().includes(keyword)
          );

          if (isCorrection && listeningStateRef.current !== 'correcting' && filledSummaryRef.current) {
            processCorrectionRef.current(currentTranscript);
          } else {
            processTranscriptRef.current(currentTranscript);
          }
        } else {
          setListeningState('idle');
        }
      };

      recognition.onerror = (event) => {
        clearTimeout(autoStopTimerRef.current);
        recognitionRef.current = null;

        if (event.error === 'not-allowed') {
          setErrorMessage('Microphone access needed for voice commands. Please allow microphone permission.');
          setListeningState('error');
        } else if (event.error === 'no-speech') {
          setErrorMessage('No speech detected. Please try again.');
          setListeningState('idle');
        } else {
          setErrorMessage(`Speech recognition error: ${event.error}`);
          setListeningState('error');
        }
      };

      recognition.start();
      recognitionRef.current = recognition;

      // Auto-stop after 15 seconds
      autoStopTimerRef.current = setTimeout(() => {
        if (recognitionRef.current) {
          recognitionRef.current.stop();
        }
      }, MIC_TIMEOUT);
    } catch (err) {
      setErrorMessage(`Failed to start voice input: ${err.message}`);
      setListeningState('error');
    }
  }, [isHttpPage]);

  /**
   * Stops the Web Speech API recognition manually.
   */
  const stopListening = useCallback(() => {
    clearTimeout(autoStopTimerRef.current);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  // ============================================================
  // BACKEND COMMUNICATION
  // ============================================================

  /**
   * Sends transcript to backend via background.js for processing.
   * @param {string} text - The voice transcript to process.
   */
  const processTranscript = useCallback(async (text) => {
    if (!text || !text.trim()) return;

    setListeningState('processing');

    // Client-side sensitive data detection
    let hasSensitive = false;
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(text)) {
        hasSensitive = true;
        break;
      }
    }
    setIsSensitiveDetected(hasSensitive);

    try {
      const response = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Processing took too long. Please try again.'));
        }, 12000);

        chrome.runtime.sendMessage(
          {
            type: 'START_VOICE_FORM_FILL',
            transcript: text,
            sessionId,
          },
          (resp) => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(resp);
            }
          }
        );
      });

      if (!response?.success) {
        setErrorMessage(response?.message || response?.error || 'Form filling failed.');
        setListeningState('error');
        return;
      }

      // Handle different response statuses
      if (response.status === 'ready' && response.payload) {
        // Send fill command to content script via background
        const fillResponse = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: 'FORM_FILL_RESPONSE',
              status: 'ready',
              payload: response.payload,
            },
            (resp) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(resp);
              }
            }
          );
        });

        setFilledSummary(response.payload.summary || {});
        setFillReport(fillResponse?.fillReport || null);
        setListeningState('filled');
      } else if (response.status === 'needs_input') {
        setClarificationQuestion(response.question || 'Could you provide more details?');
        setPartialFields(response.partial || null);
        setListeningState('confirming');
      } else {
        setErrorMessage(response.message || 'Unexpected response from AI service.');
        setListeningState('error');
      }
    } catch (err) {
      setErrorMessage(err.message || 'AI service temporarily unavailable.');
      setListeningState('error');
    } finally {
      // Clear transcript from state after processing (security)
      setTranscript('');
    }
  }, [sessionId]);

  /**
   * Sends a correction transcript to the backend.
   * @param {string} correctionText - The correction speech.
   */
  const processCorrection = useCallback(async (correctionText) => {
    setListeningState('processing');

    try {
      const response = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Processing took too long. Please try again.'));
        }, 12000);

        chrome.runtime.sendMessage(
          {
            type: 'VOICE_CORRECTION',
            sessionId,
            correctionTranscript: correctionText,
          },
          (resp) => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(resp);
            }
          }
        );
      });

      if (response?.status === 'ready' && response?.payload) {
        // Re-fill the form with corrected values
        await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'FORM_FILL_RESPONSE',
              status: 'ready',
              payload: response.payload,
            },
            resolve
          );
        });

        setFilledSummary(response.payload.summary || {});
        setListeningState('filled');
      } else if (response?.status === 'needs_input') {
        setClarificationQuestion(response.question || 'What would you like to change?');
        setListeningState('confirming');
      } else {
        setErrorMessage(response?.message || 'Could not process correction.');
        setListeningState('error');
      }
    } catch (err) {
      setErrorMessage(err.message);
      setListeningState('error');
    } finally {
      setTranscript('');
    }
  }, [sessionId]);

  // Keep function refs in sync so startListening's onend can call latest versions
  useEffect(() => { processTranscriptRef.current = processTranscript; }, [processTranscript]);
  useEffect(() => { processCorrectionRef.current = processCorrection; }, [processCorrection]);

  // ============================================================
  // ACTIONS
  // ============================================================

  /**
   * Resets all state and clears the backend session.
   */
  const resetSession = useCallback(() => {
    stopListening();
    setListeningState('idle');
    setTranscript('');
    setClarificationQuestion('');
    setFilledSummary(null);
    setFillReport(null);
    setIsSensitiveDetected(false);
    setErrorMessage('');
    setPartialFields(null);

    // Clear backend session
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'CLEAR_FORM_SESSION',
        sessionId,
      });
    }
  }, [sessionId, stopListening]);

  /**
   * Saves filled profile data for future use.
   */
  const saveProfile = useCallback(() => {
    if (!filledSummary) return;

    chrome.runtime.sendMessage(
      {
        type: 'SAVE_FORM_PROFILE',
        userId: 'default_user',
        profileData: filledSummary,
      },
      (resp) => {
        if (resp?.success) {
          setErrorMessage('');
        } else {
          setErrorMessage('Failed to save profile.');
        }
      }
    );
  }, [filledSummary]);

  /**
   * Enters correction mode — user can speak corrections.
   */
  const startCorrection = useCallback(() => {
    setListeningState('correcting');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    // State
    listeningState,
    transcript,
    clarificationQuestion,
    filledSummary,
    fillReport,
    isSensitiveDetected,
    errorMessage,
    partialFields,
    sessionId,
    isHttpPage,

    // Actions
    startListening,
    stopListening,
    processTranscript,
    processCorrection,
    resetSession,
    saveProfile,
    startCorrection,
  };
}
