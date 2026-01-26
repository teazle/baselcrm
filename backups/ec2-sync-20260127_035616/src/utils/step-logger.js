import { logger } from './logger.js';

/**
 * Tiny helper to make workflow logs easier to follow.
 *
 * Usage:
 *   const steps = new StepLogger({ total: 21, prefix: 'WF' });
 *   steps.step(1, 'Login to Clinic Assist');
 */
export class StepLogger {
  constructor({ total, prefix = 'WF' } = {}) {
    this.total = total || null;
    this.prefix = prefix;
  }

  step(n, message, meta) {
    const total = this.total ? `/${this.total}` : '';
    const tag = `[${this.prefix} STEP ${String(n).padStart(2, '0')}${total}]`;
    if (meta !== undefined) logger.info(`${tag} ${message}`, meta);
    else logger.info(`${tag} ${message}`);
  }
}


