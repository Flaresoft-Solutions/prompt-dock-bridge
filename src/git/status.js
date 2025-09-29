import simpleGit from 'simple-git';
import { logger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs/promises';

export async function getGitStatus(workdir) {
  try {
    const git = simpleGit(workdir);

    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return {
        isGitRepo: false,
        error: 'Not a git repository'
      };
    }

    const [status, branch, remotes, log] = await Promise.all([
      git.status(),
      git.branch(),
      git.getRemotes(true),
      git.log(['--oneline', '-10'])
    ]);

    const ahead = status.ahead;
    const behind = status.behind;

    return {
      isGitRepo: true,
      currentBranch: branch.current,
      branches: branch.all,
      tracking: status.tracking,
      ahead,
      behind,
      files: {
        modified: status.modified,
        added: status.created,
        deleted: status.deleted,
        renamed: status.renamed,
        conflicted: status.conflicted,
        staged: status.staged,
        notAdded: status.not_added
      },
      isClean: status.isClean(),
      hasUncommittedChanges: !status.isClean(),
      remotes: remotes.map(r => ({
        name: r.name,
        url: r.refs.fetch || r.refs.push
      })),
      recentCommits: log.all.map(c => ({
        hash: c.hash,
        message: c.message
      }))
    };
  } catch (error) {
    logger.error('Failed to get git status:', error);
    throw error;
  }
}

export async function isGitRepository(workdir) {
  try {
    const git = simpleGit(workdir);
    return await git.checkIsRepo();
  } catch {
    return false;
  }
}

export async function getCurrentBranch(workdir) {
  try {
    const git = simpleGit(workdir);
    const branch = await git.branch();
    return branch.current;
  } catch (error) {
    logger.error('Failed to get current branch:', error);
    return null;
  }
}

export async function hasUncommittedChanges(workdir) {
  try {
    const git = simpleGit(workdir);
    const status = await git.status();
    return !status.isClean();
  } catch (error) {
    logger.error('Failed to check uncommitted changes:', error);
    return true;
  }
}

export async function getDiff(workdir, staged = false) {
  try {
    const git = simpleGit(workdir);
    if (staged) {
      return await git.diff(['--staged']);
    }
    return await git.diff();
  } catch (error) {
    logger.error('Failed to get diff:', error);
    throw error;
  }
}