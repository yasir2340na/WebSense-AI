const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Import routes
const voiceRoutes = require('./routes/voice');
const healthRoutes = require('./routes/health');

// Routes
app.use('/api/voice', voiceRoutes);
app.use('/health', healthRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'WebSense-AI Backend API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      voiceParse: '/api/voice/parse',
      voiceNavigate: '/api/voice/navigate',
      voiceBatchParse: '/api/voice/batch-parse',
      nlpHealth: '/api/voice/nlp-health'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n🚀 WebSense-AI Backend Server');
  console.log('=' .repeat(50));
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log(`✅ Voice Parse: http://localhost:${PORT}/api/voice/parse`);
  console.log(`✅ Voice Navigate: http://localhost:${PORT}/api/voice/navigate`);
  console.log('=' .repeat(50));
  console.log('\n💡 Make sure spaCy NLP server is running on port 5001');
  console.log('   Start it with: cd backend/nlp && python spacy_server.py\n');
});

module.exports = app;
