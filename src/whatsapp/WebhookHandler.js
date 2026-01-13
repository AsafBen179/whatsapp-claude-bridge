const express = require('express');
const logger = require('../utils/logger');
const eventBus = require('../core/EventBus');
const messageParser = require('./MessageParser');
const whatsappClient = require('./WhatsAppClient');

/**
 * Handle incoming webhooks from WhatsAppAPI
 */
class WebhookHandler {
  constructor() {
    this.router = express.Router();
    this.groupNameCache = new Map(); // Cache group names
    this.setupRoutes();
  }

  /**
   * Setup webhook routes
   */
  setupRoutes() {
    this.router.post('/whatsapp', this.handleWhatsAppWebhook.bind(this));
    this.router.get('/health', this.handleHealthCheck.bind(this));
  }

  /**
   * Get Express router
   */
  getRouter() {
    return this.router;
  }

  /**
   * Handle incoming WhatsApp webhook
   */
  async handleWhatsAppWebhook(req, res) {
    try {
      const payload = req.body;

      logger.info('Webhook received', { event: payload.event, chatName: payload.payload?.chatName, from: payload.payload?.from });

      // Parse the message
      const parsed = messageParser.parseWebhookPayload(payload);

      // Ignore non-relevant messages
      if (parsed.type === 'ignored') {
        logger.info('Message ignored', { reason: parsed.reason });
        return res.json({ success: true, ignored: true });
      }

      // For group messages, get group name and check if it's a project group
      if (parsed.isGroupMessage) {
        // Prefer chatName from webhook payload, fallback to API call
        const groupName = payload.payload?.chatName || await this.getGroupName(parsed.groupId);
        parsed.groupName = groupName;

        // Check if this is a project group
        const projectName = messageParser.extractProjectName(groupName);
        if (!projectName) {
          logger.info('Not a project group', { groupName, groupId: parsed.groupId });
          return res.json({ success: true, ignored: true, reason: 'Not a project group' });
        }

        parsed.projectName = projectName;
      } else {
        // Direct messages - could be admin commands or project-agnostic
        parsed.projectName = null;
      }

      // Emit the message received event
      eventBus.emitEvent(eventBus.constructor.Events.MESSAGE_RECEIVED, parsed);

      // Respond to webhook immediately
      res.json({ success: true, received: true });

    } catch (error) {
      logger.error('Webhook handling error', { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get group name from group ID (with caching)
   */
  async getGroupName(groupId) {
    // Check cache first
    if (this.groupNameCache.has(groupId)) {
      return this.groupNameCache.get(groupId);
    }

    try {
      // Get from WhatsApp API
      const response = await whatsappClient.getChatInfo(groupId);
      // Response structure: { success: true, chat: { id, name, isGroup, ... } }
      const chatInfo = response?.chat || response;
      const groupName = chatInfo?.name || chatInfo?.subject || 'Unknown Group';

      logger.debug('Got group name from WhatsApp API', { groupId, groupName, response });

      // Cache for 5 minutes
      this.groupNameCache.set(groupId, groupName);
      setTimeout(() => this.groupNameCache.delete(groupId), 5 * 60 * 1000);

      return groupName;
    } catch (error) {
      logger.error('Failed to get group name', { error: error.message, groupId });
      return 'Unknown Group';
    }
  }

  /**
   * Clear group name cache
   */
  clearGroupCache(groupId = null) {
    if (groupId) {
      this.groupNameCache.delete(groupId);
    } else {
      this.groupNameCache.clear();
    }
  }

  /**
   * Health check endpoint
   */
  handleHealthCheck(req, res) {
    res.json({
      status: 'ok',
      service: 'whatsapp-claude-bridge',
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = new WebhookHandler();
