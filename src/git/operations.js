import simpleGit from 'simple-git';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export async function createBranch(workdir, branchName) {
  try {
    const git = simpleGit(workdir);
    await git.checkoutLocalBranch(branchName);
    logger.info(`Created and switched to branch: ${branchName}`);
    return { success: true, branch: branchName };
  } catch (error) {
    logger.error('Failed to create branch:', error);
    throw error;
  }
}

export async function switchBranch(workdir, branchName) {
  try {
    const git = simpleGit(workdir);
    await git.checkout(branchName);
    logger.info(`Switched to branch: ${branchName}`);
    return { success: true, branch: branchName };
  } catch (error) {
    logger.error('Failed to switch branch:', error);
    throw error;
  }
}

export async function stashChanges(workdir, message) {
  try {
    const git = simpleGit(workdir);
    const stashMessage = message || `Prompt Dock Bridge auto-stash ${new Date().toISOString()}`;
    await git.stash(['push', '-m', stashMessage]);
    logger.info(`Stashed changes: ${stashMessage}`);
    return { success: true, message: stashMessage };
  } catch (error) {
    logger.error('Failed to stash changes:', error);
    throw error;
  }
}

export async function createWorktree(workdir, targetPath) {
  try {
    const git = simpleGit(workdir);
    const worktreePath = targetPath || `../prompt-dock-worktree-${Date.now()}`;
    const branch = `worktree-${uuidv4().substring(0, 8)}`;

    await git.raw(['worktree', 'add', '-b', branch, worktreePath]);
    logger.info(`Created worktree at: ${worktreePath}`);

    return {
      success: true,
      path: worktreePath,
      branch
    };
  } catch (error) {
    logger.error('Failed to create worktree:', error);
    throw error;
  }
}

export async function createBackupBranch(workdir) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupBranch = `backup-prompt-dock-${timestamp}`;

    const git = simpleGit(workdir);
    const currentBranch = (await git.branch()).current;

    await git.checkoutLocalBranch(backupBranch);
    await git.checkout(currentBranch);

    logger.info(`Created backup branch: ${backupBranch}`);

    return {
      success: true,
      backupBranch,
      originalBranch: currentBranch
    };
  } catch (error) {
    logger.error('Failed to create backup branch:', error);
    throw error;
  }
}

export async function commitChanges(workdir, message, files = []) {
  try {
    const git = simpleGit(workdir);

    if (files.length > 0) {
      await git.add(files);
    } else {
      await git.add('.');
    }

    await git.commit(message);
    logger.info(`Committed changes: ${message}`);

    const lastCommit = await git.log(['-1']);
    return {
      success: true,
      commit: lastCommit.latest
    };
  } catch (error) {
    logger.error('Failed to commit changes:', error);
    throw error;
  }
}

export async function resetToCommit(workdir, commitHash, hard = false) {
  try {
    const git = simpleGit(workdir);
    const resetType = hard ? '--hard' : '--mixed';
    await git.reset([resetType, commitHash]);

    logger.info(`Reset to commit ${commitHash} (${resetType})`);

    return { success: true, commit: commitHash };
  } catch (error) {
    logger.error('Failed to reset:', error);
    throw error;
  }
}

export async function getFileHistory(workdir, filePath, limit = 10) {
  try {
    const git = simpleGit(workdir);
    const log = await git.log([
      `--max-count=${limit}`,
      '--',
      filePath
    ]);

    return log.all.map(commit => ({
      hash: commit.hash,
      date: commit.date,
      message: commit.message,
      author: commit.author_name
    }));
  } catch (error) {
    logger.error('Failed to get file history:', error);
    throw error;
  }
}

export async function checkRemoteStatus(workdir) {
  try {
    const git = simpleGit(workdir);
    await git.fetch();

    const status = await git.status();

    return {
      ahead: status.ahead,
      behind: status.behind,
      diverged: status.ahead > 0 && status.behind > 0
    };
  } catch (error) {
    logger.error('Failed to check remote status:', error);
    throw error;
  }
}