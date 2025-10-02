import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

const execAsync = promisify(exec);

let wslDetected = null;
let wslVersion = null;
let windowsUsername = null;
let wslDistro = null;

export async function detectWSL() {
  if (wslDetected !== null) {
    return {
      isWSL: wslDetected,
      version: wslVersion,
      windowsUsername,
      distro: wslDistro
    };
  }

  try {
    const versionInfo = await fs.readFile('/proc/version', 'utf-8');

    if (versionInfo.includes('Microsoft') || versionInfo.includes('WSL')) {
      wslDetected = true;

      if (versionInfo.includes('WSL2')) {
        wslVersion = 2;
      } else {
        wslVersion = 1;
      }

      wslDistro = process.env.WSL_DISTRO_NAME || inferDistroFromPath();

      try {
        const { stdout } = await execAsync('cmd.exe /c echo %USERNAME%');
        windowsUsername = stdout.trim();
      } catch {
        logger.verbose('Could not detect Windows username');
      }

      logger.info(`Detected WSL${wslVersion} environment`);
    } else {
      wslDetected = false;
    }
  } catch {
    wslDetected = false;
  }

  return {
    isWSL: wslDetected,
    version: wslVersion,
    windowsUsername,
    distro: wslDistro
  };
}

export function translatePath(path, direction = 'wsl-to-windows') {
  if (direction === 'wsl-to-windows') {
    return translateWSLToWindows(path);
  } else if (direction === 'windows-to-wsl') {
    return translateWindowsToWSL(path);
  }

  return path;
}

function translateWSLToWindows(wslPath) {
  if (!wslPath.startsWith('/')) {
    return wslPath;
  }

  if (wslPath.startsWith('/mnt/')) {
    const parts = wslPath.split('/');
    if (parts.length >= 3) {
      const drive = parts[2].toUpperCase();
      const remainingPath = parts.slice(3).join('\\');
      return `${drive}:\\${remainingPath}`;
    }
  }

  const distroName = wslDistro || process.env.WSL_DISTRO_NAME || inferDistroFromPath();
  return `\\\\wsl$\\${distroName}${wslPath}`;
}

function translateWindowsToWSL(windowsPath) {
  // Handle \\wsl.localhost\Ubuntu\path format
  if (windowsPath.startsWith('\\\\wsl.localhost\\')) {
    const parts = windowsPath.split('\\').filter(p => p);
    if (parts.length >= 3) {
      // parts[0] = 'wsl.localhost', parts[1] = distro name, parts[2+] = path
      const remainingPath = parts.slice(2).join('/');
      return `/${remainingPath}`;
    }
  }

  // Handle \\wsl$\Ubuntu\path format
  if (windowsPath.startsWith('\\\\wsl$\\')) {
    const parts = windowsPath.split('\\').filter(p => p);
    if (parts.length >= 3) {
      const remainingPath = parts.slice(2).join('/');
      return `/${remainingPath}`;
    }
  }

  // Handle C:\path format
  if (windowsPath.match(/^[A-Z]:\\/)) {
    const drive = windowsPath[0].toLowerCase();
    const remainingPath = windowsPath.substring(3).replace(/\\/g, '/');
    return `/mnt/${drive}/${remainingPath}`;
  }

  return windowsPath;
}

export async function getWindowsEnvironment() {
  try {
    const { stdout } = await execAsync('cmd.exe /c set');
    const envVars = {};

    stdout.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        envVars[key.trim()] = valueParts.join('=').trim();
      }
    });

    return envVars;
  } catch (error) {
    logger.error('Failed to get Windows environment:', error);
    return {};
  }
}

export async function detectAgentLocation(agentName) {
  const wslInfo = await detectWSL();

  if (!wslInfo.isWSL) {
    return { location: 'native', path: null };
  }

  try {
    const { stdout: wslPath } = await execAsync(`which ${agentName}`);
    if (wslPath.trim()) {
      return {
        location: 'wsl',
        path: wslPath.trim()
      };
    }
  } catch {
    // Agent not found in WSL
  }

  try {
    const { stdout: windowsPath } = await execAsync(`cmd.exe /c where ${agentName}`);
    if (windowsPath.trim()) {
      return {
        location: 'windows',
        path: windowsPath.trim()
      };
    }
  } catch {
    // Agent not found in Windows
  }

  return { location: null, path: null };
}

export async function createWSLCommand(command, args, workdir) {
  const wslInfo = await detectWSL();

  if (!wslInfo.isWSL) {
    return { command, args };
  }

  if (workdir && workdir.startsWith('/')) {
    const windowsPath = translatePath(workdir, 'wsl-to-windows');
    return {
      command: 'wsl.exe',
      args: ['-e', command, ...args],
      options: { cwd: windowsPath }
    };
  }

  return {
    command: 'wsl.exe',
    args: ['-e', command, ...args]
  };
}

export async function setupWSLNetworking() {
  const wslInfo = await detectWSL();

  if (!wslInfo.isWSL || wslInfo.version !== 2) {
    return { required: false };
  }

  try {
    const { stdout: ipAddress } = await execAsync('hostname -I');
    const wslIP = ipAddress.trim().split(' ')[0];

    logger.info(`WSL2 IP address: ${wslIP}`);

    return {
      required: true,
      wslIP,
      windowsIP: '127.0.0.1'
    };
  } catch (error) {
    logger.error('Failed to setup WSL networking:', error);
    return { required: true, error: error.message };
  }
}

export function getWSLDistribution() {
  return wslDistro || process.env.WSL_DISTRO_NAME || 'Ubuntu';
}

export async function isWSLInteropEnabled() {
  try {
    await execAsync('cmd.exe /c echo test');
    return true;
  } catch {
    return false;
  }
}

export async function fixWSLPermissions(filePath) {
  try {
    await execAsync(`chmod 600 "${filePath}"`);
    logger.verbose(`Fixed permissions for ${filePath}`);
  } catch (error) {
    logger.warn(`Failed to fix permissions for ${filePath}:`, error.message);
  }
}

function inferDistroFromPath() {
  return process.env.WSL_DISTRO_NAME || 'Ubuntu';
}
