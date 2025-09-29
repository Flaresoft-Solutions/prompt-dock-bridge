import winston from 'winston';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import * as rfs from 'rotating-file-stream';

const LOG_DIR = path.join(os.homedir(), '.prompt-dock');
const LOG_FILE = path.join(LOG_DIR, 'bridge.log');
const AUDIT_LOG_FILE = path.join(LOG_DIR, 'audit.log');

const colorize = {
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.cyan,
  verbose: chalk.gray,
  debug: chalk.gray
};

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const coloredLevel = colorize[level] ? colorize[level](level.toUpperCase()) : level.toUpperCase();
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${chalk.gray(timestamp)} ${coloredLevel} ${message}${metaStr}`;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

function createFileTransport(filename, options = {}) {
  return new winston.transports.File({
    filename,
    format: fileFormat,
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    tailable: true,
    ...options
  });
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: fileFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
      level: process.env.LOG_LEVEL || 'info'
    }),
    createFileTransport(LOG_FILE)
  ],
  exceptionHandlers: [
    createFileTransport(path.join(LOG_DIR, 'exceptions.log'))
  ],
  rejectionHandlers: [
    createFileTransport(path.join(LOG_DIR, 'rejections.log'))
  ]
});

export function setLogLevel(level) {
  logger.level = level;
  logger.transports.forEach(transport => {
    if (transport instanceof winston.transports.Console) {
      transport.level = level;
    }
  });
}

export async function showLogs(options = {}) {
  const fs = await import('fs/promises');

  try {
    const logFile = options.audit ? AUDIT_LOG_FILE : LOG_FILE;
    const lines = parseInt(options.lines) || 50;

    const content = await fs.readFile(logFile, 'utf-8');
    const logLines = content.split('\n').filter(line => line.trim());

    const recentLines = logLines.slice(-lines);

    if (options.follow) {
      console.log(`Following ${logFile}...`);
      console.log('Press Ctrl+C to stop\n');

      recentLines.forEach(line => {
        try {
          const logEntry = JSON.parse(line);
          const timestamp = new Date(logEntry.timestamp).toLocaleTimeString();
          const level = logEntry.level.toUpperCase();
          const coloredLevel = colorize[logEntry.level] ? colorize[logEntry.level](level) : level;
          console.log(`${chalk.gray(timestamp)} ${coloredLevel} ${logEntry.message}`);
        } catch {
          console.log(line);
        }
      });

      const { watch } = await import('chokidar');
      const watcher = watch(logFile);

      watcher.on('change', async () => {
        try {
          const newContent = await fs.readFile(logFile, 'utf-8');
          const newLines = newContent.split('\n').filter(line => line.trim());
          const latestLines = newLines.slice(logLines.length);

          latestLines.forEach(line => {
            try {
              const logEntry = JSON.parse(line);
              const timestamp = new Date(logEntry.timestamp).toLocaleTimeString();
              const level = logEntry.level.toUpperCase();
              const coloredLevel = colorize[logEntry.level] ? colorize[logEntry.level](level) : level;
              console.log(`${chalk.gray(timestamp)} ${coloredLevel} ${logEntry.message}`);
            } catch {
              console.log(line);
            }
          });
        } catch (error) {
          console.error('Error reading log file:', error.message);
        }
      });

      process.on('SIGINT', () => {
        watcher.close();
        process.exit(0);
      });
    } else {
      recentLines.forEach(line => {
        try {
          const logEntry = JSON.parse(line);
          const timestamp = new Date(logEntry.timestamp).toLocaleTimeString();
          const level = logEntry.level.toUpperCase();
          const coloredLevel = colorize[logEntry.level] ? colorize[logEntry.level](level) : level;
          console.log(`${chalk.gray(timestamp)} ${coloredLevel} ${logEntry.message}`);
        } catch {
          console.log(line);
        }
      });
    }
  } catch (error) {
    console.error('Failed to read log file:', error.message);
    throw error;
  }
}

export function createAuditLogger() {
  return winston.createLogger({
    level: 'info',
    format: fileFormat,
    transports: [
      createFileTransport(AUDIT_LOG_FILE, {
        maxsize: 50 * 1024 * 1024, // 50MB for audit logs
        maxFiles: 10
      })
    ]
  });
}

export function logSecurityEvent(event, data) {
  const auditLogger = createAuditLogger();
  auditLogger.info('Security Event', {
    event,
    data,
    timestamp: new Date().toISOString(),
    pid: process.pid
  });
}

export function logPerformance(operation, duration, metadata = {}) {
  logger.info(`Performance: ${operation}`, {
    duration: `${duration}ms`,
    ...metadata
  });
}

export function logAgentEvent(agent, event, data) {
  logger.info(`Agent Event: ${agent}`, {
    event,
    data,
    timestamp: new Date().toISOString()
  });
}

export { logger };