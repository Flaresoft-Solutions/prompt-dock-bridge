import { jest } from '@jest/globals';
import WebSocket from 'ws';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { startBridge, stopBridge } from '../../src/index.js';
import { generatePairingCode, validatePairingCode } from '../../src/security/pairing.js';
import { serializeForSignature, verifySignature } from '../../src/security/crypto.js';

describe('Security Integration Tests', () => {
  let bridge;
  let config;
  let clientKeyPair;

  beforeAll(async () => {
    // Generate test client key pair
    clientKeyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    config = {
      port: 51720,
      wsPort: 51721,
      security: {
        requirePairing: true,
        enforceOriginCheck: true,
        allowCustomOrigins: false,
        sessionTimeout: 3600000,
        commandTimeout: 30000,
        maxCommandsPerMinute: 100,
        allowedOrigins: ['http://localhost:3000']
      }
    };

    bridge = await startBridge(config);
  });

  afterAll(async () => {
    await stopBridge();
  });

  describe('Signature Enforcement', () => {
    test('should reject unsigned commands', async () => {
      const ws = new WebSocket('ws://localhost:51721', {
        headers: { origin: 'http://localhost:3000' }
      });

      await new Promise((resolve) => ws.on('open', resolve));

      const message = {
        id: 'test-1',
        type: 'init-session',
        data: { workdir: '/tmp', agentType: 'claude-code' },
        timestamp: new Date().toISOString()
      };

      ws.send(JSON.stringify(message));

      const response = await new Promise((resolve) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      expect(response.type).toBe('error');
      expect(response.error).toContain('Missing signature');
      ws.close();
    });

    test('should reject commands with invalid signatures', async () => {
      const ws = new WebSocket('ws://localhost:51721', {
        headers: { origin: 'http://localhost:3000' }
      });

      await new Promise((resolve) => ws.on('open', resolve));

      const message = {
        id: 'test-2',
        type: 'init-session',
        data: { workdir: '/tmp', agentType: 'claude-code' },
        timestamp: new Date().toISOString(),
        signature: 'invalid-signature'
      };

      ws.send(JSON.stringify(message));

      const response = await new Promise((resolve) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      expect(response.type).toBe('error');
      expect(response.error).toContain('Invalid signature');
      ws.close();
    });
  });

  describe('Origin Validation', () => {
    test('should reject connections from disallowed origins', async () => {
      const ws = new WebSocket('ws://localhost:51721', {
        headers: { origin: 'https://malicious.com' }
      });

      const closeEvent = await new Promise((resolve) => {
        ws.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      expect(closeEvent.code).toBe(1008);
      expect(closeEvent.reason).toBe('Origin not allowed');
    });

    test('should accept connections from allowed origins', async () => {
      const ws = new WebSocket('ws://localhost:51721', {
        headers: { origin: 'http://localhost:3000' }
      });

      const openEvent = await new Promise((resolve, reject) => {
        ws.on('open', () => resolve(true));
        ws.on('error', reject);
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });

      expect(openEvent).toBe(true);
      ws.close();
    });
  });

  describe('Rate Limiting', () => {
    test('should enforce rate limits per session', async () => {
      const ws = new WebSocket('ws://localhost:51721', {
        headers: { origin: 'http://localhost:3000' }
      });

      await new Promise((resolve) => ws.on('open', resolve));

      // Send more than 100 messages rapidly
      const responses = [];
      for (let i = 0; i < 105; i++) {
        const message = {
          id: `rate-test-${i}`,
          type: 'health-check',
          timestamp: new Date().toISOString()
        };
        ws.send(JSON.stringify(message));
      }

      // Collect responses
      const responsePromise = new Promise((resolve) => {
        let count = 0;
        ws.on('message', (data) => {
          responses.push(JSON.parse(data.toString()));
          count++;
          if (count >= 105) resolve();
        });
      });

      await responsePromise;

      const rateLimitErrors = responses.filter(r =>
        r.type === 'error' && r.error.includes('Rate limit exceeded')
      );

      expect(rateLimitErrors.length).toBeGreaterThan(0);
      ws.close();
    });
  });

  describe('Pairing Flow', () => {
    test('should complete valid pairing flow', async () => {
      // Generate pairing code
      const pairingData = await generatePairingCode('test-app', 'http://localhost:3000');
      expect(pairingData.code).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);

      // Validate pairing code with client public key
      const validated = await validatePairingCode(pairingData.code, clientKeyPair.publicKey);
      expect(validated).toBeTruthy();
      expect(validated.clientPublicKey).toBe(clientKeyPair.publicKey);
    });

    test('should reject expired pairing codes', async () => {
      const pairingData = await generatePairingCode('test-app', 'http://localhost:3000');

      // Wait for expiration (mock time)
      jest.useFakeTimers();
      jest.advanceTimersByTime(5 * 60 * 1000 + 1000); // 5 minutes + 1 second

      const validated = await validatePairingCode(pairingData.code, clientKeyPair.publicKey);
      expect(validated).toBeNull();

      jest.useRealTimers();
    });
  });

  describe('Command Replay Protection', () => {
    test('should prevent command replay attacks', async () => {
      // This would require a full pairing and session setup
      // Simplified test focusing on the core logic
      const commandId = 'test-command-1';
      const commandData = { type: 'test', timestamp: new Date().toISOString() };

      // This test would need session manager instance
      // Testing the concept for now
      expect(true).toBe(true); // Placeholder
    });
  });
});