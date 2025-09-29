# Troubleshooting Guide

## Quick Diagnostics

Run these commands first to identify common issues:

```bash
# Check bridge status
prompt-dock-bridge status

# View recent logs
prompt-dock-bridge logs --lines 50

# Test agents
prompt-dock-bridge test-agent claude-code
prompt-dock-bridge test-agent cursor-agent
prompt-dock-bridge test-agent codex

# Check network connectivity
curl -I http://localhost:51720/health
```

## Common Issues

### Bridge Won't Start

#### "Port already in use"

**Symptoms**:
```
Error: listen EADDRINUSE: address already in use :::51720
```

**Diagnosis**:
```bash
# Check what's using the port
lsof -i :51720
lsof -i :51721

# Check for existing bridge process
ps aux | grep prompt-dock-bridge
```

**Solutions**:
1. **Kill existing process**:
   ```bash
   prompt-dock-bridge stop
   # or
   pkill -f prompt-dock-bridge
   ```

2. **Use different port**:
   ```bash
   prompt-dock-bridge start --port 52720
   ```

3. **Configure permanent port change**:
   ```bash
   prompt-dock-bridge config
   # Set custom port in wizard
   ```

#### "Permission denied"

**Symptoms**:
```
Error: EACCES: permission denied, mkdir '/home/user/.prompt-dock'
```

**Solutions**:
```bash
# Fix directory permissions
mkdir -p ~/.prompt-dock
chmod 700 ~/.prompt-dock

# Fix config file permissions
chmod 600 ~/.prompt-dock/config.json

# Fix key file permissions
chmod 600 ~/.prompt-dock/keys/*
```

#### "Node.js version incompatible"

**Symptoms**:
```
Error: Requires Node.js >= 16.0.0
```

**Solutions**:
```bash
# Check Node version
node --version

# Update Node.js
# Via nvm:
nvm install 18
nvm use 18

# Via package manager:
sudo apt update && sudo apt install nodejs npm  # Ubuntu/Debian
brew install node  # macOS
```

### Connection Issues

#### "Origin not allowed"

**Symptoms**:
- WebSocket connection closes immediately
- HTTP requests return 403 errors
- Browser console shows CORS errors

**Diagnosis**:
```bash
# Check allowed origins in config
cat ~/.prompt-dock/config.json | jq '.security.allowedOrigins'

# Check logs for blocked origins
prompt-dock-bridge logs | grep "Origin not allowed"
```

**Solutions**:

1. **Use official hub**: Connect from https://promptdock.app
2. **Add custom origin** (⚠️ Not recommended):
   ```bash
   prompt-dock-bridge config
   # Enable custom origins in wizard
   ```
3. **For localhost development**:
   ```json
   {
     "security": {
       "allowedOrigins": [
         "https://promptdock.app",
         "http://localhost:3000",
         "http://localhost:8080"
       ]
     }
   }
   ```

#### "Connection timeout"

**Symptoms**:
- Bridge starts but web app can't connect
- WebSocket connection hangs

**Diagnosis**:
```bash
# Test local connectivity
curl http://localhost:51720/health

# Test WebSocket (requires wscat)
npm install -g wscat
wscat -c ws://localhost:51721
```

**Solutions**:

1. **Check firewall**:
   ```bash
   # Ubuntu/Debian
   sudo ufw status
   sudo ufw allow 51720
   sudo ufw allow 51721

   # Windows
   # Add Windows Firewall rules for ports 51720-51721

   # macOS
   # Check System Preferences > Security > Firewall
   ```

2. **WSL networking** (Windows):
   ```bash
   # Check WSL version
   wsl --status

   # WSL2 auto-forwards ports, WSL1 needs manual setup
   # For WSL1, use Windows IP instead of localhost
   ```

3. **Check bind address**:
   ```bash
   # Bridge only binds to 127.0.0.1 (localhost)
   # Ensure you're connecting to localhost, not external IP
   ```

### Authentication Issues

#### "Invalid signature"

**Symptoms**:
```json
{
  "type": "error",
  "error": "Invalid signature"
}
```

**Diagnosis**:
- Check client is signing messages correctly
- Verify client is using correct private key
- Ensure signature algorithm matches (RSA-SHA256)

**Solutions**:

1. **Re-pair the connection**:
   - Generate new pairing code
   - Complete pairing flow with fresh keys

2. **Check signature implementation**:
   ```javascript
   // Correct signing:
   const signature = crypto.sign('SHA256', Buffer.from(payload));
   signature.sign(privateKey, 'base64');

   // Correct payload format:
   const payload = JSON.stringify({
     type: message.type,
     timestamp: message.timestamp,
     nonce: message.nonce || null,
     data: canonicalize(message.data || {})
   });
   ```

3. **Verify key format**:
   ```javascript
   // Keys should be PEM format
   "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
   "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
   ```

#### "Session expired"

**Symptoms**:
```json
{
  "type": "auth-failed",
  "error": "Invalid or expired session token"
}
```

**Solutions**:

1. **Check session timeout**:
   ```bash
   # View current timeout (default 1 hour)
   cat ~/.prompt-dock/config.json | jq '.security.sessionTimeout'
   ```

2. **Re-authenticate**:
   - Use existing session token
   - Bridge will auto-refresh if within threshold

3. **Extend session timeout**:
   ```json
   {
     "security": {
       "sessionTimeout": 7200000  // 2 hours
     }
   }
   ```

#### "Rate limit exceeded"

**Symptoms**:
```json
{
  "type": "error",
  "error": "Rate limit exceeded. Cooling down for 60s"
}
```

**Solutions**:

1. **Wait for cooldown**: Exponential backoff applies
2. **Check for loops**: Ensure client isn't sending commands rapidly
3. **Increase limit** (if legitimate usage):
   ```json
   {
     "security": {
       "maxCommandsPerMinute": 200
     }
   }
   ```

### Agent Issues

#### "Agent not found"

**Symptoms**:
```
Error: Unknown agent: claude-code
```

**Diagnosis**:
```bash
# Test agent detection
prompt-dock-bridge test-agent claude-code

# Check agent installation
which claude-code
which cursor-agent
which codex

# Check agent versions
claude-code --version
cursor-agent --version
codex --version
```

**Solutions**:

1. **Install missing agent**:
   - [Claude Code](https://docs.claude.com/en/docs/claude-code)
   - [Cursor CLI](https://cursor.sh)
   - [Codex CLI](https://github.com/microsoft/codex-cli)

2. **Set explicit path**:
   ```json
   {
     "agents": {
       "paths": {
         "claude-code": "/usr/local/bin/claude-code",
         "cursor-agent": "/opt/cursor/bin/cursor-agent"
       }
     }
   }
   ```

3. **WSL path issues**:
   ```bash
   # For Windows-installed agents in WSL
   export PATH=$PATH:/mnt/c/Program\ Files/Claude\ Code/bin
   ```

#### "Agent execution timeout"

**Symptoms**:
```
Error: claude-code execution timed out after 300000ms
```

**Solutions**:

1. **Increase timeout**:
   ```json
   {
     "agents": {
       "timeout": 600000  // 10 minutes
     }
   }
   ```

2. **Check agent responsiveness**:
   ```bash
   # Test agent directly
   echo "test prompt" | claude-code --plan
   ```

3. **Monitor resource usage**:
   ```bash
   # Check if agent is hanging
   ps aux | grep claude-code
   top -p $(pgrep claude-code)
   ```

#### "Plan mode failed"

**Symptoms**:
```json
{
  "success": false,
  "error": "Plan generation failed"
}
```

**Solutions**:

1. **Check agent supports plan mode**:
   - Claude Code: `--plan` flag
   - Cursor: Uses chat mode for planning
   - Codex: Uses `--approval read-only`

2. **Verify prompt format**: Some agents are sensitive to prompt structure

3. **Check working directory**: Ensure agent has access to project files

### Git Issues

#### "Not a git repository"

**Symptoms**:
```json
{
  "isGitRepo": false,
  "error": "Not a git repository"
}
```

**Solutions**:

1. **Initialize git repo**:
   ```bash
   cd /path/to/project
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. **Check working directory**: Ensure correct path specified

#### "Uncommitted changes"

**Symptoms**:
- Bridge warns about uncommitted changes
- Execution blocked if `requireCleanWorkingTree: true`

**Solutions**:

1. **Commit changes**:
   ```bash
   git add .
   git commit -m "Work in progress"
   ```

2. **Stash changes**:
   ```bash
   git stash push -m "Before AI changes"
   ```

3. **Allow dirty tree**:
   ```json
   {
     "git": {
       "requireCleanWorkingTree": false
     }
   }
   ```

4. **Auto-stash** (convenience):
   ```json
   {
     "git": {
       "autoStash": true
     }
   }
   ```

#### "Failed to create backup branch"

**Symptoms**:
```
Error: Failed to create backup branch: fatal: A branch named 'backup-prompt-dock-...' already exists
```

**Solutions**:

1. **Clean up old backup branches**:
   ```bash
   git branch -D backup-prompt-dock-*
   ```

2. **Disable backup branches** (not recommended):
   ```json
   {
     "git": {
       "createBackupBranch": false
     }
   }
   ```

### WSL-Specific Issues

#### "WSL interop not working"

**Symptoms**:
- Windows commands fail in WSL
- Path translation errors

**Diagnosis**:
```bash
# Test interop
cmd.exe /c echo "test"

# Check mount
mount | grep drvfs

# Check WSL version
wsl --status
```

**Solutions**:

1. **Enable interop**:
   ```bash
   # Add to ~/.bashrc or ~/.zshrc
   export PATH=$PATH:/mnt/c/Windows/System32
   ```

2. **WSL2 networking**:
   ```bash
   # WSL2 auto-forwards ports
   # Use localhost:51720 from Windows
   ```

3. **Path translation**:
   ```bash
   # Manual path conversion
   wslpath -w /home/user/project  # WSL to Windows
   wslpath -u 'C:\Users\user\project'  # Windows to WSL
   ```

## Performance Issues

### High Memory Usage

**Symptoms**:
- Bridge consumes excessive RAM
- Agent processes grow large

**Diagnosis**:
```bash
# Monitor memory usage
ps aux --sort=-%mem | head -10

# Check bridge process
ps -p $(pgrep prompt-dock-bridge) -o pid,vsz,rss,comm
```

**Solutions**:

1. **Reduce buffer size**:
   ```json
   {
     "agents": {
       "maxBufferBytes": 2097152  // 2MB instead of 4MB
     }
   }
   ```

2. **Limit concurrent executions**: Bridge queues executions per session

3. **Restart bridge periodically**: If running long-term

### Slow Agent Response

**Symptoms**:
- Long delays before agent output
- Plan generation takes minutes

**Solutions**:

1. **Check system resources**:
   ```bash
   # CPU usage
   top

   # Disk I/O
   iostat 1 5

   # Memory
   free -h
   ```

2. **Optimize agent settings**:
   ```json
   {
     "agents": {
       "retryAttempts": 1,  // Fail faster
       "timeout": 180000    // 3 minutes
     }
   }
   ```

3. **Use faster agent**: Claude Code typically fastest for plans

## Log Analysis

### Enabling Verbose Logging

```bash
# Start with verbose logging
prompt-dock-bridge start --verbose

# Or set in config
{
  "logging": {
    "level": "verbose"
  }
}

# Or environment variable
LOG_LEVEL=verbose prompt-dock-bridge start
```

### Key Log Patterns

**Security Events**:
```bash
grep -E "(auth_failed|replay_attack|rate_limit)" ~/.prompt-dock/audit.log
```

**Agent Issues**:
```bash
grep -E "(Agent.*failed|timeout|spawn)" ~/.prompt-dock/bridge.log
```

**Network Issues**:
```bash
grep -E "(Origin.*not.*allowed|connection.*failed)" ~/.prompt-dock/bridge.log
```

**Performance Issues**:
```bash
grep -E "(timeout|slow|memory)" ~/.prompt-dock/bridge.log
```

## Recovery Procedures

### Full Reset

1. **Stop bridge**:
   ```bash
   prompt-dock-bridge stop
   pkill -f prompt-dock-bridge
   ```

2. **Backup configuration**:
   ```bash
   cp -r ~/.prompt-dock ~/.prompt-dock.backup
   ```

3. **Reset configuration**:
   ```bash
   rm ~/.prompt-dock/config.json
   rm -rf ~/.prompt-dock/keys/
   ```

4. **Restart**:
   ```bash
   prompt-dock-bridge start
   ```

### Emergency Recovery

If bridge is completely unresponsive:

```bash
# Kill all processes
sudo pkill -f prompt-dock-bridge
sudo pkill -f claude-code
sudo pkill -f cursor-agent
sudo pkill -f codex

# Check for hung processes
ps aux | grep -E "(prompt-dock|claude-code|cursor|codex)"

# Force kill if needed
sudo kill -9 <pid>

# Clean up temp files
rm -rf /tmp/prompt-dock-*

# Reset and restart
rm ~/.prompt-dock/config.json
prompt-dock-bridge start --verbose
```

## Getting Help

### Information to Collect

When reporting issues, include:

1. **System information**:
   ```bash
   prompt-dock-bridge version
   node --version
   npm --version
   uname -a  # Linux/macOS
   ver       # Windows
   ```

2. **Configuration**:
   ```bash
   cat ~/.prompt-dock/config.json
   ```

3. **Logs**:
   ```bash
   prompt-dock-bridge logs --lines 100 > bridge-logs.txt
   cat ~/.prompt-dock/audit.log | tail -50 > audit-logs.txt
   ```

4. **Agent status**:
   ```bash
   prompt-dock-bridge test-agent claude-code
   prompt-dock-bridge test-agent cursor-agent
   prompt-dock-bridge test-agent codex
   ```

### Support Channels

- **GitHub Issues**: https://github.com/Flaresoft-Solutions/prompt-dock-bridge/issues
- **Security Issues**: security@promptdock.app
- **Documentation**: https://docs.promptdock.app
- **Community**: https://discord.gg/promptdock

### Before Reporting

1. ✅ Search existing issues
2. ✅ Try latest version: `npm update -g prompt-dock-bridge`
3. ✅ Test with minimal configuration
4. ✅ Include full error messages and logs
5. ✅ Provide reproduction steps