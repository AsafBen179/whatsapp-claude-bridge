const axios = require('axios');
const logger = require('../utils/logger');
const configLoader = require('../utils/configLoader');

/**
 * Client wrapper for WhatsAppAPI
 */
class WhatsAppClient {
  constructor() {
    this.baseUrl = null;
    this.apiKey = null;
    this.client = null;
  }

  /**
   * Initialize the client with configuration
   */
  initialize(config) {
    this.baseUrl = config.whatsappApi.baseUrl;
    this.apiKey = config.whatsappApi.apiKey;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey
      }
    });

    logger.info(`WhatsAppClient initialized with base URL: ${this.baseUrl}`);
    return this;
  }

  /**
   * Check WhatsApp connection status
   */
  async getStatus() {
    try {
      const response = await this.client.get('/api/status');
      return response.data;
    } catch (error) {
      logger.error('Failed to get WhatsApp status', { error: error.message });
      throw error;
    }
  }

  /**
   * Send text message to a phone number or group
   */
  async sendMessage(to, message) {
    try {
      // Check if it's a group ID (ends with @g.us)
      const isGroup = to.includes('@g.us');

      const payload = isGroup
        ? { chatId: to, message }
        : { phoneNumber: to, message };

      const endpoint = isGroup ? '/api/send-to-chat' : '/api/send';

      const response = await this.client.post(endpoint, payload);

      logger.whatsapp('OUT', message, { to, isGroup });
      return response.data;
    } catch (error) {
      logger.error('Failed to send WhatsApp message', { error: error.message, to });
      throw error;
    }
  }

  /**
   * Send message to group by group ID
   */
  async sendToGroup(groupId, message) {
    try {
      const response = await this.client.post('/api/send-to-chat', {
        chatId: groupId,
        message
      });

      logger.whatsapp('OUT', message, { groupId });
      return response.data;
    } catch (error) {
      logger.error('Failed to send message to group', { error: error.message, groupId });
      throw error;
    }
  }

  /**
   * Reply to a specific message
   */
  async replyToMessage(messageId, message) {
    try {
      const response = await this.client.post('/api/messages/reply', {
        messageId,
        message
      });

      logger.whatsapp('REPLY', message, { messageId });
      return response.data;
    } catch (error) {
      logger.error('Failed to reply to message', { error: error.message, messageId });
      throw error;
    }
  }

  /**
   * Download media from a message
   */
  async downloadMedia(messageId) {
    try {
      const response = await this.client.get(`/api/download-media/${messageId}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to download media', { error: error.message, messageId });
      throw error;
    }
  }

  /**
   * Send media (image, document, etc.)
   */
  async sendMedia(to, mediaData, caption = '') {
    try {
      const isGroup = to.includes('@g.us');

      const payload = {
        phoneNumber: isGroup ? undefined : to,
        chatId: isGroup ? to : undefined,
        mediaBase64: mediaData.base64,
        mimetype: mediaData.mimetype,
        filename: mediaData.filename,
        caption
      };

      const response = await this.client.post('/api/send-media', payload);

      logger.whatsapp('MEDIA_OUT', `Media sent: ${mediaData.filename}`, { to });
      return response.data;
    } catch (error) {
      logger.error('Failed to send media', { error: error.message, to });
      throw error;
    }
  }

  /**
   * Get list of all chats
   */
  async getChats() {
    try {
      const response = await this.client.get('/api/chats');
      return response.data;
    } catch (error) {
      logger.error('Failed to get chats', { error: error.message });
      throw error;
    }
  }

  /**
   * Get chat info by ID
   */
  async getChatInfo(chatId) {
    try {
      const response = await this.client.get(`/api/chats/${encodeURIComponent(chatId)}/info`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get chat info', { error: error.message, chatId });
      throw error;
    }
  }

  /**
   * Get messages from a chat
   */
  async getMessages(chatId, limit = 50) {
    try {
      const response = await this.client.get(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
        params: { limit }
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to get messages', { error: error.message, chatId });
      throw error;
    }
  }

  /**
   * Check if a number is registered on WhatsApp
   */
  async checkNumber(phoneNumber) {
    try {
      const response = await this.client.post('/api/check-number', { phoneNumber });
      return response.data;
    } catch (error) {
      logger.error('Failed to check number', { error: error.message, phoneNumber });
      throw error;
    }
  }

  /**
   * Get client info (authenticated account)
   */
  async getClientInfo() {
    try {
      const response = await this.client.get('/api/client-info');
      return response.data;
    } catch (error) {
      logger.error('Failed to get client info', { error: error.message });
      throw error;
    }
  }

  /**
   * Send chunked message (for long texts)
   */
  async sendChunkedMessage(to, message, maxLength = 4000) {
    const chunks = this.splitMessage(message, maxLength);

    for (let i = 0; i < chunks.length; i++) {
      const chunkMessage = chunks.length > 1
        ? `[${i + 1}/${chunks.length}]\n${chunks[i]}`
        : chunks[i];

      await this.sendMessage(to, chunkMessage);

      // Small delay between chunks to maintain order
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return { success: true, chunks: chunks.length };
  }

  /**
   * Split message into chunks
   */
  splitMessage(message, maxLength) {
    if (message.length <= maxLength) {
      return [message];
    }

    const chunks = [];
    let remaining = message;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find a good break point
      let breakPoint = remaining.lastIndexOf('\n', maxLength);
      if (breakPoint === -1 || breakPoint < maxLength * 0.5) {
        breakPoint = remaining.lastIndexOf(' ', maxLength);
      }
      if (breakPoint === -1 || breakPoint < maxLength * 0.5) {
        breakPoint = maxLength;
      }

      chunks.push(remaining.substring(0, breakPoint));
      remaining = remaining.substring(breakPoint).trim();
    }

    return chunks;
  }
}

module.exports = new WhatsAppClient();
