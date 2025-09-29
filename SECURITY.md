# Security Policy

## Overview

Prompt Dock Bridge implements enterprise-grade security to protect local development environments from unauthorized access while enabling secure AI coding assistance.

## Security Model

### Architecture
```
Web App → HTTPS/WSS → Bridge (localhost) → AI Agents → Local Files
    ↓
Cryptographic signatures, origin validation, session management
```

### Core Security Principles

1. **Zero Trust**: Every command must be cryptographically signed
2. **Principle of Least Privilege**: Minimal required permissions
3. **Defense in Depth**: Multiple security layers
4. **Audit Everything**: Complete security event logging

## Security Features

### 🔐 Cryptographic Security

- **RSA-2048 Key Exchange**: Client and bridge exchange public keys during pairing
- **Command Signing**: All commands signed with client's private key
- **Signature Verification**: Bridge verifies using stored client public key
- **Key Storage**: Private keys stored with 0600 permissions in `~/.prompt-dock/keys/`

### 🛡️ Authentication & Authorization

- **Pairing Codes**: 6-character codes (format: `XXXX-XXXX-XXXX`) expire in 5 minutes
- **Single-Use Codes**: Pairing codes destroyed after successful use
- **JWT Sessions**: 1-hour sliding window with automatic refresh
- **Session Isolation**: Commands tied to specific authenticated sessions

### 🌐 Origin Validation

- **Mandatory Enforcement**: Origin checks cannot be disabled
- **Default Allowlist**:
  - `https://promptdock.app`
  - `https://www.promptdock.app`
  - `http://localhost:3000` (development)
- **Custom Origins**: Require explicit user acknowledgment
- **Both Protocols**: HTTP and WebSocket connections validated

### ⚡ Rate Limiting & Abuse Prevention

- **Per-Session Limits**: 100 commands per minute per session
- **Exponential Backoff**: 2^level seconds (max 60s) for violations
- **Replay Protection**: Command IDs tracked, duplicates rejected
- **Timestamp Validation**: Commands expire after 30 seconds
- **Emergency Kill Switch**: Terminate all sessions and agents

### 📋 Execution Safety

- **Mandatory Plan Mode**: ALL execution requires plan → approval → execute flow
- **No Plan Bypass**: Zero paths to skip plan review
- **Git Safety**: Backup branches, uncommitted change warnings
- **Session Queuing**: One execution per session, proper queueing
- **Rollback Capability**: Restore pre-execution state

## Threat Model

### Protected Against

✅ **Remote Code Execution**: Cryptographic signatures prevent unauthorized commands
✅ **Cross-Origin Attacks**: Strict origin validation
✅ **Replay Attacks**: Command ID tracking and timestamp expiration
✅ **Session Hijacking**: JWT tokens with secure refresh mechanism
✅ **Rate Limit Abuse**: Exponential backoff with session isolation
✅ **Man-in-the-Middle**: HTTPS/WSS required for web communication
✅ **Code Loss**: Git backup branches and rollback capability

### Assumptions & Limitations

⚠️ **Local Machine Security**: Bridge runs with user privileges
⚠️ **Agent Trust**: AI agents (Claude Code, Cursor, Codex) are trusted
⚠️ **Development Environment**: Intended for development, not production deployment
⚠️ **Network Security**: Assumes secure local network

## Configuration Security

### Required Settings
```json
{
  "security": {
    "requirePairing": true,          // MUST be true
    "enforceOriginCheck": true,      // MUST be true
    "allowCustomOrigins": false,     // Default false
    "sessionTimeout": 3600000,       // 1 hour max recommended
    "commandTimeout": 30000,         // 30 seconds max recommended
    "maxCommandsPerMinute": 100      // Adjust per needs
  }
}
```

### Custom Origins (Advanced)
To allow custom origins (⚠️ **NOT RECOMMENDED**):

1. Set `allowCustomOrigins: true`
2. Set `customOriginAcknowledged: true`
3. Add origins to `customOrigins` array
4. Understand you're accepting additional risk

## Audit & Monitoring

### Audit Log Location
- **Path**: `~/.prompt-dock/audit.log`
- **Format**: JSON lines with timestamps
- **Rotation**: Automatic at 10MB, keeps 5 files

### Key Events Logged
- Session creation/termination
- Pairing attempts (success/failure)
- Command validation failures
- Rate limit violations
- Replay attack attempts
- Emergency kill switch activations

### Log Analysis
```bash
# View recent security events
tail -f ~/.prompt-dock/audit.log | jq '.'

# Count failed authentication attempts
grep "auth_failed" ~/.prompt-dock/audit.log | wc -l

# Check for replay attacks
grep "replay_attack_detected" ~/.prompt-dock/audit.log
```

## Incident Response

### Security Breach Response

1. **Immediate Actions**
   ```bash
   # Emergency stop all sessions
   prompt-dock-bridge stop

   # Check audit logs
   prompt-dock-bridge logs --lines 1000

   # Regenerate keys
   rm -rf ~/.prompt-dock/keys/
   ```

2. **Investigation**
   - Review `~/.prompt-dock/audit.log` for anomalies
   - Check system logs for unauthorized access
   - Verify git history for unexpected changes

3. **Recovery**
   - Regenerate RSA keys (automatic on restart)
   - Revoke all active sessions
   - Review and update allowed origins
   - Update to latest bridge version

### Common Security Issues

**Symptom**: "Origin not allowed" errors
**Cause**: Web app origin not in allowlist
**Fix**: Add origin to config or use official promptdock.app

**Symptom**: "Invalid signature" errors
**Cause**: Client/bridge key mismatch
**Fix**: Re-pair with fresh pairing code

**Symptom**: "Rate limit exceeded"
**Cause**: Too many commands sent rapidly
**Fix**: Wait for cooldown period, check for automation loops

## Reporting Security Issues

### Responsible Disclosure

🔒 **DO NOT** open public issues for security vulnerabilities

📧 **Email**: security@promptdock.app
🔑 **PGP Key**: Available at https://promptdock.app/.well-known/pgp-key.txt
⏱️ **Response Time**: 48 hours maximum

### Report Template
```
Subject: [SECURITY] Prompt Dock Bridge Vulnerability Report

## Summary
Brief description of the vulnerability

## Impact
Potential security impact and attack scenarios

## Steps to Reproduce
1. Detailed reproduction steps
2. Expected vs actual behavior
3. Screenshots/logs if applicable

## Environment
- Bridge version:
- OS:
- Node.js version:
- Browser (if applicable):

## Suggested Fix
Optional: Proposed remediation
```

### Security Updates

- **Critical**: Released within 24 hours
- **High**: Released within 1 week
- **Medium**: Released in next minor version
- **Low**: Released in next major version

Subscribe to security advisories:
- GitHub: Watch repository for security announcements
- npm: `npm audit` will detect vulnerable versions

## Best Practices

### For Users

✅ **Keep Updated**: Run `prompt-dock-bridge version` regularly
✅ **Monitor Logs**: Check audit logs for suspicious activity
✅ **Use Official Hub**: Prefer https://promptdock.app
✅ **Secure Network**: Use on trusted networks only
✅ **Git Hygiene**: Review plans before approval

❌ **Never**: Share pairing codes or session tokens
❌ **Never**: Disable origin validation
❌ **Never**: Run on production servers
❌ **Never**: Ignore security warnings

### For Developers

✅ **Validate Origins**: Only connect from allowed domains
✅ **Sign Commands**: Use proper cryptographic signatures
✅ **Handle Errors**: Gracefully handle security rejections
✅ **Rate Limit**: Implement client-side rate limiting
✅ **Secure Storage**: Protect private keys and tokens

## Security Changelog

### v1.0.0 (2024-01-XX)
- ✅ RSA-2048 cryptographic signing
- ✅ Mandatory origin validation
- ✅ Rate limiting with exponential backoff
- ✅ Replay attack prevention
- ✅ Emergency kill switch
- ✅ Complete audit logging

---

**Remember**: Security is a shared responsibility between the bridge, web applications, and users. Follow all guidelines to maintain a secure development environment.