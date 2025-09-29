# Prompt Dock Bridge

A production-ready Node.js bridge application that enables web applications to securely control local AI coding agents (Claude Code, Cursor CLI, and Codex CLI). This bridge runs as a local server that accepts WebSocket connections from authorized web applications and orchestrates AI agent execution with real-time bidirectional communication.

## Features

- **🔒 Enterprise Security**: RSA-2048 encryption, JWT sessions, cryptographic signing
- **🤖 Multi-Agent Support**: Claude Code, Cursor CLI, and Codex CLI with automatic detection
- **📡 Real-time Communication**: WebSocket-based bidirectional messaging
- **🔄 Git Integration**: Safe execution with backup branches and rollback capability
- **🔄 Plan-Execute Flow**: Mandatory plan review before code execution
- **🖥️ WSL Support**: Full Windows Subsystem for Linux compatibility
- **📊 Monitoring**: Comprehensive logging and audit trails
- **🛑 Safety Controls**: Emergency kill switch and per-session rate limiting
- **🚀 Auto-Updates**: Keep your bridge current with the latest features

## Quick Start

### Installation

```bash
# Install globally via npm
npm install -g prompt-dock-bridge

# Or via yarn
yarn global add prompt-dock-bridge
```

### First Run

```bash
# Start the bridge
prompt-dock-bridge start

# Follow the setup wizard
prompt-dock-bridge config
```

The bridge will:
1. Generate RSA keys for secure communication
2. Start HTTP server on port 51720
3. Start WebSocket server on port 51721
4. Detect available AI agents
5. Open your browser to [Prompt Dock](https://promptdock.app)

### Pairing with Web Applications

1. Visit [promptdock.app](https://promptdock.app) or your custom web app
2. Click "Connect Bridge"
3. Enter the pairing code (format `XXXX-XXXX-XXXX`) displayed in your terminal
4. Start coding with AI assistance!

## CLI Commands

```bash
# Start the bridge
prompt-dock-bridge start [options]
  --port <number>        Port to run on (default: 51720)
  --verbose             Verbose logging
  --agent <type>        Preferred agent (claude-code|cursor|codex)
  --hub <url>           Override Prompt Dock hub URL
  --no-open            Don't open browser on start

# Check status
prompt-dock-bridge status

# Stop the bridge
prompt-dock-bridge stop

# View logs
prompt-dock-bridge logs

# Configuration wizard
prompt-dock-bridge config

# Test agent installation
prompt-dock-bridge test-agent claude-code

# Version information
prompt-dock-bridge version
  # Displays local version and update availability
```

## Configuration

The bridge stores configuration in `~/.prompt-dock/config.json`. Default configuration:

```json
{
  "port": 51720,
  "wsPort": 51721,
  "hub": "https://promptdock.app",
  "allowedOrigins": [
    "https://promptdock.app",
    "https://www.promptdock.app",
    "http://localhost:3000"
  ],
  "customOrigins": [],
  "security": {
    "requirePairing": true,
    "enforceOriginCheck": true,
    "allowCustomOrigins": false,
    "sessionTimeout": 3600000,
    "commandTimeout": 30000,
    "clockSkewTolerance": 5000,
    "maxCommandsPerMinute": 100
  },
  "agents": {
    "preferred": "claude-code",
    "timeout": 300000,
    "retryAttempts": 3
  },
  "git": {
    "createBackupBranch": true,
    "requireCleanWorkingTree": false,
    "autoCommit": false
  },
  "logging": {
    "level": "info",
    "maxFiles": 5
  }
}
```

## Security Features

- **RSA-2048 encryption** for all command signing
- **JWT tokens** with automatic refresh
- **Command expiration** (30 seconds max)
- **Clock skew tolerance** (configurable, default 5 seconds)
- **Replay attack prevention**
- **Rate limiting** (100 commands/minute)
- **CORS protection** with origin whitelist
- **Complete audit logs**

## Git Safety

- **Plan mode first**: Always review before execution
- **Backup branches**: Automatic recovery points
- **File monitoring**: Real-time change tracking
- **Rollback support**: Restore previous state

## License

MIT License - see [LICENSE](LICENSE) file for details.
