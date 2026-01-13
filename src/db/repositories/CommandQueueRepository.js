const { v4: uuidv4 } = require('uuid');
const database = require('../database');

/**
 * Repository for command queue data access
 */
class CommandQueueRepository {
  /**
   * Add command to queue
   */
  enqueue(projectId, commandText, senderPhone, options = {}) {
    const db = database.getDb();
    const id = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO command_queue (id, project_id, command_text, command_type, sender_phone, sender_name, operation_type, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      projectId,
      commandText,
      options.commandType || 'command',
      senderPhone,
      options.senderName || null,
      options.operationType || 'unknown',
      options.priority || 0
    );

    return this.findById(id);
  }

  /**
   * Find command by ID
   */
  findById(id) {
    const db = database.getDb();
    const row = db.prepare('SELECT * FROM command_queue WHERE id = ?').get(id);
    return row ? this.parseCommand(row) : null;
  }

  /**
   * Get next pending command for a project
   */
  getNextPending(projectId) {
    const db = database.getDb();
    const row = db.prepare(`
      SELECT * FROM command_queue
      WHERE project_id = ? AND status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get(projectId);
    return row ? this.parseCommand(row) : null;
  }

  /**
   * Get all pending commands for a project
   */
  getPendingByProject(projectId) {
    const db = database.getDb();
    const rows = db.prepare(`
      SELECT * FROM command_queue
      WHERE project_id = ? AND status = 'pending'
      ORDER BY priority DESC, created_at ASC
    `).all(projectId);
    return rows.map(row => this.parseCommand(row));
  }

  /**
   * Get currently processing command for a project
   */
  getProcessing(projectId) {
    const db = database.getDb();
    const row = db.prepare(`
      SELECT * FROM command_queue
      WHERE project_id = ? AND status = 'processing'
      ORDER BY started_at DESC
      LIMIT 1
    `).get(projectId);
    return row ? this.parseCommand(row) : null;
  }

  /**
   * Start processing a command
   */
  startProcessing(id) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE command_queue
      SET status = 'processing', started_at = strftime('%s', 'now')
      WHERE id = ?
    `);
    stmt.run(id);
    return this.findById(id);
  }

  /**
   * Mark command as waiting for approval
   */
  markWaitingApproval(id) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE command_queue
      SET status = 'waiting_approval'
      WHERE id = ?
    `);
    stmt.run(id);
    return this.findById(id);
  }

  /**
   * Complete a command
   */
  complete(id, rawOutput, summary = null) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE command_queue
      SET status = 'completed', completed_at = strftime('%s', 'now'), raw_output = ?, summary = ?
      WHERE id = ?
    `);
    stmt.run(rawOutput, summary, id);
    return this.findById(id);
  }

  /**
   * Fail a command
   */
  fail(id, errorMessage) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE command_queue
      SET status = 'failed', completed_at = strftime('%s', 'now'), error_message = ?
      WHERE id = ?
    `);
    stmt.run(errorMessage, id);
    return this.findById(id);
  }

  /**
   * Cancel a command
   */
  cancel(id, reason = null) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE command_queue
      SET status = 'cancelled', completed_at = strftime('%s', 'now'), error_message = ?
      WHERE id = ?
    `);
    stmt.run(reason, id);
    return this.findById(id);
  }

  /**
   * Get command history for a project
   */
  getHistory(projectId, limit = 20) {
    const db = database.getDb();
    const rows = db.prepare(`
      SELECT * FROM command_queue
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(projectId, limit);
    return rows.map(row => this.parseCommand(row));
  }

  /**
   * Get queue size for a project
   */
  getQueueSize(projectId) {
    const db = database.getDb();
    const row = db.prepare(`
      SELECT COUNT(*) as count FROM command_queue
      WHERE project_id = ? AND status = 'pending'
    `).get(projectId);
    return row.count;
  }

  /**
   * Clear pending commands for a project
   */
  clearPending(projectId) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE command_queue
      SET status = 'cancelled', completed_at = strftime('%s', 'now'), error_message = 'Queue cleared'
      WHERE project_id = ? AND status = 'pending'
    `);
    const result = stmt.run(projectId);
    return result.changes;
  }

  /**
   * Parse database row to command object
   */
  parseCommand(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      commandText: row.command_text,
      commandType: row.command_type,
      senderPhone: row.sender_phone,
      senderName: row.sender_name,
      operationType: row.operation_type,
      status: row.status,
      priority: row.priority,
      createdAt: new Date(row.created_at * 1000),
      startedAt: row.started_at ? new Date(row.started_at * 1000) : null,
      completedAt: row.completed_at ? new Date(row.completed_at * 1000) : null,
      rawOutput: row.raw_output,
      summary: row.summary,
      errorMessage: row.error_message
    };
  }
}

module.exports = new CommandQueueRepository();
