import { BaseAgent } from './base.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

export class CursorAgent extends BaseAgent {
  constructor(config = {}) {
    super('cursor-agent', config);
    this.warningShown = false;
  }

  async detectInstallation() {
    try {
      const { stdout, stderr } = await execAsync('cursor-agent --version');
      const version = stdout.trim() || stderr.trim();

      if (!this.warningShown) {
        logger.warn('Cursor CLI is beta software and may have unexpected behavior');
        this.warningShown = true;
      }

      return {
        installed: true,
        version,
        path: (await execAsync('which cursor-agent')).stdout.trim(),
        beta: true
      };
    } catch (error) {
      logger.verbose('Cursor agent not detected:', error.message);
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
    try {
      logger.info('Executing Cursor agent in chat mode for planning');

      const planPrompt = `Please provide a detailed plan for the following task. List the specific files you will modify and the changes you will make:\n\n${prompt}`;

      const result = await this.spawnProcess(
        'cursor-agent',
        ['chat'],
        {
          workdir,
          input: planPrompt,
          closeStdin: true
        }
      );

      const plan = this.extractPlan(result.stdout);

      return {
        success: true,
        plan,
        raw: result.stdout,
        modifiedFiles: this.extractModifiedFiles(plan)
      };
    } catch (error) {
      logger.error('Cursor agent plan mode failed:', error);
      return {
        success: false,
        error: error.message,
        raw: error.message
      };
    }
  }

  async executePrompt(prompt, workdir, options = {}) {
    try {
      logger.info('Executing Cursor agent prompt');

      const args = ['chat'];

      if (options.model) {
        args.push('--model', options.model);
      }

      if (options.parallel && options.parallel > 1) {
        logger.info(`Running ${options.parallel} parallel Cursor agents`);
        const promises = [];

        for (let i = 0; i < options.parallel; i++) {
          promises.push(
            this.spawnProcess('cursor-agent', [...args], {
              workdir,
              input: prompt,
              closeStdin: true
            })
          );
        }

        const results = await Promise.all(promises);
        const combinedOutput = results.map(r => r.stdout).join('\n---\n');

        return this.normalizeOutput(combinedOutput);
      }

      const result = await this.spawnProcess('cursor-agent', args, {
        workdir,
        input: prompt,
        closeStdin: !options.interactive,
        onOutput: options.onOutput,
        onError: options.onError
      });

      return this.normalizeOutput(result.stdout);
    } catch (error) {
      logger.error('Cursor agent execution failed:', error);
      throw error;
    }
  }

  extractPlan(output) {
    const cursorPlanMarkers = [
      { start: 'I\'ll help you with:', end: '\n\n' },
      { start: 'Here\'s my approach:', end: '\n\n' },
      { start: 'Plan:', end: '\n\n' }
    ];

    for (const marker of cursorPlanMarkers) {
      const startIdx = output.indexOf(marker.start);
      if (startIdx !== -1) {
        const endIdx = output.indexOf(marker.end, startIdx);
        if (endIdx !== -1) {
          return output.substring(startIdx + marker.start.length, endIdx).trim();
        }
      }
    }

    const bulletPoints = output.match(/^[\s]*[-*•]\s+.+$/gm);
    if (bulletPoints && bulletPoints.length > 0) {
      return bulletPoints.join('\n');
    }

    return output.substring(0, 500);
  }

  parseOutput(output) {
    const cleanOutput = output
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/^cursor-agent:\s*/gm, '')
      .trim();

    return cleanOutput;
  }

  async runParallelAgents(count, prompt, workdir) {
    logger.info(`Starting ${count} parallel Cursor agents`);

    const agents = [];
    for (let i = 0; i < count; i++) {
      agents.push({
        id: i,
        promise: this.executePrompt(prompt, workdir, {
          parallel: false
        })
      });
    }

    const results = await Promise.all(agents.map(a => a.promise));

    return {
      agents: results.map((result, index) => ({
        id: index,
        output: result
      })),
      combined: results.map(r => r.text).join('\n\n---\n\n')
    };
  }
}