import { logger } from './logger.js';

export async function gracefulShutdown(httpServer, wsServer, sessionManager) {
  logger.info('Initiating graceful shutdown...');

  try {
    if (sessionManager) {
      logger.info('Cleaning up active sessions...');
      const activeSessions = sessionManager.getActiveSessions();

      for (const session of activeSessions) {
        sessionManager.revokeSession(session.id);
      }
    }

    if (wsServer) {
      logger.info('Closing WebSocket server...');
      wsServer.clients.forEach(ws => {
        ws.close(1001, 'Server shutting down');
      });

      await new Promise((resolve) => {
        wsServer.close(resolve);
      });
    }

    if (httpServer) {
      logger.info('Closing HTTP server...');
      await new Promise((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}