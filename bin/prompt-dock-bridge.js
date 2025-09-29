#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import { startBridge, stopBridge, getStatus } from '../src/index.js';
import { showLogs } from '../src/utils/logger.js';
import { configWizard } from '../src/utils/config.js';
import { testAgent } from '../src/agents/detector.js';
import { checkForUpdates, getVersionInfo } from '../src/utils/updater.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'package.json'), 'utf-8'));

program
  .name('prompt-dock-bridge')
  .description('Bridge for connecting web applications to AI coding agents')
  .version(packageJson.version);

program
  .command('start')
  .description('Start the bridge server')
  .option('-p, --port <number>', 'Port to run on', '51720')
  .option('-v, --verbose', 'Verbose logging')
  .option('-a, --agent <type>', 'Preferred agent (claude-code|cursor|codex)')
  .option('--hub <url>', 'Override Prompt Dock hub URL')
  .option('--no-open', 'Don\'t open browser on start')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    try {
      console.log(chalk.cyan('🚀 Starting Prompt Dock Bridge...'));

      if (options.verbose) {
        process.env.LOG_LEVEL = 'verbose';
      }

      await checkForUpdates();

      const port = parseInt(options.port, 10);

      await startBridge(options);

      if (options.open) {
        const open = (await import('open')).default;
        const targetHub = options.hub || process.env.PROMPT_DOCK_HUB || 'https://promptdock.app';
        try {
          const hubUrl = new URL(targetHub);
          hubUrl.searchParams.set('bridge', `localhost:${port}`);
          await open(hubUrl.toString());
        } catch (error) {
          console.log(chalk.yellow(`⚠️  Unable to open hub URL (${targetHub}): ${error.message}`));
        }
      }

      console.log(chalk.green(`✅ Bridge running on port ${port}`));
      console.log(chalk.gray(`WebSocket: ws://localhost:${port + 1}`));
      console.log(chalk.yellow('\nPress Ctrl+C to stop'));

    } catch (error) {
      console.error(chalk.red('Failed to start bridge:'), error.message);
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop the bridge server')
  .action(async () => {
    try {
      await stopBridge();
      console.log(chalk.green('✅ Bridge stopped'));
    } catch (error) {
      console.error(chalk.red('Failed to stop bridge:'), error.message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show bridge status and active sessions')
  .action(async () => {
    try {
      const status = await getStatus();

      if (status.running) {
        console.log(chalk.green('✅ Bridge is running'));
        console.log(chalk.gray(`Port: ${status.port}`));
        console.log(chalk.gray(`Active sessions: ${status.activeSessions}`));
        console.log(chalk.gray(`Detected agents: ${status.agents.join(', ')}`));
      } else {
        console.log(chalk.yellow('⚠️  Bridge is not running'));
      }
    } catch (error) {
      console.error(chalk.red('Failed to get status:'), error.message);
      process.exit(1);
    }
  });

program
  .command('logs')
  .description('Show recent execution logs')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .option('-f, --follow', 'Follow log output')
  .action(async (options) => {
    try {
      await showLogs(options);
    } catch (error) {
      console.error(chalk.red('Failed to show logs:'), error.message);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Interactive configuration wizard')
  .action(async () => {
    try {
      await configWizard();
      console.log(chalk.green('✅ Configuration saved'));
    } catch (error) {
      console.error(chalk.red('Configuration failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('test-agent <agent>')
  .description('Test if specific agent is working correctly')
  .action(async (agent) => {
    try {
      console.log(chalk.cyan(`Testing ${agent}...`));
      const result = await testAgent(agent);

      if (result.installed) {
        console.log(chalk.green(`✅ ${agent} is installed`));
        console.log(chalk.gray(`Version: ${result.version}`));
        console.log(chalk.gray(`Path: ${result.path}`));

        if (result.testOutput) {
          console.log(chalk.gray('Test output:'), result.testOutput);
        }
      } else {
        console.log(chalk.red(`❌ ${agent} is not installed or not working`));
        if (result.error) {
          console.log(chalk.gray('Error:'), result.error);
        }
      }
    } catch (error) {
      console.error(chalk.red('Test failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('version')
  .description('Show bridge version details and update status')
  .action(async () => {
    try {
      const info = await getVersionInfo();
      console.log(chalk.gray(`Name: ${info.name}`));
      console.log(chalk.gray(`Version: ${info.version}`));
      console.log(chalk.gray(`Description: ${info.description}`));

      const update = await checkForUpdates();

      if (update.updateAvailable) {
        console.log(chalk.yellow(`Update available: ${update.currentVersion} → ${update.latestVersion}`));
      } else {
        console.log(chalk.green('You are running the latest version.'));
      }
    } catch (error) {
      console.error(chalk.red('Failed to retrieve version information:'), error.message);
      process.exit(1);
    }
  });

program.parse();
