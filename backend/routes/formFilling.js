/**
 * WebSense-AI Form Filling Routes
 * 
 * API endpoints for voice-based form filling using LangChain + LangGraph.
 * Handles multi-turn conversations, corrections, and session management.
 * 
 * Security Features:
 * - HTTPS-only enforcement
 * - Rate limiting (30 req/min per session)
 * - Sensitive data filtering at Node.js layer
 * - Authentication via Bearer token
 * - Zero sensitive data logging
 */

const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');

const {
  filterSensitiveFields,
  validateRequiredFields,
  containsSensitiveData,
} = require('../utils/sensitiveDataFilter');

const logger = require('../utils/secureLogger');

// ============================================================
// CONFIGURATION
// ============================================================

const PYTHON_EXECUTABLE = process.env.PYTHON_PATH || 'python';
const CHAIN_SCRIPT_PATH = path.join(__dirname, '..', 'chains', 'invoke_chain.py');
const REQUEST_TIMEOUT = 10000; // 10 seconds
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests per minute per session

// In-memory rate limiting tracker (use Redis in production)
const rateLimitStore = new Map();

// ============================================================
// MIDDLEWARE
// ============================================================

/**
 * Enforces HTTPS-only requests.
 * Rejects HTTP requests with 403 Forbidden.
 */
function httpsOnly(req, res, next) {
  // Allow HTTP in development mode
  if (process.env.NODE_ENV === 'development') {
    return next();
  }

  if (!req.secure && req.get('x-forwarded-proto') !== 'https') {
    logger.warn('HTTPS enforcement: Rejected HTTP request', {
      path: req.path,
      ip: req.ip,
    });
    return res.status(403).json({
      success: false,
      error: 'HTTPS required',
      message: 'Form filling is only available over HTTPS',
    });
  }

  next();
}

/**
 * Authenticates requests via Bearer token.
 * In production, validate against a proper auth system.
 */
function authenticate(req, res, next) {
  const authHeader = req.get('authorization');

  // In development, allow requests without auth
  if (process.env.NODE_ENV === 'development') {
    return next();
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Authentication failed: Missing or invalid token', {
      path: req.path,
      ip: req.ip,
    });
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Valid authentication token required',
    });
  }

  // TODO: Validate token against your auth system
  // const token = authHeader.substring(7);
  // if (!isValidToken(token)) { return res.status(401).json(...); }

  next();
}

/**
 * Rate limiting middleware.
 * Limits requests to 30 per minute per session.
 */
function rateLimit(req, res, next) {
  const sessionId = req.body.sessionId || req.params.sessionId || req.ip;
  const now = Date.now();

  if (!rateLimitStore.has(sessionId)) {
    rateLimitStore.set(sessionId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return next();
  }

  const sessionData = rateLimitStore.get(sessionId);

  // Reset window if expired
  if (now > sessionData.resetAt) {
    rateLimitStore.set(sessionId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return next();
  }

  // Check limit
  if (sessionData.count >= RATE_LIMIT_MAX) {
    logger.warn('Rate limit exceeded', {
      sessionId,
      count: sessionData.count,
      ip: req.ip,
    });
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please wait a minute.',
    });
  }

  // Increment count
  sessionData.count++;
  next();
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Invokes the Python LangGraph chain via child_process.
 * 
 * @param {Object} payload - Data to send to the Python chain.
 * @returns {Promise<Object>} Chain response.
 */
async function invokePythonChain(payload) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    const pythonProcess = spawn(PYTHON_EXECUTABLE, [
      CHAIN_SCRIPT_PATH,
      JSON.stringify(payload),
    ]);

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      const duration = Date.now() - startTime;

      if (code !== 0) {
        logger.error('Python chain execution failed', {
          code,
          stderr: stderr.substring(0, 500), // Limit error log size
          duration,
        });
        return reject(new Error(`Python process exited with code ${code}`));
      }

      try {
        const result = JSON.parse(stdout);
        logger.debug('Python chain completed', { duration, status: result.status });
        resolve(result);
      } catch (err) {
        logger.error('Failed to parse Python chain output', {
          error: err.message,
          stdout: stdout.substring(0, 500),
        });
        reject(new Error('Invalid JSON response from Python chain'));
      }
    });

    // Timeout handler
    const timeout = setTimeout(() => {
      pythonProcess.kill();
      reject(new Error('Python chain execution timeout'));
    }, REQUEST_TIMEOUT);

    pythonProcess.on('close', () => clearTimeout(timeout));
  });
}

/**
 * Cleans up expired rate limit entries.
 * Called periodically to prevent memory leaks.
 */
function cleanupRateLimitStore() {
  const now = Date.now();
  for (const [sessionId, data] of rateLimitStore.entries()) {
    if (now > data.resetAt) {
      rateLimitStore.delete(sessionId);
    }
  }
}

// Cleanup every 5 minutes
setInterval(cleanupRateLimitStore, 5 * 60 * 1000);

// ============================================================
// ROUTES
// ============================================================

/**
 * POST /api/form-fill
 * 
 * Main endpoint for form filling. Handles initial input and
 * multi-turn clarification responses.
 * 
 * Request Body:
 *   - transcript: string (user's voice input)
 *   - pageFields: array (form field metadata from DOM)
 *   - sessionId: string (unique session identifier)
 *   - userId: string (optional, user identifier)
 * 
 * Response:
 *   - status: "ready" | "needs_input" | "error"
 *   - payload: object (when ready)
 *   - question: string (when needs_input)
 *   - partial: object (partial extraction when needs_input)
 */
router.post('/form-fill', httpsOnly, authenticate, rateLimit, async (req, res) => {
  const startTime = Date.now();
  logger.logRequest(req, 'form-fill');

  try {
    // Validate required fields
    const validation = validateRequiredFields(req.body, [
      'transcript',
      'pageFields',
      'sessionId',
    ]);

    if (!validation.valid) {
      logger.warn('Invalid request: Missing required fields', {
        missing: validation.missing,
      });
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        missing: validation.missing,
      });
    }

    const { transcript, pageFields, sessionId, userId = 'default_user' } = req.body;

    // Validate transcript is not empty
    if (!transcript.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Empty transcript',
        message: 'Transcript cannot be empty',
      });
    }

    // Security: Filter out password/card fields (double layer)
    const safePageFields = filterSensitiveFields(pageFields);

    logger.info('Form fill request received', {
      sessionId,
      fieldCount: safePageFields.length,
    });

    // Call Python LangGraph chain
    const chainPayload = {
      transcript,
      page_fields: safePageFields,
      session_id: sessionId,
      user_id: userId,
      correction_mode: false,
    };

    const result = await invokePythonChain(chainPayload);

    // Handle different response statuses
    if (result.status === 'success') {
      logger.info('Form fill ready', { sessionId });
      const duration = Date.now() - startTime;
      logger.logResponse('form-fill', 200, duration);

      return res.json({
        status: 'ready',
        payload: result.payload,
      });
    }

    if (result.status === 'needs_input') {
      logger.info('Form fill needs clarification', { sessionId });
      const duration = Date.now() - startTime;
      logger.logResponse('form-fill', 200, duration);

      return res.json({
        status: 'needs_input',
        question: result.question,
        partial: result.partial || {},
        missing: result.missing || [],
      });
    }

    // Error from chain
    logger.error('Form fill chain error', {
      sessionId,
      message: result.message,
    });
    const duration = Date.now() - startTime;
    logger.logResponse('form-fill', 500, duration);

    return res.status(500).json({
      success: false,
      error: 'Form filling failed',
      message: 'Form filling service is temporarily unavailable',
    });

  } catch (error) {
    logger.error('Form fill request failed', {
      error: error.message,
      stack: error.stack,
    });
    const duration = Date.now() - startTime;
    logger.logResponse('form-fill', 500, duration);

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Form filling service is temporarily unavailable',
    });
  }
});

/**
 * POST /api/form-fill/correction
 * 
 * Handles user corrections to previously filled fields.
 * Resumes existing LangGraph thread using session_id.
 * 
 * Request Body:
 *   - sessionId: string
 *   - correctionTranscript: string
 *   - pageFields: array (same fields as original request)
 * 
 * Response: Same format as POST /api/form-fill
 */
router.post('/form-fill/correction', httpsOnly, authenticate, rateLimit, async (req, res) => {
  const startTime = Date.now();
  logger.logRequest(req, 'form-fill-correction');

  try {
    const validation = validateRequiredFields(req.body, [
      'sessionId',
      'correctionTranscript',
      'pageFields',
    ]);

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        missing: validation.missing,
      });
    }

    const { sessionId, correctionTranscript, pageFields, userId = 'default_user' } = req.body;

    if (!correctionTranscript.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Empty correction',
        message: 'Correction transcript cannot be empty',
      });
    }

    const safePageFields = filterSensitiveFields(pageFields);

    logger.info('Correction request received', { sessionId });

    // Call Python chain with correction_mode = true
    const chainPayload = {
      transcript: correctionTranscript,
      page_fields: safePageFields,
      session_id: sessionId,
      user_id: userId,
      correction_mode: true,
      user_response: correctionTranscript,
    };

    const result = await invokePythonChain(chainPayload);

    if (result.status === 'success') {
      logger.info('Correction applied successfully', { sessionId });
      const duration = Date.now() - startTime;
      logger.logResponse('form-fill-correction', 200, duration);

      return res.json({
        status: 'ready',
        payload: result.payload,
      });
    }

    if (result.status === 'needs_input') {
      const duration = Date.now() - startTime;
      logger.logResponse('form-fill-correction', 200, duration);

      return res.json({
        status: 'needs_input',
        question: result.question,
        partial: result.partial || {},
      });
    }

    // Error
    logger.error('Correction failed', {
      sessionId,
      message: result.message,
    });
    const duration = Date.now() - startTime;
    logger.logResponse('form-fill-correction', 500, duration);

    return res.status(500).json({
      success: false,
      error: 'Correction failed',
      message: 'Could not process correction',
    });

  } catch (error) {
    logger.error('Correction request failed', {
      error: error.message,
    });
    const duration = Date.now() - startTime;
    logger.logResponse('form-fill-correction', 500, duration);

    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Correction service is temporarily unavailable',
    });
  }
});

/**
 * DELETE /api/form-fill/session/:sessionId
 * 
 * Clears LangGraph MemorySaver state for a session.
 * Called when tab closes or user resets.
 * 
 * Response:
 *   - success: boolean
 */
router.delete('/form-fill/session/:sessionId', httpsOnly, authenticate, async (req, res) => {
  const startTime = Date.now();
  logger.logRequest(req, 'clear-session');

  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId',
      });
    }

    // Clear rate limit store for this session
    rateLimitStore.delete(sessionId);

    // Note: MemorySaver clears automatically on process restart.
    // For production, implement persistent storage (SqliteSaver)
    // and add actual deletion logic here.

    logger.info('Session cleared', { sessionId });
    const duration = Date.now() - startTime;
    logger.logResponse('clear-session', 200, duration);

    return res.json({
      success: true,
      message: 'Session cleared',
    });

  } catch (error) {
    logger.error('Clear session failed', {
      error: error.message,
    });
    const duration = Date.now() - startTime;
    logger.logResponse('clear-session', 500, duration);

    return res.status(500).json({
      success: false,
      error: 'Failed to clear session',
    });
  }
});

module.exports = router;
