const express = require('express');
const router = express.Router();
const axios = require('axios');

// spaCy NLP server configuration
const SPACY_SERVER_URL = process.env.SPACY_SERVER_URL || 'http://localhost:5001';

/**
 * Parse voice command using spaCy NLP
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

    // Call spaCy server
    const response = await axios.post(`${SPACY_SERVER_URL}/parse`, {
      text: text.trim()
    }, {
      timeout: 5000, // 5 second timeout
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Return parsed command
    return res.json(response.data);

  } catch (error) {
    console.error('Error parsing command:', error.message);

    // Handle spaCy server connection errors
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        error: 'NLP service unavailable',
        message: 'spaCy server is not running. Please start it on port 5001'
      });
    }

    // Handle timeout
    if (error.code === 'ETIMEDOUT') {
      return res.status(504).json({
        success: false,
        error: 'NLP service timeout',
        message: 'spaCy server took too long to respond'
      });
    }

    // Other errors
    return res.status(500).json({
      success: false,
      error: 'Failed to parse command',
      message: error.message
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

    // Call spaCy server
    const response = await axios.post(`${SPACY_SERVER_URL}/batch-parse`, {
      commands
    }, {
      timeout: 10000, // 10 second timeout for batch
      headers: {
        'Content-Type': 'application/json'
      }
    });

    return res.json(response.data);

  } catch (error) {
    console.error('Error in batch parsing:', error.message);

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
