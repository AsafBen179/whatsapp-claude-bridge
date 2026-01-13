const fs = require('fs').promises;
const path = require('path');
const { v4: uuid } = require('uuid');
const logger = require('../utils/logger');
const eventBus = require('../core/EventBus');
const whatsappClient = require('../whatsapp/WhatsAppClient');

/**
 * Handle image transfer between WhatsApp and Claude Code
 */
class ImageHandler {
  constructor() {
    this.config = null;
    this.tempDir = null;
  }

  /**
   * Initialize with configuration
   */
  initialize(config) {
    this.config = config;
    this.tempDir = path.join(config.basePath, '_bridge', 'temp');

    // Ensure temp directory exists
    this.ensureTempDir();

    // Subscribe to image events
    this.setupEventListeners();

    return this;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    eventBus.subscribe(eventBus.constructor.Events.IMAGE_RECEIVED, async (data) => {
      // This is for images detected in Claude output
      await this.handleClaudeOutputImages(data);
    });
  }

  /**
   * Ensure temp directory exists
   */
  async ensureTempDir() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        logger.error('Failed to create temp directory', { error: error.message });
      }
    }
  }

  /**
   * Handle image received from WhatsApp
   * Download and save locally for Claude
   */
  async handleIncomingImage(messageId, groupId, caption = '') {
    logger.info('Handling incoming image', { messageId, groupId });

    try {
      // Download media from WhatsApp API
      const mediaData = await whatsappClient.downloadMedia(messageId);

      if (!mediaData || !mediaData.data) {
        throw new Error('Failed to download media');
      }

      // Determine file extension from mimetype
      const ext = this.getExtensionFromMimetype(mediaData.mimetype);
      const filename = `${uuid()}.${ext}`;
      const localPath = path.join(this.tempDir, filename);

      // Save to local file
      await fs.writeFile(localPath, mediaData.data, 'base64');

      logger.info('Image saved locally', { localPath, size: mediaData.filesize });

      eventBus.emitEvent(eventBus.constructor.Events.IMAGE_DOWNLOADED, {
        messageId,
        localPath,
        mimetype: mediaData.mimetype,
        caption
      });

      return {
        success: true,
        localPath,
        mimetype: mediaData.mimetype,
        caption
      };
    } catch (error) {
      logger.error('Failed to handle incoming image', { error: error.message, messageId });
      throw error;
    }
  }

  /**
   * Handle images detected in Claude Code output
   * Send them to WhatsApp
   */
  async handleClaudeOutputImages(data) {
    const { sessionId, paths } = data;

    for (const imagePath of paths) {
      try {
        // Check if file exists
        await fs.access(imagePath);

        logger.info('Detected image in Claude output', { sessionId, imagePath });

        // Would need to know which group to send to
        // This will be handled by the orchestrator
        eventBus.emitEvent(eventBus.constructor.Events.IMAGE_SENT, {
          sessionId,
          path: imagePath,
          status: 'detected'
        });
      } catch (error) {
        logger.debug('Image path not accessible', { imagePath });
      }
    }
  }

  /**
   * Send image to WhatsApp group
   */
  async sendImageToWhatsApp(groupId, imagePath, caption = '') {
    try {
      // Read file
      const imageData = await fs.readFile(imagePath);
      const base64 = imageData.toString('base64');

      // Get mimetype from extension
      const ext = path.extname(imagePath).slice(1).toLowerCase();
      const mimetype = this.getMimetypeFromExtension(ext);

      // Send via WhatsApp API
      await whatsappClient.sendMedia(groupId, {
        base64,
        mimetype,
        filename: path.basename(imagePath)
      }, caption);

      logger.info('Image sent to WhatsApp', { groupId, imagePath });

      eventBus.emitEvent(eventBus.constructor.Events.IMAGE_SENT, {
        groupId,
        path: imagePath,
        status: 'sent'
      });

      return { success: true };
    } catch (error) {
      logger.error('Failed to send image to WhatsApp', { error: error.message, groupId });
      throw error;
    }
  }

  /**
   * Build Claude command with image reference
   */
  buildImageCommand(localPath, caption) {
    // Claude Code can analyze images when given a path
    const prompt = caption || 'Analyze this image';
    return `${prompt}\n\n[Attached image: ${localPath}]`;
  }

  /**
   * Cleanup old temp files
   */
  async cleanupOldFiles(maxAgeMs = 24 * 60 * 60 * 1000) {
    try {
      const files = await fs.readdir(this.tempDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = await fs.stat(filePath);
        const age = now - stats.mtimeMs;

        if (age > maxAgeMs) {
          await fs.unlink(filePath);
          logger.debug('Cleaned up old temp file', { file });
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup temp files', { error: error.message });
    }
  }

  /**
   * Get file extension from mimetype
   */
  getExtensionFromMimetype(mimetype) {
    const mimeToExt = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp'
    };

    return mimeToExt[mimetype] || 'jpg';
  }

  /**
   * Get mimetype from file extension
   */
  getMimetypeFromExtension(ext) {
    const extToMime = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'bmp': 'image/bmp'
    };

    return extToMime[ext] || 'image/jpeg';
  }

  /**
   * Check if file is an image
   */
  isImageFile(filePath) {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
    const ext = path.extname(filePath).toLowerCase();
    return imageExtensions.includes(ext);
  }
}

module.exports = new ImageHandler();
