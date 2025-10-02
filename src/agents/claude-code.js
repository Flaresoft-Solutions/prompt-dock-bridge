import { BaseAgent } from './base.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

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

      logger.info('Executing Claude Code in plan mode');

      // Use -p (print/SDK mode) with a plan-focused prompt
      const planPrompt = `Please create a detailed execution plan for the following task. Do not execute anything yet, just provide a clear plan with steps:\n\n${prompt}`;

      const result = await this.spawnProcess(
        this.claudePath || 'claude',
        ['-p', planPrompt, '--output-format', 'text'],
        {
          workdir,
          closeStdin: true,
          onOutput: (output) => {
            this.planOutput += output;
          }
        }
      );

      const plan = this.extractPlan(result.stdout || this.planOutput);

      return {
        success: true,
        plan,
        raw: result.stdout || this.planOutput,
        modifiedFiles: this.extractModifiedFiles(plan)
      };
    } catch (error) {
      logger.error('Claude Code plan mode failed:', error);
      return {
        success: false,
        error: error.message,
        raw: this.planOutput || error.message
      };
    } finally {
      this.isInPlanMode = false;
      this.planOutput = '';
    }
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