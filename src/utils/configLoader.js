const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

class ConfigLoader {
  constructor() {
    this.config = null;
    this.allowlist = null;
    this.configPath = path.join(__dirname, '..', '..', 'config', 'bridge.config.json');
    this.allowlistPath = path.join(__dirname, '..', '..', 'config', 'allowlist.json');
  }

  /**
   * Load and parse configuration, replacing ${ENV_VAR} placeholders
   */
  load() {
    // Load main config
    const configRaw = fs.readFileSync(this.configPath, 'utf-8');
    this.config = JSON.parse(this.replaceEnvVars(configRaw));

    // Load allowlist
    const allowlistRaw = fs.readFileSync(this.allowlistPath, 'utf-8');
    this.allowlist = JSON.parse(allowlistRaw);

    // Override with environment variables
    this.applyEnvOverrides();

    return this;
  }

  /**
   * Replace ${VAR} placeholders with environment variable values
   */
  replaceEnvVars(str) {
    return str.replace(/\$\{(\w+)\}/g, (match, varName) => {
      return process.env[varName] || match;
    });
  }

  /**
   * Apply environment variable overrides
   */
  applyEnvOverrides() {
    // Server
    if (process.env.PORT) this.config.server.port = parseInt(process.env.PORT);
    if (process.env.HOST) this.config.server.host = process.env.HOST;

    // Base path
    if (process.env.BASE_PATH) this.config.basePath = process.env.BASE_PATH;

    // WhatsApp API
    if (process.env.WHATSAPP_API_URL) this.config.whatsappApi.baseUrl = process.env.WHATSAPP_API_URL;
    if (process.env.WHATSAPP_API_KEY) this.config.whatsappApi.apiKey = process.env.WHATSAPP_API_KEY;

    // OpenRouter
    if (process.env.OPENROUTER_API_KEY) this.config.openRouter.apiKey = process.env.OPENROUTER_API_KEY;
    if (process.env.OPENROUTER_MODEL) this.config.openRouter.model = process.env.OPENROUTER_MODEL;

    // Permissions
    if (process.env.PERMISSION_TIMEOUT) {
      this.config.permissions.approvalTimeout = parseInt(process.env.PERMISSION_TIMEOUT);
    }
    if (process.env.AUTO_APPROVE_READS) {
      this.config.permissions.defaultAutoApproveReads = process.env.AUTO_APPROVE_READS === 'true';
    }
    if (process.env.AUTO_APPROVE_EDITS) {
      this.config.permissions.defaultAutoApproveEdits = process.env.AUTO_APPROVE_EDITS === 'true';
    }

    // Logging
    if (process.env.LOG_LEVEL) this.config.logging.level = process.env.LOG_LEVEL;

    // Admin phones
    if (process.env.ADMIN_PHONES) {
      this.config.adminPhones = process.env.ADMIN_PHONES.split(',').map(p => p.trim());
    }
  }

  /**
   * Get config value by dot notation path
   */
  get(path, defaultValue = null) {
    const keys = path.split('.');
    let value = this.config;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  /**
   * Get full config object
   */
  getConfig() {
    return this.config;
  }

  /**
   * Get allowlist
   */
  getAllowlist() {
    return this.allowlist;
  }

  /**
   * Check if a phone number is admin
   */
  isAdmin(phoneNumber) {
    const adminPhones = this.config.adminPhones || [];
    const normalized = phoneNumber.replace(/\D/g, '');
    return adminPhones.some(admin => normalized.includes(admin.replace(/\D/g, '')));
  }

  /**
   * Reload configuration from files
   */
  reload() {
    return this.load();
  }
}

// Export singleton instance
const configLoader = new ConfigLoader();
module.exports = configLoader;
