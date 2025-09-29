import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function checkForUpdates() {
  try {
    const packagePath = path.join(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf-8'));
    const currentVersion = packageJson.version;

    logger.verbose(`Current version: ${currentVersion}`);

    try {
      const { stdout } = await execAsync('npm view prompt-dock-bridge version');
      const latestVersion = stdout.trim();

      if (latestVersion && latestVersion !== currentVersion) {
        logger.info(`Update available: ${currentVersion} → ${latestVersion}`);
        logger.info('Run: npm update -g prompt-dock-bridge');

        return {
          updateAvailable: true,
          currentVersion,
          latestVersion
        };
      }
    } catch (error) {
      logger.verbose('Failed to check for updates:', error.message);
    }

    return {
      updateAvailable: false,
      currentVersion
    };
  } catch (error) {
    logger.error('Update check failed:', error);
    return {
      updateAvailable: false,
      error: error.message
    };
  }
}

export async function performSelfUpdate() {
  try {
    logger.info('Updating prompt-dock-bridge...');

    const { stdout } = await execAsync('npm update -g prompt-dock-bridge');
    logger.info('Update completed successfully');

    return {
      success: true,
      output: stdout
    };
  } catch (error) {
    logger.error('Self-update failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

export async function getVersionInfo() {
  try {
    const packagePath = path.join(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf-8'));

    return {
      version: packageJson.version,
      name: packageJson.name,
      description: packageJson.description,
      license: packageJson.license
    };
  } catch (error) {
    logger.error('Failed to get version info:', error);
    return {
      version: 'unknown',
      error: error.message
    };
  }
}