require('dotenv').config();

const logger = require('./utils/logger');
const configLoader = require('./utils/configLoader');
const database = require('./db/database');
const { createApp } = require('./app');
const orchestrator = require('./core/BridgeOrchestrator');

async function main() {
  logger.info('='.repeat(50));
  logger.info('WhatsApp-Claude Bridge starting...');
  logger.info('='.repeat(50));

  try {
    // Load configuration
    configLoader.load();
    const config = configLoader.getConfig();

    logger.info('Configuration loaded', {
      basePath: config.basePath,
      whatsappApi: config.whatsappApi?.baseUrl,
      port: config.server?.port
    });

    // Initialize database (async for sql.js)
    await database.initialize();

    // Initialize orchestrator (initializes all other components)
    await orchestrator.initialize();

    // Create Express app
    const app = createApp(config);

    // Start server
    const port = config.server?.port || 3001;
    const host = config.server?.host || '127.0.0.1';

    const server = app.listen(port, host, () => {
      logger.info('='.repeat(50));
      logger.info(`Server running on http://${host}:${port}`);
      logger.info(`Webhook URL: http://${host}:${port}/webhook/whatsapp`);
      logger.info('='.repeat(50));

      // Signal PM2 that we're ready
      if (process.send) {
        process.send('ready');
      }
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);

      // Stop accepting new connections
      server.close(async () => {
        logger.info('HTTP server closed');

        // Shutdown orchestrator (terminates sessions)
        await orchestrator.shutdown();

        // Close database
        database.close();

        logger.info('Shutdown complete');
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      // Give time for logs to flush
      setTimeout(() => process.exit(1), 1000);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason: String(reason) });
    });

  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Start the application
main();
