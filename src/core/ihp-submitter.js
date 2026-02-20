import { logger } from '../utils/logger.js';
import { PORTALS } from '../config/portals.js';

/**
 * Dedicated submit service boundary for IHP portal flow.
 */
export class IHPSubmitter {
  constructor(steps = null) {
    this.steps = steps;
  }

  async submit(visit, runtimeCredential = null) {
    if (this.steps?.step) {
      this.steps.step(2, 'Submitting to IHP portal service');
    }

    logger.warn('[SUBMIT] IHP portal automation not yet implemented', {
      visitId: visit?.id || null,
      payType: visit?.pay_type || null,
    });

    return {
      success: false,
      reason: 'not_implemented',
      error: 'IHP portal submit service is selected but automation is not implemented yet',
      portal: 'IHP',
      portalService: 'IHP',
      detailReason: 'ihp_portal_automation_not_implemented',
      portalUrl: runtimeCredential?.url || PORTALS.IHP?.url || null,
      hasRuntimeCredential: Boolean(runtimeCredential?.username || runtimeCredential?.password),
      savedAsDraft: false,
      submitted: false,
    };
  }
}
