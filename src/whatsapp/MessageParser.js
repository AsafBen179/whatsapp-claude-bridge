const logger = require('../utils/logger');

/**
 * Parse incoming WhatsApp messages and extract relevant information
 */
class MessageParser {
  constructor() {
    this.projectPattern = /^Project\s+(.+)$/i;
  }

  /**
   * Parse webhook payload from WhatsAppAPI
   */
  parseWebhookPayload(payload) {
    const { event, payload: messageData } = payload;

    if (event !== 'message') {
      return { type: 'ignored', reason: 'Not a message event' };
    }

    // Extract basic message info
    const parsed = {
      messageId: messageData.id,
      from: messageData.from,
      to: messageData.to,
      body: messageData.body || '',
      timestamp: messageData.timestamp,
      fromMe: messageData.fromMe,
      isGroupMessage: messageData.from?.includes('@g.us') || messageData.isGroupMsg,
      author: messageData.author,
      authorPhone: this.extractPhone(messageData.author),
      senderName: messageData.notifyName || 'Unknown',
      type: messageData.type,
      hasMedia: messageData.hasMedia || false,
      mediaType: messageData.mediaType,
      mimetype: messageData.mimetype
    };

    // Skip own messages
    if (parsed.fromMe) {
      return { type: 'ignored', reason: 'Own message' };
    }

    // Extract group info if group message
    if (parsed.isGroupMessage) {
      parsed.groupId = parsed.from;
      parsed.senderPhone = parsed.authorPhone;
    } else {
      parsed.senderPhone = this.extractPhone(parsed.from);
    }

    // Determine message type
    const messageType = this.determineMessageType(parsed);
    parsed.messageType = messageType.type;
    parsed.messageData = messageType.data;

    return parsed;
  }

  /**
   * Determine the type of message (command, slash command, admin, image, etc.)
   */
  determineMessageType(parsed) {
    const body = parsed.body.trim();

    // Check for admin command (! prefix)
    if (body.startsWith('!')) {
      return {
        type: 'admin_command',
        data: this.parseAdminCommand(body)
      };
    }

    // Check for slash command (/ prefix)
    if (body.startsWith('/')) {
      return {
        type: 'slash_command',
        data: { command: body }
      };
    }

    // Check for approval response
    if (this.isApprovalResponse(body)) {
      return {
        type: 'approval_response',
        data: {
          approved: this.isApprovalPositive(body),
          rawResponse: body
        }
      };
    }

    // Check for image
    if (parsed.hasMedia && parsed.mediaType === 'image') {
      return {
        type: 'image',
        data: {
          messageId: parsed.messageId,
          mimetype: parsed.mimetype,
          caption: body
        }
      };
    }

    // Check for other media
    if (parsed.hasMedia) {
      return {
        type: 'media',
        data: {
          messageId: parsed.messageId,
          mediaType: parsed.mediaType,
          mimetype: parsed.mimetype,
          caption: body
        }
      };
    }

    // Regular command with potential @ mentions
    const hasMentions = body.includes('@') && !body.includes('@g.us');

    return {
      type: 'command',
      data: {
        command: body,
        hasMentions,
        mentions: hasMentions ? this.extractMentions(body) : []
      }
    };
  }

  /**
   * Parse admin command
   */
  parseAdminCommand(body) {
    const parts = body.substring(1).trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    return {
      command,
      args,
      raw: body
    };
  }

  /**
   * Extract project name from group name
   */
  extractProjectName(groupName) {
    if (!groupName) return null;

    const match = groupName.match(this.projectPattern);
    if (match) {
      return match[1].trim();
    }
    return null;
  }

  /**
   * Check if group name starts with "Project "
   */
  isProjectGroup(groupName) {
    if (!groupName) return false;
    return this.projectPattern.test(groupName);
  }

  /**
   * Extract phone number from WhatsApp ID
   */
  extractPhone(whatsappId) {
    if (!whatsappId) return null;
    // Format: 972501234567@c.us or 972501234567@g.us
    const match = whatsappId.match(/^(\d+)@/);
    return match ? match[1] : null;
  }

  /**
   * Extract @ mentions from message body
   */
  extractMentions(body) {
    const mentions = [];

    // File mentions: @file.js, @src/index.ts
    const fileMentionPattern = /@([\w\-./\\]+\.\w+)/g;
    let match;
    while ((match = fileMentionPattern.exec(body)) !== null) {
      mentions.push({ type: 'file', value: match[1] });
    }

    // Folder mentions: @src/, @components/
    const folderMentionPattern = /@([\w\-./\\]+\/)/g;
    while ((match = folderMentionPattern.exec(body)) !== null) {
      mentions.push({ type: 'folder', value: match[1] });
    }

    // URL mentions: @https://...
    const urlMentionPattern = /@(https?:\/\/[^\s]+)/g;
    while ((match = urlMentionPattern.exec(body)) !== null) {
      mentions.push({ type: 'url', value: match[1] });
    }

    // Special mentions: @git, @problems
    const specialMentions = ['git', 'problems', 'codebase', 'terminal'];
    for (const special of specialMentions) {
      if (body.includes(`@${special}`)) {
        mentions.push({ type: 'special', value: special });
      }
    }

    return mentions;
  }

  /**
   * Check if message is an approval response
   */
  isApprovalResponse(body) {
    const approvalPatterns = [
      /^(y|n|yes|no|approve|reject|cancel|אשר|דחה|כן|לא|ביטול|אישור|ok)$/i
    ];

    return approvalPatterns.some(pattern => pattern.test(body.trim()));
  }

  /**
   * Check if approval response is positive
   */
  isApprovalPositive(body) {
    const positiveResponses = ['y', 'yes', 'approve', 'אשר', 'כן', 'אישור', 'ok'];
    return positiveResponses.includes(body.trim().toLowerCase());
  }

  /**
   * Determine operation type (read/write) from command text
   */
  classifyOperation(commandText, config) {
    const text = commandText.toLowerCase();

    // Check blocked patterns first
    const blockedPatterns = config.permissions?.blockedPatterns || [];
    for (const pattern of blockedPatterns) {
      if (new RegExp(pattern, 'i').test(commandText)) {
        return 'blocked';
      }
    }

    // Check read patterns
    const readPatterns = config.permissions?.readOperationPatterns || [];
    for (const pattern of readPatterns) {
      if (new RegExp(pattern, 'i').test(text)) {
        return 'read';
      }
    }

    // Check write patterns
    const writePatterns = config.permissions?.writeOperationPatterns || [];
    for (const pattern of writePatterns) {
      if (new RegExp(pattern, 'i').test(text)) {
        return 'write';
      }
    }

    return 'unknown';
  }
}

module.exports = new MessageParser();
