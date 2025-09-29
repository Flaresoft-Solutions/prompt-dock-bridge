import { BaseAgent } from './base.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import fs from 'fs/promises';

const execAsync = promisify(exec);

export class CodexAgent extends BaseAgent {
  constructor(config = {}) {
    super('codex', config);
    this.mcpServers = [];
  }

  async detectInstallation() {
    try {
      const { stdout, stderr } = await execAsync('codex --version');
      const version = stdout.trim() || stderr.trim();

      return {
        installed: true,
        version,
        path: (await execAsync('which codex')).stdout.trim()
      };
    } catch (error) {
      logger.verbose('Codex not detected:', error.message);
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
      logger.info('Executing Codex in interactive mode for planning');

      const planPrompt = `Please provide a detailed plan for the following task. List the specific files you will modify and the changes you will make. Do not execute anything yet:\n\n${prompt}`;

      const result = await this.spawnProcess(
        'codex',
        ['-i', '--approval', 'read-only'],
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
      logger.error('Codex plan mode failed:', error);
      return {
        success: false,
        error: error.message,
        raw: error.message
      };
    }
  }

  async executePrompt(prompt, workdir, options = {}) {
    try {
      logger.info('Executing Codex prompt');

      const args = [];

      if (options.interactive) {
        args.push('-i');
      }

      if (options.images && options.images.length > 0) {
        for (const image of options.images) {
          const exists = await this.fileExists(image);
          if (exists) {
            args.push('--image', image);
          } else {
            logger.warn(`Image file not found: ${image}`);
          }
        }
      }

      if (options.reasoning) {
        const validLevels = ['low', 'medium', 'high'];
        if (validLevels.includes(options.reasoning)) {
          args.push('--reasoning', options.reasoning);
        }
      }

      if (options.approval) {
        const validModes = ['read-only', 'auto', 'full'];
        if (validModes.includes(options.approval)) {
          args.push('--approval', options.approval);
        }
      }

      if (options.mcpServers && options.mcpServers.length > 0) {
        for (const server of options.mcpServers) {
          args.push('--mcp', server);
        }
      }

      const result = await this.spawnProcess('codex', args, {
        workdir,
        input: prompt,
        closeStdin: !options.interactive,
        onOutput: options.onOutput,
        onError: options.onError
      });

      return this.normalizeOutput(result.stdout);
    } catch (error) {
      logger.error('Codex execution failed:', error);
      throw error;
    }
  }

  async fileExists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  extractPlan(output) {
    const codexPlanMarkers = [
      { start: 'Plan:', end: 'Execution:' },
      { start: 'I will:', end: '\n\n' },
      { start: 'Steps:', end: '\n\n' }
    ];

    for (const marker of codexPlanMarkers) {
      const startIdx = output.indexOf(marker.start);
      if (startIdx !== -1) {
        const endIdx = output.indexOf(marker.end, startIdx);
        if (endIdx !== -1) {
          return output.substring(startIdx + marker.start.length, endIdx).trim();
        }
      }
    }

    const numberedSteps = output.match(/^[\s]*\d+\.\s+.+$/gm);
    if (numberedSteps && numberedSteps.length > 0) {
      return numberedSteps.join('\n');
    }

    return output.substring(0, 500);
  }

  parseOutput(output) {
    const cleanOutput = output
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/^codex:\s*/gm, '')
      .trim();

    return cleanOutput;
  }

  async handleMultimodalInput(prompt, images, workdir) {
    logger.info(`Processing multimodal input with ${images.length} images`);

    return this.executePrompt(prompt, workdir, {
      images,
      interactive: true
    });
  }

  async configureMCPServers(servers) {
    this.mcpServers = servers;
    logger.info(`Configured ${servers.length} MCP servers`);
  }

  async setApprovalMode(mode) {
    const validModes = ['read-only', 'auto', 'full'];
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid approval mode: ${mode}`);
    }

    this.config.approvalMode = mode;
    logger.info(`Set Codex approval mode to: ${mode}`);
  }
}