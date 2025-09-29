import jwt from 'jsonwebtoken';
import { generateRandomToken, hashData } from './crypto.js';
import { logger } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const AUDIT_LOG_PATH = path.join(os.homedir(), '.prompt-dock', 'audit.log');

export class SessionManager {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
    this.commandHistory = new Map();
    this.jwtSecret = generateRandomToken(64);
    this.tokenRefreshThresholdMs = this.computeRefreshThreshold();

    setInterval(() => this.cleanupExpiredSessions(), 60000);
  }

  async createSession(pairingData) {
    const sessionId = generateRandomToken(32);
    const now = Date.now();
    const expiresAt = now + (this.config.security.sessionTimeout || 3600000);

    const sessionData = {
      id: sessionId,
      appName: pairingData.appName,
      appUrl: pairingData.appUrl,
      clientPublicKey: pairingData.clientPublicKey,
      createdAt: now,
      expiresAt,
      lastActivity: now,
      commandCount: 0,
      executedCommands: new Set(),
      token: null,
      tokenIssuedAt: now,
      latestToken: null,
      rateLimit: this.createRateLimitState()
    };

    const token = this.generateJwt(sessionId, pairingData.appName, pairingData.appUrl);
    sessionData.token = token;
    sessionData.latestToken = token;

    this.sessions.set(sessionId, sessionData);

    await this.auditLog('session_created', {
      sessionId,
      appName: pairingData.appName,
      appUrl: pairingData.appUrl
    });

    logger.info(`Session created for ${pairingData.appName} (${sessionId})`);

    return {
      id: sessionId,
      token,
      expiresAt
    };
  }

  validateSession(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      const session = this.sessions.get(decoded.sessionId);

      if (!session) {
        logger.warn('Session not found for valid token');
        return null;
      }

      if (Date.now() > session.expiresAt) {
        logger.warn(`Session expired: ${session.id}`);
        this.sessions.delete(session.id);
        return null;
      }

       if (session.token !== token) {
        logger.warn(`Token mismatch for session ${session.id}`);
        return null;
      }

      session.lastActivity = Date.now();
      session.expiresAt = Date.now() + (this.config.security.sessionTimeout || 3600000);

      const tokenAge = Date.now() - (session.tokenIssuedAt || session.createdAt);
      if (tokenAge >= this.tokenRefreshThresholdMs) {
        this.issueSessionToken(session.id, session.appName, session.appUrl);
      }

      session.latestToken = session.token;

      return session;
    } catch (error) {
      logger.warn('Invalid session token:', error.message);
      return null;
    }
  }

  getSessionByToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      const session = this.sessions.get(decoded.sessionId);
      if (!session) {
        return null;
      }

      if (Date.now() > session.expiresAt) {
        this.sessions.delete(session.id);
        return null;
      }

      if (session.token !== token) {
        return null;
      }

      return session;
    } catch (error) {
      logger.warn('Failed to resolve session by token:', error.message);
      return null;
    }
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  revokeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.sessions.delete(sessionId);
    this.commandHistory.delete(sessionId);

    this.auditLog('session_revoked', {
      sessionId,
      appName: session.appName
    }).catch(err => logger.error('Failed to log session revocation:', err));

    logger.info(`Session revoked: ${sessionId}`);
    return true;
  }

  getActiveSessions() {
    this.cleanupExpiredSessions();
    return Array.from(this.sessions.values());
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(sessionId);
        this.commandHistory.delete(sessionId);
        logger.verbose(`Cleaned up expired session: ${sessionId}`);
      }
    }
  }

  async validateCommand(sessionId, commandId, commandData) {
    const session = this.getSession(sessionId);
    if (!session) {
      return { allowed: false, reason: 'Session expired or revoked' };
    }

    const rateLimitResult = this.applyRateLimiting(session);

    if (!rateLimitResult.allowed) {
      return rateLimitResult;
    }

    const commandHash = hashData(commandId + JSON.stringify(commandData));

    if (session.executedCommands.has(commandHash)) {
      logger.warn(`Replay attack detected for session ${sessionId}`);
      await this.auditLog('replay_attack_detected', {
        sessionId,
        commandId,
        appName: session.appName
      });
      return { allowed: false, reason: 'Replay detected' };
    }

    // Don't mark command as executed until after all validation passes
    const validationResult = { allowed: true };

    // Only mark as executed after successful validation
    session.executedCommands.add(commandHash);
    session.commandCount++;

    const recentCommands = this.commandHistory.get(sessionId) || [];
    recentCommands.push({
      commandId,
      timestamp: Date.now(),
      type: commandData.type
    });

    if (recentCommands.length > 100) {
      recentCommands.shift();
    }

    this.commandHistory.set(sessionId, recentCommands);

    return { allowed: true };
  }

  async auditLog(action, data) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      action,
      data
    };

    try {
      await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
      await fs.appendFile(AUDIT_LOG_PATH, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      logger.error('Failed to write audit log:', error);
    }
  }

  async emergencyKillSwitch(reason = 'Emergency kill switch activated') {
    logger.warn(`EMERGENCY KILL SWITCH ACTIVATED: ${reason}`);

    const activeSessions = Array.from(this.sessions.values());

    this.sessions.clear();
    this.commandHistory.clear();

    await this.auditLog('emergency_kill_switch', {
      sessionCount: activeSessions.length,
      sessions: activeSessions.map(s => ({
        id: s.id,
        appName: s.appName
      })),
      reason
    });

    return activeSessions;
  }

  computeRefreshThreshold() {
    const timeout = this.config?.security?.sessionTimeout || 3600000;
    const halfTimeout = Math.floor(timeout / 2);
    const fifteenMinutes = 15 * 60 * 1000;
    return Math.min(halfTimeout, fifteenMinutes);
  }

  issueSessionToken(sessionId, appName, appUrl) {
    const token = this.generateJwt(sessionId, appName, appUrl);

    const session = this.sessions.get(sessionId);
    if (session) {
      session.token = token;
      session.tokenIssuedAt = Date.now();
      session.latestToken = token;
    }

    return token;
  }

  generateJwt(sessionId, appName, appUrl) {
    return jwt.sign(
      {
        sessionId,
        appName,
        appUrl
      },
      this.jwtSecret,
      { expiresIn: '1h' }
    );
  }

  applyRateLimiting(session) {
    if (!session.rateLimit) {
      session.rateLimit = this.createRateLimitState();
    }

    const rateLimit = session.rateLimit;
    const now = Date.now();
    const maxCommandsPerMinute = this.config.security.maxCommandsPerMinute || 100;

    if (rateLimit.backoffUntil && now < rateLimit.backoffUntil) {
      const waitSeconds = Math.ceil((rateLimit.backoffUntil - now) / 1000);
      return {
        allowed: false,
        reason: `Rate limit backoff in effect. Try again in ${waitSeconds}s`
      };
    }

    if (now > rateLimit.resetTime) {
      rateLimit.count = 0;
      rateLimit.resetTime = now + 60000;
      rateLimit.penaltyLevel = Math.max(rateLimit.penaltyLevel - 1, 0);
    }

    rateLimit.count += 1;

    if (rateLimit.count > maxCommandsPerMinute) {
      rateLimit.penaltyLevel += 1;
      const backoffSeconds = Math.min(60, 2 ** rateLimit.penaltyLevel);
      rateLimit.backoffUntil = now + backoffSeconds * 1000;
      rateLimit.count = 0;
      rateLimit.resetTime = now + 60000;
      return {
        allowed: false,
        reason: `Rate limit exceeded. Cooling down for ${backoffSeconds}s`
      };
    }

    rateLimit.backoffUntil = null;
    return { allowed: true };
  }

  createRateLimitState() {
    const now = Date.now();
    return {
      count: 0,
      resetTime: now + 60000,
      penaltyLevel: 0,
      backoffUntil: null
    };
  }
}
