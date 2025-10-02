export const MessageTypes = {
  // Client to Bridge
  PAIR: 'pair',
  AUTHENTICATE: 'authenticate',
  INIT_SESSION: 'init-session',
  GIT_STATUS: 'git-status',
  GIT_COMMAND: 'git-command',
  EXECUTE_PROMPT: 'execute-prompt',
  AGENT_INTERACTION: 'agent-interaction',
  AGENT_FEEDBACK: 'agent-feedback',  // NEW: User feedback during execution
  APPROVE_PLAN: 'approve-plan',
  REJECT_PLAN: 'reject-plan',
  ABORT_EXECUTION: 'abort-execution',
  GENERATE_PR: 'generate-pr',
  CLEANUP_WORKTREE: 'cleanup-worktree',  // NEW: Cleanup worktree after PR
  GET_LOGS: 'get-logs',
  HEALTH_CHECK: 'health-check',
  EMERGENCY_KILL: 'emergency-kill',

  // Bridge to Client
  CONNECTED: 'connected',
  PAIRING_SUCCESS: 'pairing-success',
  AUTH_SUCCESS: 'auth-success',
  AUTH_FAILED: 'auth-failed',
  AGENTS_AVAILABLE: 'agents-available',
  GIT_STATUS_RESPONSE: 'git-status',
  AGENT_PLAN: 'agent-plan',
  AGENT_OUTPUT: 'agent-output',
  AGENT_QUESTION: 'agent-question',
  AGENT_STATE_CHANGE: 'agent-state-change',  // NEW: Agent streaming/waiting/complete states
  FILE_LIST: 'file-list',  // NEW: Initial directory structure
  FILE_DIFF: 'file-diff',  // NEW: File changes with diff content
  FILE_CHANGED: 'file-changed',  // Existing (deprecated in favor of FILE_DIFF)
  WORKTREE_CREATED: 'worktree-created',  // NEW: Worktree creation event
  WORKTREE_DELETED: 'worktree-deleted',  // NEW: Worktree deletion event
  EXECUTION_PROGRESS: 'execution-progress',
  EXECUTION_COMPLETE: 'execution-complete',
  PR_CREATED: 'pr-created',
  EMERGENCY_KILL_CONFIRMED: 'emergency-kill-confirmed',
  ERROR: 'error'
};

export function createMessage(type, data = {}, messageId = null) {
  return {
    id: messageId || generateMessageId(),
    type,
    data,
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  };
}

export function createErrorMessage(error, messageId = null) {
  return createMessage(MessageTypes.ERROR, {
    error: typeof error === 'string' ? error : error.message,
    code: error.code || 'UNKNOWN_ERROR',
    stack: error.stack
  }, messageId);
}

export function createSuccessMessage(type, data = {}, messageId = null) {
  return createMessage(type, {
    success: true,
    ...data
  }, messageId);
}

export function validateMessage(message) {
  const errors = [];

  if (!message.id) {
    errors.push('Missing message ID');
  }

  if (!message.type) {
    errors.push('Missing message type');
  }

  if (!message.timestamp) {
    errors.push('Missing timestamp');
  }

  if (!Object.values(MessageTypes).includes(message.type)) {
    errors.push(`Invalid message type: ${message.type}`);
  }

  if (message.timestamp) {
    const messageTime = new Date(message.timestamp).getTime();
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    if (now - messageTime > maxAge) {
      errors.push('Message too old');
    }

    if (messageTime > now + 60000) {
      errors.push('Message from future');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function generateMessageId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export const MessageSchema = {
  [MessageTypes.PAIR]: {
    required: ['code', 'clientPublicKey'],
    optional: ['appName', 'appUrl']
  },

  [MessageTypes.AUTHENTICATE]: {
    required: ['token'],
    optional: []
  },

  [MessageTypes.INIT_SESSION]: {
    required: ['workdir', 'agentType'],
    optional: ['agentConfig']
  },

  [MessageTypes.GIT_STATUS]: {
    required: ['workdir'],
    optional: []
  },

  [MessageTypes.GIT_COMMAND]: {
    required: ['command', 'workdir'],
    optional: ['args', 'options']
  },

  [MessageTypes.EXECUTE_PROMPT]: {
    required: ['prompt', 'mode'],
    optional: ['options']
  },

  [MessageTypes.AGENT_INTERACTION]: {
    required: ['message'],
    optional: ['type']
  },

  [MessageTypes.APPROVE_PLAN]: {
    required: ['planId'],
    optional: ['modifications']
  },

  [MessageTypes.REJECT_PLAN]: {
    required: ['planId', 'reason'],
    optional: []
  },

  [MessageTypes.ABORT_EXECUTION]: {
    required: ['executionId'],
    optional: ['reason']
  },

  [MessageTypes.GENERATE_PR]: {
    required: ['executionId'],
    optional: ['title', 'description', 'baseBranch']
  },

  [MessageTypes.HEALTH_CHECK]: {
    required: [],
    optional: []
  },

  [MessageTypes.EMERGENCY_KILL]: {
    required: [],
    optional: ['reason']
  }
};

export function validateMessageData(type, data) {
  const schema = MessageSchema[type];
  if (!schema) {
    return { valid: true };
  }

  const errors = [];

  for (const field of schema.required) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
