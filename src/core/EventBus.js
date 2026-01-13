const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * Central event bus for inter-component communication
 */
class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // Increase limit for multiple listeners
  }

  /**
   * Emit event with logging
   */
  emitEvent(event, data) {
    logger.debug(`Event emitted: ${event}`, { eventData: typeof data === 'object' ? Object.keys(data) : data });
    this.emit(event, data);
  }

  /**
   * Subscribe to event with logging
   */
  subscribe(event, handler) {
    logger.debug(`Subscribed to event: ${event}`);
    this.on(event, handler);
    return () => this.off(event, handler); // Return unsubscribe function
  }

  /**
   * Subscribe once to event
   */
  subscribeOnce(event, handler) {
    logger.debug(`Subscribed once to event: ${event}`);
    this.once(event, handler);
  }
}

// Event names constants
EventBus.Events = {
  // Message events
  MESSAGE_RECEIVED: 'message:received',
  MESSAGE_ROUTED: 'message:routed',
  MESSAGE_QUEUED: 'message:queued',
  MESSAGE_PROCESSED: 'message:processed',

  // Session events
  SESSION_STARTING: 'session:starting',
  SESSION_STARTED: 'session:started',
  SESSION_OUTPUT: 'session:output',
  SESSION_PERMISSION_PROMPT: 'session:permission_prompt',
  SESSION_COMPLETED: 'session:completed',
  SESSION_ERROR: 'session:error',
  SESSION_TERMINATED: 'session:terminated',

  // Permission events
  PERMISSION_REQUESTED: 'permission:requested',
  PERMISSION_APPROVED: 'permission:approved',
  PERMISSION_REJECTED: 'permission:rejected',
  PERMISSION_TIMEOUT: 'permission:timeout',
  PERMISSION_AUTO_APPROVED: 'permission:auto_approved',

  // OAuth events
  OAUTH_REQUIRED: 'oauth:required',
  OAUTH_URL_RECEIVED: 'oauth:url_received',
  OAUTH_CODE_RECEIVED: 'oauth:code_received',
  OAUTH_COMPLETED: 'oauth:completed',
  OAUTH_FAILED: 'oauth:failed',

  // Queue events
  QUEUE_ITEM_ADDED: 'queue:item_added',
  QUEUE_ITEM_STARTED: 'queue:item_started',
  QUEUE_ITEM_COMPLETED: 'queue:item_completed',
  QUEUE_ITEM_FAILED: 'queue:item_failed',

  // Response events
  RESPONSE_SENDING: 'response:sending',
  RESPONSE_SENT: 'response:sent',
  RESPONSE_FAILED: 'response:failed',

  // Admin events
  ADMIN_COMMAND: 'admin:command',
  ADMIN_RESPONSE: 'admin:response',

  // System events
  SYSTEM_READY: 'system:ready',
  SYSTEM_ERROR: 'system:error',
  SYSTEM_SHUTDOWN: 'system:shutdown',

  // Image events
  IMAGE_RECEIVED: 'image:received',
  IMAGE_DOWNLOADED: 'image:downloaded',
  IMAGE_SENT: 'image:sent'
};

// Export singleton instance
const eventBus = new EventBus();
module.exports = eventBus;
