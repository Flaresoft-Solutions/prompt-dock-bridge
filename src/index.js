import { createHTTPServer } from './server/http.js';
import { createWebSocketServer } from './server/websocket.js';
import { logger } from './utils/logger.js';
import { loadConfig, ensureConfigDir } from './utils/config.js';
import { detectAgents } from './agents/detector.js';
import { initializeSecurity } from './security/crypto.js';
import { SessionManager } from './security/session.js';
import { gracefulShutdown } from './utils/shutdown.js';
import path from 'path';
import os from 'os';

let httpServer = null;
let wsServer = null;
let sessionManager = null;
let config = null;

export async function startBridge(options = {}) {
  try {
    await ensureConfigDir();

    const overrides = buildConfigOverrides(options);
    config = await loadConfig({ path: options.config, overrides });

    logger.info('Initializing Prompt Dock Bridge...');

    await initializeSecurity();

    const detectedAgents = await detectAgents();
    logger.info(`Detected agents: ${detectedAgents.map(a => a.name).join(', ')}`);

    if (detectedAgents.length === 0) {
      logger.warn('No AI agents detected. Please install Claude Code, Cursor CLI, or Codex CLI.');
    }

    sessionManager = new SessionManager(config);

    httpServer = await createHTTPServer(config, sessionManager);
    wsServer = await createWebSocketServer(config, sessionManager);

    process.on('SIGINT', () => gracefulShutdown(httpServer, wsServer, sessionManager));
    process.on('SIGTERM', () => gracefulShutdown(httpServer, wsServer, sessionManager));

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      gracefulShutdown(httpServer, wsServer, sessionManager);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      gracefulShutdown(httpServer, wsServer, sessionManager);
    });

    logger.info(`Bridge started on port ${config.port} (HTTP) and ${config.wsPort} (WebSocket)`);

    return {
      httpServer,
      wsServer,
      sessionManager,
      config
    };
  } catch (error) {
    logger.error('Failed to start bridge:', error);
    throw error;
  }
}

function buildConfigOverrides(options) {
  const overrides = {};

  const envHub = process.env.PROMPT_DOCK_HUB;
  if (envHub) {
    overrides.hub = envHub;
  }

  if (options?.hub) {
    overrides.hub = options.hub;
  }

  if (options?.port) {
    const port = parseInt(options.port, 10);
    if (!Number.isNaN(port)) {
      overrides.port = port;
      overrides.wsPort = port + 1;
    }
  }

  if (options?.wsPort) {
    const wsPort = parseInt(options.wsPort, 10);
    if (!Number.isNaN(wsPort)) {
      overrides.wsPort = wsPort;
    }
  }

  if (options?.agent) {
    overrides.agents = {
      preferred: options.agent
    };
  }

  if (options?.allowedOrigins) {
    overrides.allowedOrigins = options.allowedOrigins;
  }

  if (options?.customOrigins) {
    overrides.customOrigins = options.customOrigins;
  }

  return overrides;
}

export async function stopBridge() {
  logger.info('Stopping bridge...');
  await gracefulShutdown(httpServer, wsServer, sessionManager);
}

export async function getStatus() {
  const detectedAgents = await detectAgents();

  return {
    running: httpServer !== null,
    port: config?.port,
    wsPort: config?.wsPort,
    activeSessions: sessionManager?.getActiveSessions()?.length || 0,
    agents: detectedAgents.map(a => a.name)
  };
}

export default {
  startBridge,
  stopBridge,
  getStatus
};
