# Configuration Guide

## Overview

Prompt Dock Bridge stores configuration in `~/.prompt-dock/config.json`. The bridge supports configuration via file, environment variables, and CLI flags with the following precedence:

1. CLI flags (highest priority)
2. Environment variables
3. Configuration file
4. Built-in defaults (lowest priority)

## Configuration File

### Location
- **Path**: `~/.prompt-dock/config.json`
- **Permissions**: 0600 (read/write for owner only)
- **Format**: JSON

### Default Configuration

```json
{
  "hub": "https://promptdock.app",
  "defaultHub": "https://promptdock.app",
  "allowedOrigins": [
    "https://promptdock.app",
    "https://www.promptdock.app",
    "http://localhost:3000"
  ],
  "customOrigins": [],
  "api": {
    "endpoint": "https://promptdock.app/api",
    "version": "v1"
  },
  "telemetry": {
    "enabled": false,
    "endpoint": null
  },
  "branding": {
    "name": "Prompt Dock Bridge",
    "defaultMessage": "Connected to Prompt Dock (promptdock.app)"
  },
  "port": 51720,
  "wsPort": 51721,
  "security": {
    "requirePairing": true,
    "enforceOriginCheck": true,
    "allowCustomOrigins": false,
    "customOriginAcknowledged": false,
    "sessionTimeout": 3600000,
    "commandTimeout": 30000,
    "maxCommandsPerMinute": 100
  },
  "agents": {
    "preferred": "claude-code",
    "paths": {
      "claude-code": "auto-detect",
      "cursor-agent": "auto-detect",
      "codex": "auto-detect"
    },
    "timeout": 300000,
    "retryAttempts": 3,
    "maxBufferBytes": 4194304
  },
  "git": {
    "autoStash": false,
    "createBackupBranch": true,
    "requireCleanWorkingTree": false,
    "autoCommit": false
  },
  "logging": {
    "level": "info",
    "file": "~/.prompt-dock/bridge.log",
    "maxSize": "10m",
    "maxFiles": 5
  },
  "features": {
    "autoUpdate": true,
    "telemetry": false,
    "experimentalFeatures": false
  }
}
```

## Configuration Sections

### Network Settings

```json
{
  "port": 51720,
  "wsPort": 51721,
  "hub": "https://promptdock.app"
}
```

- **`port`**: HTTP server port (default: 51720)
- **`wsPort`**: WebSocket server port (default: port + 1)
- **`hub`**: Default hub URL for --open flag

### Security Configuration

```json
{
  "security": {
    "requirePairing": true,
    "enforceOriginCheck": true,
    "allowCustomOrigins": false,
    "customOriginAcknowledged": false,
    "sessionTimeout": 3600000,
    "commandTimeout": 30000,
    "maxCommandsPerMinute": 100,
    "allowedOrigins": [
      "https://promptdock.app",
      "https://www.promptdock.app",
      "http://localhost:3000"
    ]
  }
}
```

#### Security Options

- **`requirePairing`**: Must be `true` (pairing cannot be disabled)
- **`enforceOriginCheck`**: Must be `true` (origin validation cannot be disabled)
- **`allowCustomOrigins`**: Allow additional origins beyond defaults
- **`customOriginAcknowledged`**: Must be `true` if custom origins used
- **`sessionTimeout`**: Session expiration in milliseconds (default: 1 hour)
- **`commandTimeout`**: Command expiration in milliseconds (default: 30 seconds)
- **`maxCommandsPerMinute`**: Rate limit per session (default: 100)

#### Custom Origins (⚠️ Advanced)

To add custom origins:

1. Set `allowCustomOrigins: true`
2. Set `customOriginAcknowledged: true`
3. Add origins to `customOrigins` array

```json
{
  "security": {
    "allowCustomOrigins": true,
    "customOriginAcknowledged": true
  },
  "customOrigins": [
    "https://my-custom-app.com",
    "http://localhost:8080"
  ]
}
```

**⚠️ Security Warning**: Custom origins increase security risk. Only add trusted domains.

### Agent Configuration

```json
{
  "agents": {
    "preferred": "claude-code",
    "paths": {
      "claude-code": "auto-detect",
      "cursor-agent": "/usr/local/bin/cursor-agent",
      "codex": "auto-detect"
    },
    "timeout": 300000,
    "retryAttempts": 3,
    "maxBufferBytes": 4194304
  }
}
```

#### Agent Options

- **`preferred`**: Default agent to use (`claude-code`, `cursor-agent`, `codex`)
- **`paths`**: Explicit paths to agent binaries (or `auto-detect`)
- **`timeout`**: Agent execution timeout in milliseconds (default: 5 minutes)
- **`retryAttempts`**: Max retry attempts on agent failure (default: 3)
- **`maxBufferBytes`**: Max memory buffer per agent (default: 4MB)

#### Supported Agents

| Agent | Installation | Features |
|-------|-------------|----------|
| `claude-code` | [Claude Code](https://docs.claude.com/en/docs/claude-code) | Plan mode, web search, multi-file editing |
| `cursor-agent` | [Cursor CLI](https://cursor.sh) | Chat mode, parallel execution (beta) |
| `codex` | [Codex CLI](https://github.com/microsoft/codex-cli) | Interactive mode, multimodal, MCP servers |

### Git Configuration

```json
{
  "git": {
    "autoStash": false,
    "createBackupBranch": true,
    "requireCleanWorkingTree": false,
    "autoCommit": false
  }
}
```

#### Git Options

- **`autoStash`**: Automatically stash uncommitted changes before execution
- **`createBackupBranch`**: Create backup branch before modifications
- **`requireCleanWorkingTree`**: Require clean git state before execution
- **`autoCommit`**: Automatically commit agent changes

### Logging Configuration

```json
{
  "logging": {
    "level": "info",
    "file": "~/.prompt-dock/bridge.log",
    "maxSize": "10m",
    "maxFiles": 5
  }
}
```

#### Logging Options

- **`level`**: Log level (`verbose`, `info`, `warn`, `error`)
- **`file`**: Log file path
- **`maxSize`**: Max log file size before rotation
- **`maxFiles`**: Number of rotated log files to keep

## Environment Variables

Override configuration with environment variables:

```bash
# Network
export PROMPT_DOCK_PORT=52720
export PROMPT_DOCK_WS_PORT=52721
export PROMPT_DOCK_HUB=https://my-hub.com

# Security
export PROMPT_DOCK_SESSION_TIMEOUT=7200000  # 2 hours
export PROMPT_DOCK_COMMAND_TIMEOUT=60000    # 1 minute
export PROMPT_DOCK_MAX_COMMANDS=200

# Agents
export PROMPT_DOCK_PREFERRED_AGENT=cursor-agent
export PROMPT_DOCK_AGENT_TIMEOUT=600000     # 10 minutes

# Logging
export LOG_LEVEL=verbose
```

## CLI Flag Overrides

Override any setting with CLI flags:

```bash
# Network
prompt-dock-bridge start --port 52720 --hub https://my-hub.com

# Agent
prompt-dock-bridge start --agent cursor-agent

# Logging
prompt-dock-bridge start --verbose

# Config file
prompt-dock-bridge start --config /path/to/custom-config.json
```

## Configuration Management

### Interactive Configuration

```bash
prompt-dock-bridge config
```

Launches interactive wizard to set:
- Network ports
- Hub URL
- Preferred agent
- Git safety settings
- Security options
- Custom origins (advanced)
- Logging level

### Validate Configuration

```bash
# Test configuration
prompt-dock-bridge start --verbose --no-open

# Check detected agents
prompt-dock-bridge test-agent claude-code
```

### Reset Configuration

```bash
# Backup current config
cp ~/.prompt-dock/config.json ~/.prompt-dock/config.json.backup

# Delete config (will regenerate defaults)
rm ~/.prompt-dock/config.json

# Start bridge to regenerate
prompt-dock-bridge start
```

## Production Configuration

### Recommended Production Settings

```json
{
  "security": {
    "sessionTimeout": 1800000,    // 30 minutes
    "commandTimeout": 30000,      // 30 seconds
    "maxCommandsPerMinute": 50    // Conservative limit
  },
  "agents": {
    "timeout": 180000,            // 3 minutes
    "retryAttempts": 1            // Fail fast
  },
  "git": {
    "createBackupBranch": true,   // Always backup
    "requireCleanWorkingTree": true  // Require clean state
  },
  "logging": {
    "level": "info",              // Detailed logging
    "maxFiles": 10                // Keep more logs
  }
}
```

### Development Configuration

```json
{
  "security": {
    "sessionTimeout": 7200000,    // 2 hours
    "maxCommandsPerMinute": 200   // Higher limit
  },
  "agents": {
    "timeout": 600000,            // 10 minutes
    "retryAttempts": 3            // More retries
  },
  "git": {
    "autoStash": true,            // Convenience
    "requireCleanWorkingTree": false
  },
  "logging": {
    "level": "verbose"            // Debug info
  }
}
```

## WSL Configuration

The bridge automatically detects and configures for WSL environments:

```json
{
  "wsl": {
    "detected": true,
    "version": 2,
    "distro": "Ubuntu",
    "pathTranslation": true
  }
}
```

No manual WSL configuration required.

## Troubleshooting Configuration

### Common Issues

**Issue**: "Port already in use"
**Solution**: Change port in config or stop conflicting process

**Issue**: "Origin not allowed"
**Solution**: Add origin to `allowedOrigins` or use official hub

**Issue**: "Agent not found"
**Solution**: Install agent or set explicit path in config

**Issue**: "Permission denied" on config file
**Solution**: `chmod 600 ~/.prompt-dock/config.json`

### Debugging Configuration

```bash
# Check effective configuration
prompt-dock-bridge start --verbose

# Validate specific agent
prompt-dock-bridge test-agent claude-code

# Check logs for config errors
prompt-dock-bridge logs --lines 50

# Reset to defaults
rm ~/.prompt-dock/config.json && prompt-dock-bridge start
```

### Configuration Validation

The bridge validates configuration on startup:

✅ **Valid ports** (1-65535, not conflicting)
✅ **Required security settings** (pairing and origin checks enabled)
✅ **Agent paths** (exist and executable)
✅ **Timeout values** (reasonable ranges)
✅ **Custom origin acknowledgment** (if custom origins used)

Invalid configurations prevent startup with clear error messages.