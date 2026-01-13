const logger = require('../utils/logger');
const eventBus = require('../core/EventBus');
const whatsappClient = require('./WhatsAppClient');
const configLoader = require('../utils/configLoader');

/**
 * Send formatted responses back to WhatsApp
 */
class ResponseSender {
  constructor() {
    this.config = null;
  }

  /**
   * Initialize with configuration
   */
  initialize(config) {
    this.config = config;
    this.formatting = config.messageFormatting || {};
    return this;
  }

  /**
   * Send a response to a group
   */
  async sendToGroup(groupId, message, options = {}) {
    try {
      const formatted = this.formatMessage(message, options);

      eventBus.emitEvent(eventBus.constructor.Events.RESPONSE_SENDING, {
        groupId,
        message: formatted
      });

      let result;
      if (formatted.length > (this.formatting.maxMessageLength || 4000)) {
        result = await whatsappClient.sendChunkedMessage(groupId, formatted);
      } else {
        result = await whatsappClient.sendToGroup(groupId, formatted);
      }

      eventBus.emitEvent(eventBus.constructor.Events.RESPONSE_SENT, {
        groupId,
        messageId: result.messageId
      });

      return result;
    } catch (error) {
      logger.error('Failed to send response', { error: error.message, groupId });
      eventBus.emitEvent(eventBus.constructor.Events.RESPONSE_FAILED, {
        groupId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Send success message
   */
  async sendSuccess(groupId, message) {
    const prefix = this.formatting.successPrefix || '✅ ';
    return this.sendToGroup(groupId, `${prefix}${message}`);
  }

  /**
   * Send error message
   */
  async sendError(groupId, message) {
    const prefix = this.formatting.errorPrefix || '❌ ';
    return this.sendToGroup(groupId, `${prefix}${message}`);
  }

  /**
   * Send pending/processing message
   */
  async sendPending(groupId, message) {
    const prefix = this.formatting.pendingPrefix || '⏳ ';
    return this.sendToGroup(groupId, `${prefix}${message}`);
  }

  /**
   * Send approval request
   */
  async sendApprovalRequest(groupId, description, timeoutSeconds) {
    const prefix = this.formatting.approvalPrefix || '⚠️ ';
    const timeoutMinutes = Math.ceil(timeoutSeconds / 60);

    const message = `${prefix}Claude asks permission:

${description}

Reply *Y* or *N* (${timeoutMinutes} min timeout)`;

    return this.sendToGroup(groupId, message);
  }

  /**
   * Send OAuth login request
   */
  async sendOAuthRequest(groupId, oauthUrl) {
    const message = `🔐 *Claude requires login!*

Open this URL on your phone/computer:
${oauthUrl}

After logging in, send the code back here.`;

    return this.sendToGroup(groupId, message);
  }

  /**
   * Send progress update
   */
  async sendProgress(groupId, currentStep, totalSteps, description) {
    const percentage = Math.round((currentStep / totalSteps) * 100);
    const progressBar = this.createProgressBar(percentage);

    const message = `⏳ Progress: ${currentStep}/${totalSteps} (${percentage}%)
${progressBar}
${description}`;

    return this.sendToGroup(groupId, message);
  }

  /**
   * Send queue position notification
   */
  async sendQueuePosition(groupId, position, estimatedWait = null) {
    let message = `📋 Your command is *#${position}* in queue`;

    if (estimatedWait) {
      message += `\nEstimated wait: ~${estimatedWait}`;
    }

    return this.sendToGroup(groupId, message);
  }

  /**
   * Send session status
   */
  async sendSessionStatus(groupId, status, details = {}) {
    let emoji;
    switch (status) {
      case 'active': emoji = '🟢'; break;
      case 'starting': emoji = '🟡'; break;
      case 'error': emoji = '🔴'; break;
      default: emoji = '⚪';
    }

    let message = `${emoji} Session Status: *${status}*`;

    if (details.projectName) {
      message += `\nProject: ${details.projectName}`;
    }
    if (details.uptime) {
      message += `\nUptime: ${details.uptime}`;
    }
    if (details.error) {
      message += `\nError: ${details.error}`;
    }

    return this.sendToGroup(groupId, message);
  }

  /**
   * Send command result summary
   */
  async sendCommandResult(groupId, result) {
    const prefix = result.success
      ? (this.formatting.successPrefix || '✅ ')
      : (this.formatting.errorPrefix || '❌ ');

    let message = prefix;

    // Add the summary or error
    if (result.success) {
      message += result.summary || 'Command completed';
    } else {
      message += result.error || 'Command failed';
    }

    // Add execution time on new line
    if (result.executionTime) {
      message += `\n⏱️ ${this.formatDuration(result.executionTime)}`;
    }

    return this.sendToGroup(groupId, message);
  }

  /**
   * Send admin response
   */
  async sendAdminResponse(groupId, response) {
    return this.sendToGroup(groupId, `🔧 Admin: ${response}`);
  }

  /**
   * Format message with optional styling
   */
  formatMessage(message, options = {}) {
    let formatted = message;

    // Add code block formatting if it looks like code
    if (options.codeBlock || this.looksLikeCode(message)) {
      formatted = '```\n' + message + '\n```';
    }

    // Truncate if too long
    const maxLength = options.maxLength || this.formatting.maxMessageLength || 4000;
    if (formatted.length > maxLength) {
      formatted = formatted.substring(0, maxLength - 100) + '\n\n... [truncated]';
    }

    return formatted;
  }

  /**
   * Check if text looks like code
   */
  looksLikeCode(text) {
    const codeIndicators = [
      /^(function|const|let|var|class|import|export|async|await)\s/m,
      /^\s*(if|for|while|switch)\s*\(/m,
      /[{};]\s*$/m,
      /^\s*\/\//m,
      /^\s*#\s*(include|define|ifdef)/m
    ];

    return codeIndicators.some(pattern => pattern.test(text));
  }

  /**
   * Create a text progress bar
   */
  createProgressBar(percentage, length = 10) {
    const filled = Math.round(percentage / 100 * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * Format duration in human readable form
   */
  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
  }
}

module.exports = new ResponseSender();
