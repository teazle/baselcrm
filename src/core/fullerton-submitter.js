import { PORTALS } from '../config/portals.js';
import { GenericPortalSubmitter, createDefaultSelectors } from './portal-generic-submitter.js';

function withOverrides(base, overrides) {
  const next = { ...base };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (Array.isArray(value)) {
      next[key] = [...new Set([...(value || []), ...(base[key] || [])])];
      continue;
    }
    next[key] = value;
  }
  return next;
}

async function ensureFullertonVisitForm({ page, state, helpers }) {
  const isEditPage = () =>
    page
      .evaluate(() => {
        const url = String(globalThis.location?.href || '');
        const body = String(globalThis.document?.body?.innerText || '').toLowerCase();
        if (/edit_visit|editvisit|visit_edit|visit\/edit|visit_register\.action/i.test(url))
          return true;
        return /edit visit|visit information|diagnosis|medication certificate|in-house services|radiology services/i.test(
          body
        );
      })
      .catch(() => false);

  const waitForEditPage = async timeoutMs => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await isEditPage()) return true;
      await page.waitForTimeout(700);
    }
    return false;
  };

  const clickDuplicateOk = async () => {
    const picked = await helpers.clickFirst(
      [
        '.ui-dialog button:has-text("OK"):visible',
        '.ui-dialog-buttonset button:has-text("OK"):visible',
        '.ui-dialog-buttonpane button:has-text("OK"):visible',
        'button#btn_dialog_ok',
        'input#btn_dialog_ok',
        'button:has-text("OK")',
        'input[value="OK"]',
      ],
      { timeout: 1200, clickTimeout: 1500, force: true, visibleOnly: true }
    );
    if (picked) state.duplicate_visit_popup = 'ok_clicked';
    return Boolean(picked);
  };

  const submitRegisterFormDirectly = async () =>
    page
      .evaluate(() => {
        const byId = globalThis.document?.querySelector?.('#visitRegister_0');
        const registerInput =
          byId ||
          Array.from(globalThis.document?.querySelectorAll?.('input[type="submit"]') || []).find(
            node => /register/i.test(String(node.value || ''))
          );
        const form = registerInput?.form || registerInput?.closest?.('form');
        if (!form) return false;
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit(registerInput || undefined);
          return true;
        }
        form.submit();
        return true;
      })
      .catch(() => false);

  if (await isEditPage()) {
    state.form_navigation = {
      mode: 'already_edit',
      url: String(page.url() || ''),
    };
    return;
  }

  for (let i = 0; i < 5; i += 1) {
    await clickDuplicateOk();
    if (await waitForEditPage(8000)) {
      state.form_navigation = {
        mode: 'popup_resolved_to_edit',
        url: String(page.url() || ''),
      };
      return;
    }

    const clickedRegister = await helpers.clickFirst(
      [
        'input#visitRegister_0',
        'input[value="Register"]',
        'a:has-text("Register")',
        'button:has-text("Register")',
      ],
      { timeout: 1800, clickTimeout: 2200, force: true, visibleOnly: false }
    );
    if (clickedRegister) {
      state.register_click_selector = clickedRegister;
    }
    if (!clickedRegister) {
      const submitted = await submitRegisterFormDirectly();
      if (submitted) state.register_click_selector = 'form.requestSubmit(visitRegister_0)';
    }

    await page.waitForTimeout(1200);
    await clickDuplicateOk();
    await page.waitForTimeout(1200);

    if (await waitForEditPage(12000)) {
      state.form_navigation = {
        mode: 'register_to_edit',
        url: String(page.url() || ''),
      };
      return;
    }
  }

  state.form_navigation = {
    mode: 'register_not_advanced',
    url: String(page.url() || ''),
  };
}

function buildSelectors() {
  return withOverrides(createDefaultSelectors(), {
    loginUsername: [
      'input[name="user.loginId"]',
      'input#appLogin_user_loginId',
      'input[name="LoginId"]',
      'input[id="LoginId"]',
      'input[name*="doctor" i]',
      'input[type="text"]',
      'input[type="email"]',
    ],
    loginPassword: [
      'input[name="user.pwd"]',
      'input#pwd',
      'input[name="Password"]',
      'input[id="Password"]',
      'input[type="password"]',
    ],
    loginSubmit: ['input#appLogin_0', 'input[value="Login"]', 'input[type="submit"]'],
    otpInputs: ['input[name*="otp" i]', 'input[name*="token" i]', 'input[id*="token" i]'],
    otpSubmit: ['button:has-text("Verify")', 'button:has-text("Continue")'],
    preSearchClicks: [
      'input#btn_dialog_ok',
      'button#btn_dialog_ok',
      'a:has-text("Patients")',
      'a[href*="patient_list"]',
    ],
    preSearchUrls: ['https://doctor.fhn3.com/patient_list'],
    searchInput: [
      'input#idnVerify',
      'input[name="patient.idn"]',
      'input[name*="nricNo" i]',
      'input[name*="patientNo" i]',
      'input[id*="memberNo" i]',
      'input[name*="nric" i]',
      'input[id*="nric" i]',
      'input[name*="member" i]',
      'input[id*="member" i]',
      'input[name*="patient" i]',
      'input[id*="patient" i]',
      'input[type="search"]',
    ],
    searchVisitDate: [
      'input#visitDateTime',
      'input[name="patient.visitDateTimeStr"]',
      'input[id*="visitDateTime" i]',
    ],
    searchSubmit: [
      'input#patientSearch_0',
      'input[value="Verify"]',
      'button:has-text("Search")',
      'button:has-text("Find Patient")',
      'input[value*="Search" i]',
      'input[type="submit"]',
    ],
    searchPostSubmitWaitMs: 4500,
    searchResultForceClick: true,
    searchNoResultPatterns: [
      'no record',
      'no result',
      'not found',
      'unable to find',
      'invalid member',
    ],
    searchPageIndicators: ['input#idnVerify', 'input#patientSearch_0', 'text=Select Patient'],
    formPageIndicators: [
      'input[name*="consult" i]',
      'input[name*="diagnosis" i]',
      'textarea[name*="diagnosis" i]',
      'input[name*="claim" i]',
      'button:has-text("Save")',
      'button:has-text("Submit")',
    ],
    preFormClicks: [],
    preFormForceClick: true,
    preFormPostClickWaitMs: 4500,
    searchResultRow: [
      'xpath=//table[contains(., "Select Patient")]//a[contains(normalize-space(.), "Select")][1]',
      'table:has-text("Select Patient") a:has-text("Select")',
      'table:has-text("Select Patient") input[value="Select"]',
      'a:has-text("Select")',
      'input[id^="selectInfo_"][value="Select"]',
      'input[value="Select"]',
      'table tbody tr:first-child td input[type="submit"]',
      'text=/^\\s*Select\\s*$/i',
    ],
    formVisitDate: [
      'input[name*="visitDate" i]',
      'input[id*="visitDate" i]',
      'input[name*="visit" i]',
      'input[id*="visit" i]',
    ],
    formDiagnosis: [
      'xpath=//label[contains(normalize-space(.), "Primary")]/following::input[1]',
      'xpath=//*[contains(normalize-space(.), "Diagnosis")]/following::input[1]',
      'xpath=//*[contains(normalize-space(.), "Diagnosis")]/following::textarea[1]',
      'textarea[name*="diagnosis" i]',
      'input[name*="diagnosis" i]',
      'textarea[name*="diag" i]',
      'input[name*="diag" i]',
      'textarea[name*="chief" i]',
      'input[name*="chief" i]',
    ],
    formAmount: [
      'input[name*="claimAmt" i]',
      'input[name*="consultFee" i]',
      'input[name*="consult" i]',
      'input[name*="amount" i]',
      'input[name*="total" i]',
    ],
    minFilledFormFields: 2,
  });
}

/**
 * Dedicated submit service boundary for Fullerton portal flow.
 */
export class FullertonSubmitter {
  constructor(page, steps = null) {
    this.steps = steps;
    this.runtime = new GenericPortalSubmitter({
      page,
      steps,
      portalTarget: 'FULLERTON',
      portalName: 'Fullerton Health',
      defaultUrl: PORTALS.FULLERTON?.url || 'https://doctor.fhn3.com/app_index',
      defaultUsername: PORTALS.FULLERTON?.username || '',
      defaultPassword: PORTALS.FULLERTON?.password || '',
      supportsOtp: true,
      selectors: buildSelectors(),
      beforeForm: async ({ page: runPage, state, helpers }) => {
        await ensureFullertonVisitForm({ page: runPage, state, helpers });
      },
    });
  }

  async submit(visit, runtimeCredential = null) {
    if (this.steps?.step) {
      this.steps.step(2, 'Submitting to Fullerton portal service');
    }
    return this.runtime.submit(visit, runtimeCredential);
  }
}
