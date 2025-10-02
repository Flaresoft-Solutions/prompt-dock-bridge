import { MessageTypes, createMessage, createErrorMessage, validateMessage, validateMessageData } from './messages.js';
import { validatePairingCode } from '../security/pairing.js';
import { getGitStatus } from '../git/status.js';
import { createBranch, switchBranch, stashChanges } from '../git/operations.js';
import { detectAgents } from '../agents/detector.js';
import { ExecutionPlanner } from '../execution/planner.js';
import { ExecutionOrchestrator } from '../execution/executor.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

let planner = null;
let orchestrator = null;

export async function handleMessage(message, clientInfo, sessionManager, config) {
  try {
    logger.verbose(`Handling message type: ${message.type}`);

    const validation = validateMessage(message);
    if (!validation.valid) {
      logger.error(`Message validation failed: ${validation.errors.join(', ')}`);
      return sendError(clientInfo.ws, validation.errors.join(', '), message.id);
    }

    const dataValidation = validateMessageData(message.type, message.data || {});
    if (!dataValidation.valid) {
      logger.error(`Data validation failed for ${message.type}: ${dataValidation.errors.join(', ')}`);
      return sendError(clientInfo.ws, dataValidation.errors.join(', '), message.id);
    }

    const requiresSession = ![
      MessageTypes.PAIR,
      MessageTypes.AUTHENTICATE,
      MessageTypes.HEALTH_CHECK
    ].includes(message.type);

    if (requiresSession) {
      const existingSession = clientInfo.session;

      if (!existingSession) {
        return sendError(clientInfo.ws, 'Not authenticated', message.id);
      }

      const activeSession = sessionManager.getSession(existingSession.id);

      if (!activeSession) {
        clientInfo.session = null;
        return sendError(clientInfo.ws, 'Not authenticated', message.id);
      }

      clientInfo.session = activeSession;

      const commandValidation = await sessionManager.validateCommand(activeSession.id, message.id, {
        type: message.type,
        timestamp: message.timestamp
      });

      if (!commandValidation.allowed) {
        return sendError(clientInfo.ws, commandValidation.reason || 'Command rejected', message.id);
      }
    }

    if (!planner) {
      planner = new ExecutionPlanner(sessionManager, config);
    }

    if (!orchestrator) {
      orchestrator = new ExecutionOrchestrator(sessionManager, config);
      orchestrator.planner = planner;

      orchestrator.on('execution-started', (data) => {
        broadcastToClient(clientInfo, MessageTypes.EXECUTION_PROGRESS, {
          executionId: data.executionId,
          status: 'started',
          progress: 0
        });
      });

      orchestrator.on('agent-output', (data) => {
        broadcastToClient(clientInfo, MessageTypes.AGENT_OUTPUT, data);
      });

      orchestrator.on('agent-state-change', (data) => {
        broadcastToClient(clientInfo, MessageTypes.AGENT_STATE_CHANGE, data);
      });

      orchestrator.on('execution-progress', (data) => {
        broadcastToClient(clientInfo, MessageTypes.EXECUTION_PROGRESS, data);
      });

      orchestrator.on('file-changed', (data) => {
        broadcastToClient(clientInfo, MessageTypes.FILE_CHANGED, data);
      });

      orchestrator.on('file-list', (data) => {
        broadcastToClient(clientInfo, MessageTypes.FILE_LIST, data);
      });

      orchestrator.on('file-diff', (data) => {
        broadcastToClient(clientInfo, MessageTypes.FILE_DIFF, data);
      });

      orchestrator.on('worktree-created', (data) => {
        broadcastToClient(clientInfo, MessageTypes.WORKTREE_CREATED, data);
      });

      orchestrator.on('worktree-deleted', (data) => {
        broadcastToClient(clientInfo, MessageTypes.WORKTREE_DELETED, data);
      });

      orchestrator.on('execution-completed', (data) => {
        broadcastToClient(clientInfo, MessageTypes.EXECUTION_COMPLETE, data);
      });

      orchestrator.on('pr-created', (data) => {
        broadcastToClient(clientInfo, MessageTypes.PR_CREATED, data);
      });
    }

    switch (message.type) {
      case MessageTypes.PAIR:
        await handlePairing(message, clientInfo, sessionManager);
        break;

      case MessageTypes.AUTHENTICATE:
        await handleAuthentication(message, clientInfo, sessionManager);
        break;

      case MessageTypes.INIT_SESSION:
        await handleInitSession(message, clientInfo);
        break;

      case MessageTypes.START_AGENT_SESSION:
        await handleStartAgentSession(message, clientInfo);
        break;

      case MessageTypes.CREATE_WORKTREE:
        await handleCreateWorktree(message, clientInfo);
        break;

      case MessageTypes.GIT_STATUS:
        await handleGitStatus(message, clientInfo);
        break;

      case MessageTypes.GIT_COMMAND:
        await handleGitCommand(message, clientInfo);
        break;

      case MessageTypes.EXECUTE_PROMPT:
        await handleExecutePrompt(message, clientInfo);
        break;

      case MessageTypes.AGENT_INTERACTION:
        await handleAgentInteraction(message, clientInfo);
        break;

      case MessageTypes.APPROVE_PLAN:
        await handleApprovePlan(message, clientInfo);
        break;

      case MessageTypes.REJECT_PLAN:
        await handleRejectPlan(message, clientInfo);
        break;

      case MessageTypes.ABORT_EXECUTION:
        await handleAbortExecution(message, clientInfo);
        break;

      case MessageTypes.GENERATE_PR:
        await handleGeneratePR(message, clientInfo);
        break;

      case MessageTypes.CLEANUP_WORKTREE:
        await handleCleanupWorktree(message, clientInfo);
        break;

      case MessageTypes.AGENT_FEEDBACK:
        await handleAgentFeedback(message, clientInfo);
        break;

      case MessageTypes.HEALTH_CHECK:
        await handleHealthCheck(message, clientInfo);
        break;

      case MessageTypes.EMERGENCY_KILL:
        await handleEmergencyKillSwitch(message, clientInfo, sessionManager);
        break;

      default:
        sendError(clientInfo.ws, `Unknown message type: ${message.type}`, message.id);
    }
  } catch (error) {
    logger.error('Message handling error:', error);
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handlePairing(message, clientInfo, sessionManager) {
  try {
    const { code, clientPublicKey } = message.data;

    const pairingData = await validatePairingCode(code, clientPublicKey);
    if (!pairingData) {
      return sendError(clientInfo.ws, 'Invalid or expired pairing code', message.id);
    }

    const session = await sessionManager.createSession(pairingData);
    clientInfo.session = session;

    sendMessage(clientInfo.ws, MessageTypes.PAIRING_SUCCESS, {
      sessionId: session.id,
      token: session.token,
      bridgePublicKey: pairingData.bridgePublicKey,
      publicKey: pairingData.bridgePublicKey,
      expiresAt: session.expiresAt
    }, message.id);

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleAuthentication(message, clientInfo, sessionManager) {
  try {
    const { token } = message.data;

    const session = sessionManager.validateSession(token);
    if (!session) {
      return sendMessage(clientInfo.ws, MessageTypes.AUTH_FAILED, {
        reason: 'Invalid or expired token'
      }, message.id);
    }

    const commandValidation = await sessionManager.validateCommand(session.id, message.id, {
      type: message.type,
      timestamp: message.timestamp
    });

    if (!commandValidation.allowed) {
      return sendError(clientInfo.ws, commandValidation.reason || 'Command rejected', message.id);
    }

    clientInfo.session = session;
    clientInfo.pendingSession = null;

    const agents = await detectAgents();

    sendMessage(clientInfo.ws, MessageTypes.AUTH_SUCCESS, {
      sessionId: session.id,
      token: session.latestToken || token
    }, message.id);

    sendMessage(clientInfo.ws, MessageTypes.AGENTS_AVAILABLE, {
      agents
    });

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleInitSession(message, clientInfo) {
  try {
    const { workdir, agentType, agentConfig } = message.data;

    // Translate Windows WSL paths to Linux paths
    const { translatePath } = await import('../utils/wsl.js');
    const normalizedWorkdir = translatePath(workdir, 'windows-to-wsl');
    logger.verbose(`Normalized workdir: ${workdir} -> ${normalizedWorkdir}`);

    clientInfo.workdir = normalizedWorkdir;
    clientInfo.agentType = agentType;
    clientInfo.agentConfig = agentConfig || {};

    sendMessage(clientInfo.ws, 'session-initialized', {
      workdir: normalizedWorkdir,
      agentType
    }, message.id);

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleStartAgentSession(message, clientInfo) {
  try {
    logger.info('Starting agent session...');

    if (!clientInfo.workdir) {
      throw new Error('Session not initialized - call init-session first');
    }

    // workdir is already normalized in handleInitSession
    const workdir = clientInfo.workdir;
    logger.info(`Scanning files in: ${workdir}`);

    // Scan files first
    const { scanDirectory } = await import('../utils/file-scanner.js');
    const files = await scanDirectory(workdir);
    logger.info(`Found ${files.length} files`);

    broadcastToClient(clientInfo, MessageTypes.FILE_LIST, {
      files,
      executionId: null
    });

    // Get git status including available branches
    logger.info('Getting git status...');
    const gitStatus = await getGitStatus(workdir);
    logger.info(`Git status: ${gitStatus.branches?.length || 0} branches, current: ${gitStatus.currentBranch}`);

    const responseData = {
      fileCount: files.length,
      gitStatus: {
        isGitRepo: gitStatus.isGitRepo,
        currentBranch: gitStatus.currentBranch,
        branches: gitStatus.branches,
        hasUncommittedChanges: gitStatus.hasUncommittedChanges
      }
    };

    logger.info(`Sending agent-session-started with ${JSON.stringify(responseData).substring(0, 200)}`);
    sendMessage(clientInfo.ws, 'agent-session-started', responseData, message.id);

    logger.info('Agent session started successfully');

  } catch (error) {
    logger.error('Failed to start agent session:', error);
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleCreateWorktree(message, clientInfo) {
  try {
    if (!clientInfo.workdir) {
      throw new Error('Session not initialized - call init-session first');
    }

    const { baseBranch } = message.data;
    const workdir = clientInfo.workdir;

    // Create worktree for isolated execution
    const { createWorktree } = await import('../git/worktree.js');
    const worktree = await createWorktree(workdir, baseBranch);

    // Store worktree info on clientInfo for later use
    clientInfo.worktree = worktree;

    broadcastToClient(clientInfo, MessageTypes.WORKTREE_CREATED, {
      worktreePath: worktree.worktreePath,
      branchName: worktree.branchName,
      baseBranch: worktree.baseBranch,
      createdAt: worktree.createdAt
    });

    sendMessage(clientInfo.ws, 'worktree-created', {
      worktree: {
        worktreePath: worktree.worktreePath,
        branchName: worktree.branchName,
        baseBranch: worktree.baseBranch
      }
    }, message.id);

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleGitStatus(message, clientInfo) {
  try {
    const { workdir } = message.data;

    // Translate Windows WSL paths to Linux paths
    const { translatePath } = await import('../utils/wsl.js');
    const normalizedWorkdir = translatePath(workdir, 'windows-to-wsl');

    const gitStatus = await getGitStatus(normalizedWorkdir);

    sendMessage(clientInfo.ws, MessageTypes.GIT_STATUS_RESPONSE, gitStatus, message.id);

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleGitCommand(message, clientInfo) {
  try {
    const { command, workdir, args, options } = message.data;

    // Translate Windows WSL paths to Linux paths
    const { translatePath } = await import('../utils/wsl.js');
    const normalizedWorkdir = translatePath(workdir, 'windows-to-wsl');

    let result;

    switch (command) {
      case 'create-branch':
        result = await createBranch(normalizedWorkdir, args.name);
        break;

      case 'switch-branch':
        result = await switchBranch(normalizedWorkdir, args.name);
        break;

      case 'stash':
        result = await stashChanges(normalizedWorkdir, args.message);
        break;

      default:
        throw new Error(`Unknown git command: ${command}`);
    }

    sendMessage(clientInfo.ws, 'git-command-result', result, message.id);

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleExecutePrompt(message, clientInfo) {
  try {
    const { prompt, mode, options } = message.data;

    if (!clientInfo.workdir || !clientInfo.agentType) {
      throw new Error('Session not initialized');
    }

    if (mode === 'plan') {
      const plan = await planner.createPlan(
        prompt,
        clientInfo.workdir,
        clientInfo.agentType,
        {
          ...options,
          sessionId: clientInfo.session?.id,
          onOutput: (output) => {
            // Stream agent output to client
            sendMessage(clientInfo.ws, MessageTypes.AGENT_OUTPUT, {
              type: output.type,
              data: output.data,
              executionId: output.executionId
            });
          },
          onStateChange: (stateData) => {
            // Stream agent state changes to client
            broadcastToClient(clientInfo, MessageTypes.AGENT_STATE_CHANGE, {
              state: stateData.state,
              executionId: stateData.executionId
            });
          }
        }
      );

      sendMessage(clientInfo.ws, MessageTypes.AGENT_PLAN, plan, message.id);

    } else if (mode === 'execute') {
      if (!options.planId) {
        throw new Error('Plan ID required for execution');
      }

      const execution = await orchestrator.executePlan(
        options.planId,
        clientInfo.session.id,
        clientInfo.worktree  // Pass worktree from session initialization
      );

      sendMessage(clientInfo.ws, 'execution-started', {
        executionId: execution.id,
        planId: options.planId
      }, message.id);

    } else {
      throw new Error(`Invalid execution mode: ${mode}`);
    }

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleAgentInteraction(message, clientInfo) {
  try {
    const { message: agentMessage, type } = message.data;

    if (!clientInfo.agent) {
      throw new Error('No active agent');
    }

    await clientInfo.agent.sendInteraction(agentMessage);

    sendMessage(clientInfo.ws, 'interaction-sent', {
      type: type || 'message'
    }, message.id);

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleApprovePlan(message, clientInfo) {
  try {
    const { planId, modifications } = message.data;

    const plan = planner.approvePlan(planId);

    sendMessage(clientInfo.ws, 'plan-approved', {
      planId,
      plan
    }, message.id);

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleRejectPlan(message, clientInfo) {
  try {
    const { planId, reason } = message.data;

    const plan = planner.rejectPlan(planId, reason);

    sendMessage(clientInfo.ws, 'plan-rejected', {
      planId,
      reason
    }, message.id);

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleAbortExecution(message, clientInfo) {
  try {
    const { executionId, reason } = message.data;

    const execution = await orchestrator.abortExecution(executionId);

    sendMessage(clientInfo.ws, 'execution-aborted', {
      executionId,
      reason
    }, message.id);

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleGeneratePR(message, clientInfo) {
  try {
    const { executionId, title, description, baseBranch } = message.data;

    const pr = await orchestrator.generatePR(executionId, {
      title,
      description,
      baseBranch
    });

    sendMessage(clientInfo.ws, MessageTypes.PR_CREATED, pr, message.id);

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleHealthCheck(message, clientInfo) {
  sendMessage(clientInfo.ws, 'health-check-response', {
    status: 'healthy',
    timestamp: new Date().toISOString()
  }, message.id);
}

async function handleEmergencyKillSwitch(message, clientInfo, sessionManager) {
  try {
    if (!clientInfo.session) {
      throw new Error('Not authenticated');
    }

    const reason = message.data?.reason || 'Emergency kill switch activated';
    const abortedExecutions = await orchestrator.emergencyStop(reason);
    const terminatedSessions = await sessionManager.emergencyKillSwitch(reason);

    clientInfo.session = null;

    sendMessage(clientInfo.ws, MessageTypes.EMERGENCY_KILL_CONFIRMED, {
      abortedExecutions,
      terminatedSessions
    }, message.id);
  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleCleanupWorktree(message, clientInfo) {
  try {
    const { executionId } = message.data;

    await orchestrator.cleanupWorktree(executionId);

    sendMessage(clientInfo.ws, 'worktree-cleanup-complete', {
      executionId
    }, message.id);

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

async function handleAgentFeedback(message, clientInfo) {
  try {
    const { executionId, feedback } = message.data;

    // Forward feedback to the active agent
    const execution = orchestrator.getExecution(executionId);

    if (!execution) {
      throw new Error('Execution not found');
    }

    if (!execution.agent) {
      throw new Error('No active agent for this execution');
    }

    await execution.agent.sendInteraction(feedback);

    sendMessage(clientInfo.ws, 'feedback-sent', {
      executionId,
      success: true
    }, message.id);

  } catch (error) {
    sendError(clientInfo.ws, error.message, message.id);
  }
}

function sendMessage(ws, type, data = {}, messageId = null) {
  const message = createMessage(type, data, messageId);
  const json = JSON.stringify(message);
  logger.info(`Sending message type=${type} length=${json.length} bytes`);
  ws.send(json);
}

function sendError(ws, error, messageId = null) {
  const message = createErrorMessage(error, messageId);
  ws.send(JSON.stringify(message));
}

function broadcastToClient(clientInfo, type, data) {
  const message = createMessage(type, data);
  const json = JSON.stringify(message);
  logger.info(`Broadcasting message type=${type} length=${json.length} bytes`);
  clientInfo.ws.send(json);
}
