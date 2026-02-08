const express = require('express');
const router = express.Router();
const axios = require('axios');

// NLP Engine Configuration
const NLP_ENGINE = process.env.NLP_ENGINE || 'spacy'; // 'spacy' or 'mistral'
const SPACY_SERVER_URL = process.env.SPACY_SERVER_URL || 'http://localhost:5001';
const MISTRAL_SERVER_URL = process.env.MISTRAL_SERVER_URL || 'http://localhost:5002';
const NLP_TIMEOUT = parseInt(process.env.NLP_TIMEOUT || '30000');

// Log active NLP engine
console.log(`🧠 NLP Engine: ${NLP_ENGINE.toUpperCase()}`);
console.log(`📡 Server URL: ${NLP_ENGINE === 'mistral' ? MISTRAL_SERVER_URL : SPACY_SERVER_URL}`);

// Get appropriate server URL
function getNLPServerUrl() {
  return NLP_ENGINE === 'mistral' ? MISTRAL_SERVER_URL : SPACY_SERVER_URL;
}

// Get engine name
function getEngineName() {
  return NLP_ENGINE === 'mistral' ? 'Mistral' : 'spaCy';
}

/**
 * Parse voice command using configured NLP engine (spaCy or Mistral)
 * POST /api/voice/parse
 * Body: { "text": "show all buttons" }
 */
router.post('/parse', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing or empty "text" field'
      });
    }

    // Call NLP server (spaCy or Mistral)
    const nlpServerUrl = getNLPServerUrl();
    const response = await axios.post(`${nlpServerUrl}/parse`, {
      text: text.trim()
    }, {
      timeout: NLP_TIMEOUT,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add engine info to response
    const result = {
      ...response.data,
      engine: NLP_ENGINE,
      success: true
    };

    return res.json(result);

  } catch (error) {
    console.error(`Error parsing command with ${getEngineName()}:`, error.message);
    const nlpServerUrl = getNLPServerUrl();

    // Handle server connection errors
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        error: 'NLP service unavailable',
        message: `${getEngineName()} server is not running at ${nlpServerUrl}`,
        engine: NLP_ENGINE
      });
    }

    // Handle timeout
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return res.status(504).json({
        success: false,
        error: 'NLP service timeout',
        message: `${getEngineName()} server took too long to respond`,
        engine: NLP_ENGINE
      });
    }

    // Other errors
    return res.status(500).json({
      success: false,
      error: 'Failed to parse command',
      message: error.message,
      engine: NLP_ENGINE
    });
  }
});

/**
 * Parse multiple commands at once
 * POST /api/voice/batch-parse
 * Body: { "commands": ["show buttons", "scroll down"] }
 */
router.post('/batch-parse', async (req, res) => {
  try {
    const { commands } = req.body;

    if (!commands || !Array.isArray(commands)) {
      return res.status(400).json({
        success: false,
        error: '"commands" must be an array'
      });
    }

    // Call NLP server
    const nlpServerUrl = getNLPServerUrl();
    const response = await axios.post(`${nlpServerUrl}/batch-parse`, {
      commands
    }, {
      timeout: NLP_TIMEOUT * 2, // Double timeout for batch
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = {
      ...response.data,
      engine: NLP_ENGINE
    };

    return res.json(result);

  } catch (error) {
    console.error(`Error in batch parsing with ${getEngineName()}:`, error.message);

    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        error: 'NLP service unavailable'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to parse commands',
      message: error.message
    });
  }
});

/**
 * Check NLP service health
 * GET /api/voice/nlp-health
 */
router.get('/nlp-health', async (req, res) => {
  try {
    const response = await axios.get(`${SPACY_SERVER_URL}/health`, {
      timeout: 3000
    });

    return res.json({
      success: true,
      nlp_service: response.data
    });

  } catch (error) {
    return res.status(503).json({
      success: false,
      error: 'NLP service unavailable',
      message: error.message
    });
  }
});

/**
 * Intelligent navigation with element matching
 * POST /api/voice/navigate
 * Body: { 
 *   "command": "click login button",
 *   "page_elements": [
 *     {"id": 0, "text": "Sign In", "type": "button", "selector": "#btn"}
 *   ]
 * }
 */
router.post('/navigate', async (req, res) => {
  try {
    const { command, page_elements } = req.body;

    if (!command || !command.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing or empty "command" field'
      });
    }

    // Call spaCy server navigate endpoint
    const response = await axios.post(`${SPACY_SERVER_URL}/navigate`, {
      command: command.trim(),
      page_elements: page_elements || []
    }, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    return res.json(response.data);

  } catch (error) {
    console.error('Error in navigate:', error.message);

    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        error: 'NLP service unavailable',
        message: 'spaCy server is not running. Please start it on port 5001'
      });
    }

    if (error.code === 'ETIMEDOUT') {
      return res.status(504).json({
        success: false,
        error: 'NLP service timeout'
      });
    }

    // Forward any error response from spaCy server
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to process navigation',
      message: error.message
    });
  }
});

module.exports = router;
