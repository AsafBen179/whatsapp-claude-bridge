# WhatsApp Claude Bridge

A bridge service that connects WhatsApp to Claude Code CLI, enabling remote code assistance through WhatsApp messages.

## Overview

This service allows developers to interact with Claude Code through WhatsApp groups. Each WhatsApp group represents a project, and messages sent to the group are forwarded to Claude Code for processing. Responses are summarized and sent back via WhatsApp.

## Key Features

- **WhatsApp Integration**: Send commands to Claude Code via WhatsApp messages
- **Project-Based Sessions**: Each WhatsApp group maps to a separate project directory
- **Session Persistence**: Conversations maintain context across multiple messages using Claude's session management
- **Output Summarization**: Long Claude outputs are summarized using OpenRouter API for WhatsApp-friendly responses
- **Permission Control**: Configurable auto-approve patterns and blocklists for safe operations
- **Admin Commands**: System management via WhatsApp with `!` prefix commands
- **Image Support**: Send images to Claude for analysis
- **Command Queue**: Multiple commands are queued and processed sequentially per project
- **Multi-Language Support**: Approval responses support English and Hebrew

## Architecture

```
WhatsApp --> WhatsAppAPI --> Bridge --> Claude Code CLI
                              |
                              +--> OpenRouter (summarization)
                              +--> SQLite (sessions, logs)
```

### Components

| Component | Description |
|-----------|-------------|
| `BridgeOrchestrator` | Main coordinator connecting all components |
| `SessionManager` | Manages Claude Code sessions per project |
| `CmdExecutor` | Executes Claude CLI commands |
| `CommandQueue` | Queues and processes commands per project |
| `MessageParser` | Parses WhatsApp messages and determines type |
| `ResponseSender` | Sends formatted responses to WhatsApp |
| `PermissionHandler` | Manages operation permissions and approvals |
| `SummarizerService` | Summarizes Claude output via OpenRouter |
| `AdminCommandHandler` | Handles admin commands (!help, !status, etc.) |

## Installation

### Prerequisites

- Node.js >= 18.0.0
- Claude Code CLI installed and authenticated (`claude` command available)
- WhatsAppAPI server running (e.g., [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) based server)
- OpenRouter API key (for output summarization)

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd _bridge
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment:
```bash
cp .env.example .env
```

4. Edit `.env` with your settings:
```env
# Server
PORT=3001
HOST=127.0.0.1

# WhatsApp API Connection
WHATSAPP_API_URL=http://localhost:3000
WHATSAPP_API_KEY=your-whatsapp-api-key

# OpenRouter API (for summarization)
OPENROUTER_API_KEY=your-openrouter-api-key

# Base Path for Projects
BASE_PATH=C:\RemoteClaudeCode

# Admin Phone Numbers (with country code)
ADMIN_PHONES=972501234567
```

5. Start the service:
```bash
npm start
```

Or with PM2:
```bash
npm run pm2:start
```

## Usage

### WhatsApp Group Setup

1. Create a WhatsApp group named `Project <project-name>` (e.g., "Project MyApp")
2. Add the WhatsApp bot to the group
3. The bridge automatically creates the project folder at `BASE_PATH/<project-name>`

### Sending Commands

Simply send messages in the WhatsApp group:

```
Create a new file called hello.js with a hello world function
```

```
What files are in the src folder?
```

```
Fix the bug in utils.js line 42
```

### Slash Commands

Forward Claude Code slash commands directly:

```
/help
```

```
/status
```

### Admin Commands

Admins can use `!` prefix commands:

| Command | Description |
|---------|-------------|
| `!help` | Show all admin commands |
| `!status` | System health and uptime |
| `!sessions` | List active Claude sessions |
| `!kill <project>` | Terminate a project session |
| `!config` | Show current configuration |
| `!addproject <name>` | Register a new project |
| `!listprojects` | List all projects |
| `!listusers` | List authorized users |
| `!allowlist` | View auto-approve patterns |
| `!blocklist` | View blocked patterns |

### Permission Approvals

When Claude requests permission for an operation not in the auto-approve list, the bridge sends an approval request. Reply with:

- **Approve**: `Y`, `yes`, `ok`, `אשר`, `כן`
- **Reject**: `N`, `no`, `cancel`, `דחה`, `לא`

## Configuration

### bridge.config.json

```json
{
  "server": {
    "port": 3001,
    "host": "127.0.0.1"
  },
  "basePath": "C:\\RemoteClaudeCode",
  "claudeCode": {
    "sessionTimeout": 3600000,
    "maxConcurrentSessions": 10
  },
  "permissions": {
    "approvalTimeout": 120,
    "defaultAutoApproveReads": true,
    "defaultAutoApproveEdits": true
  },
  "queue": {
    "maxQueueSize": 100,
    "processingTimeout": 600000
  }
}
```

### allowlist.json

Configure auto-approve patterns for different operation types:

```json
{
  "globalAllowlist": {
    "read": [
      { "pattern": "Read\\s+", "description": "File read operations", "autoApprove": true }
    ],
    "write": [
      { "pattern": "Edit\\s+.*\\.(js|ts|json)$", "description": "Edit code files", "autoApprove": true }
    ],
    "shell": [
      { "pattern": "^npm\\s+(install|test|build)\\b", "description": "NPM safe commands", "autoApprove": true }
    ]
  },
  "globalBlocklist": [
    { "pattern": "rm\\s+-rf", "description": "Recursive force delete" },
    { "pattern": "format\\s+[a-z]:", "description": "Format drive" }
  ]
}
```

## Testing

Run the conversation test:

```bash
npm test
```

This runs a 10-step conversation test that:
- Creates files and folders
- Reads and modifies content
- Verifies session context is maintained
- Checks filesystem operations

## Project Structure

```
_bridge/
├── src/
│   ├── core/
│   │   ├── BridgeOrchestrator.js   # Main coordinator
│   │   └── EventBus.js             # Event system
│   ├── claude/
│   │   ├── CmdExecutor.js          # CLI execution
│   │   ├── SessionManager.js       # Session management
│   │   ├── OutputProcessor.js      # Output parsing
│   │   ├── PermissionHandler.js    # Permission control
│   │   └── ImageHandler.js         # Image processing
│   ├── whatsapp/
│   │   ├── WhatsAppClient.js       # WhatsApp API client
│   │   ├── MessageParser.js        # Message parsing
│   │   ├── ResponseSender.js       # Response formatting
│   │   ├── WebhookHandler.js       # Webhook processing
│   │   └── AdminCommandHandler.js  # Admin commands
│   ├── queue/
│   │   └── CommandQueue.js         # Command queuing
│   ├── ai/
│   │   ├── SummarizerService.js    # Output summarization
│   │   └── OpenRouterClient.js     # OpenRouter API client
│   ├── db/
│   │   ├── database.js             # SQLite setup
│   │   └── repositories/           # Data access layer
│   ├── utils/
│   │   ├── logger.js               # Winston logger
│   │   └── configLoader.js         # Configuration loader
│   ├── app.js                      # Express app
│   └── index.js                    # Entry point
├── config/
│   ├── bridge.config.json          # Main configuration
│   └── allowlist.json              # Permission patterns
├── tests/
│   └── conversation-test.js        # Integration test
├── logs/                           # Log files (auto-created)
├── .env                            # Environment variables
├── package.json
└── README.md
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start the bridge service |
| `npm run dev` | Start with auto-reload (development) |
| `npm test` | Run conversation test |
| `npm run pm2:start` | Start with PM2 |
| `npm run pm2:stop` | Stop PM2 process |
| `npm run pm2:restart` | Restart PM2 process |
| `npm run pm2:logs` | View PM2 logs |

## Security Considerations

- **Admin Authentication**: Only phone numbers in `ADMIN_PHONES` can execute admin commands
- **Blocklist**: Dangerous commands are blocked (rm -rf, format, etc.)
- **Permission Approvals**: Write operations can require manual approval
- **Session Isolation**: Each project runs in its own directory
- **Sandboxed Execution**: Claude runs with `--dangerously-skip-permissions` for automation (ensure proper network/directory isolation)

## Troubleshooting

### Claude not responding

Ensure Claude CLI is installed and authenticated:
```bash
claude --version
claude "hello"
```

### Session timeout

Adjust `sessionTimeout` in config (default: 1 hour):
```json
{
  "claudeCode": {
    "sessionTimeout": 7200000
  }
}
```

### WhatsApp connection issues

Check WhatsAppAPI server is running and webhook URL is correctly configured.

### View logs

```bash
# Direct logs
npm run pm2:logs

# Or check logs directory
cat logs/combined-*.log
```

## License

MIT
