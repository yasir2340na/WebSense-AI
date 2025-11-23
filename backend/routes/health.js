const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'WebSense-AI Backend',
    uptime: process.uptime()
  });
});

module.exports = router;
