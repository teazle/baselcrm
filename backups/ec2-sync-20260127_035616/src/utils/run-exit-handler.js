import { logger } from './logger.js';

let finalized = false;
let handlerRan = false;

/**
 * Register exit/signal handlers so we always mark an RPA run as 'failed' if the
 * process exits before we explicitly mark it completed. Prevents runs stuck as "running".
 *
 * @param {object} supabase - Supabase client
 * @param {string|null} runId - rpa_extraction_runs id
 * @param {(id: string, updates: object) => Promise<void>} updateRun - e.g. _updateRun or updateRun
 */
export function registerRunExitHandler(supabase, runId, updateRun) {
  if (!supabase || !runId || typeof updateRun !== 'function') return;

  const run = async () => {
    if (handlerRan || finalized) return;
    handlerRan = true;
    try {
      await updateRun(runId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: 'Process exited or was killed before run completed.',
      });
    } catch (e) {
      logger.warn('[RunExitHandler] Failed to update run on exit', { error: e?.message });
    }
  };

  const onExit = () => {
    run().then(() => process.exit(1)).catch(() => process.exit(1));
  };

  process.once('SIGINT', onExit);
  process.once('SIGTERM', onExit);
}

/**
 * Call this when you have successfully set status to 'completed' or 'failed'.
 * Exit handlers will then skip updating the run.
 */
export function markRunFinalized() {
  finalized = true;
}

/**
 * Reset state (e.g. for tests or multiple runs in same process).
 */
export function resetRunExitHandler() {
  finalized = false;
  handlerRan = false;
}
