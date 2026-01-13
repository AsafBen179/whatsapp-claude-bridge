const { v4: uuidv4 } = require('uuid');
const database = require('../database');

/**
 * Repository for pending approvals data access
 */
class ApprovalRepository {
  /**
   * Create a new pending approval
   */
  create(projectId, operationDescription, options = {}) {
    const db = database.getDb();
    const id = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO pending_approvals (id, command_id, project_id, session_id, operation_description, approval_type, raw_prompt, timeout_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      options.commandId || null,
      projectId,
      options.sessionId || null,
      operationDescription,
      options.approvalType || 'command',
      options.rawPrompt || null,
      options.timeoutSeconds || 120
    );

    return this.findById(id);
  }

  /**
   * Find approval by ID
   */
  findById(id) {
    const db = database.getDb();
    const row = db.prepare('SELECT * FROM pending_approvals WHERE id = ?').get(id);
    return row ? this.parseApproval(row) : null;
  }

  /**
   * Find pending approvals for a project
   */
  findPendingByProject(projectId) {
    const db = database.getDb();
    const rows = db.prepare(`
      SELECT * FROM pending_approvals
      WHERE project_id = ? AND status = 'pending'
      ORDER BY requested_at DESC
    `).all(projectId);
    return rows.map(row => this.parseApproval(row));
  }

  /**
   * Find pending approval for a session
   */
  findPendingBySession(sessionId) {
    const db = database.getDb();
    const row = db.prepare(`
      SELECT * FROM pending_approvals
      WHERE session_id = ? AND status = 'pending'
      ORDER BY requested_at DESC
      LIMIT 1
    `).get(sessionId);
    return row ? this.parseApproval(row) : null;
  }

  /**
   * Find pending approval by WhatsApp message ID
   */
  findByWhatsAppMessageId(messageId) {
    const db = database.getDb();
    const row = db.prepare(`
      SELECT * FROM pending_approvals
      WHERE whatsapp_message_id = ? AND status = 'pending'
    `).get(messageId);
    return row ? this.parseApproval(row) : null;
  }

  /**
   * Get most recent pending approval for a project
   */
  getMostRecentPending(projectId) {
    const db = database.getDb();
    const row = db.prepare(`
      SELECT * FROM pending_approvals
      WHERE project_id = ? AND status = 'pending'
      ORDER BY requested_at DESC
      LIMIT 1
    `).get(projectId);
    return row ? this.parseApproval(row) : null;
  }

  /**
   * Update WhatsApp message ID for tracking responses
   */
  setWhatsAppMessageId(id, messageId) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE pending_approvals
      SET whatsapp_message_id = ?
      WHERE id = ?
    `);
    stmt.run(messageId, id);
    return this.findById(id);
  }

  /**
   * Approve the request
   */
  approve(id, responderPhone) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE pending_approvals
      SET status = 'approved', responded_at = strftime('%s', 'now'), responder_phone = ?
      WHERE id = ?
    `);
    stmt.run(responderPhone, id);
    return this.findById(id);
  }

  /**
   * Reject the request
   */
  reject(id, responderPhone) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE pending_approvals
      SET status = 'rejected', responded_at = strftime('%s', 'now'), responder_phone = ?
      WHERE id = ?
    `);
    stmt.run(responderPhone, id);
    return this.findById(id);
  }

  /**
   * Mark as timed out
   */
  timeout(id) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE pending_approvals
      SET status = 'timeout', responded_at = strftime('%s', 'now')
      WHERE id = ?
    `);
    stmt.run(id);
    return this.findById(id);
  }

  /**
   * Find expired approvals
   */
  findExpired() {
    const db = database.getDb();
    const now = Math.floor(Date.now() / 1000);

    const rows = db.prepare(`
      SELECT * FROM pending_approvals
      WHERE status = 'pending'
      AND (requested_at + timeout_seconds) < ?
    `).all(now);

    return rows.map(row => this.parseApproval(row));
  }

  /**
   * Cancel all pending approvals for a session
   */
  cancelBySession(sessionId) {
    const db = database.getDb();
    const stmt = db.prepare(`
      UPDATE pending_approvals
      SET status = 'cancelled', responded_at = strftime('%s', 'now')
      WHERE session_id = ? AND status = 'pending'
    `);
    const result = stmt.run(sessionId);
    return result.changes;
  }

  /**
   * Get approval history for a project
   */
  getHistory(projectId, limit = 20) {
    const db = database.getDb();
    const rows = db.prepare(`
      SELECT * FROM pending_approvals
      WHERE project_id = ?
      ORDER BY requested_at DESC
      LIMIT ?
    `).all(projectId, limit);
    return rows.map(row => this.parseApproval(row));
  }

  /**
   * Parse database row to approval object
   */
  parseApproval(row) {
    return {
      id: row.id,
      commandId: row.command_id,
      projectId: row.project_id,
      sessionId: row.session_id,
      operationDescription: row.operation_description,
      approvalType: row.approval_type,
      rawPrompt: row.raw_prompt,
      status: row.status,
      requestedAt: new Date(row.requested_at * 1000),
      respondedAt: row.responded_at ? new Date(row.responded_at * 1000) : null,
      responderPhone: row.responder_phone,
      timeoutSeconds: row.timeout_seconds,
      whatsappMessageId: row.whatsapp_message_id
    };
  }
}

module.exports = new ApprovalRepository();
