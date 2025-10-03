import { spawnPromise } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

/**
 * Detect the default branch of a repository
 * @param {string} repoPath - Repository path
 * @returns {Promise<string>} Default branch name
 */
async function getDefaultBranch(repoPath) {
  try {
    // Try to get the remote HEAD branch
    const { stdout } = await spawnPromise(
      'git',
      ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
      { cwd: repoPath }
    );
    const remoteBranch = stdout.trim();
    // Strip 'origin/' prefix
    return remoteBranch.replace(/^origin\//, '');
  } catch (error) {
    // Fallback: check current branch
    try {
      const { stdout } = await spawnPromise(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: repoPath }
      );
      return stdout.trim();
    } catch (fallbackError) {
      // Last resort: assume 'main'
      logger.warn('Could not detect default branch, using "main"');
      return 'main';
    }
  }
}

/**
 * Create a git worktree for isolated execution
 * @param {string} repoPath - Main repository path
 * @param {string} baseBranch - Branch to base worktree on (auto-detected if null)
 * @param {string} workdir - Working directory for execution
 * @param {Object} metadata - Optional metadata (promptName, promptId, promptFormat)
 * @returns {Promise<{worktreePath: string, branchName: string}>}
 */
export async function createWorktree(repoPath, baseBranch = null, workdir = null, metadata = {}) {
  try {
    const targetDir = workdir || repoPath;

    // Auto-detect base branch if not provided
    if (!baseBranch) {
      baseBranch = await getDefaultBranch(repoPath);
      logger.info(`Auto-detected base branch: ${baseBranch}`);
    }

    // Generate unique branch and worktree names with metadata
    const timestamp = Date.now();
    const uniqueId = uuidv4().split('-')[0];

    // Build branch name with metadata if provided
    let branchName = 'agent-session';

    if (metadata.promptName) {
      // Sanitize prompt name for branch name (remove special chars, spaces)
      const safeName = metadata.promptName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 30); // Limit length
      branchName += `-${safeName}`;
    }

    if (metadata.promptId) {
      branchName += `-${metadata.promptId.substring(0, 8)}`; // Short ID
    }

    if (metadata.promptFormat) {
      branchName += `-${metadata.promptFormat}`;
    }

    branchName += `-${timestamp}-${uniqueId}`;

    const worktreePath = path.join(targetDir, '.prompt-dock-worktrees', branchName);

    logger.info(`Creating worktree at ${worktreePath} from ${baseBranch}`);

    // Ensure worktrees directory exists
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });

    // Create worktree with new branch (using spawn to prevent command injection)
    await spawnPromise(
      'git',
      ['worktree', 'add', '-b', branchName, worktreePath, baseBranch],
      { cwd: repoPath }
    );

    logger.info(`Worktree created: ${branchName} at ${worktreePath}`);

    return {
      worktreePath,
      branchName,
      baseBranch,
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Failed to create worktree:', error);
    throw new Error(`Worktree creation failed: ${error.message}`);
  }
}

/**
 * Delete a git worktree and its branch
 * @param {string} repoPath - Main repository path
 * @param {string} worktreePath - Path to worktree to delete
 * @param {string} branchName - Branch name to delete
 * @param {boolean} force - Force deletion even with uncommitted changes
 * @returns {Promise<void>}
 */
export async function deleteWorktree(repoPath, worktreePath, branchName, force = false) {
  try {
    logger.info(`Deleting worktree: ${worktreePath}`);

    // Remove worktree (using spawn to prevent command injection)
    const removeArgs = ['worktree', 'remove'];
    if (force) removeArgs.push('--force');
    removeArgs.push(worktreePath);

    await spawnPromise('git', removeArgs, { cwd: repoPath });

    // Delete branch if it exists
    if (branchName) {
      try {
        const deleteBranchFlag = force ? '-D' : '-d';
        await spawnPromise(
          'git',
          ['branch', deleteBranchFlag, branchName],
          { cwd: repoPath }
        );
        logger.info(`Deleted branch: ${branchName}`);
      } catch (branchError) {
        // Branch might already be deleted or merged, log but don't fail
        logger.warn(`Could not delete branch ${branchName}:`, branchError.message);
      }
    }

    // Clean up worktree directory if it still exists
    try {
      await fs.rm(worktreePath, { recursive: true, force: true });
    } catch (cleanupError) {
      logger.warn(`Could not remove worktree directory:`, cleanupError.message);
    }

    logger.info(`Worktree deleted successfully`);
  } catch (error) {
    logger.error('Failed to delete worktree:', error);
    throw new Error(`Worktree deletion failed: ${error.message}`);
  }
}

/**
 * List all worktrees in a repository
 * @param {string} repoPath - Repository path
 * @returns {Promise<Array<{path: string, branch: string, commit: string}>>}
 */
export async function listWorktrees(repoPath) {
  try {
    const { stdout } = await spawnPromise(
      'git',
      ['worktree', 'list', '--porcelain'],
      { cwd: repoPath }
    );

    const worktrees = [];
    const lines = stdout.split('\n');
    let current = {};

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (current.path) {
          worktrees.push(current);
        }
        current = { path: line.substring('worktree '.length) };
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring('branch '.length).replace('refs/heads/', '');
      } else if (line.startsWith('HEAD ')) {
        current.commit = line.substring('HEAD '.length);
      }
    }

    if (current.path) {
      worktrees.push(current);
    }

    return worktrees;
  } catch (error) {
    logger.error('Failed to list worktrees:', error);
    return [];
  }
}

/**
 * Clean up old agent session worktrees
 * @param {string} repoPath - Repository path
 * @param {number} maxAgeHours - Maximum age in hours (default 24)
 * @returns {Promise<number>} Number of worktrees cleaned
 */
export async function cleanupOldWorktrees(repoPath, maxAgeHours = 24) {
  try {
    const worktrees = await listWorktrees(repoPath);
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    let cleaned = 0;

    for (const worktree of worktrees) {
      // Only clean up agent session worktrees
      if (!worktree.branch || !worktree.branch.startsWith('agent-session-')) {
        continue;
      }

      // Extract timestamp from branch name
      const match = worktree.branch.match(/agent-session-(\d+)-/);
      if (!match) continue;

      const timestamp = parseInt(match[1], 10);
      const age = now - timestamp;

      if (age > maxAgeMs) {
        try {
          await deleteWorktree(repoPath, worktree.path, worktree.branch, true);
          cleaned++;
          logger.info(`Cleaned up old worktree: ${worktree.branch} (age: ${Math.round(age / 3600000)}h)`);
        } catch (error) {
          logger.warn(`Failed to clean up worktree ${worktree.branch}:`, error.message);
        }
      }
    }

    return cleaned;
  } catch (error) {
    logger.error('Worktree cleanup failed:', error);
    return 0;
  }
}

/**
 * Get git status within a worktree
 * @param {string} worktreePath - Path to worktree
 * @returns {Promise<{isClean: boolean, files: Array}>}
 */
export async function getWorktreeStatus(worktreePath) {
  try {
    const { stdout } = await spawnPromise(
      'git',
      ['status', '--porcelain'],
      { cwd: worktreePath }
    );

    const files = [];
    const lines = stdout.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);

      files.push({
        file,
        status: parseGitStatus(status)
      });
    }

    return {
      isClean: files.length === 0,
      files,
      hasUncommittedChanges: files.length > 0
    };
  } catch (error) {
    logger.error('Failed to get worktree status:', error);
    throw error;
  }
}

function parseGitStatus(status) {
  const statusMap = {
    'M ': 'modified',
    ' M': 'modified',
    'MM': 'modified',
    'A ': 'added',
    ' A': 'added',
    'D ': 'deleted',
    ' D': 'deleted',
    'R ': 'renamed',
    'C ': 'copied',
    '??': 'untracked'
  };

  return statusMap[status] || 'unknown';
}
