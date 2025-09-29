import { createAgent } from '../agents/detector.js';
import { logger } from '../utils/logger.js';
import { EventEmitter } from 'events';
import { generatePullRequest } from '../git/pr-generator.js';
import { commitChanges } from '../git/operations.js';
import fs from 'fs/promises';
import path from 'path';

export class ExecutionOrchestrator extends EventEmitter {
  constructor(sessionManager, config) {
    super();
    this.sessionManager = sessionManager;
    this.config = config;
    this.activeExecutions = new Map();
    this.executionQueues = new Map();
  }

  async executePlan(planId, sessionId) {
    const planner = this.planner;
    const plan = planner.getPlan(planId);

    if (!plan) {
      throw new Error('Plan not found');
    }

    if (!plan.approved) {
      throw new Error('Plan not approved');
    }

    if (plan.executed) {
      throw new Error('Plan already executed');
    }

    if (plan.sessionId && plan.sessionId !== sessionId) {
      throw new Error('Plan does not belong to this session');
    }

    return this.enqueueExecution(sessionId, async () => {
      const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const execution = {
        id: executionId,
        planId,
        sessionId,
        plan,
        status: 'starting',
        startedAt: new Date().toISOString(),
        progress: 0,
        modifiedFiles: [],
        output: [],
        agent: null
      };

      this.activeExecutions.set(executionId, execution);

      try {
        await this.runExecution(execution);
        return execution;
      } catch (error) {
        execution.status = 'failed';
        execution.error = error.message;
        execution.finishedAt = new Date().toISOString();
        throw error;
      }
    });
  }

  async runExecution(execution) {
    const { plan } = execution;

    this.emit('execution-started', {
      executionId: execution.id,
      planId: execution.planId
    });

    execution.status = 'initializing';
    execution.agent = createAgent(plan.agentName, this.config.agents);

    execution.agent.on('output', (output) => {
      execution.output.push(output);
      this.emit('agent-output', {
        executionId: execution.id,
        output
      });
    });

    execution.status = 'executing';
    this.updateProgress(execution, 10);

    const watchedFiles = new Set();
    if (plan.modifiedFiles.length > 0) {
      await this.startFileWatching(plan.workdir, plan.modifiedFiles, (file) => {
        if (!watchedFiles.has(file)) {
          watchedFiles.add(file);
          execution.modifiedFiles.push(file);
          this.emit('file-changed', {
            executionId: execution.id,
            file
          });
        }
      });
    }

    try {
      const result = await execution.agent.executePrompt(
        plan.prompt,
        plan.workdir,
        {
          ...plan.options,
          apply: true,
          onOutput: (output) => {
            this.emit('agent-output', {
              executionId: execution.id,
              type: 'stdout',
              data: output
            });
          },
          onError: (error) => {
            this.emit('agent-output', {
              executionId: execution.id,
              type: 'stderr',
              data: error
            });
          }
        }
      );

      this.updateProgress(execution, 80);

      execution.result = result;
      execution.modifiedFiles = [...new Set([...execution.modifiedFiles, ...result.modifiedFiles])];

      if (execution.modifiedFiles.length > 0) {
        this.updateProgress(execution, 90);

        if (this.config.git.autoCommit) {
          const commitResult = await commitChanges(
            plan.workdir,
            `AI-generated changes: ${plan.prompt.substring(0, 50)}...`,
            execution.modifiedFiles
          );

          execution.commitHash = commitResult.commit.hash;
        }
      }

      execution.status = 'completed';
      execution.finishedAt = new Date().toISOString();
      this.updateProgress(execution, 100);

      plan.executed = true;
      plan.executedAt = new Date().toISOString();
      this.planner?.activePlans?.delete(plan.id);

      this.emit('execution-completed', {
        executionId: execution.id,
        planId: execution.planId,
        modifiedFiles: execution.modifiedFiles,
        result: execution.result
      });

      logger.info(`Execution completed: ${execution.id}`);

    } catch (error) {
      execution.status = 'failed';
      execution.error = error.message;
      execution.finishedAt = new Date().toISOString();

      this.emit('execution-failed', {
        executionId: execution.id,
        planId: execution.planId,
        error: error.message
      });

      logger.error(`Execution failed: ${execution.id}`, error);
      throw error;
    } finally {
      await execution.agent.cleanup();
    }
  }

  async startFileWatching(workdir, files, onChange) {
    const { watch } = await import('chokidar');

    const patterns = files.map(file => path.join(workdir, file));

    const watcher = watch(patterns, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    watcher.on('change', (filePath) => {
      const relativePath = path.relative(workdir, filePath);
      onChange(relativePath);
    });

    watcher.on('add', (filePath) => {
      const relativePath = path.relative(workdir, filePath);
      onChange(relativePath);
    });

    setTimeout(() => {
      watcher.close();
    }, 10 * 60 * 1000);

    return watcher;
  }

  updateProgress(execution, progress) {
    execution.progress = progress;
    this.emit('execution-progress', {
      executionId: execution.id,
      progress
    });
  }

  async generatePR(executionId, options = {}) {
    const execution = this.activeExecutions.get(executionId);

    if (!execution) {
      throw new Error('Execution not found');
    }

    if (execution.status !== 'completed') {
      throw new Error('Execution not completed');
    }

    try {
      const prOptions = {
        prompt: execution.plan.prompt,
        plan: execution.plan.plan,
        modifiedFiles: execution.modifiedFiles,
        executionSummary: this.generateExecutionSummary(execution),
        ...options
      };

      const pr = await generatePullRequest(execution.plan.workdir, prOptions);

      execution.pullRequest = pr;

      this.emit('pr-created', {
        executionId: execution.id,
        pr
      });

      return pr;
    } catch (error) {
      logger.error('Failed to generate PR:', error);
      throw error;
    }
  }

  generateExecutionSummary(execution) {
    const summary = [];

    summary.push(`**Execution ID:** ${execution.id}`);
    summary.push(`**Agent:** ${execution.plan.agentName}`);
    summary.push(`**Duration:** ${this.getExecutionDuration(execution)}`);
    summary.push(`**Files Modified:** ${execution.modifiedFiles.length}`);

    if (execution.modifiedFiles.length > 0) {
      summary.push('**Modified Files:**');
      execution.modifiedFiles.forEach(file => {
        summary.push(`- ${file}`);
      });
    }

    if (execution.commitHash) {
      summary.push(`**Commit:** ${execution.commitHash}`);
    }

    return summary.join('\n');
  }

  getExecutionDuration(execution) {
    if (!execution.startedAt || !execution.finishedAt) {
      return 'Unknown';
    }

    const start = new Date(execution.startedAt);
    const end = new Date(execution.finishedAt);
    const durationMs = end - start;

    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);

    return `${minutes}m ${seconds}s`;
  }

  getExecution(executionId) {
    return this.activeExecutions.get(executionId);
  }

  getActiveExecutions() {
    return Array.from(this.activeExecutions.values());
  }

  async abortExecution(executionId) {
    const execution = this.activeExecutions.get(executionId);

    if (!execution) {
      throw new Error('Execution not found');
    }

    if (execution.status === 'completed' || execution.status === 'failed') {
      throw new Error('Execution already finished');
    }

    try {
      if (execution.agent) {
        await execution.agent.kill();
      }

      execution.status = 'aborted';
      execution.finishedAt = new Date().toISOString();

      this.emit('execution-aborted', {
        executionId: execution.id
      });

      logger.info(`Execution aborted: ${execution.id}`);

      return execution;
    } catch (error) {
      logger.error('Failed to abort execution:', error);
      throw error;
    }
  }

  enqueueExecution(sessionId, task) {
    if (!this.executionQueues.has(sessionId)) {
      this.executionQueues.set(sessionId, []);
    }

    const queue = this.executionQueues.get(sessionId);

    return new Promise((resolve, reject) => {
      const entry = {};
      entry.run = async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          queue.shift();
          if (queue.length > 0) {
            queue[0].run();
          } else {
            this.executionQueues.delete(sessionId);
          }
        }
      };

      entry.reject = reject;

      queue.push(entry);

      if (queue.length === 1) {
        entry.run();
      }
    });
  }

  async emergencyStop(reason = 'Emergency kill switch activated') {
    const abortedExecutions = [];
    const executions = Array.from(this.activeExecutions.values());

    for (const execution of executions) {
      try {
        if (execution.agent) {
          await execution.agent.kill();
        }
      } catch (error) {
        logger.error('Failed to terminate agent during emergency stop:', error);
      }

      execution.status = 'aborted';
      execution.error = reason;
      execution.finishedAt = new Date().toISOString();
      abortedExecutions.push(execution.id);

      this.emit('execution-aborted', {
        executionId: execution.id,
        reason
      });

      this.activeExecutions.delete(execution.id);
    }

    for (const [sessionId, queue] of this.executionQueues.entries()) {
      queue.forEach((entry, index) => {
        if (index === 0) {
          return;
        }

        entry.reject(new Error(reason));
      });

      this.executionQueues.delete(sessionId);
    }

    return abortedExecutions;
  }
}
