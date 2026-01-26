import { logger } from './logger.js';

// Global registry of cleanup functions
const cleanupRegistry = new Set();

/**
 * Register a cleanup function to be called before process exit
 * @param {Function} cleanupFn - Async function to run during cleanup
 */
export function registerCleanup(cleanupFn) {
  if (typeof cleanupFn !== 'function') {
    throw new Error('cleanupFn must be a function');
  }
  cleanupRegistry.add(cleanupFn);
  
  // Return unregister function
  return () => {
    cleanupRegistry.delete(cleanupFn);
  };
}

/**
 * Execute all registered cleanup functions
 */
async function executeCleanup() {
  if (cleanupRegistry.size === 0) return;
  
  logger.info(`Executing ${cleanupRegistry.size} cleanup function(s)...`);
  const cleanupPromises = Array.from(cleanupRegistry).map(async (fn) => {
    try {
      await fn();
    } catch (error) {
      logger.error('Error in cleanup function:', error);
    }
  });
  
  await Promise.allSettled(cleanupPromises);
  cleanupRegistry.clear();
}

let exitInProgress = false;

/**
 * Safe process exit that ensures cleanup runs first
 * This replaces process.exit() to ensure proper cleanup
 * 
 * @param {number} code - Exit code (default: 0)
 */
export async function safeExit(code = 0) {
  if (exitInProgress) {
    // Already exiting, just exit immediately
    process.exit(code);
    return;
  }
  
  exitInProgress = true;
  
  try {
    await executeCleanup();
    logger.info('Cleanup completed, exiting...');
  } catch (error) {
    logger.error('Error during cleanup:', error);
  } finally {
    // Use setTimeout to allow any pending async operations to complete
    // but don't wait forever
    setTimeout(() => {
      process.exit(code);
    }, 1000);
  }
}

/**
 * Synchronous version for cases where you can't await
 * Note: This gives cleanup 2 seconds max to complete
 */
export function safeExitSync(code = 0) {
  if (exitInProgress) {
    process.exit(code);
    return;
  }
  
  exitInProgress = true;
  
  // Execute cleanup with timeout
  const cleanupPromise = executeCleanup();
  const timeoutPromise = new Promise(resolve => setTimeout(resolve, 2000));
  
  Promise.race([cleanupPromise, timeoutPromise])
    .then(() => {
      logger.info('Cleanup completed (or timed out), exiting...');
      process.exit(code);
    })
    .catch(() => {
      process.exit(code);
    });
}

// Register signal handlers to ensure cleanup on termination
let handlersRegistered = false;

/**
 * Register process signal handlers for graceful shutdown
 * This ensures cleanup runs even on SIGINT/SIGTERM
 */
export function registerExitHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;
  
  const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}, initiating graceful shutdown...`);
    await executeCleanup();
    process.exit(0);
  };
  
  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
  
  // Handle uncaught exceptions and unhandled rejections
  process.once('uncaughtException', async (error) => {
    logger.error('Uncaught exception:', error);
    await executeCleanup();
    process.exit(1);
  });
  
  process.once('unhandledRejection', async (reason) => {
    logger.error('Unhandled rejection:', reason);
    await executeCleanup();
    process.exit(1);
  });
}

// Auto-register handlers when module is imported
registerExitHandlers();
