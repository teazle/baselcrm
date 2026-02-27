import { PORTALS } from '../config/portals.js';
import { GenericPortalSubmitter, createDefaultSelectors } from './portal-generic-submitter.js';

function withOverrides(base, overrides) {
  const next = { ...base };
  for (const [key, list] of Object.entries(overrides || {})) {
    next[key] = [...new Set([...(list || []), ...(base[key] || [])])];
  }
  return next;
}

function buildSelectors() {
  return withOverrides(createDefaultSelectors(), {
    loginUsername: ['input[name="userName"]', 'input[id="username"]'],
    loginPassword: ['input[name="password"]', 'input[id="password"]'],
    loginSubmit: ['a:has-text("Login")', 'td:has-text("Login") a', 'a[href*="weoButtonHrefUid"]'],
    otpInputs: ['input[name="otp"]', 'input[id="otp"]'],
    searchInput: [
      'input[name*="policy" i]',
      'input[id*="policy" i]',
      'input[name*="surname" i]',
      'input[id*="surname" i]',
      'input[name*="dob" i]',
      'input[id*="dob" i]',
      'input[type="text"]',
    ],
    searchSubmit: [
      'button:has-text("Search Member")',
      'button:has-text("Search")',
      'button:has-text("SEARCH")',
      'input[value*="SEARCH" i]',
      'a:has-text("SEARCH")',
      'td:has-text("SEARCH")',
    ],
    formDiagnosis: ['textarea[name*="diagnosisDescription" i]', 'input[name*="diagnosisCode" i]'],
    formAmount: ['input[name*="claimAmount" i]', 'input[id*="claimAmount" i]'],
  });
}

/**
 * Dedicated submit service boundary for Allianz Worldwide Care portal flow.
 */
export class AllianzSubmitter {
  constructor(page, steps = null) {
    this.steps = steps;
    this.runtime = new GenericPortalSubmitter({
      page,
      steps,
      portalTarget: 'ALLIANZ',
      portalName: 'Allianz Worldwide Care',
      defaultUrl: PORTALS.ALLIANZ?.url || 'https://my.allianzworldwidecare.com/sol/login.do',
      defaultUsername: PORTALS.ALLIANZ?.username || '',
      defaultPassword: PORTALS.ALLIANZ?.password || '',
      supportsOtp: true,
      selectors: buildSelectors(),
    });
  }

  async submit(visit, runtimeCredential = null) {
    if (this.steps?.step) {
      this.steps.step(2, 'Submitting to Allianz portal service');
    }
    return this.runtime.submit(visit, runtimeCredential);
  }
}
