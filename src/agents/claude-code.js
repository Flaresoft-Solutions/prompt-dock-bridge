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
  }

  async detectInstallation() {
    try {
      const { stdout, stderr } = await execAsync('claude-code --version');
      const version = stdout.trim() || stderr.trim();

      return {
        installed: true,
        version,
        path: (await execAsync('which claude-code')).stdout.trim()
      };
    } catch (error) {
      logger.verbose('Claude Code not detected:', error.message);
      return {
        installed: false,
        error: error.message
      };
    }
  }

  async getVersion() {
    const result = await this.detectInstallation();
    return result.installed ? result.version : null;
  }

  async executeInPlanMode(prompt, workdir) {
    this.isInPlanMode = true;
    this.planOutput = '';

    try {
      logger.info('Executing Claude Code in plan mode');

      const result = await this.spawnProcess(
        'claude-code',
        ['--plan'],
        {
          workdir,
          input: prompt,
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

      const result = await this.spawnProcess('claude-code', args, {
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
    logger.info('Starting Claude Code interactive mode');

    return this.spawnProcess('claude-code', ['--interactive'], {
      workdir,
      closeStdin: false
    });
  }
}