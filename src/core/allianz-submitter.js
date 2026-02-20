import { logger } from '../utils/logger.js';
import { PORTALS } from '../config/portals.js';

/**
 * Dedicated submit service boundary for Allianz Worldwide Care portal flow.
 */
export class AllianzSubmitter {
  constructor(steps = null) {
    this.steps = steps;
  }

  async submit(visit, runtimeCredential = null) {
    if (this.steps?.step) {
      this.steps.step(2, 'Submitting to Allianz portal service');
    }

    logger.warn('[SUBMIT] Allianz portal automation not yet implemented', {
      visitId: visit?.id || null,
      payType: visit?.pay_type || null,
    });

    return {
      success: false,
      reason: 'not_implemented',
      error: 'Allianz portal submit service is selected but automation is not implemented yet',
      portal: 'ALLIANZ',
      portalService: 'ALLIANZ',
      detailReason: 'allianz_portal_automation_not_implemented',
      portalUrl: runtimeCredential?.url || PORTALS.ALLIANZ?.url || null,
      hasRuntimeCredential: Boolean(runtimeCredential?.username || runtimeCredential?.password),
      savedAsDraft: false,
      submitted: false,
    };
  }
}
