const logger = require('../utils/logger');
const eventBus = require('../core/EventBus');

/**
 * Process and buffer Claude Code output
 */
class OutputProcessor {
  constructor() {
    this.buffers = new Map(); // sessionId -> buffer info
    this.config = null;
  }

  /**
   * Initialize with configuration
   */
  initialize(config) {
    this.config = config;
    this.maxBufferSize = config.claudeCode?.outputBufferSize || 1048576; // 1MB default

    // Subscribe to output events
    this.setupEventListeners();

    return this;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    eventBus.subscribe(eventBus.constructor.Events.SESSION_OUTPUT, (data) => {
      this.handleOutput(data);
    });

    eventBus.subscribe(eventBus.constructor.Events.SESSION_TERMINATED, (data) => {
      this.clearBuffer(data.sessionId);
    });
  }

  /**
   * Handle output from a session
   */
  handleOutput(data) {
    const { sessionId, output, timestamp } = data;

    // Get or create buffer
    let buffer = this.buffers.get(sessionId);
    if (!buffer) {
      buffer = {
        content: '',
        chunks: [],
        startTime: timestamp,
        lastUpdate: timestamp,
        lineCount: 0
      };
      this.buffers.set(sessionId, buffer);
    }

    // Add to buffer
    buffer.content += output;
    buffer.chunks.push({ output, timestamp });
    buffer.lastUpdate = timestamp;
    buffer.lineCount += (output.match(/\n/g) || []).length;

    // Truncate if too large
    if (buffer.content.length > this.maxBufferSize) {
      buffer.content = buffer.content.substring(buffer.content.length - this.maxBufferSize);
      logger.warn('Output buffer truncated', { sessionId });
    }

    // Detect and emit special patterns
    this.detectPatterns(sessionId, output);
  }

  /**
   * Detect special patterns in output
   */
  detectPatterns(sessionId, output) {
    // Detect image paths
    const imagePaths = this.extractImagePaths(output);
    if (imagePaths.length > 0) {
      eventBus.emitEvent(eventBus.constructor.Events.IMAGE_RECEIVED, {
        sessionId,
        paths: imagePaths
      });
    }

    // Detect errors
    if (this.detectError(output)) {
      logger.warn('Error detected in output', { sessionId, output: output.substring(0, 200) });
    }
  }

  /**
   * Extract image paths from output
   */
  extractImagePaths(output) {
    const patterns = [
      /saved (?:to|as|at) ['"]?([^'"]+\.(png|jpg|jpeg|gif|webp|svg))['"]?/gi,
      /screenshot saved: ([^\s]+)/gi,
      /created image: ([^\s]+)/gi,
      /wrote (?:image|file) ['"]?([^'"]+\.(png|jpg|jpeg|gif|webp))['"]?/gi
    ];

    const paths = [];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        paths.push(match[1]);
      }
    }

    return paths;
  }

  /**
   * Detect error patterns
   */
  detectError(output) {
    const errorPatterns = [
      /error:/i,
      /exception:/i,
      /failed:/i,
      /fatal:/i,
      /traceback/i,
      /^\s*at\s+.*:\d+:\d+/m // Stack trace
    ];

    return errorPatterns.some(pattern => pattern.test(output));
  }

  /**
   * Get current buffer for a session
   */
  getBuffer(sessionId) {
    return this.buffers.get(sessionId);
  }

  /**
   * Get buffer content as string
   */
  getBufferContent(sessionId) {
    const buffer = this.buffers.get(sessionId);
    return buffer ? buffer.content : '';
  }

  /**
   * Clear buffer for a session
   */
  clearBuffer(sessionId) {
    this.buffers.delete(sessionId);
  }

  /**
   * Get buffer and clear it
   */
  flushBuffer(sessionId) {
    const buffer = this.buffers.get(sessionId);
    this.clearBuffer(sessionId);
    return buffer ? buffer.content : '';
  }

  /**
   * Wait for output to stabilize (no new output for specified time)
   */
  async waitForStableOutput(sessionId, stableTimeMs = 2000, maxWaitMs = 60000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const buffer = this.buffers.get(sessionId);
      if (!buffer) {
        await this.sleep(500);
        continue;
      }

      const timeSinceLastUpdate = Date.now() - buffer.lastUpdate;
      if (timeSinceLastUpdate >= stableTimeMs) {
        return buffer.content;
      }

      await this.sleep(500);
    }

    // Return whatever we have after max wait
    const buffer = this.buffers.get(sessionId);
    return buffer ? buffer.content : '';
  }

  /**
   * Wait for specific pattern in output
   */
  async waitForPattern(sessionId, pattern, maxWaitMs = 30000) {
    const startTime = Date.now();
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

    while (Date.now() - startTime < maxWaitMs) {
      const buffer = this.buffers.get(sessionId);
      if (buffer && regex.test(buffer.content)) {
        return true;
      }
      await this.sleep(500);
    }

    return false;
  }

  /**
   * Extract the last meaningful output (removing prompts, etc.)
   */
  extractMeaningfulOutput(sessionId) {
    const buffer = this.buffers.get(sessionId);
    if (!buffer) return '';

    let content = buffer.content;

    // Remove common prompt patterns
    content = content.replace(/^>\s*$/gm, '');
    content = content.replace(/^\s*claude>\s*/gm, '');

    // Remove ANSI escape codes
    content = content.replace(/\x1b\[[0-9;]*m/g, '');

    // Remove leading/trailing whitespace
    content = content.trim();

    return content;
  }

  /**
   * Get output statistics
   */
  getStats(sessionId) {
    const buffer = this.buffers.get(sessionId);
    if (!buffer) return null;

    return {
      totalLength: buffer.content.length,
      lineCount: buffer.lineCount,
      chunkCount: buffer.chunks.length,
      duration: buffer.lastUpdate - buffer.startTime,
      lastUpdate: buffer.lastUpdate
    };
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new OutputProcessor();
