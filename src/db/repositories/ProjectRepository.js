const { v4: uuidv4 } = require('uuid');
const database = require('../database');

/**
 * Repository for project data access
 */
class ProjectRepository {
  /**
   * Create a new project
   */
  create(name, folderPath, whatsappGroupId, whatsappGroupName = null, config = {}) {
    const db = database.getDb();
    const id = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO projects (id, name, folder_path, whatsapp_group_id, whatsapp_group_name, config_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, name, folderPath, whatsappGroupId, whatsappGroupName, JSON.stringify(config));
    return this.findById(id);
  }

  /**
   * Find project by ID
   */
  findById(id) {
    const db = database.getDb();
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row ? this.parseProject(row) : null;
  }

  /**
   * Find project by name
   */
  findByName(name) {
    const db = database.getDb();
    const row = db.prepare('SELECT * FROM projects WHERE name = ? AND is_active = 1').get(name);
    return row ? this.parseProject(row) : null;
  }

  /**
   * Find project by WhatsApp group ID
   */
  findByGroupId(whatsappGroupId) {
    const db = database.getDb();
    const row = db.prepare('SELECT * FROM projects WHERE whatsapp_group_id = ? AND is_active = 1').get(whatsappGroupId);
    return row ? this.parseProject(row) : null;
  }

  /**
   * Get all active projects
   */
  findAll() {
    const db = database.getDb();
    const rows = db.prepare('SELECT * FROM projects WHERE is_active = 1 ORDER BY name').all();
    return rows.map(row => this.parseProject(row));
  }

  /**
   * Update project
   */
  update(id, updates) {
    const db = database.getDb();
    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.folderPath !== undefined) {
      fields.push('folder_path = ?');
      values.push(updates.folderPath);
    }
    if (updates.whatsappGroupName !== undefined) {
      fields.push('whatsapp_group_name = ?');
      values.push(updates.whatsappGroupName);
    }
    if (updates.config !== undefined) {
      fields.push('config_json = ?');
      values.push(JSON.stringify(updates.config));
    }
    if (updates.isActive !== undefined) {
      fields.push('is_active = ?');
      values.push(updates.isActive ? 1 : 0);
    }

    if (fields.length === 0) return this.findById(id);

    fields.push('updated_at = strftime(\'%s\', \'now\')');
    values.push(id);

    const stmt = db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.findById(id);
  }

  /**
   * Delete project (soft delete)
   */
  delete(id) {
    return this.update(id, { isActive: false });
  }

  /**
   * Parse database row to project object
   */
  parseProject(row) {
    return {
      id: row.id,
      name: row.name,
      folderPath: row.folder_path,
      whatsappGroupId: row.whatsapp_group_id,
      whatsappGroupName: row.whatsapp_group_name,
      createdAt: new Date(row.created_at * 1000),
      updatedAt: new Date(row.updated_at * 1000),
      isActive: row.is_active === 1,
      config: JSON.parse(row.config_json || '{}')
    };
  }
}

module.exports = new ProjectRepository();
