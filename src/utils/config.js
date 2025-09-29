import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

const CONFIG_DIR = path.join(os.homedir(), '.prompt-dock');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_ALLOWED_ORIGINS = [
  'https://promptdock.app',
  'https://www.promptdock.app',
  'http://localhost:3000'
];

const DEFAULT_CONFIG = {
  hub: 'https://promptdock.app',
  defaultHub: 'https://promptdock.app',
  allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS],
  customOrigins: [],
  api: {
    endpoint: 'https://promptdock.app/api',
    version: 'v1'
  },
  telemetry: {
    enabled: false,
    endpoint: null
  },
  branding: {
    name: 'Prompt Dock Bridge',
    defaultMessage: 'Connected to Prompt Dock (promptdock.app)'
  },
  port: 51720,
  wsPort: 51721,
  security: {
    requirePairing: true,
    enforceOriginCheck: true,
    allowCustomOrigins: false,
    customOriginAcknowledged: false,
    sessionTimeout: 3600000, // 1 hour
    commandTimeout: 30000, // 30 seconds
    maxCommandsPerMinute: 100
  },
  agents: {
    preferred: 'claude-code',
    paths: {
      'claude-code': 'auto-detect',
      'cursor-agent': 'auto-detect',
      'codex': 'auto-detect'
    },
    timeout: 300000, // 5 minutes
    retryAttempts: 3,
    maxBufferBytes: 4 * 1024 * 1024
  },
  git: {
    autoStash: false,
    createBackupBranch: true,
    requireCleanWorkingTree: false,
    autoCommit: false
  },
  logging: {
    level: 'info',
    file: path.join(CONFIG_DIR, 'bridge.log'),
    maxSize: '10m',
    maxFiles: 5
  },
  features: {
    autoUpdate: true,
    telemetry: false,
    experimentalFeatures: false
  }
};

export async function ensureConfigDir() {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  } catch (error) {
    logger.error('Failed to create config directory:', error);
    throw error;
  }
}

export async function loadConfig(options = null) {
  try {
    const { configFile, overrides } = resolveLoadOptions(options);
    let config = cloneDefaults();

    try {
      const configData = await fs.readFile(configFile, 'utf-8');
      const userConfig = JSON.parse(configData);
      config = mergeConfig(config, userConfig);
      logger.verbose(`Loaded config from ${configFile}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('No config file found, using defaults');
        await saveConfig(config);
      } else {
        logger.error('Failed to load config:', error);
        throw error;
      }
    }

    config = applyOverrides(config, overrides);
    config = hydrateDerivedConfig(config);
    validateConfig(config);
    return config;
  } catch (error) {
    logger.error('Failed to load configuration:', error);
    throw error;
  }
}

export async function saveConfig(config, configPath = null) {
  try {
    const configFile = configPath || CONFIG_FILE;
    await ensureConfigDir();

    const configJson = JSON.stringify(config, null, 2);
    await fs.writeFile(configFile, configJson, { mode: 0o600 });

    logger.verbose(`Saved config to ${configFile}`);
  } catch (error) {
    logger.error('Failed to save config:', error);
    throw error;
  }
}

function mergeConfig(defaultConfig, userConfig) {
  const merged = { ...defaultConfig };

  for (const [key, value] of Object.entries(userConfig)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      merged[key] = { ...defaultConfig[key], ...value };
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function resolveLoadOptions(options) {
  if (typeof options === 'string') {
    return { configFile: options, overrides: {} };
  }

  const configOptions = options || {};
  return {
    configFile: configOptions.path || configOptions.configPath || CONFIG_FILE,
    overrides: configOptions.overrides || {}
  };
}

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function applyOverrides(config, overrides) {
  const next = mergeConfig(config, overrides);

  if (Array.isArray(overrides.allowedOrigins)) {
    next.allowedOrigins = [...new Set(overrides.allowedOrigins)];
  }

  if (Array.isArray(overrides.customOrigins)) {
    next.customOrigins = [...new Set(overrides.customOrigins)];
  }

  return next;
}

function hydrateDerivedConfig(config) {
  const hydrated = { ...config };

  hydrated.allowedOrigins = Array.from(new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(hydrated.allowedOrigins || []),
    ...(hydrated.security?.allowCustomOrigins ? hydrated.customOrigins || [] : [])
  ]));

  if (!hydrated.security) {
    hydrated.security = {};
  }

  hydrated.security.allowedOrigins = [...hydrated.allowedOrigins];

  return hydrated;
}

function validateConfig(config) {
  const errors = [];

  if (!config.port || config.port < 1 || config.port > 65535) {
    errors.push('Invalid port number');
  }

  if (!config.wsPort || config.wsPort < 1 || config.wsPort > 65535) {
    errors.push('Invalid WebSocket port number');
  }

  if (config.port === config.wsPort) {
    errors.push('HTTP and WebSocket ports cannot be the same');
  }

  if (!config.security.sessionTimeout || config.security.sessionTimeout < 60000) {
    errors.push('Session timeout must be at least 1 minute');
  }

  if (!config.security.maxCommandsPerMinute || config.security.maxCommandsPerMinute < 1) {
    errors.push('Max commands per minute must be at least 1');
  }

  if (!Array.isArray(config.security.allowedOrigins)) {
    errors.push('Allowed origins must be an array');
  }

  if (config.customOrigins?.length) {
    if (!config.security.allowCustomOrigins) {
      errors.push('Custom origins provided but allowCustomOrigins is false');
    }

    if (!config.security.customOriginAcknowledged) {
      errors.push('Custom origins require explicit security acknowledgement');
    }
  }

  // Origin checks are now always enforced - remove this validation as it's no longer configurable

  if (!config.agents.timeout || config.agents.timeout < 30000) {
    errors.push('Agent timeout must be at least 30 seconds');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
  }
}

export async function configWizard() {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => new Promise((resolve) => {
    rl.question(prompt, resolve);
  });

  try {
    console.log('\n🔧 Prompt Dock Bridge Configuration Wizard\n');

    const config = { ...DEFAULT_CONFIG };

    // Basic settings
    const port = await question(`HTTP port (${config.port}): `);
    if (port) config.port = parseInt(port);

    const wsPort = await question(`WebSocket port (${config.port + 1}): `);
    if (wsPort) config.wsPort = parseInt(wsPort);
    else config.wsPort = config.port + 1;

    const hub = await question(`Hub URL (${config.hub}): `);
    if (hub) {
      config.hub = hub.trim();
    }

    // Agent preferences
    const preferredAgent = await question('Preferred agent (claude-code/cursor-agent/codex): ');
    if (preferredAgent) config.agents.preferred = preferredAgent;

    // Git settings
    const createBackup = await question('Create backup branch before execution? (y/N): ');
    config.git.createBackupBranch = createBackup.toLowerCase().startsWith('y');

    const autoStash = await question('Auto-stash uncommitted changes? (y/N): ');
    config.git.autoStash = autoStash.toLowerCase().startsWith('y');

    const requireClean = await question('Require clean working tree? (y/N): ');
    config.git.requireCleanWorkingTree = requireClean.toLowerCase().startsWith('y');

    // Security settings
    const sessionTimeout = await question(`Session timeout in minutes (${config.security.sessionTimeout / 60000}): `);
    if (sessionTimeout) config.security.sessionTimeout = parseInt(sessionTimeout) * 60000;

    // Origin security
    const allowCustomOrigins = await question('Allow custom origins? (y/N): ');
    config.security.allowCustomOrigins = allowCustomOrigins.toLowerCase().startsWith('y');

    if (config.security.allowCustomOrigins) {
      const acknowledge = await question('Type "ALLOW" to acknowledge security risks of custom origins: ');
      config.security.customOriginAcknowledged = acknowledge.trim().toUpperCase() === 'ALLOW';

      if (config.security.customOriginAcknowledged) {
        let originIndex = 1;
        while (true) {
          const customOrigin = await question(`Custom origin #${originIndex} (leave blank to stop): `);
          if (!customOrigin) break;
          config.customOrigins.push(customOrigin.trim());
          originIndex += 1;
        }
      }
    }

    // Logging level
    const logLevel = await question('Log level (verbose/info/warn/error): ');
    if (logLevel) config.logging.level = logLevel;

    // Features
    const autoUpdate = await question('Enable auto-updates? (Y/n): ');
    config.features.autoUpdate = !autoUpdate.toLowerCase().startsWith('n');

    const hydrated = hydrateDerivedConfig(config);

    console.log('\n📋 Configuration Summary:');
    console.log(JSON.stringify(hydrated, null, 2));

    const confirm = await question('\nSave this configuration? (Y/n): ');
    if (!confirm.toLowerCase().startsWith('n')) {
      await saveConfig(hydrated);
      console.log('✅ Configuration saved!');
    }

    return hydrated;
  } finally {
    rl.close();
  }
}

export function getConfigPath() {
  return CONFIG_FILE;
}

export function getConfigDir() {
  return CONFIG_DIR;
}
