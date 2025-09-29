#!/usr/bin/env node

/**
 * Prompt Dock Bridge - Example Client
 *
 * This example demonstrates how to properly connect to the Prompt Dock Bridge
 * with cryptographic signing, origin validation, and proper error handling.
 *
 * Usage:
 *   node examples/client.js --prompt "Add error handling to the login function"
 */

import crypto from 'crypto';
import WebSocket from 'ws';
import { program } from 'commander';
import canonicalize from 'canonicalize';

class PromptDockClient {
  constructor(options = {}) {
    this.bridgeUrl = options.bridgeUrl || 'http://localhost:51720';
    this.wsUrl = options.wsUrl || 'ws://localhost:51721';
    this.origin = options.origin || 'http://localhost:3000';

    this.keyPair = null;
    this.sessionToken = null;
    this.sessionId = null;
    this.ws = null;
    this.messageHandlers = new Map();
    this.pendingMessages = new Map();
  }

  /**
   * Generate RSA key pair for client authentication
   */
  generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    this.keyPair = { publicKey, privateKey };
    return this.keyPair;
  }

  /**
   * Sign a message with the client's private key
   */
  signMessage(message) {
    if (!this.keyPair?.privateKey) {
      throw new Error('No private key available for signing');
    }

    const payload = {
      type: message.type,
      timestamp: message.timestamp,
      nonce: message.nonce || null,
      data: canonicalize(message.data || {})
    };

    const serialized = JSON.stringify(payload);
    const signature = crypto.sign('SHA256', Buffer.from(serialized));
    return signature.sign(this.keyPair.privateKey, 'base64');
  }

  /**
   * Generate pairing code via HTTP API
   */
  async generatePairingCode() {
    const response = await fetch(`${this.bridgeUrl}/api/pairing/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': this.origin
      },
      body: JSON.stringify({
        appName: 'Example Client',
        appUrl: this.origin
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Pairing generation failed: ${error.error || response.statusText}`);
    }

    const pairing = await response.json();
    console.log(`Pairing Code: ${pairing.code}`);
    console.log(`Expires: ${new Date(pairing.expiresAt).toLocaleString()}`);
    console.log('Enter this code in the bridge terminal when prompted.');

    return pairing;
  }

  /**
   * Complete pairing flow
   */
  async completePairing(pairingCode) {
    if (!this.keyPair) {
      this.generateKeyPair();
    }

    const response = await fetch(`${this.bridgeUrl}/api/pairing/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': this.origin
      },
      body: JSON.stringify({
        code: pairingCode,
        clientPublicKey: this.keyPair.publicKey
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Pairing verification failed: ${error.error || response.statusText}`);
    }

    const result = await response.json();
    this.sessionToken = result.token;
    this.sessionId = result.sessionId;

    console.log('Pairing successful!');
    return result;
  }

  /**
   * Connect to WebSocket server
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, {
        headers: {
          origin: this.origin
        }
      });

      this.ws.on('open', () => {
        console.log('WebSocket connected');
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`WebSocket closed: ${code} ${reason}`);
      });
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(message) {
    console.log(`Received: ${message.type}`);

    // Handle responses to pending requests
    if (message.id && this.pendingMessages.has(message.id)) {
      const { resolve } = this.pendingMessages.get(message.id);
      this.pendingMessages.delete(message.id);
      resolve(message);
      return;
    }

    // Handle specific message types
    switch (message.type) {
      case 'connected':
        console.log(`Connected to bridge v${message.data.version}`);
        break;
      case 'pairing-success':
        this.sessionToken = message.data.token;
        this.sessionId = message.data.sessionId;
        console.log('WebSocket pairing successful');
        break;
      case 'auth-success':
        if (message.data.token) {
          this.sessionToken = message.data.token;
        }
        console.log('Authentication successful');
        break;
      case 'agents-available':
        console.log('Available agents:', message.data.agents.map(a => `${a.name} v${a.version}`));
        break;
      case 'agent-plan':
        console.log('\n=== EXECUTION PLAN ===');
        console.log(message.data.plan);
        console.log('\nFiles to modify:', message.data.modifiedFiles);
        if (message.data.metadata) {
          console.log('Complexity:', message.data.metadata.complexity);
          console.log('Risk Level:', message.data.metadata.riskLevel);
        }
        console.log('======================\n');
        break;
      case 'agent-output':
        process.stdout.write(message.data.data);
        break;
      case 'execution-progress':
        console.log(`Progress: ${message.data.progress}% (${message.data.status})`);
        break;
      case 'execution-complete':
        console.log('\n=== EXECUTION COMPLETE ===');
        console.log('Success:', message.data.result.success);
        console.log('Summary:', message.data.result.summary);
        console.log('Modified files:', message.data.modifiedFiles);
        console.log('===========================\n');
        break;
      case 'error':
        console.error(`Bridge error: ${message.data.error}`);
        break;
      default:
        console.log('Unhandled message:', message);
    }
  }

  /**
   * Send signed message and optionally wait for response
   */
  async sendMessage(type, data, waitForResponse = false) {
    const message = {
      id: crypto.randomUUID(),
      type,
      data,
      timestamp: new Date().toISOString(),
      nonce: crypto.randomBytes(16).toString('hex')
    };

    // Sign message if not a health check
    if (type !== 'health-check') {
      message.signature = this.signMessage(message);
    }

    // Set up response handler if needed
    let responsePromise;
    if (waitForResponse) {
      responsePromise = new Promise((resolve, reject) => {
        this.pendingMessages.set(message.id, { resolve, reject });

        // Timeout after 30 seconds
        setTimeout(() => {
          if (this.pendingMessages.has(message.id)) {
            this.pendingMessages.delete(message.id);
            reject(new Error('Message timeout'));
          }
        }, 30000);
      });
    }

    // Send message
    this.ws.send(JSON.stringify(message));

    return responsePromise;
  }

  /**
   * Authenticate with session token
   */
  async authenticate() {
    if (!this.sessionToken) {
      throw new Error('No session token available');
    }

    await this.sendMessage('authenticate', {
      token: this.sessionToken
    });
  }

  /**
   * Initialize session with working directory
   */
  async initSession(workdir, agentType = 'claude-code') {
    await this.sendMessage('init-session', {
      workdir,
      agentType,
      agentConfig: {}
    });
  }

  /**
   * Get git status
   */
  async getGitStatus(workdir) {
    return await this.sendMessage('git-status', {
      workdir
    }, true);
  }

  /**
   * Execute prompt in plan mode
   */
  async executePlan(prompt, options = {}) {
    return await this.sendMessage('execute-prompt', {
      prompt,
      mode: 'plan',
      options
    }, true);
  }

  /**
   * Approve and execute plan
   */
  async approvePlan(planId, modifications = '') {
    await this.sendMessage('approve-plan', {
      planId,
      modifications
    });
  }

  /**
   * Execute approved plan
   */
  async executePrompt(prompt, planId, options = {}) {
    return await this.sendMessage('execute-prompt', {
      prompt,
      mode: 'execute',
      options: {
        ...options,
        planId
      }
    }, true);
  }

  /**
   * Close connection
   */
  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

/**
 * Interactive CLI prompt
 */
function askQuestion(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.once('data', (data) => {
      resolve(data.toString().trim());
    });
  });
}

/**
 * Main execution flow
 */
async function main() {
  program
    .option('-p, --prompt <prompt>', 'Prompt to execute')
    .option('-w, --workdir <workdir>', 'Working directory', process.cwd())
    .option('-a, --agent <agent>', 'Agent type', 'claude-code')
    .option('--bridge-url <url>', 'Bridge URL', 'http://localhost:51720')
    .option('--ws-url <url>', 'WebSocket URL', 'ws://localhost:51721')
    .option('--origin <origin>', 'Origin header', 'http://localhost:3000')
    .parse();

  const options = program.opts();
  const client = new PromptDockClient({
    bridgeUrl: options.bridgeUrl,
    wsUrl: options.wsUrl,
    origin: options.origin
  });

  try {
    // Generate keys
    console.log('Generating client key pair...');
    client.generateKeyPair();

    // Generate pairing code
    console.log('Generating pairing code...');
    const pairing = await client.generatePairingCode();

    // Wait for user to enter code in bridge
    await askQuestion('Press Enter after entering the pairing code in the bridge terminal...');

    // Complete pairing
    console.log('Completing pairing...');
    await client.completePairing(pairing.code);

    // Connect WebSocket
    console.log('Connecting to WebSocket...');
    await client.connect();

    // Authenticate
    console.log('Authenticating...');
    await client.authenticate();

    // Initialize session
    console.log(`Initializing session with workdir: ${options.workdir}`);
    await client.initSession(options.workdir, options.agent);

    // Get git status
    console.log('Getting git status...');
    const gitStatus = await client.getGitStatus(options.workdir);
    if (gitStatus.data.isGitRepo) {
      console.log(`Git repo: ${gitStatus.data.currentBranch} (clean: ${gitStatus.data.isClean})`);
    } else {
      console.log('Not a git repository');
    }

    // Execute prompt if provided
    if (options.prompt) {
      console.log(`\nExecuting prompt: "${options.prompt}"`);

      // Generate plan
      console.log('Generating execution plan...');
      const planResponse = await client.executePlan(options.prompt);

      if (planResponse.type === 'agent-plan') {
        const plan = planResponse.data;

        // Ask user to approve plan
        const approval = await askQuestion('\nApprove this plan? (y/N): ');

        if (approval.toLowerCase() === 'y' || approval.toLowerCase() === 'yes') {
          console.log('Approving and executing plan...');
          await client.approvePlan(plan.id);
          await client.executePrompt(options.prompt, plan.id);

          // Keep connection open to see execution output
          console.log('Execution started. Press Ctrl+C to exit.');

          // Handle graceful shutdown
          process.on('SIGINT', () => {
            console.log('\nShutting down...');
            client.close();
            process.exit(0);
          });

          // Keep process running
          setInterval(() => {}, 1000);
        } else {
          console.log('Plan rejected by user');
        }
      } else {
        console.error('Failed to generate plan:', planResponse);
      }
    } else {
      console.log('\nReady! Use --prompt "your prompt here" to execute commands.');
      client.close();
    }

  } catch (error) {
    console.error('Error:', error.message);
    client.close();
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default PromptDockClient;