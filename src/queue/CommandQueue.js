const { v4: uuid } = require('uuid');
const logger = require('../utils/logger');
const eventBus = require('../core/EventBus');

/**
 * Command queue manager - handles per-project command queues
 */
class CommandQueue {
  constructor() {
    this.queues = new Map(); // projectId -> array of queue items
    this.processing = new Map(); // projectId -> current processing item
    this.config = null;
  }

  /**
   * Initialize with configuration
   */
  initialize(config) {
    this.config = config;
    this.maxQueueSize = config.queue?.maxQueueSize || 100;
    return this;
  }

  /**
   * Add command to project queue
   */
  async enqueue(projectId, command) {
    const queueItem = {
      id: uuid(),
      projectId,
      command: command.text,
      commandType: command.type || 'command',
      senderPhone: command.senderPhone,
      senderName: command.senderName,
      operationType: command.operationType || 'unknown',
      priority: command.priority || 0,
      status: 'pending',
      createdAt: Date.now(),
      groupId: command.groupId,
      messageId: command.messageId,
      projectName: command.projectName
    };

    // Get or create queue for project
    let queue = this.queues.get(projectId);
    if (!queue) {
      queue = [];
      this.queues.set(projectId, queue);
    }

    // Check queue size limit
    if (queue.length >= this.maxQueueSize) {
      throw new Error('Queue is full');
    }

    // Add to queue (sorted by priority)
    queue.push(queueItem);
    queue.sort((a, b) => b.priority - a.priority);

    logger.info('Command queued', {
      commandId: queueItem.id,
      projectId,
      position: queue.indexOf(queueItem) + 1
    });

    eventBus.emitEvent(eventBus.constructor.Events.QUEUE_ITEM_ADDED, queueItem);

    return queueItem;
  }

  /**
   * Get next item from queue
   */
  dequeue(projectId) {
    const queue = this.queues.get(projectId);
    if (!queue || queue.length === 0) {
      return null;
    }

    // Find first pending item
    const index = queue.findIndex(item => item.status === 'pending');
    if (index === -1) {
      return null;
    }

    const item = queue[index];
    item.status = 'processing';
    item.startedAt = Date.now();

    this.processing.set(projectId, item);

    eventBus.emitEvent(eventBus.constructor.Events.QUEUE_ITEM_STARTED, item);

    return item;
  }

  /**
   * Mark item as completed
   */
  complete(projectId, itemId, result) {
    const queue = this.queues.get(projectId);
    if (!queue) return;

    const item = queue.find(i => i.id === itemId);
    if (item) {
      item.status = 'completed';
      item.completedAt = Date.now();
      item.result = result;

      eventBus.emitEvent(eventBus.constructor.Events.QUEUE_ITEM_COMPLETED, item);
    }

    // Clear processing
    if (this.processing.get(projectId)?.id === itemId) {
      this.processing.delete(projectId);
    }

    // Remove completed item from queue
    this.removeItem(projectId, itemId);
  }

  /**
   * Mark item as failed
   */
  fail(projectId, itemId, error) {
    const queue = this.queues.get(projectId);
    if (!queue) return;

    const item = queue.find(i => i.id === itemId);
    if (item) {
      item.status = 'failed';
      item.completedAt = Date.now();
      item.error = error;

      eventBus.emitEvent(eventBus.constructor.Events.QUEUE_ITEM_FAILED, item);
    }

    // Clear processing
    if (this.processing.get(projectId)?.id === itemId) {
      this.processing.delete(projectId);
    }

    // Remove failed item from queue
    this.removeItem(projectId, itemId);
  }

  /**
   * Remove item from queue
   */
  removeItem(projectId, itemId) {
    const queue = this.queues.get(projectId);
    if (!queue) return;

    const index = queue.findIndex(i => i.id === itemId);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  }

  /**
   * Get queue position for an item
   */
  getPosition(projectId, itemId) {
    const queue = this.queues.get(projectId);
    if (!queue) return -1;

    const pendingItems = queue.filter(i => i.status === 'pending');
    const index = pendingItems.findIndex(i => i.id === itemId);
    return index + 1; // 1-based position
  }

  /**
   * Get queue length for a project
   */
  getQueueLength(projectId) {
    const queue = this.queues.get(projectId);
    if (!queue) return 0;
    return queue.filter(i => i.status === 'pending').length;
  }

  /**
   * Check if project is currently processing
   */
  isProcessing(projectId) {
    return this.processing.has(projectId);
  }

  /**
   * Get currently processing item
   */
  getCurrentlyProcessing(projectId) {
    return this.processing.get(projectId);
  }

  /**
   * Get all items in queue for a project
   */
  getQueue(projectId) {
    return this.queues.get(projectId) || [];
  }

  /**
   * Get pending items for a project
   */
  getPending(projectId) {
    const queue = this.queues.get(projectId);
    if (!queue) return [];
    return queue.filter(i => i.status === 'pending');
  }

  /**
   * Cancel item
   */
  cancel(projectId, itemId) {
    const queue = this.queues.get(projectId);
    if (!queue) return false;

    const item = queue.find(i => i.id === itemId);
    if (item && item.status === 'pending') {
      item.status = 'cancelled';
      this.removeItem(projectId, itemId);
      return true;
    }
    return false;
  }

  /**
   * Cancel all pending items for a project
   */
  cancelAll(projectId) {
    const queue = this.queues.get(projectId);
    if (!queue) return;

    queue.filter(i => i.status === 'pending').forEach(item => {
      item.status = 'cancelled';
    });

    this.queues.set(projectId, queue.filter(i => i.status === 'processing'));
  }

  /**
   * Get statistics
   */
  getStats() {
    let totalPending = 0;
    let totalProcessing = 0;

    for (const queue of this.queues.values()) {
      totalPending += queue.filter(i => i.status === 'pending').length;
      totalProcessing += queue.filter(i => i.status === 'processing').length;
    }

    return {
      projects: this.queues.size,
      totalPending,
      totalProcessing
    };
  }
}

module.exports = new CommandQueue();
