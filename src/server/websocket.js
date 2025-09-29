import { WebSocketServer } from 'ws';
import { handleMessage } from '../protocols/handler.js';
import { logger } from '../utils/logger.js';
import { verifySignature, serializeForSignature } from '../security/crypto.js';
import { v4 as uuidv4 } from 'uuid';
import { MessageTypes } from '../protocols/messages.js';

export async function createWebSocketServer(config, sessionManager) {
  const wss = new WebSocketServer({
    port: config.wsPort,
    host: '127.0.0.1',
    clientTracking: true,
    perMessageDeflate: false
  });

  const clients = new Map();

  wss.on('listening', () => {
    logger.info(`WebSocket server listening on port ${config.wsPort}`);
  });

  wss.on('connection', (ws, req) => {
    if (!isOriginAllowed(req.headers.origin, config)) {
      logger.warn(`Rejected WebSocket connection from origin: ${req.headers.origin || 'unknown'}`);
      ws.close(1008, 'Origin not allowed');
      return;
    }

    const clientId = uuidv4();
    const clientInfo = {
      id: clientId,
      ws,
      session: null,
      agent: null,
      workdir: null,
      lastActivity: Date.now(),
      messageCount: 0,
      rateLimit: {
        count: 0,
        resetTime: Date.now() + 60000
      }
    };

    clients.set(clientId, clientInfo);
    logger.info(`WebSocket client connected: ${clientId}`);

    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        clientInfo.lastActivity = Date.now();
        clientInfo.messageCount++;

        if (!message.id || !message.type) {
          ws.send(JSON.stringify({
            id: message.id || uuidv4(),
            type: 'error',
            error: 'Invalid message format',
            timestamp: new Date().toISOString()
          }));
          return;
        }

        enforceCommandTimestamp(message, config);

        if (Date.now() > clientInfo.rateLimit.resetTime) {
          clientInfo.rateLimit.count = 0;
          clientInfo.rateLimit.resetTime = Date.now() + 60000;
        }

        clientInfo.rateLimit.count++;
        if (clientInfo.rateLimit.count > config.security.maxCommandsPerMinute) {
          ws.send(JSON.stringify({
            id: message.id,
            type: 'error',
            error: 'Rate limit exceeded',
            timestamp: new Date().toISOString()
          }));
          return;
        }

        const signatureCheck = await verifyClientSignature({
          message,
          clientInfo,
          sessionManager,
          config
        });

        if (!signatureCheck.valid) {
          ws.send(JSON.stringify({
            id: message.id,
            type: 'error',
            error: signatureCheck.error || 'Signature verification failed',
            timestamp: new Date().toISOString()
          }));
          return;
        }

        await handleMessage(message, clientInfo, sessionManager, config);

      } catch (error) {
        logger.error('WebSocket message error:', error);
        ws.send(JSON.stringify({
          id: uuidv4(),
          type: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        }));
      }
    });

    ws.on('close', (code, reason) => {
      logger.info(`WebSocket client disconnected: ${clientId} (code: ${code})`);

      if (clientInfo.agent) {
        clientInfo.agent.cleanup().catch(err =>
          logger.error('Failed to cleanup agent:', err)
        );
      }

      clients.delete(clientId);
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket client error (${clientId}):`, error);
    });

    ws.send(JSON.stringify({
      id: uuidv4(),
      type: 'connected',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }));
  });

  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        logger.verbose('Terminating inactive WebSocket connection');
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(pingInterval);
    logger.info('WebSocket server closed');
  });

  return wss;
}

function isOriginAllowed(origin, config) {
  // Origin checks must ALWAYS be enforced for security
  if (!origin) {
    return false;
  }

  return (config.security.allowedOrigins || []).includes(origin);
}

function enforceCommandTimestamp(message, config) {
  if (!message.timestamp) {
    return;
  }

  const now = Date.now();
  const messageTime = new Date(message.timestamp).getTime();

  if (Number.isNaN(messageTime)) {
    return;
  }

  const clockSkewTolerance = Number.isFinite(config?.security?.clockSkewTolerance)
    ? config.security.clockSkewTolerance
    : 5000;

  if (messageTime > now + clockSkewTolerance) {
    throw new Error('Command timestamp is in the future');
  }

  const maxAge = config.security.commandTimeout || 30000;
  if (now - messageTime > maxAge) {
    throw new Error('Command expired');
  }
}

async function verifyClientSignature({ message, clientInfo, sessionManager, config }) {
  const requiresSignature = message.type !== MessageTypes.HEALTH_CHECK;

  if (!message.signature && requiresSignature) {
    return { valid: false, error: 'Missing signature' };
  }

  let publicKey = null;
  let sessionFromToken = null;

  try {
    if (message.type === MessageTypes.PAIR) {
      publicKey = message.data?.clientPublicKey;
      if (!publicKey) {
        return { valid: false, error: 'Client public key required for pairing' };
      }
    } else if (message.type === MessageTypes.AUTHENTICATE) {
      const token = message.data?.token;
      if (!token) {
        return { valid: false, error: 'Authentication token missing' };
      }

      sessionFromToken = sessionManager.getSessionByToken(token);

      if (!sessionFromToken) {
        return { valid: false, error: 'Invalid or expired session token' };
      }

      publicKey = sessionFromToken.clientPublicKey;
    } else {
      publicKey = clientInfo.session?.clientPublicKey;

      if (!clientInfo.session) {
        return { valid: false, error: 'Not authenticated' };
      }
    }

    if (!requiresSignature) {
      return { valid: true };
    }

    if (!publicKey) {
      return { valid: false, error: 'Missing public key for signature verification' };
    }

    const payload = serializeForSignature(message);

    const signatureValid = verifySignature(payload, message.signature, publicKey);

    if (!signatureValid) {
      return { valid: false, error: 'Invalid signature' };
    }

    return { valid: true };
  } catch (error) {
    logger.warn('Signature verification error:', error.message);
    return { valid: false, error: 'Signature verification error' };
  }
}
