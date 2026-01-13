const logger = require('../utils/logger');
const eventBus = require('./EventBus');
const configLoader = require('../utils/configLoader');

// WhatsApp components
const whatsappClient = require('../whatsapp/WhatsAppClient');
const messageParser = require('../whatsapp/MessageParser');
const responseSender = require('../whatsapp/ResponseSender');
const adminCommandHandler = require('../whatsapp/AdminCommandHandler');

// Claude components
const sessionManager = require('../claude/SessionManager');
const cmdExecutor = require('../claude/CmdExecutor');
const outputProcessor = require('../claude/OutputProcessor');
const permissionHandler = require('../claude/PermissionHandler');
const imageHandler = require('../claude/ImageHandler');

// Queue and AI
const commandQueue = require('../queue/CommandQueue');
const summarizerService = require('../ai/SummarizerService');

// Database repositories
const repositories = require('../db/repositories');

// Playwright MCP config path
const PLAYWRIGHT_MCP_CONFIG = 'C:\\Users\\asaf1\\.claude\\plugins\\marketplaces\\claude-plugins-official\\external_plugins\\playwright\\.mcp.json';

/**
 * Main orchestrator - coordinates all components
 */
class BridgeOrchestrator {
  constructor() {
    this.config = null;
    this.projects = new Map(); // projectId -> projectInfo
    this.oauthSessions = new Map(); // sessionId -> { groupId, awaiting }
    this.initialized = false;
    this.repositories = null;
  }

  /**
   * Initialize all components
   */
  async initialize() {
    logger.info('Initializing Bridge Orchestrator...');

    // Load configuration
    configLoader.load();
    this.config = configLoader.getConfig();

    // Store repositories reference
    this.repositories = repositories;

    // Initialize components with repositories where needed
    whatsappClient.initialize(this.config);
    responseSender.initialize(this.config);
    sessionManager.initialize(this.config, repositories.sessionRepository);
    outputProcessor.initialize(this.config);
    permissionHandler.initialize(this.config);
    imageHandler.initialize(this.config);
    commandQueue.initialize(this.config);
    summarizerService.initialize(this.config);
    adminCommandHandler.initialize(repositories, sessionManager);

    // Recover sessions on startup
    await sessionManager.recoverSessions();

    // Setup event handlers
    this.setupEventHandlers();

    this.initialized = true;
    logger.info('Bridge Orchestrator initialized');

    eventBus.emitEvent(eventBus.constructor.Events.SYSTEM_READY, {
      timestamp: Date.now()
    });

    return this;
  }

  /**
   * Setup event handlers to wire components together
   */
  setupEventHandlers() {
    const Events = eventBus.constructor.Events;

    // Message received from WhatsApp
    eventBus.subscribe(Events.MESSAGE_RECEIVED, async (data) => {
      await this.handleMessageReceived(data);
    });

    // Permission auto-approved
    eventBus.subscribe(Events.PERMISSION_AUTO_APPROVED, async (data) => {
      await this.handlePermissionAutoApproved(data);
    });

    // Permission request (needs manual approval)
    eventBus.subscribe(Events.PERMISSION_REQUESTED, async (data) => {
      await this.handlePermissionRequested(data);
    });

    // Permission approved
    eventBus.subscribe(Events.PERMISSION_APPROVED, async (data) => {
      await this.handlePermissionApproved(data);
    });

    // Permission rejected
    eventBus.subscribe(Events.PERMISSION_REJECTED, async (data) => {
      await this.handlePermissionRejected(data);
    });

    // Permission timeout
    eventBus.subscribe(Events.PERMISSION_TIMEOUT, async (data) => {
      await this.handlePermissionTimeout(data);
    });

    // OAuth URL received
    eventBus.subscribe(Events.OAUTH_URL_RECEIVED, async (data) => {
      await this.handleOAuthUrl(data);
    });

    // OAuth code received
    eventBus.subscribe(Events.OAUTH_CODE_RECEIVED, async (data) => {
      await this.handleOAuthCode(data);
    });

    // Session completed
    eventBus.subscribe(Events.SESSION_COMPLETED, async (data) => {
      await this.handleSessionCompleted(data);
    });

    // Queue item completed
    eventBus.subscribe(Events.QUEUE_ITEM_COMPLETED, async (data) => {
      await this.processNextInQueue(data.projectId);
    });

    // Queue item failed
    eventBus.subscribe(Events.QUEUE_ITEM_FAILED, async (data) => {
      await this.processNextInQueue(data.projectId);
    });
  }

  /**
   * Handle received WhatsApp message
   */
  async handleMessageReceived(parsed) {
    const { projectName, messageType, messageData, groupId, senderPhone, senderName } = parsed;

    try {
      // Handle admin commands
      if (messageType === 'admin_command') {
        await adminCommandHandler.handleCommand(parsed, { orchestrator: this });
        return;
      }

      // Handle approval responses
      if (messageType === 'approval_response') {
        await this.handleApprovalResponse(parsed);
        return;
      }

      // Check if this is an OAuth code response
      if (messageType === 'command' && messageData?.command) {
        const oauthCheck = this.isOAuthCodeResponse(messageData.command, groupId);
        if (oauthCheck.isOAuth) {
          eventBus.emitEvent(eventBus.constructor.Events.OAUTH_CODE_RECEIVED, {
            sessionId: oauthCheck.sessionId,
            code: messageData.command.trim(),
            senderPhone
          });
          return;
        }
      }

      // For other message types, we need a project
      if (!projectName) {
        logger.debug('Message without project context', { messageType });
        return;
      }

      // Get or create project ID (using group ID as project ID for now)
      const projectId = groupId;

      // Handle image messages
      if (messageType === 'image') {
        await this.handleImageMessage(parsed, projectId, projectName);
        return;
      }

      // Handle slash commands
      if (messageType === 'slash_command') {
        await this.handleSlashCommand(parsed, projectId, projectName);
        return;
      }

      // Handle regular commands
      if (messageType === 'command') {
        await this.handleCommand(parsed, projectId, projectName);
        return;
      }

    } catch (error) {
      logger.error('Error handling message', { error: error.message });
      if (groupId) {
        await responseSender.sendError(groupId, `Error: ${error.message}`);
      }
    }
  }

  /**
   * Handle regular command
   */
  async handleCommand(parsed, projectId, projectName) {
    const { messageData, groupId, senderPhone, senderName } = parsed;
    const command = messageData.command;

    // Classify operation type
    const operationType = messageParser.classifyOperation(command, this.config);

    // Check if blocked
    if (operationType === 'blocked') {
      await responseSender.sendError(groupId, 'This operation is blocked for safety reasons');
      return;
    }

    // Check if needs approval for initial command
    const needsApproval = operationType === 'write' &&
      !this.config.permissions?.defaultAutoApproveEdits;

    if (needsApproval) {
      // Queue and wait for approval
      await responseSender.sendApprovalRequest(
        groupId,
        `Execute: ${command.substring(0, 100)}`,
        this.config.permissions?.approvalTimeout || 120
      );

      // Create pending approval (handled separately)
      return;
    }

    // Add to queue
    const queueItem = await commandQueue.enqueue(projectId, {
      text: command,
      type: 'command',
      senderPhone,
      senderName,
      operationType,
      groupId,
      messageId: parsed.messageId,
      projectName
    });

    // Notify if queue position > 1
    const position = commandQueue.getPosition(projectId, queueItem.id);
    if (position > 1) {
      await responseSender.sendQueuePosition(groupId, position);
    } else {
      await responseSender.sendPending(groupId, 'Processing your command...');
    }

    // Process queue if not already processing
    if (!commandQueue.isProcessing(projectId)) {
      await this.processNextInQueue(projectId);
    }
  }

  /**
   * Handle slash command (forward to Claude)
   */
  async handleSlashCommand(parsed, projectId, projectName) {
    const { messageData, groupId, senderPhone, senderName } = parsed;
    const command = messageData.command;

    // Add to queue with high priority
    await commandQueue.enqueue(projectId, {
      text: command,
      type: 'slash_command',
      senderPhone,
      senderName,
      operationType: 'slash',
      groupId,
      priority: 1, // Higher priority
      projectName
    });

    // Process if not processing
    if (!commandQueue.isProcessing(projectId)) {
      await this.processNextInQueue(projectId);
    }
  }

  /**
   * Handle image message
   */
  async handleImageMessage(parsed, projectId, projectName) {
    const { messageData, groupId } = parsed;

    try {
      await responseSender.sendPending(groupId, 'Processing image...');

      // Download and save image
      const result = await imageHandler.handleIncomingImage(
        messageData.messageId,
        groupId,
        messageData.caption
      );

      // Build command with image reference
      const imageCommand = imageHandler.buildImageCommand(result.localPath, result.caption);

      // Add to queue
      await commandQueue.enqueue(projectId, {
        text: imageCommand,
        type: 'image',
        groupId,
        projectName
      });

      // Process if not processing
      if (!commandQueue.isProcessing(projectId)) {
        await this.processNextInQueue(projectId);
      }
    } catch (error) {
      logger.error('Image handling failed', { error: error.message });
      await responseSender.sendError(groupId, 'Failed to process image');
    }
  }

  /**
   * Check if command is a screenshot request
   */
  isScreenshotCommand(command) {
    const lower = command.toLowerCase().trim();
    return lower.startsWith('/screenshot') ||
           lower.startsWith('screenshot ') ||
           lower.includes('take screenshot') ||
           lower.includes('take a screenshot');
  }

  /**
   * Extract URL from screenshot command
   */
  extractScreenshotUrl(command) {
    // Match URLs in the command
    const urlMatch = command.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) return urlMatch[0];

    // Check for /screenshot <url> pattern
    const parts = command.split(/\s+/);
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].toLowerCase() === '/screenshot' && parts[i + 1]) {
        return parts[i + 1].startsWith('http') ? parts[i + 1] : `https://${parts[i + 1]}`;
      }
    }
    return null;
  }

  /**
   * Build screenshot command for Claude with Playwright
   */
  buildScreenshotCommand(url, outputPath) {
    return `Using Playwright browser, navigate to ${url} and take a full page screenshot. Save the screenshot to ${outputPath}. After saving, confirm the screenshot was saved successfully.`;
  }

  /**
   * Extract image file paths from Claude's output
   */
  extractImagePaths(output) {
    const paths = [];
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

    // Match Windows paths like C:\path\to\image.png
    const windowsPathRegex = /[A-Z]:\\[^\s\)>\]"']+\.(png|jpg|jpeg|gif|webp|bmp)/gi;
    const windowsMatches = output.match(windowsPathRegex) || [];
    paths.push(...windowsMatches);

    // Match Unix paths like /path/to/image.png
    const unixPathRegex = /\/[^\s\)>\]"']+\.(png|jpg|jpeg|gif|webp|bmp)/gi;
    const unixMatches = output.match(unixPathRegex) || [];
    paths.push(...unixMatches);

    // Match markdown image syntax ![alt](path)
    const markdownRegex = /!\[[^\]]*\]\(([^)]+\.(png|jpg|jpeg|gif|webp|bmp))\)/gi;
    let match;
    while ((match = markdownRegex.exec(output)) !== null) {
      paths.push(match[1]);
    }

    // Remove duplicates and clean paths
    const uniquePaths = [...new Set(paths)].map(p => p.replace(/[)"'>]+$/, ''));

    logger.debug('Extracted image paths from output', { count: uniquePaths.length, paths: uniquePaths });
    return uniquePaths;
  }

  /**
   * Process next item in project queue
   */
  async processNextInQueue(projectId) {
    const item = commandQueue.dequeue(projectId);
    if (!item) {
      logger.debug('No items in queue', { projectId });
      return;
    }

    logger.info('Processing queue item', { itemId: item.id, projectId });

    try {
      // Use projectName from queue item, fallback to lookup
      const projectName = item.projectName || await this.getProjectName(projectId);
      logger.info('Got projectName for queue item', { projectName, itemCommand: item.command?.substring(0, 50) });

      // Check session status before sending command
      const sessionStatus = sessionManager.getSessionStatus(projectId);
      logger.info('Session status before command', {
        projectId,
        sessionStatus: sessionStatus.status,
        commandCount: sessionStatus.commandCount,
        exists: sessionStatus.exists
      });

      // Track if task went to background mode
      let wasBackgroundTask = false;

      // Progress callback - sends updates based on changes or time
      const progressCallback = async (progressData) => {
        try {
          // Track if this became a background task
          if (progressData.isBackgroundNotification) {
            wasBackgroundTask = true;
          }
          await responseSender.sendToGroup(item.groupId, progressData.message);
        } catch (err) {
          logger.debug('Failed to send progress update', { error: err.message });
        }
      };

      // Check if this is a screenshot command
      const isScreenshot = this.isScreenshotCommand(item.command);
      let commandToSend = item.command;
      let options = {};
      let screenshotPath = null;

      if (isScreenshot) {
        const url = this.extractScreenshotUrl(item.command);
        if (url) {
          // Generate screenshot path
          const timestamp = Date.now();
          screenshotPath = `C:\\RemoteClaudeCode\\_bridge\\temp\\screenshot_${timestamp}.png`;
          commandToSend = this.buildScreenshotCommand(url, screenshotPath);
          options.mcpConfig = PLAYWRIGHT_MCP_CONFIG;

          await responseSender.sendPending(item.groupId, `📸 Taking screenshot of ${url}...`);
          logger.info('Processing screenshot command', { url, screenshotPath });
        }
      }

      // Send command to Claude with progress tracking
      const result = await sessionManager.sendCommand(projectId, projectName, commandToSend, progressCallback, options);
      logger.info('Command completed', {
        sessionId: result.sessionId,
        success: result.success,
        outputLength: result.output?.length
      });

      // Store session reference
      item.sessionId = result.sessionId;

      // Get output from result
      const output = result.output || '';

      // Detect any image paths in Claude's output and send them
      const imagePaths = this.extractImagePaths(output);
      let imagesSent = 0;

      if (imagePaths.length > 0) {
        const fs = require('fs').promises;
        for (const imgPath of imagePaths) {
          try {
            await fs.access(imgPath);
            await imageHandler.sendImageToWhatsApp(item.groupId, imgPath, '📸 Screenshot');
            logger.info('Image sent to WhatsApp', { imgPath, groupId: item.groupId });
            imagesSent++;
          } catch (imgErr) {
            logger.debug('Image not accessible', { imgPath, error: imgErr.message });
          }
        }
      }

      // Also try explicit screenshot path if it was a screenshot command
      if (isScreenshot && screenshotPath && result.success && !imagePaths.includes(screenshotPath)) {
        try {
          const fs = require('fs').promises;
          await fs.access(screenshotPath);
          await imageHandler.sendImageToWhatsApp(item.groupId, screenshotPath, '📸 Screenshot captured');
          logger.info('Screenshot sent to WhatsApp', { screenshotPath, groupId: item.groupId });
          imagesSent++;
        } catch (imgErr) {
          logger.debug('Screenshot path not accessible', { error: imgErr.message, screenshotPath });
        }
      }

      // Calculate execution time
      const executionTime = item.startedAt
        ? `${((Date.now() - new Date(item.startedAt).getTime()) / 1000).toFixed(1)}s`
        : 'N/A';

      // Summarize using OpenRouter AI
      const summary = await summarizerService.summarizeOutput(output, {
        commandText: item.command,
        projectName,
        startTime: item.startedAt
      });

      // Send summarized response
      if (output && output.trim()) {
        // Build header based on whether this was a background task
        const statusIcon = result.success ? '✅' : '❌';
        let header = '';

        if (wasBackgroundTask) {
          header = `${statusIcon} *Background task completed!*\n⏱️ ${executionTime}\n\n`;
        }

        // Use the AI-summarized response
        let formattedResponse;
        if (summarizerService.isAvailable() && summary.summary) {
          // Use the formatted summary from AI
          formattedResponse = summarizerService.formatForWhatsApp(summary, {
            successPrefix: wasBackgroundTask ? '' : `${statusIcon} `,
            errorPrefix: wasBackgroundTask ? '' : '❌ '
          });

          // Add header for background tasks
          if (wasBackgroundTask) {
            formattedResponse = header + formattedResponse;
          }
        } else {
          // Fallback: truncate raw output if summarizer unavailable
          let claudeResponse = output.trim();
          const MAX_LENGTH = 4000;
          if (claudeResponse.length > MAX_LENGTH) {
            claudeResponse = claudeResponse.substring(0, MAX_LENGTH - 100) + '\n\n... _(truncated)_';
          }
          formattedResponse = (wasBackgroundTask ? header : `${statusIcon} *Done* (${executionTime})\n\n`) + claudeResponse;
        }

        await responseSender.sendToGroup(item.groupId, formattedResponse);
      } else if (imagesSent > 0) {
        // Only images, short message
        await responseSender.sendSuccess(item.groupId, `Done! Sent ${imagesSent} image${imagesSent > 1 ? 's' : ''} (${executionTime})`);
      } else {
        // No output - send status only
        const statusMsg = result.success
          ? `✅ *Done* (${executionTime})\n\nTask completed successfully.`
          : `❌ *Failed* (${executionTime})\n\n${result.stderr || 'Unknown error'}`;
        await responseSender.sendToGroup(item.groupId, statusMsg);
      }

      // Mark as completed
      commandQueue.complete(projectId, item.id, summary);

    } catch (error) {
      logger.error('Queue item processing failed', { error: error.message, stack: error.stack, itemId: item.id });

      await responseSender.sendError(item.groupId, error.message);
      commandQueue.fail(projectId, item.id, error.message);
    }
  }

  /**
   * Handle approval response from WhatsApp
   */
  async handleApprovalResponse(parsed) {
    const { messageData, senderPhone, groupId } = parsed;
    const { approved } = messageData;

    // Find pending approval for this session/group
    const projectId = groupId;
    const sessionId = sessionManager.getSessionId(projectId);

    if (!sessionId) {
      logger.debug('No active session for approval response');
      return;
    }

    // Get most recent pending approval
    const pendingApproval = permissionHandler.getMostRecentPending(sessionId);

    if (pendingApproval) {
      permissionHandler.handleApprovalResponse(pendingApproval.id, approved, senderPhone);
    } else {
      await responseSender.sendToGroup(groupId, 'No pending approval request');
    }
  }

  /**
   * Handle permission auto-approved
   */
  async handlePermissionAutoApproved(data) {
    const { sessionId } = data;
    await cmdExecutor.respondToPrompt(sessionId, true);
  }

  /**
   * Handle permission request (needs manual approval)
   */
  async handlePermissionRequested(data) {
    const { sessionId, prompt } = data;

    // Find group ID for this session
    const groupId = this.getGroupIdForSession(sessionId);
    if (!groupId) {
      logger.error('Cannot find group for session', { sessionId });
      return;
    }

    await responseSender.sendApprovalRequest(
      groupId,
      prompt.description,
      this.config.permissions?.approvalTimeout || 120
    );
  }

  /**
   * Handle permission approved
   */
  async handlePermissionApproved(data) {
    const { sessionId } = data;
    await cmdExecutor.respondToPrompt(sessionId, true);
  }

  /**
   * Handle permission rejected
   */
  async handlePermissionRejected(data) {
    const { sessionId, autoRejected, reason } = data;
    await cmdExecutor.respondToPrompt(sessionId, false);

    if (autoRejected) {
      const groupId = this.getGroupIdForSession(sessionId);
      if (groupId) {
        await responseSender.sendToGroup(groupId, `⛔ Operation blocked: ${reason}`);
      }
    }
  }

  /**
   * Handle permission timeout
   */
  async handlePermissionTimeout(data) {
    const { sessionId, prompt } = data;

    await cmdExecutor.respondToPrompt(sessionId, false);

    const groupId = this.getGroupIdForSession(sessionId);
    if (groupId) {
      await responseSender.sendToGroup(groupId,
        '⏰ Permission request timed out - automatically rejected'
      );
    }
  }

  /**
   * Handle OAuth URL (login required)
   */
  async handleOAuthUrl(data) {
    const { sessionId, url } = data;

    const groupId = this.getGroupIdForSession(sessionId);
    if (groupId) {
      // Track that this session is awaiting OAuth
      this.oauthSessions.set(sessionId, { groupId, url, awaiting: true });

      await responseSender.sendOAuthRequest(groupId, url);

      // Log activity
      repositories.activityLogRepository.logOAuthEvent(
        groupId,
        sessionId,
        'url_sent'
      );
    }
  }

  /**
   * Handle OAuth code received from WhatsApp
   */
  async handleOAuthCode(data) {
    const { sessionId, code, senderPhone } = data;

    // Check if we're awaiting OAuth for this session
    const oauthInfo = this.oauthSessions.get(sessionId);
    if (!oauthInfo || !oauthInfo.awaiting) {
      logger.warn('OAuth code received but no pending OAuth for session', { sessionId });
      return;
    }

    try {
      // Send the code to Claude stdin
      await cmdExecutor.sendInput(sessionId, code);

      // Update tracking
      oauthInfo.awaiting = false;
      this.oauthSessions.delete(sessionId);

      // Notify user
      await responseSender.sendToGroup(oauthInfo.groupId, 'OAuth code received, authenticating...');

      // Log activity
      repositories.activityLogRepository.logOAuthEvent(
        oauthInfo.groupId,
        sessionId,
        'code_submitted'
      );

      logger.info('OAuth code submitted', { sessionId, senderPhone });
    } catch (error) {
      logger.error('Failed to submit OAuth code', { error: error.message, sessionId });
      await responseSender.sendError(oauthInfo.groupId, 'Failed to submit OAuth code');
    }
  }

  /**
   * Check if message is an OAuth code response
   */
  isOAuthCodeResponse(message, groupId) {
    // Check if any session for this group is awaiting OAuth
    for (const [sessionId, info] of this.oauthSessions.entries()) {
      if (info.groupId === groupId && info.awaiting) {
        // Check if message looks like an OAuth code
        const text = message.trim();
        // OAuth codes are typically alphanumeric strings
        if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) {
          return { isOAuth: true, sessionId };
        }
      }
    }
    return { isOAuth: false };
  }

  /**
   * Handle session completed
   */
  async handleSessionCompleted(data) {
    const { sessionId, output } = data;
    logger.debug('Session completed', { sessionId, outputLength: output?.length });
  }

  /**
   * Get project name from project ID (group ID)
   */
  async getProjectName(projectId) {
    // For now, extract from cached group name
    // In a real implementation, this would come from the database
    const info = this.projects.get(projectId);
    if (info) return info.name;

    // Try to get from WhatsApp
    try {
      const chatInfo = await whatsappClient.getChatInfo(projectId);
      const groupName = chatInfo?.name || 'Unknown';
      const projectName = messageParser.extractProjectName(groupName) || 'Unknown';

      this.projects.set(projectId, { name: projectName, groupName });
      return projectName;
    } catch (error) {
      return 'Unknown';
    }
  }

  /**
   * Get group ID for a session
   */
  getGroupIdForSession(sessionId) {
    // Find project that has this session
    for (const [projectId, sid] of sessionManager.sessions || []) {
      if (sid === sessionId) {
        return projectId;
      }
    }
    return null;
  }

  /**
   * Shutdown orchestrator
   */
  async shutdown() {
    logger.info('Shutting down Bridge Orchestrator...');

    eventBus.emitEvent(eventBus.constructor.Events.SYSTEM_SHUTDOWN, {
      timestamp: Date.now()
    });

    // Terminate all sessions
    await sessionManager.terminateAll();

    logger.info('Bridge Orchestrator shutdown complete');
  }

  /**
   * Get system stats
   */
  getStats() {
    return {
      sessions: sessionManager.getStats(),
      queue: commandQueue.getStats(),
      projects: this.projects.size
    };
  }
}

module.exports = new BridgeOrchestrator();
