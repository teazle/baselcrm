import { logger } from '../utils/logger.js';
import { PORTALS } from '../config/portals.js';

/**
 * Dedicated submit service boundary for Fullerton portal flow.
 */
export class FullertonSubmitter {
  constructor(steps = null) {
    this.steps = steps;
  }

  async submit(visit, runtimeCredential = null) {
    if (this.steps?.step) {
      this.steps.step(2, 'Submitting to Fullerton portal service');
    }

    logger.warn('[SUBMIT] Fullerton portal automation not yet implemented', {
      visitId: visit?.id || null,
      payType: visit?.pay_type || null,
    });

    return {
      success: false,
      reason: 'not_implemented',
      error: 'Fullerton portal submit service is selected but automation is not implemented yet',
      portal: 'FULLERTON',
      portalService: 'FULLERTON',
      detailReason: 'fullerton_portal_automation_not_implemented',
      portalUrl: runtimeCredential?.url || PORTALS.FULLERTON?.url || null,
      hasRuntimeCredential: Boolean(runtimeCredential?.username || runtimeCredential?.password),
      savedAsDraft: false,
      submitted: false,
    };
  }
}
