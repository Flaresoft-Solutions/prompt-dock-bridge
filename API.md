# Prompt Dock Bridge API Reference

## Overview

The Prompt Dock Bridge provides HTTP REST endpoints for basic operations and a WebSocket protocol for real-time bidirectional communication with AI coding agents.

## Base URLs

- **HTTP Server**: `http://localhost:51720` (configurable)
- **WebSocket Server**: `ws://localhost:51721` (HTTP port + 1)

## Authentication Flow

### 1. Generate Pairing Code

**Endpoint**: `POST /api/pairing/generate`

**Request**:
```json
{
  "appName": "My App",
  "appUrl": "https://myapp.com"
}
```

**Response**:
```json
{
  "code": "A1B2-C3D4-E5F6",
  "expiresAt": "2024-01-01T12:05:00Z",
  "bridgePublicKey": "-----BEGIN PUBLIC KEY-----\n...",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n..."
}
```

### 2. Complete Pairing

**Endpoint**: `POST /api/pairing/verify`

**Request**:
```json
{
  "code": "A1B2-C3D4-E5F6",
  "clientPublicKey": "-----BEGIN PUBLIC KEY-----\n..."
}
```

**Response**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "sessionId": "sess_abc123...",
  "bridgePublicKey": "-----BEGIN PUBLIC KEY-----\n...",
  "expiresAt": "2024-01-01T13:00:00Z"
}
```

## WebSocket Protocol

### Connection

```javascript
const ws = new WebSocket('ws://localhost:51721', {
  headers: {
    origin: 'https://promptdock.app'
  }
});
```

### Message Format

All messages follow this structure:

```json
{
  "id": "unique-message-id",
  "type": "message-type",
  "data": { },
  "timestamp": "2024-01-01T12:00:00Z",
  "signature": "base64-signature" // Required for most messages
}
```

### Message Signing

Messages must be signed using the client's private key:

```javascript
import crypto from 'crypto';

function signMessage(message, privateKey) {
  const payload = {
    type: message.type,
    timestamp: message.timestamp,
    nonce: message.nonce || null,
    data: canonicalize(message.data || {})
  };

  const serialized = JSON.stringify(payload);
  const signature = crypto.sign('SHA256', Buffer.from(serialized));
  return signature.sign(privateKey, 'base64');
}
```

## Message Types

### Client → Bridge Messages

#### `pair`
Establish initial connection with pairing code.

```json
{
  "type": "pair",
  "data": {
    "code": "A1B2-C3D4-E5F6",
    "clientPublicKey": "-----BEGIN PUBLIC KEY-----\n..."
  },
  "signature": "required"
}
```

#### `authenticate`
Authenticate with session token.

```json
{
  "type": "authenticate",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs..."
  },
  "signature": "required"
}
```

#### `init-session`
Initialize working session.

```json
{
  "type": "init-session",
  "data": {
    "workdir": "/path/to/project",
    "agentType": "claude-code",
    "agentConfig": {
      "model": "claude-3-5-sonnet-20241022"
    }
  },
  "signature": "required"
}
```

#### `git-status`
Get git repository status.

```json
{
  "type": "git-status",
  "data": {
    "workdir": "/path/to/project"
  },
  "signature": "required"
}
```

#### `execute-prompt`
Execute prompt in plan or execute mode.

```json
{
  "type": "execute-prompt",
  "data": {
    "prompt": "Add error handling to the login function",
    "mode": "plan", // or "execute"
    "options": {
      "planId": "plan_123", // Required for execute mode
      "webSearch": true,
      "model": "claude-3-5-sonnet-20241022"
    }
  },
  "signature": "required"
}
```

#### `approve-plan`
Approve execution plan.

```json
{
  "type": "approve-plan",
  "data": {
    "planId": "plan_123",
    "modifications": "Optional plan modifications"
  },
  "signature": "required"
}
```

#### `reject-plan`
Reject execution plan.

```json
{
  "type": "reject-plan",
  "data": {
    "planId": "plan_123",
    "reason": "Plan scope too broad"
  },
  "signature": "required"
}
```

#### `abort-execution`
Abort running execution.

```json
{
  "type": "abort-execution",
  "data": {
    "executionId": "exec_456",
    "reason": "User cancelled"
  },
  "signature": "required"
}
```

#### `generate-pr`
Generate pull request from execution.

```json
{
  "type": "generate-pr",
  "data": {
    "executionId": "exec_456",
    "title": "Add error handling",
    "description": "Automated PR from AI agent",
    "baseBranch": "main"
  },
  "signature": "required"
}
```

#### `health-check`
Simple keepalive message.

```json
{
  "type": "health-check",
  "data": {}
}
```

#### `emergency-kill`
Emergency stop all operations.

```json
{
  "type": "emergency-kill",
  "data": {
    "reason": "Security incident"
  },
  "signature": "required"
}
```

### Bridge → Client Messages

#### `connected`
Initial connection confirmation.

```json
{
  "type": "connected",
  "data": {
    "version": "1.0.0"
  }
}
```

#### `pairing-success`
Pairing completed successfully.

```json
{
  "type": "pairing-success",
  "data": {
    "sessionId": "sess_abc123",
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "bridgePublicKey": "-----BEGIN PUBLIC KEY-----\n...",
    "expiresAt": "2024-01-01T13:00:00Z"
  }
}
```

#### `auth-success`
Authentication successful.

```json
{
  "type": "auth-success",
  "data": {
    "sessionId": "sess_abc123",
    "token": "new-refreshed-token"
  }
}
```

#### `agents-available`
List of detected AI agents.

```json
{
  "type": "agents-available",
  "data": {
    "agents": [
      {
        "name": "claude-code",
        "version": "1.0.0",
        "path": "/usr/local/bin/claude-code",
        "beta": false
      },
      {
        "name": "cursor-agent",
        "version": "0.5.0",
        "path": "/usr/local/bin/cursor-agent",
        "beta": true
      }
    ]
  }
}
```

#### `git-status`
Git repository status.

```json
{
  "type": "git-status",
  "data": {
    "isGitRepo": true,
    "currentBranch": "main",
    "isClean": false,
    "hasUncommittedChanges": true,
    "files": {
      "modified": ["src/app.js"],
      "added": ["src/new-feature.js"],
      "deleted": [],
      "staged": ["src/app.js"]
    },
    "remotes": [
      {
        "name": "origin",
        "url": "https://github.com/user/repo.git"
      }
    ]
  }
}
```

#### `agent-plan`
Execution plan from agent.

```json
{
  "type": "agent-plan",
  "data": {
    "id": "plan_123",
    "prompt": "Add error handling to login",
    "plan": "1. Add try-catch block\n2. Handle network errors\n3. Add user feedback",
    "modifiedFiles": ["src/auth.js", "src/errors.js"],
    "metadata": {
      "complexity": "medium",
      "riskLevel": "low",
      "estimatedDuration": 120
    },
    "gitStatus": { },
    "approved": false
  }
}
```

#### `agent-output`
Real-time agent output.

```json
{
  "type": "agent-output",
  "data": {
    "executionId": "exec_456",
    "type": "stdout", // or "stderr"
    "data": "Processing file: src/auth.js",
    "timestamp": "2024-01-01T12:00:01Z"
  }
}
```

#### `execution-progress`
Execution progress updates.

```json
{
  "type": "execution-progress",
  "data": {
    "executionId": "exec_456",
    "status": "executing", // "started", "executing", "completed", "failed"
    "progress": 45 // Percentage 0-100
  }
}
```

#### `file-changed`
File modification notification.

```json
{
  "type": "file-changed",
  "data": {
    "executionId": "exec_456",
    "file": "src/auth.js"
  }
}
```

#### `execution-complete`
Execution finished.

```json
{
  "type": "execution-complete",
  "data": {
    "executionId": "exec_456",
    "planId": "plan_123",
    "modifiedFiles": ["src/auth.js", "src/errors.js"],
    "result": {
      "success": true,
      "summary": "Added comprehensive error handling"
    }
  }
}
```

#### `pr-created`
Pull request generated.

```json
{
  "type": "pr-created",
  "data": {
    "url": "https://github.com/user/repo/pull/123",
    "title": "Add error handling",
    "branch": "feature-error-handling"
  }
}
```

#### `error`
Error response.

```json
{
  "type": "error",
  "data": {
    "error": "Plan not found",
    "code": "PLAN_NOT_FOUND"
  }
}
```

## HTTP Endpoints

### Health Check

**GET** `/health`

**Response**:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "activeSessions": 2
}
```

### Get Available Agents

**GET** `/api/agents`

**Response**:
```json
[
  {
    "name": "claude-code",
    "version": "1.0.0",
    "path": "/usr/local/bin/claude-code",
    "beta": false
  }
]
```

### Get Active Sessions

**GET** `/api/sessions`

**Response**:
```json
[
  {
    "id": "sess_abc123",
    "appName": "My App",
    "createdAt": "2024-01-01T12:00:00Z",
    "lastActivity": "2024-01-01T12:30:00Z"
  }
]
```

### Revoke Session

**DELETE** `/api/sessions/{sessionId}`

**Response**:
```json
{
  "message": "Session revoked"
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `INVALID_MESSAGE_FORMAT` | Message missing required fields |
| `MISSING_SIGNATURE` | Command requires signature |
| `INVALID_SIGNATURE` | Signature verification failed |
| `NOT_AUTHENTICATED` | Session required |
| `SESSION_EXPIRED` | Session timeout |
| `RATE_LIMIT_EXCEEDED` | Too many commands |
| `REPLAY_DETECTED` | Command already executed |
| `ORIGIN_NOT_ALLOWED` | Invalid origin header |
| `PLAN_NOT_FOUND` | Plan ID invalid |
| `PLAN_NOT_APPROVED` | Plan requires approval |
| `EXECUTION_NOT_FOUND` | Execution ID invalid |
| `AGENT_NOT_AVAILABLE` | Requested agent not installed |
| `GIT_ERROR` | Git operation failed |
| `COMMAND_TIMEOUT` | Operation timed out |

## Rate Limits

- **Global**: 100 commands per minute per session
- **Backoff**: Exponential (2^penalty seconds, max 60s)
- **Reset**: 1 minute sliding window

## Security Headers

All responses include security headers:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
```

## Example Client Implementation

See `examples/client.js` for a complete client implementation with proper signing and error handling.