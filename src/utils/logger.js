const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const logsDir = path.join(__dirname, '..', '..', 'logs');

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.json()
);

// Handle EPIPE errors gracefully - don't exit, just ignore
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Silently ignore - console is disconnected
  }
});
process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Silently ignore - console is disconnected
  }
});

// Check if running in a real terminal
const isTTY = process.stdout.isTTY;

// Build transports array
const transports = [];

// Only add console transport if we're in a real terminal
if (isTTY) {
  transports.push(new winston.transports.Console({
    format: consoleFormat,
    handleExceptions: true
  }));
}

// Always add file transports
transports.push(new winston.transports.DailyRotateFile({
  filename: path.join(logsDir, 'bridge-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '10m',
  maxFiles: '14d',
  format: fileFormat
}));

// Separate error log
transports.push(new winston.transports.DailyRotateFile({
  filename: path.join(logsDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '10m',
  maxFiles: '30d',
  level: 'error',
  format: fileFormat
}));

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports
});

// Add convenience methods
logger.session = (sessionId, message, meta = {}) => {
  logger.info(message, { sessionId, ...meta });
};

logger.command = (projectId, command, meta = {}) => {
  logger.info(`Command: ${command.substring(0, 100)}...`, { projectId, ...meta });
};

logger.permission = (action, description, meta = {}) => {
  logger.info(`Permission ${action}: ${description}`, { type: 'permission', ...meta });
};

logger.whatsapp = (direction, message, meta = {}) => {
  logger.debug(`WhatsApp ${direction}: ${message.substring(0, 50)}...`, { type: 'whatsapp', ...meta });
};

module.exports = logger;
