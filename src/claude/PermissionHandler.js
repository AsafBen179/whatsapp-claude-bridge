const logger = require('../utils/logger');
const eventBus = require('../core/EventBus');
const configLoader = require('../utils/configLoader');

/**
 * Handle permission prompts from Claude Code
 */
class PermissionHandler {
  constructor() {
    this.pendingApprovals = new Map(); // approvalId -> approval info
    this.config = null;
    this.allowlist = null;
  }

  /**
   * Initialize with configuration
   */
  initialize(config) {
    this.config = config;
    this.allowlist = configLoader.getAllowlist();

    // Subscribe to permission prompt events
    this.setupEventListeners();

    return this;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    eventBus.subscribe(eventBus.constructor.Events.SESSION_PERMISSION_PROMPT, (data) => {
      this.handlePermissionPrompt(data);
    });
  }

  /**
   * Handle incoming permission prompt
   */
  async handlePermissionPrompt(data) {
    const { sessionId, prompt } = data;

    logger.permission('detected', prompt.description, { sessionId });

    // Check if this should be auto-approved
    const decision = this.evaluatePermission(prompt);

    if (decision.autoApprove) {
      logger.permission('auto_approved', prompt.description, { sessionId, reason: decision.reason });

      eventBus.emitEvent(eventBus.constructor.Events.PERMISSION_AUTO_APPROVED, {
        sessionId,
        prompt,
        reason: decision.reason
      });
    } else if (decision.blocked) {
      logger.permission('blocked', prompt.description, { sessionId, reason: decision.reason });

      eventBus.emitEvent(eventBus.constructor.Events.PERMISSION_REJECTED, {
        sessionId,
        prompt,
        reason: decision.reason,
        autoRejected: true
      });
    } else {
      // Needs manual approval
      const approvalId = this.createPendingApproval(sessionId, prompt);

      logger.permission('pending', prompt.description, { sessionId, approvalId });

      eventBus.emitEvent(eventBus.constructor.Events.PERMISSION_REQUESTED, {
        sessionId,
        approvalId,
        prompt
      });
    }
  }

  /**
   * Evaluate if permission should be auto-approved, blocked, or needs manual approval
   */
  evaluatePermission(prompt) {
    const { description, operationType, rawPrompt } = prompt;
    const text = (description + ' ' + rawPrompt).toLowerCase();

    // Check blocklist first
    if (this.matchesBlocklist(text)) {
      return {
        autoApprove: false,
        blocked: true,
        reason: 'Matches blocklist pattern'
      };
    }

    // Check allowlist based on operation type
    const allowlistMatch = this.matchesAllowlist(text, operationType);
    if (allowlistMatch.matches && allowlistMatch.autoApprove) {
      return {
        autoApprove: true,
        blocked: false,
        reason: allowlistMatch.reason
      };
    }

    // Check default settings
    if (operationType === 'read' && this.config.permissions?.defaultAutoApproveReads) {
      return {
        autoApprove: true,
        blocked: false,
        reason: 'Default auto-approve for reads'
      };
    }

    if (operationType === 'edit' && this.config.permissions?.defaultAutoApproveEdits) {
      return {
        autoApprove: true,
        blocked: false,
        reason: 'Default auto-approve for edits'
      };
    }

    // Needs manual approval
    return {
      autoApprove: false,
      blocked: false,
      reason: 'Requires manual approval'
    };
  }

  /**
   * Check if text matches any blocklist pattern
   */
  matchesBlocklist(text) {
    const blocklist = this.allowlist?.globalBlocklist || [];

    for (const item of blocklist) {
      try {
        const regex = new RegExp(item.pattern, 'i');
        if (regex.test(text)) {
          return true;
        }
      } catch (e) {
        logger.warn('Invalid blocklist pattern', { pattern: item.pattern });
      }
    }

    return false;
  }

  /**
   * Check if text matches any allowlist pattern
   */
  matchesAllowlist(text, operationType) {
    const allowlist = this.allowlist?.globalAllowlist || {};

    // Check specific operation type first
    const typePatterns = allowlist[operationType] || [];
    for (const item of typePatterns) {
      try {
        const regex = new RegExp(item.pattern, 'i');
        if (regex.test(text)) {
          return {
            matches: true,
            autoApprove: item.autoApprove,
            reason: item.description || 'Matches allowlist pattern'
          };
        }
      } catch (e) {
        logger.warn('Invalid allowlist pattern', { pattern: item.pattern });
      }
    }

    // Check shell patterns for shell operations
    if (operationType === 'shell' || operationType === 'unknown') {
      const shellPatterns = allowlist.shell || [];
      for (const item of shellPatterns) {
        try {
          const regex = new RegExp(item.pattern, 'i');
          if (regex.test(text)) {
            return {
              matches: true,
              autoApprove: item.autoApprove,
              reason: item.description || 'Matches shell allowlist'
            };
          }
        } catch (e) {
          logger.warn('Invalid shell pattern', { pattern: item.pattern });
        }
      }
    }

    return { matches: false };
  }

  /**
   * Create a pending approval request
   */
  createPendingApproval(sessionId, prompt) {
    const approvalId = `${sessionId}-${Date.now()}`;
    const timeout = (this.config.permissions?.approvalTimeout || 120) * 1000;

    const approval = {
      id: approvalId,
      sessionId,
      prompt,
      status: 'pending',
      createdAt: Date.now(),
      timeoutAt: Date.now() + timeout
    };

    this.pendingApprovals.set(approvalId, approval);

    // Set timeout
    setTimeout(() => {
      this.handleApprovalTimeout(approvalId);
    }, timeout);

    return approvalId;
  }

  /**
   * Handle approval response
   */
  handleApprovalResponse(approvalId, approved, responderPhone) {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval) {
      logger.warn('Approval not found', { approvalId });
      return false;
    }

    if (approval.status !== 'pending') {
      logger.warn('Approval already processed', { approvalId, status: approval.status });
      return false;
    }

    approval.status = approved ? 'approved' : 'rejected';
    approval.respondedAt = Date.now();
    approval.responderPhone = responderPhone;

    const eventName = approved
      ? eventBus.constructor.Events.PERMISSION_APPROVED
      : eventBus.constructor.Events.PERMISSION_REJECTED;

    eventBus.emitEvent(eventName, {
      approvalId,
      sessionId: approval.sessionId,
      prompt: approval.prompt,
      responderPhone
    });

    this.pendingApprovals.delete(approvalId);
    return true;
  }

  /**
   * Handle approval timeout
   */
  handleApprovalTimeout(approvalId) {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval || approval.status !== 'pending') {
      return;
    }

    approval.status = 'timeout';
    logger.permission('timeout', approval.prompt.description, { approvalId });

    eventBus.emitEvent(eventBus.constructor.Events.PERMISSION_TIMEOUT, {
      approvalId,
      sessionId: approval.sessionId,
      prompt: approval.prompt
    });

    this.pendingApprovals.delete(approvalId);
  }

  /**
   * Get pending approval by ID
   */
  getPendingApproval(approvalId) {
    return this.pendingApprovals.get(approvalId);
  }

  /**
   * Get all pending approvals for a session
   */
  getPendingBySession(sessionId) {
    const pending = [];
    for (const approval of this.pendingApprovals.values()) {
      if (approval.sessionId === sessionId && approval.status === 'pending') {
        pending.push(approval);
      }
    }
    return pending;
  }

  /**
   * Get most recent pending approval for a session
   */
  getMostRecentPending(sessionId) {
    const pending = this.getPendingBySession(sessionId);
    if (pending.length === 0) return null;

    return pending.sort((a, b) => b.createdAt - a.createdAt)[0];
  }

  /**
   * Cancel all pending approvals for a session
   */
  cancelPendingForSession(sessionId) {
    for (const [approvalId, approval] of this.pendingApprovals.entries()) {
      if (approval.sessionId === sessionId) {
        approval.status = 'cancelled';
        this.pendingApprovals.delete(approvalId);
      }
    }
  }

  /**
   * Parse approval response text
   */
  parseApprovalResponse(text) {
    const approvalResponses = this.allowlist?.approvalResponses || {
      approve: ['y', 'yes', 'approve', 'אשר', 'כן', 'ok'],
      reject: ['n', 'no', 'reject', 'דחה', 'לא', 'cancel']
    };

    const normalized = text.trim().toLowerCase();

    if (approvalResponses.approve.includes(normalized)) {
      return { valid: true, approved: true };
    }

    if (approvalResponses.reject.includes(normalized)) {
      return { valid: true, approved: false };
    }

    return { valid: false };
  }
}

module.exports = new PermissionHandler();
