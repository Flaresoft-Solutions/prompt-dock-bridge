import express from 'express';
import cors from 'cors';
import { generatePairingCode, validatePairingCode } from '../security/pairing.js';
import { logger } from '../utils/logger.js';
import { detectAgents } from '../agents/detector.js';
import { getGitStatus } from '../git/status.js';
import path from 'path';

export async function createHTTPServer(config, sessionManager) {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowedOrigins = config.security.allowedOrigins || [];

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  }));

  app.use((req, res, next) => {
    // Origin checks must ALWAYS be enforced for security
    const origin = req.headers.origin;

    if (origin && !(config.security.allowedOrigins || []).includes(origin)) {
      logger.warn(`Blocked HTTP request from disallowed origin: ${origin}`);
      return res.status(403).json({ error: 'Origin not allowed' });
    }

    next();
  });

  app.use((req, res, next) => {
    logger.verbose(`${req.method} ${req.path}`);
    next();
  });

  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      version: '1.0.0',
      uptime: process.uptime(),
      activeSessions: sessionManager.getActiveSessions().length
    });
  });

  app.post('/api/pairing/generate', async (req, res) => {
    try {
      const { appName, appUrl } = req.body;

      if (!appName || !appUrl) {
        return res.status(400).json({
          error: 'Missing appName or appUrl'
        });
      }

      const pairingData = await generatePairingCode(appName, appUrl);

      res.json({
        code: pairingData.code,
        expiresAt: pairingData.expiresAt,
        bridgePublicKey: pairingData.bridgePublicKey,
        publicKey: pairingData.bridgePublicKey
      });

      logger.info(`Generated pairing code for ${appName}: ${pairingData.code}`);
    } catch (error) {
      logger.error('Failed to generate pairing code:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/pairing/verify', async (req, res) => {
    try {
      const { code, clientPublicKey } = req.body;

      if (!code || !clientPublicKey) {
        return res.status(400).json({ error: 'Missing pairing code or client public key' });
      }

      const pairingData = await validatePairingCode(code, clientPublicKey);

      if (!pairingData) {
        return res.status(400).json({ error: 'Invalid or expired pairing code' });
      }

      const session = await sessionManager.createSession(pairingData);

      res.json({
        token: session.token,
        sessionId: session.id,
        bridgePublicKey: pairingData.bridgePublicKey,
        publicKey: pairingData.bridgePublicKey,
        expiresAt: session.expiresAt
      });

      logger.info(`Pairing successful for ${pairingData.appName}`);
    } catch (error) {
      logger.error('Failed to verify pairing code:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/agents', async (req, res) => {
    try {
      const agents = await detectAgents();
      res.json(agents);
    } catch (error) {
      logger.error('Failed to detect agents:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/git/status', async (req, res) => {
    try {
      const { workdir } = req.query;

      if (!workdir) {
        return res.status(400).json({ error: 'Missing workdir parameter' });
      }

      const gitStatus = await getGitStatus(workdir);
      res.json(gitStatus);
    } catch (error) {
      logger.error('Failed to get git status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/sessions', (req, res) => {
    try {
      const sessions = sessionManager.getActiveSessions();
      res.json(sessions.map(s => ({
        id: s.id,
        appName: s.appName,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity
      })));
    } catch (error) {
      logger.error('Failed to get sessions:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/sessions/:id', (req, res) => {
    try {
      const { id } = req.params;
      const success = sessionManager.revokeSession(id);

      if (success) {
        res.json({ message: 'Session revoked' });
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    } catch (error) {
      logger.error('Failed to revoke session:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.use((err, req, res, next) => {
    logger.error('Express error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, '127.0.0.1', () => {
      logger.info(`HTTP server listening on port ${config.port}`);
      resolve(server);
    });

    server.on('error', reject);
  });
}
