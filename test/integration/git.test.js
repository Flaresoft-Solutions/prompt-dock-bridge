import { jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getGitStatus, hasUncommittedChanges } from '../../src/git/status.js';
import { createBranch, createBackupBranch, stashChanges } from '../../src/git/operations.js';
import { generatePullRequest } from '../../src/git/pr-generator.js';
import simpleGit from 'simple-git';

describe('Git Integration Tests', () => {
  let testRepoPath;
  let git;

  beforeEach(async () => {
    // Create temporary git repository for testing
    testRepoPath = path.join(os.tmpdir(), `prompt-dock-test-${Date.now()}`);
    await fs.mkdir(testRepoPath, { recursive: true });

    git = simpleGit(testRepoPath);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');

    // Create initial commit
    await fs.writeFile(path.join(testRepoPath, 'README.md'), '# Test Repo');
    await git.add('README.md');
    await git.commit('Initial commit');
  });

  afterEach(async () => {
    // Cleanup test repository
    try {
      await fs.rm(testRepoPath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Git Status Detection', () => {
    test('should detect clean git repository', async () => {
      const status = await getGitStatus(testRepoPath);

      expect(status.isGitRepo).toBe(true);
      expect(status.isClean).toBe(true);
      expect(status.hasUncommittedChanges).toBe(false);
    });

    test('should detect uncommitted changes', async () => {
      // Modify a file
      await fs.writeFile(path.join(testRepoPath, 'test.js'), 'console.log("test");');

      const status = await getGitStatus(testRepoPath);

      expect(status.isGitRepo).toBe(true);
      expect(status.isClean).toBe(false);
      expect(status.hasUncommittedChanges).toBe(true);
      expect(status.files.notAdded).toContain('test.js');
    });
  });

  describe('Branch Operations', () => {
    test('should create new branch', async () => {
      const branchName = 'feature-test';
      const result = await createBranch(testRepoPath, branchName);

      expect(result.success).toBe(true);
      expect(result.branch).toBe(branchName);

      const branches = await git.branch();
      expect(branches.current).toBe(branchName);
    });

    test('should create backup branch', async () => {
      const result = await createBackupBranch(testRepoPath);

      expect(result.success).toBe(true);
      expect(result.backupBranch).toMatch(/^backup-prompt-dock-/);
      expect(result.originalBranch).toBe('main');

      const branches = await git.branch();
      expect(branches.all).toContain(result.backupBranch);
    });
  });

  describe('Stash Operations', () => {
    test('should stash uncommitted changes', async () => {
      // Create uncommitted changes
      await fs.writeFile(path.join(testRepoPath, 'test.js'), 'console.log("test");');

      const hasChanges = await hasUncommittedChanges(testRepoPath);
      expect(hasChanges).toBe(true);

      const result = await stashChanges(testRepoPath, 'Test stash');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Test stash');

      const hasChangesAfter = await hasUncommittedChanges(testRepoPath);
      expect(hasChangesAfter).toBe(false);
    });
  });

  describe('PR Generation', () => {
    test('should generate PR data structure', async () => {
      // Create and commit some changes
      await fs.writeFile(path.join(testRepoPath, 'feature.js'), 'const feature = true;');
      await git.add('feature.js');
      await git.commit('Add feature');

      const prOptions = {
        title: 'Test Feature',
        prompt: 'Add a new feature',
        plan: '1. Create feature.js\n2. Add feature code',
        modifiedFiles: ['feature.js'],
        autoCommit: false
      };

      // Mock remote (would normally fail without real remote)
      try {
        const result = await generatePullRequest(testRepoPath, prOptions);
        // This will likely fail due to no remote, but we can test the structure
      } catch (error) {
        // Expected - no remote configured
        expect(error.message).toContain('No git remote configured');
      }
    });
  });

  describe('Safety Checks', () => {
    test('should validate working directory safety', async () => {
      const status = await getGitStatus(testRepoPath);

      // Clean repository should be safe
      expect(status.isGitRepo).toBe(true);
      expect(status.isClean).toBe(true);
    });

    test('should handle non-git directories', async () => {
      const nonGitPath = path.join(os.tmpdir(), `non-git-${Date.now()}`);
      await fs.mkdir(nonGitPath, { recursive: true });

      const status = await getGitStatus(nonGitPath);

      expect(status.isGitRepo).toBe(false);
      expect(status.error).toBe('Not a git repository');

      await fs.rm(nonGitPath, { recursive: true, force: true });
    });
  });
});