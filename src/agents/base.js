import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export class BaseAgent extends EventEmitter {
  constructor(name, config = {}) {
    super();
    this.name = name;
    this.config = config;
    this.process = null;
    this.executionId = null;
    this.status = 'idle';
    this.commandQueue = [];
    this.currentCommand = null;
    this.outputBuffer = '';
    this.errorBuffer = '';
    this.timeout = config.timeout || 300000;
    this.retryAttempts = 0;
    this.maxRetries = config.retryAttempts || 3;
    this.maxBufferSize = config.maxBufferBytes || 4 * 1024 * 1024;
  }

  async detectInstallation() {
    throw new Error('detectInstallation must be implemented by subclass');
  }

  async getVersion() {
    throw new Error('getVersion must be implemented by subclass');
  }

  async executeInPlanMode(prompt, workdir) {
    throw new Error('executeInPlanMode must be implemented by subclass');
  }

  async executePrompt(prompt, workdir, options = {}) {
    throw new Error('executePrompt must be implemented by subclass');
  }

  async sendInteraction(message) {
    if (!this.process || this.status !== 'executing') {
      throw new Error('No active agent process');
    }

    try {
      this.process.stdin.write(message + '\n');
      logger.verbose(`Sent interaction to ${this.name}: ${message.substring(0, 100)}...`);
    } catch (error) {
      logger.error(`Failed to send interaction to ${this.name}:`, error);
      throw error;
    }
  }

  spawnProcess(command, args, options = {}) {
    return new Promise((resolve, reject) => {
      const spawnOptions = {
        cwd: options.workdir || process.cwd(),
        env: { ...process.env, ...options.env },
        shell: false
      };

      logger.verbose(`Spawning ${this.name}: ${command} ${args.join(' ')}`);

      this.process = spawn(command, args, spawnOptions);
      this.executionId = uuidv4();
      this.status = 'executing';

      const timeoutHandle = setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGTERM');
          reject(new Error(`${this.name} execution timed out after ${this.timeout}ms`));
        }
      }, this.timeout);

      this.process.stdout.on('data', (data) => {
        const output = data.toString();
        this.outputBuffer += output;
        this.trimBuffer('outputBuffer');

        this.emit('output', {
          type: 'stdout',
          data: output,
          executionId: this.executionId,
          timestamp: new Date().toISOString()
        });

        if (options.onOutput) {
          options.onOutput(output);
        }
      });

      this.process.stderr.on('data', (data) => {
        const error = data.toString();
        this.errorBuffer += error;
        this.trimBuffer('errorBuffer');

        this.emit('output', {
          type: 'stderr',
          data: error,
          executionId: this.executionId,
          timestamp: new Date().toISOString()
        });

        if (options.onError) {
          options.onError(error);
        }
      });

      this.process.on('close', (code) => {
        clearTimeout(timeoutHandle);
        this.status = 'idle';

        const result = {
          code,
          stdout: this.outputBuffer,
          stderr: this.errorBuffer,
          executionId: this.executionId
        };

        this.outputBuffer = '';
        this.errorBuffer = '';
        this.executionId = null;
        this.process = null;

        if (code === 0 || options.allowNonZeroExit) {
          resolve(result);
        } else {
          reject(new Error(`${this.name} exited with code ${code}\n${this.errorBuffer}`));
        }
      });

      this.process.on('error', (error) => {
        clearTimeout(timeoutHandle);
        this.status = 'idle';
        this.process = null;
        reject(error);
      });

      if (options.input) {
        this.process.stdin.write(options.input);
        if (options.closeStdin !== false) {
          this.process.stdin.end();
        }
      }
    });
  }

  async kill() {
    if (this.process) {
      logger.info(`Killing ${this.name} process`);

      return new Promise((resolve) => {
        const forceKillTimeout = setTimeout(() => {
          if (this.process) {
            logger.warn(`Force killing ${this.name} process`);
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        this.process.once('exit', () => {
          clearTimeout(forceKillTimeout);
          this.process = null;
          this.status = 'idle';
          resolve();
        });

        this.process.kill('SIGTERM');
      });
    }
  }

  async cleanup() {
    await this.kill();
    this.removeAllListeners();
    this.commandQueue = [];
    this.currentCommand = null;
  }

  parseOutput(output) {
    return output;
  }

  extractPlan(output) {
    return output;
  }

  extractModifiedFiles(output) {
    const files = [];
    const filePatterns = [
      /(?:modified|changed|updated|created|deleted):\s+(.+)/gi,
      /\+\+\+ b\/(.+)/g,
      /File:\s+(.+)/gi
    ];

    for (const pattern of filePatterns) {
      const matches = output.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && !files.includes(match[1])) {
          files.push(match[1]);
        }
      }
    }

    return files;
  }

  normalizeOutput(output) {
    return {
      raw: output,
      text: this.parseOutput(output),
      modifiedFiles: this.extractModifiedFiles(output),
      timestamp: new Date().toISOString()
    };
  }

  trimBuffer(bufferName) {
    if (!this.maxBufferSize) {
      return;
    }

    const bufferValue = this[bufferName];

    if (typeof bufferValue !== 'string') {
      return;
    }

    if (bufferValue.length > this.maxBufferSize) {
      this[bufferName] = bufferValue.slice(bufferValue.length - this.maxBufferSize);
    }
  }
}
