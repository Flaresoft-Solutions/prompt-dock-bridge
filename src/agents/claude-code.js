import { BaseAgent } from './base.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

export class ClaudeCodeAgent extends BaseAgent {
  constructor(config = {}) {
    super('claude-code', config);
    this.planOutput = '';
    this.isInPlanMode = false;
    this.claudePath = config.claudePath || null;
  }

  async detectInstallation() {
    // If user configured a specific path, use it
    if (this.claudePath && this.claudePath !== 'auto-detect') {
      try {
        const { stdout, stderr } = await execAsync(`${this.claudePath} --version`);
        const version = stdout.trim() || stderr.trim();
        return {
          installed: true,
          version,
          path: this.claudePath
        };
      } catch (error) {
        logger.error(`Configured Claude path ${this.claudePath} is invalid:`, error.message);
        return {
          installed: false,
          error: `Configured path ${this.claudePath} failed: ${error.message}`
        };
      }
    }

    // Auto-detect: Common installation paths for Claude Code
    const possiblePaths = [
      `${process.env.HOME}/.claude/local/claude`, // Most common location
      'claude', // In PATH
      `${process.env.HOME}/.claude-code/bin/claude`,
      `${process.env.HOME}/.local/bin/claude`,
      '/usr/local/bin/claude',
      '/usr/bin/claude'
    ];

    for (const cmdPath of possiblePaths) {
      try {
        const { stdout, stderr } = await execAsync(`${cmdPath} --version`);
        const version = stdout.trim() || stderr.trim();

        this.claudePath = cmdPath; // Store the working path

        return {
          installed: true,
          version,
          path: cmdPath
        };
      } catch (error) {
        continue;
      }
    }

    logger.verbose('Claude Code not detected in any common location');
    return {
      installed: false,
      error: 'Claude command not found in PATH or common installation directories'
    };
  }

  async getVersion() {
    const result = await this.detectInstallation();
    return result.installed ? result.version : null;
  }

  async executeInPlanMode(prompt, workdir) {
    this.isInPlanMode = true;
    this.planOutput = '';

    try {
      // Ensure we have the claude path
      if (!this.claudePath) {
        await this.detectInstallation();
      }

      const claudeCmd = this.claudePath || 'claude';

      logger.info(`Starting Claude Code streaming JSON session with plan mode`);
      logger.info(`Command: ${claudeCmd} -p --verbose --input-format stream-json --output-format stream-json --permission-mode plan`);
      logger.info(`Working directory: ${workdir}`);

      // Start streaming JSON session
      const args = ['-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--permission-mode', 'plan'];
      const spawnOptions = {
        cwd: workdir || process.cwd(),
        env: { ...process.env }
      };

      this.process = spawn(claudeCmd, args, spawnOptions);
      this.executionId = uuidv4();
      this.status = 'planning';

      let messageBuffer = '';

      return new Promise((resolve, reject) => {
        let planResolved = false;

        this.process.stdout.on('data', (data) => {
          const output = data.toString();
          messageBuffer += output;

          // Parse JSON messages line by line
          const lines = messageBuffer.split('\n');
          messageBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const message = JSON.parse(line);
              logger.info(`[Claude JSON]: ${JSON.stringify(message).substring(0, 200)}...`);

              // Emit the JSON message
              this.emit('output', {
                type: 'stdout',
                data: JSON.stringify(message),
                executionId: this.executionId,
                timestamp: new Date().toISOString()
              });

              // Extract plan text from assistant messages
              if (message.type === 'assistant' && message.message && message.message.content) {
                for (const block of message.message.content) {
                  if (block.type === 'text') {
                    this.planOutput += block.text;
                  }
                }
              }

              // Check if plan is complete and awaiting approval
              if (!planResolved && message.type === 'result') {
                planResolved = true;
                logger.info('Plan complete from result message');
                resolve({
                  success: true,
                  plan: this.planOutput,
                  raw: this.planOutput,
                  modifiedFiles: this.extractModifiedFiles(this.planOutput),
                  processKept: true
                });
              }
            } catch (err) {
              logger.error(`Failed to parse JSON: ${line}`, err);
            }
          }
        });

        this.process.stderr.on('data', (data) => {
          const error = data.toString();
          logger.error(`[Claude stderr]: ${error}`);

          this.emit('output', {
            type: 'stderr',
            data: error,
            executionId: this.executionId,
            timestamp: new Date().toISOString()
          });
        });

        this.process.on('close', (code) => {
          if (!planResolved) {
            logger.error(`Process closed with code ${code}`);
            reject(new Error(`claude-code exited with code ${code}`));
          }
        });

        // Send user message in correct stream-json format
        // In plan mode, just send the prompt directly - Claude Code will automatically
        // create a plan and wait for approval
        const userMessage = {
          type: 'user',
          message: {
            role: 'user',
            content: prompt
          }
        };
        this.process.stdin.write(JSON.stringify(userMessage) + '\n');
        logger.info(`Sent user message: ${prompt}`);
      });

    } catch (error) {
      logger.error('Claude Code plan mode failed:', error);
      return {
        success: false,
        error: error.message,
        raw: this.planOutput || error.message
      };
    }
  }

  async approvePlan() {
    if (!this.process || this.status !== 'planning') {
      throw new Error('No active planning session to approve');
    }

    logger.info('Sending approval message to claude-code');
    this.status = 'executing';

    // IMPORTANT: Remove ALL existing stdout listeners to prevent duplicate messages
    this.process.stdout.removeAllListeners('data');

    // Send approval as JSON message (just send another user message to continue)
    const approvalMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: 'Yes, please proceed with executing this plan.'
      }
    };
    this.process.stdin.write(JSON.stringify(approvalMessage) + '\n');

    return new Promise((resolve, reject) => {
      let executionOutput = '';
      let messageBuffer = '';

      const outputHandler = (data) => {
        const output = data.toString();
        messageBuffer += output;

        const lines = messageBuffer.split('\n');
        messageBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const message = JSON.parse(line);
            logger.info(`[Execution]: ${JSON.stringify(message).substring(0, 200)}...`);

            // Emit JSON messages
            this.emit('output', {
              type: 'stdout',
              data: JSON.stringify(message),
              executionId: this.executionId,
              timestamp: new Date().toISOString()
            });

            // Accumulate text output
            if (message.type === 'assistant' && message.message && message.message.content) {
              for (const block of message.message.content) {
                if (block.type === 'text') {
                  executionOutput += block.text;
                }
              }
            }

            // Check for completion
            if (message.type === 'result') {
              this.process.stdout.removeListener('data', outputHandler);
              this.process.removeListener('close', closeHandler);
              this.process = null;
              this.status = 'idle';

              resolve({
                success: !message.is_error,
                output: executionOutput
              });
            }
          } catch (err) {
            // Continue
          }
        }
      };

      const closeHandler = (code) => {
        this.process = null;
        this.status = 'idle';

        if (code === 0) {
          resolve({
            success: true,
            output: executionOutput
          });
        } else {
          reject(new Error(`claude-code exited with code ${code}`));
        }
      };

      this.process.stdout.on('data', outputHandler);
      this.process.on('close', closeHandler);
    });
  }

  async rejectPlan(feedback) {
    if (!this.process || this.status !== 'planning') {
      throw new Error('No active planning session to reject');
    }

    logger.info('Sending rejection with feedback to claude-code');
    this.planOutput = '';

    // Send rejection with feedback as new user message
    const rejectionMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: `No, please revise the plan. Here's my feedback: ${feedback}`
      }
    };
    this.process.stdin.write(JSON.stringify(rejectionMessage) + '\n');

    return new Promise((resolve) => {
      let planResolved = false;
      let messageBuffer = '';

      const outputHandler = (data) => {
        const output = data.toString();
        messageBuffer += output;

        const lines = messageBuffer.split('\n');
        messageBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const message = JSON.parse(line);

            // Emit JSON messages
            this.emit('output', {
              type: 'stdout',
              data: JSON.stringify(message),
              executionId: this.executionId,
              timestamp: new Date().toISOString()
            });

            // Accumulate new plan text
            if (message.type === 'assistant' && message.message && message.message.content) {
              for (const block of message.message.content) {
                if (block.type === 'text') {
                  this.planOutput += block.text;
                }
              }
            }

            // Check for new plan completion
            if (!planResolved && message.type === 'result') {
              planResolved = true;
              this.process.stdout.removeListener('data', outputHandler);
              resolve({
                success: true,
                plan: this.planOutput,
                raw: this.planOutput,
                modifiedFiles: this.extractModifiedFiles(this.planOutput)
              });
            }
          } catch (err) {
            // Continue
          }
        }
      };

      this.process.stdout.on('data', outputHandler);

      // Fallback timeout
      setTimeout(() => {
        if (!planResolved) {
          planResolved = true;
          this.process.stdout.removeListener('data', outputHandler);
          resolve({
            success: true,
            plan: this.planOutput,
            raw: this.planOutput,
            modifiedFiles: this.extractModifiedFiles(this.planOutput)
          });
        }
      }, 30000);
    });
  }

  async executePrompt(prompt, workdir, options = {}) {
    try {
      // Ensure we have the claude path
      if (!this.claudePath) {
        await this.detectInstallation();
      }

      logger.info('Executing Claude Code prompt');

      const args = [];

      if (options.apply) {
        args.push('--apply');
      }

      if (options.model) {
        args.push('--model', options.model);
      }

      if (options.webSearch) {
        args.push('--web-search');
      }

      if (options.webFetch && options.webFetch.length > 0) {
        args.push('--web-fetch', options.webFetch.join(','));
      }

      const result = await this.spawnProcess(this.claudePath || 'claude', args, {
        workdir,
        input: prompt,
        closeStdin: !options.interactive,
        onOutput: options.onOutput,
        onError: options.onError
      });

      return this.normalizeOutput(result.stdout);
    } catch (error) {
      logger.error('Claude Code execution failed:', error);
      throw error;
    }
  }

  extractPlan(output) {
    const planMarkers = [
      { start: 'PLAN:', end: 'END PLAN' },
      { start: 'Here\'s what I\'ll do:', end: '\n\n' },
      { start: 'I will:', end: '\n\n' },
      { start: 'Plan:', end: '\n\n' }
    ];

    for (const marker of planMarkers) {
      const startIdx = output.indexOf(marker.start);
      if (startIdx !== -1) {
        const endIdx = output.indexOf(marker.end, startIdx);
        if (endIdx !== -1) {
          return output.substring(startIdx + marker.start.length, endIdx).trim();
        } else {
          const nextDoubleNewline = output.indexOf('\n\n', startIdx);
          if (nextDoubleNewline !== -1) {
            return output.substring(startIdx + marker.start.length, nextDoubleNewline).trim();
          }
        }
      }
    }

    const bulletPoints = output.match(/^[\s]*[-*•]\s+.+$/gm);
    if (bulletPoints && bulletPoints.length > 0) {
      return bulletPoints.join('\n');
    }

    const numberedList = output.match(/^[\s]*\d+\.\s+.+$/gm);
    if (numberedList && numberedList.length > 0) {
      return numberedList.join('\n');
    }

    return output.substring(0, 500);
  }

  parseOutput(output) {
    try {
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.result || parsed.output) {
          return parsed.result || parsed.output;
        }
      }
    } catch (e) {
      // Not JSON, return as text
    }

    const cleanOutput = output
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/^(stdout|stderr):\s*/gm, '')
      .trim();

    return cleanOutput;
  }

  async handleInteractiveMode(workdir) {
    // Ensure we have the claude path
    if (!this.claudePath) {
      await this.detectInstallation();
    }

    logger.info('Starting Claude Code interactive mode');

    return this.spawnProcess(this.claudePath || 'claude', ['--interactive'], {
      workdir,
      closeStdin: false
    });
  }
}