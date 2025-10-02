import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

/**
 * Scan a directory and return its file structure
 * @param {string} rootPath - Directory to scan
 * @param {Object} options - Scanner options
 * @returns {Promise<Array<string>>} List of relative file paths
 */
export async function scanDirectory(rootPath, options = {}) {
  const {
    maxDepth = 10,
    excludePatterns = [
      /node_modules/,
      /\.git$/,
      /\.prompt-dock-worktrees/,
      /dist/,
      /build/,
      /\.next/,
      /\.cache/,
      /coverage/,
      /\.DS_Store/,
      /\.env$/,
      /\.log$/
    ],
    includeHidden = false,
    maxFiles = 10000
  } = options;

  const files = [];
  let fileCount = 0;

  async function scan(currentPath, depth = 0) {
    if (depth > maxDepth || fileCount >= maxFiles) {
      return;
    }

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        if (fileCount >= maxFiles) break;

        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(rootPath, fullPath);

        // Skip hidden files unless includeHidden is true
        if (!includeHidden && entry.name.startsWith('.')) {
          continue;
        }

        // Check exclude patterns
        const shouldExclude = excludePatterns.some(pattern =>
          pattern instanceof RegExp ? pattern.test(relativePath) : relativePath.includes(pattern)
        );

        if (shouldExclude) {
          continue;
        }

        if (entry.isDirectory()) {
          await scan(fullPath, depth + 1);
        } else if (entry.isFile()) {
          files.push(relativePath);
          fileCount++;
        }
      }
    } catch (error) {
      // Skip directories we can't read
      logger.debug(`Cannot read directory ${currentPath}:`, error.message);
    }
  }

  await scan(rootPath);
  return files.sort();
}

/**
 * Get diff content for a file
 * @param {string} filePath - Path to file
 * @param {string} workdir - Working directory
 * @returns {Promise<{diff: string, status: string}>}
 */
export async function getFileDiff(filePath, workdir) {
  try {
    const { spawnPromise } = await import('./exec.js');

    // Validate path is within workdir to prevent path traversal
    const fullPath = path.join(workdir, filePath);
    const normalizedPath = path.normalize(fullPath);
    const normalizedWorkdir = path.normalize(workdir);

    if (!normalizedPath.startsWith(normalizedWorkdir)) {
      throw new Error('Path traversal detected');
    }

    // Get git diff for the file (using spawn to prevent injection)
    try {
      const { stdout: diff } = await spawnPromise(
        'git',
        ['diff', 'HEAD', '--', filePath],
        { cwd: workdir }
      );

      // Get file status
      const { stdout: status } = await spawnPromise(
        'git',
        ['status', '--porcelain', '--', filePath],
        { cwd: workdir }
      );

      const statusCode = status.trim().substring(0, 2);
      let fileStatus = 'modified';

      if (statusCode.includes('?')) fileStatus = 'untracked';
      else if (statusCode.includes('A')) fileStatus = 'added';
      else if (statusCode.includes('D')) fileStatus = 'deleted';
      else if (statusCode.includes('M')) fileStatus = 'modified';
      else if (statusCode.includes('R')) fileStatus = 'renamed';

      return {
        file: filePath,
        diff: diff || '',
        status: fileStatus,
        timestamp: new Date().toISOString()
      };
    } catch (gitError) {
      // Not a git file or new file, try to read content
      const fullPath = path.join(workdir, filePath);

      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        return {
          file: filePath,
          diff: `+++ ${filePath}\n${content}`,
          status: 'added',
          timestamp: new Date().toISOString()
        };
      } catch (readError) {
        return {
          file: filePath,
          diff: '',
          status: 'deleted',
          timestamp: new Date().toISOString()
        };
      }
    }
  } catch (error) {
    logger.error(`Failed to get diff for ${filePath}:`, error);
    return {
      file: filePath,
      diff: '',
      status: 'unknown',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Get multiple file diffs efficiently
 * @param {Array<string>} filePaths - Files to get diffs for
 * @param {string} workdir - Working directory
 * @returns {Promise<Array>}
 */
export async function getMultipleFileDiffs(filePaths, workdir) {
  const diffs = await Promise.all(
    filePaths.map(file => getFileDiff(file, workdir))
  );
  return diffs;
}

/**
 * Get file statistics
 * @param {string} filePath - Path to file
 * @param {string} workdir - Working directory
 * @returns {Promise<Object>}
 */
export async function getFileStats(filePath, workdir) {
  try {
    const fullPath = path.join(workdir, filePath);
    const stats = await fs.stat(fullPath);

    return {
      file: filePath,
      size: stats.size,
      modified: stats.mtime.toISOString(),
      created: stats.birthtime.toISOString(),
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile()
    };
  } catch (error) {
    return {
      file: filePath,
      error: error.message
    };
  }
}

/**
 * Watch directory for file changes
 * @param {string} workdir - Directory to watch
 * @param {Function} onChange - Callback for changes
 * @param {Object} options - Watch options
 * @returns {Promise<Object>} Watcher instance
 */
export async function watchDirectory(workdir, onChange, options = {}) {
  const {
    excludePatterns = [
      /node_modules/,
      /\.git/,
      /\.prompt-dock-worktrees/,
      /dist/,
      /build/
    ],
    debounceMs = 100
  } = options;

  const { watch } = await import('chokidar');
  const debounceTimers = new Map();

  const watcher = watch(workdir, {
    ignored: (filePath) => {
      const relativePath = path.relative(workdir, filePath);
      return excludePatterns.some(pattern =>
        pattern instanceof RegExp ? pattern.test(relativePath) : relativePath.includes(pattern)
      );
    },
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100
    },
    persistent: true
  });

  const debouncedOnChange = (filePath, eventType) => {
    const relativePath = path.relative(workdir, filePath);

    if (debounceTimers.has(relativePath)) {
      clearTimeout(debounceTimers.get(relativePath));
    }

    const timer = setTimeout(async () => {
      debounceTimers.delete(relativePath);

      try {
        const diff = await getFileDiff(relativePath, workdir);
        onChange({
          ...diff,
          eventType
        });
      } catch (error) {
        logger.error(`Error processing file change:`, error);
      }
    }, debounceMs);

    debounceTimers.set(relativePath, timer);
  };

  watcher
    .on('add', filePath => debouncedOnChange(filePath, 'added'))
    .on('change', filePath => debouncedOnChange(filePath, 'modified'))
    .on('unlink', filePath => debouncedOnChange(filePath, 'deleted'));

  return {
    watcher,
    close: async () => {
      // Clear all debounce timers
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();
      await watcher.close();
    }
  };
}
