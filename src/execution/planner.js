import { createAgent } from '../agents/detector.js';
import { getGitStatus, hasUncommittedChanges } from '../git/status.js';
import { createBackupBranch } from '../git/operations.js';
import { logger } from '../utils/logger.js';

export class ExecutionPlanner {
  constructor(sessionManager, config) {
    this.sessionManager = sessionManager;
    this.config = config;
    this.activePlans = new Map();
  }

  async createPlan(prompt, workdir, agentName, options = {}) {
    try {
      const planId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);

      await this.validateWorkdir(workdir);

      const gitStatus = await getGitStatus(workdir);
      if (!gitStatus.isGitRepo) {
        logger.warn('Working directory is not a git repository');
      }

      const agent = createAgent(agentName, this.config.agents);

      logger.info(`Creating execution plan with ${agentName}`);

      const planResult = await agent.executeInPlanMode(prompt, workdir);

      if (!planResult.success) {
        throw new Error(`Plan generation failed: ${planResult.error}`);
      }

      const plan = {
        id: planId,
        sessionId: options.sessionId || null,
        prompt,
        workdir,
        agentName,
        plan: planResult.plan,
        modifiedFiles: planResult.modifiedFiles || [],
        gitStatus,
        createdAt: new Date().toISOString(),
        approved: false,
        executed: false,
        backupBranch: null,
        options
      };

      plan.metadata = await this.extractPlanMetadata(plan);

      if (gitStatus.isGitRepo && this.config.git.createBackupBranch) {
        try {
          const backup = await createBackupBranch(workdir);
          plan.backupBranch = backup.backupBranch;
          logger.info(`Created backup branch: ${backup.backupBranch}`);
        } catch (error) {
          logger.warn('Failed to create backup branch:', error.message);
        }
      }

      this.activePlans.set(planId, plan);

      return plan;
    } catch (error) {
      logger.error('Failed to create plan:', error);
      throw error;
    }
  }

  async validateWorkdir(workdir) {
    const fs = await import('fs/promises');

    try {
      const stats = await fs.stat(workdir);
      if (!stats.isDirectory()) {
        throw new Error('Working directory is not a directory');
      }

      await fs.access(workdir, fs.constants.R_OK | fs.constants.W_OK);

    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('Working directory does not exist');
      } else if (error.code === 'EACCES') {
        throw new Error('No read/write access to working directory');
      }
      throw error;
    }
  }

  async validateGitSafety(workdir) {
    if (!this.config.git.requireCleanWorkingTree) {
      return { safe: true };
    }

    const hasChanges = await hasUncommittedChanges(workdir);

    if (hasChanges) {
      return {
        safe: false,
        reason: 'Uncommitted changes detected',
        suggestion: 'Commit or stash changes before proceeding'
      };
    }

    return { safe: true };
  }

  getPlan(planId) {
    return this.activePlans.get(planId);
  }

  approvePlan(planId) {
    const plan = this.activePlans.get(planId);
    if (!plan) {
      throw new Error('Plan not found');
    }

    if (plan.executed) {
      throw new Error('Plan already executed');
    }

    plan.approved = true;
    plan.approvedAt = new Date().toISOString();

    logger.info(`Plan ${planId} approved for execution`);

    return plan;
  }

  rejectPlan(planId, reason) {
    const plan = this.activePlans.get(planId);
    if (!plan) {
      throw new Error('Plan not found');
    }

    plan.rejected = true;
    plan.rejectedAt = new Date().toISOString();
    plan.rejectionReason = reason;

    logger.info(`Plan ${planId} rejected: ${reason}`);

    this.activePlans.delete(planId);

    return plan;
  }

  getActivePlans() {
    return Array.from(this.activePlans.values());
  }

  cleanupExpiredPlans() {
    const expiredTime = Date.now() - (30 * 60 * 1000); // 30 minutes

    for (const [planId, plan] of this.activePlans.entries()) {
      const createdTime = new Date(plan.createdAt).getTime();
      if (createdTime < expiredTime && !plan.executed) {
        this.activePlans.delete(planId);
        logger.verbose(`Cleaned up expired plan: ${planId}`);
      }
    }
  }

  async extractPlanMetadata(plan) {
    const metadata = {
      fileCount: plan.modifiedFiles.length,
      complexity: this.assessComplexity(plan.plan),
      riskLevel: this.assessRisk(plan),
      estimatedDuration: this.estimateDuration(plan)
    };

    return metadata;
  }

  assessComplexity(planText) {
    const indicators = [
      { pattern: /create|add|new/gi, weight: 1 },
      { pattern: /modify|update|change/gi, weight: 2 },
      { pattern: /delete|remove/gi, weight: 3 },
      { pattern: /refactor|restructure/gi, weight: 4 },
      { pattern: /migration|database/gi, weight: 5 }
    ];

    let complexity = 0;
    for (const indicator of indicators) {
      const matches = planText.match(indicator.pattern);
      if (matches) {
        complexity += matches.length * indicator.weight;
      }
    }

    if (complexity < 5) return 'low';
    if (complexity < 15) return 'medium';
    return 'high';
  }

  assessRisk(plan) {
    let risk = 0;

    if (!plan.gitStatus.isGitRepo) risk += 3;
    if (plan.gitStatus.hasUncommittedChanges) risk += 2;
    if (plan.modifiedFiles.length > 10) risk += 2;
    if (plan.modifiedFiles.some(f => f.includes('package.json'))) risk += 1;
    if (plan.modifiedFiles.some(f => f.includes('.env'))) risk += 3;

    if (risk < 3) return 'low';
    if (risk < 6) return 'medium';
    return 'high';
  }

  estimateDuration(plan) {
    const baseTime = 30;
    const fileMultiplier = plan.modifiedFiles.length * 10;
    const complexityMultiplier = {
      low: 1,
      medium: 1.5,
      high: 2.5
    };

    const complexity = this.assessComplexity(plan.plan);
    return Math.round(baseTime + fileMultiplier * complexityMultiplier[complexity]);
  }
}
