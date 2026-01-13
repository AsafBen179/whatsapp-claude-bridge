const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const logger = require('./utils/logger');
const webhookHandler = require('./whatsapp/WebhookHandler');
const configLoader = require('./utils/configLoader');

/**
 * Create and configure Express application
 */
function createApp(config) {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: config.server?.allowedOrigins || '*'
  }));

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logging
  app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path}`, {
      ip: req.ip,
      contentLength: req.headers['content-length']
    });
    next();
  });

  // Health check (no auth)
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'whatsapp-claude-bridge',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // Webhook routes
  app.use('/webhook', webhookHandler.getRouter());

  // API routes
  app.get('/api/status', (req, res) => {
    const orchestrator = require('./core/BridgeOrchestrator');
    res.json({
      status: 'running',
      stats: orchestrator.getStats()
    });
  });

  app.get('/api/sessions', (req, res) => {
    const sessionManager = require('./claude/SessionManager');
    res.json({
      sessions: sessionManager.getAllSessions().map(s => ({
        id: s.sessionId,
        projectPath: s.projectPath,
        status: s.status,
        startedAt: s.startedAt,
        lastActivity: s.lastActivity
      }))
    });
  });

  app.get('/api/queue', (req, res) => {
    const commandQueue = require('./queue/CommandQueue');
    res.json({
      stats: commandQueue.getStats()
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    logger.error('Express error', { error: err.message, stack: err.stack });
    res.status(500).json({
      error: 'Internal server error',
      message: err.message
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not found',
      path: req.path
    });
  });

  return app;
}

module.exports = { createApp };
