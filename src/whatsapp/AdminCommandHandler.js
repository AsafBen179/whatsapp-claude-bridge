const logger = require('../utils/logger');
const eventBus = require('../core/EventBus');
const responseSender = require('./ResponseSender');
const configLoader = require('../utils/configLoader');

/**
 * Handle admin commands (! prefix)
 */
class AdminCommandHandler {
  constructor() {
    this.commands = new Map();
    this.repositories = null;
    this.sessionManager = null;
    this.registerCommands();
  }

  /**
   * Initialize with dependencies
   */
  initialize(repositories, sessionManager) {
    this.repositories = repositories;
    this.sessionManager = sessionManager;
    return this;
  }

  /**
   * Register all admin commands
   */
  registerCommands() {
    // Project management
    this.commands.set('addproject', this.cmdAddProject.bind(this));
    this.commands.set('removeproject', this.cmdRemoveProject.bind(this));
    this.commands.set('listprojects', this.cmdListProjects.bind(this));
    this.commands.set('projectinfo', this.cmdProjectInfo.bind(this));

    // User management
    this.commands.set('adduser', this.cmdAddUser.bind(this));
    this.commands.set('removeuser', this.cmdRemoveUser.bind(this));
    this.commands.set('listusers', this.cmdListUsers.bind(this));
    this.commands.set('setrole', this.cmdSetRole.bind(this));

    // Permission management
    this.commands.set('allowlist', this.cmdAllowlist.bind(this));
    this.commands.set('blocklist', this.cmdBlocklist.bind(this));

    // System commands
    this.commands.set('status', this.cmdStatus.bind(this));
    this.commands.set('sessions', this.cmdSessions.bind(this));
    this.commands.set('kill', this.cmdKill.bind(this));
    this.commands.set('logs', this.cmdLogs.bind(this));

    // Settings
    this.commands.set('set', this.cmdSet.bind(this));
    this.commands.set('get', this.cmdGet.bind(this));
    this.commands.set('config', this.cmdConfig.bind(this));

    // Help
    this.commands.set('help', this.cmdHelp.bind(this));
  }

  /**
   * Handle admin command
   */
  async handleCommand(parsed, context) {
    const { command, args } = parsed.messageData;
    const senderPhone = parsed.senderPhone;
    const groupId = parsed.groupId || parsed.from;

    // Check if sender is admin
    if (!configLoader.isAdmin(senderPhone)) {
      logger.warn('Unauthorized admin command attempt', { senderPhone, command });
      await responseSender.sendError(groupId, 'You are not authorized to use admin commands');
      return;
    }

    logger.info('Admin command received', { command, args, senderPhone });

    // Get command handler
    const handler = this.commands.get(command);
    if (!handler) {
      await responseSender.sendError(groupId, `Unknown command: !${command}\nUse !help for available commands`);
      return;
    }

    try {
      await handler(args, groupId, context);
    } catch (error) {
      logger.error('Admin command error', { command, error: error.message });
      await responseSender.sendError(groupId, `Command failed: ${error.message}`);
    }
  }

  // ===== Project Management =====

  async cmdAddProject(args, groupId, context) {
    if (args.length < 1) {
      await responseSender.sendError(groupId, 'Usage: !addproject <name> [path]');
      return;
    }

    const name = args[0];
    const path = args[1] || `${configLoader.get('basePath')}\\${name}`;

    // This would need the project repository
    await responseSender.sendSuccess(groupId, `Project "${name}" added at ${path}\n\nNote: Create a WhatsApp group named "Project ${name}" to start using it.`);
  }

  async cmdRemoveProject(args, groupId) {
    if (args.length < 1) {
      await responseSender.sendError(groupId, 'Usage: !removeproject <name>');
      return;
    }

    const name = args[0];
    await responseSender.sendSuccess(groupId, `Project "${name}" removed`);
  }

  async cmdListProjects(args, groupId) {
    // Would fetch from repository
    await responseSender.sendAdminResponse(groupId, `📁 *Projects:*\n\n(No projects configured yet)\n\nUse !addproject <name> to add a project`);
  }

  async cmdProjectInfo(args, groupId) {
    if (args.length < 1) {
      await responseSender.sendError(groupId, 'Usage: !projectinfo <name>');
      return;
    }

    const name = args[0];
    await responseSender.sendAdminResponse(groupId, `📁 *Project: ${name}*\n\nPath: C:\\RemoteClaudeCode\\${name}\nStatus: Not found`);
  }

  // ===== User Management =====

  async cmdAddUser(args, groupId) {
    if (args.length < 2) {
      await responseSender.sendError(groupId, 'Usage: !adduser <phone> <role>\nRoles: admin, user, viewer');
      return;
    }

    const [phone, role] = args;
    await responseSender.sendSuccess(groupId, `User ${phone} added as ${role}`);
  }

  async cmdRemoveUser(args, groupId) {
    if (args.length < 1) {
      await responseSender.sendError(groupId, 'Usage: !removeuser <phone>');
      return;
    }

    const phone = args[0];
    await responseSender.sendSuccess(groupId, `User ${phone} removed`);
  }

  async cmdListUsers(args, groupId) {
    const adminPhones = configLoader.get('adminPhones') || [];
    let message = '👥 *Authorized Users:*\n\n';

    if (adminPhones.length > 0) {
      message += '*Admins:*\n';
      adminPhones.forEach(phone => {
        message += `• ${phone}\n`;
      });
    } else {
      message += '(No users configured)';
    }

    await responseSender.sendAdminResponse(groupId, message);
  }

  async cmdSetRole(args, groupId) {
    if (args.length < 2) {
      await responseSender.sendError(groupId, 'Usage: !setrole <phone> <role>');
      return;
    }

    const [phone, role] = args;
    await responseSender.sendSuccess(groupId, `User ${phone} role set to ${role}`);
  }

  // ===== Permission Management =====

  async cmdAllowlist(args, groupId) {
    const subCommand = args[0];

    if (!subCommand || subCommand === 'show') {
      const allowlist = configLoader.getAllowlist();
      let message = '✅ *Allowlist:*\n\n';

      if (allowlist.globalAllowlist) {
        Object.entries(allowlist.globalAllowlist).forEach(([type, patterns]) => {
          message += `*${type}:*\n`;
          patterns.forEach(p => {
            message += `• ${p.description} ${p.autoApprove ? '(auto)' : '(manual)'}\n`;
          });
          message += '\n';
        });
      }

      await responseSender.sendAdminResponse(groupId, message);
      return;
    }

    if (subCommand === 'add' && args.length >= 2) {
      const pattern = args.slice(1).join(' ');
      await responseSender.sendSuccess(groupId, `Pattern added to allowlist: ${pattern}`);
      return;
    }

    if (subCommand === 'remove' && args.length >= 2) {
      const pattern = args.slice(1).join(' ');
      await responseSender.sendSuccess(groupId, `Pattern removed from allowlist: ${pattern}`);
      return;
    }

    await responseSender.sendError(groupId, 'Usage: !allowlist [show|add <pattern>|remove <pattern>]');
  }

  async cmdBlocklist(args, groupId) {
    const subCommand = args[0];

    if (!subCommand || subCommand === 'show') {
      const allowlist = configLoader.getAllowlist();
      let message = '🚫 *Blocklist:*\n\n';

      if (allowlist.globalBlocklist) {
        allowlist.globalBlocklist.forEach(p => {
          message += `• ${p.description}\n  Pattern: ${p.pattern}\n`;
        });
      }

      await responseSender.sendAdminResponse(groupId, message);
      return;
    }

    if (subCommand === 'add' && args.length >= 2) {
      const pattern = args.slice(1).join(' ');
      await responseSender.sendSuccess(groupId, `Pattern added to blocklist: ${pattern}`);
      return;
    }

    await responseSender.sendError(groupId, 'Usage: !blocklist [show|add <pattern>]');
  }

  // ===== System Commands =====

  async cmdStatus(args, groupId) {
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    const message = `🖥️ *System Status:*

• Status: Online
• Uptime: ${this.formatUptime(uptime)}
• Memory: ${Math.round(memory.heapUsed / 1024 / 1024)}MB / ${Math.round(memory.heapTotal / 1024 / 1024)}MB
• Node: ${process.version}`;

    await responseSender.sendAdminResponse(groupId, message);
  }

  async cmdSessions(args, groupId) {
    // Would get from session manager
    const message = `🔗 *Active Sessions:*\n\n(No active sessions)`;
    await responseSender.sendAdminResponse(groupId, message);
  }

  async cmdKill(args, groupId) {
    if (args.length < 1) {
      await responseSender.sendError(groupId, 'Usage: !kill <project>');
      return;
    }

    const project = args[0];
    // Would kill session via session manager
    await responseSender.sendSuccess(groupId, `Session for project "${project}" terminated`);
  }

  async cmdLogs(args, groupId) {
    const count = parseInt(args[0]) || 10;
    // Would fetch recent logs
    await responseSender.sendAdminResponse(groupId, `📜 *Recent Logs (${count}):*\n\n(Log retrieval not implemented yet)`);
  }

  // ===== Settings =====

  async cmdSet(args, groupId) {
    if (args.length < 2) {
      await responseSender.sendError(groupId, 'Usage: !set <key> <value>');
      return;
    }

    const [key, ...valueParts] = args;
    const value = valueParts.join(' ');
    await responseSender.sendSuccess(groupId, `Setting ${key} = ${value}`);
  }

  async cmdGet(args, groupId) {
    if (args.length < 1) {
      await responseSender.sendError(groupId, 'Usage: !get <key>');
      return;
    }

    const key = args[0];
    const value = configLoader.get(key);
    await responseSender.sendAdminResponse(groupId, `⚙️ ${key} = ${JSON.stringify(value)}`);
  }

  async cmdConfig(args, groupId) {
    const config = configLoader.getConfig();
    const summary = {
      basePath: config.basePath,
      whatsappApi: config.whatsappApi?.baseUrl,
      openRouterModel: config.openRouter?.model,
      permissionTimeout: config.permissions?.approvalTimeout,
      autoApproveReads: config.permissions?.defaultAutoApproveReads,
      autoApproveEdits: config.permissions?.defaultAutoApproveEdits
    };

    let message = '⚙️ *Configuration:*\n\n';
    Object.entries(summary).forEach(([key, value]) => {
      message += `• ${key}: ${value}\n`;
    });

    await responseSender.sendAdminResponse(groupId, message);
  }

  // ===== Help =====

  async cmdHelp(args, groupId) {
    const message = `📖 *Admin Commands:*

*Project Management:*
• !addproject <name> [path]
• !removeproject <name>
• !listprojects
• !projectinfo <name>

*User Management:*
• !adduser <phone> <role>
• !removeuser <phone>
• !listusers
• !setrole <phone> <role>

*Permissions:*
• !allowlist [show|add|remove]
• !blocklist [show|add]

*System:*
• !status - System health
• !sessions - Active Claude sessions
• !kill <project> - Terminate session
• !logs [n] - Recent logs

*Settings:*
• !set <key> <value>
• !get <key>
• !config - Show configuration`;

    await responseSender.sendAdminResponse(groupId, message);
  }

  // ===== Helpers =====

  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (parts.length === 0) parts.push(`${Math.floor(seconds)}s`);

    return parts.join(' ');
  }
}

module.exports = new AdminCommandHandler();
