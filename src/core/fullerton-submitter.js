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

async function extractFullertonFeeEvidence(page) {
  return page
    .evaluate(() => {
      const norm = value =>
        String(value || '')
          .replace(/\s+/g, ' ')
          .trim();
      const parseAmount = value => {
        const m = norm(value)
          .replace(/,/g, '')
          .match(/\d+(?:\.\d{1,2})?/);
        return m ? Number(m[0]).toFixed(2) : '';
      };

      const inputs = Array.from(
        globalThis.document?.querySelectorAll?.(
          'input[name*="consult" i], input[name*="fee" i], input[name*="amount" i], select[name*="consult" i], select[name*="fee" i]'
        ) || []
      );
      for (const node of inputs) {
        const raw = 'value' in node ? node.value : node.textContent || '';
        const amount = parseAmount(raw);
        if (!amount) continue;
        const id = norm(node.getAttribute?.('id'));
        const name = norm(node.getAttribute?.('name'));
        return { ok: true, value: amount, source: `input:${name || id || 'consult'}` };
      }

      const rows = Array.from(globalThis.document?.querySelectorAll?.('tr') || []);
      for (const row of rows) {
        const text = norm(row.textContent || '');
        if (!/consultation\s*cost|consult\s*price|consultation/i.test(text)) continue;
        const amount = parseAmount(text);
        if (!amount) continue;
        return { ok: true, value: amount, source: 'row:consultation_cost' };
      }

      const body = norm(globalThis.document?.body?.innerText || '');
      const bodyMatch = body.match(
        /consultation\s*cost[^0-9]{0,30}(\d+(?:\.\d{1,2})?)|consult\s*price[^0-9]{0,30}(\d+(?:\.\d{1,2})?)/i
      );
      const bodyAmount = bodyMatch?.[1] || bodyMatch?.[2] || '';
      if (bodyAmount) {
        return { ok: true, value: Number(bodyAmount).toFixed(2), source: 'body:consultation_cost' };
      }

      return { ok: false, value: '', source: null };
    })
    .catch(() => ({ ok: false, value: '', source: null }));
}

async function extractFullertonVisitDateEvidence(page) {
  return page
    .evaluate(() => {
      const norm = value =>
        String(value || '')
          .replace(/\s+/g, ' ')
          .trim();
      const dateLike = value => {
        const text = norm(value);
        if (!text) return '';
        if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(text)) return text;
        if (/\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/.test(text)) return text;
        if (/\b\d{4}-\d{1,2}-\d{1,2}\b/.test(text)) return text;
        return '';
      };

      const hiddenDate = globalThis.document?.querySelector?.('input[name="visit.visitDateStr"]');
      const hiddenVal = dateLike(hiddenDate?.value || '');
      if (hiddenVal) return { ok: true, value: hiddenVal, source: 'input:visit.visitDateStr' };

      const visitDateCell = Array.from(globalThis.document?.querySelectorAll?.('tr, td, div') || [])
        .map(node => norm(node.textContent || ''))
        .find(text => /visit date/i.test(text) && dateLike(text));
      if (visitDateCell) return { ok: true, value: visitDateCell, source: 'row:visit_date' };

      const body = norm(globalThis.document?.body?.innerText || '');
      const m = body.match(
        /visit date[^0-9A-Za-z]{0,10}([0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4}|[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}|[0-9]{4}-[0-9]{1,2}-[0-9]{1,2})/i
      );
      if (m?.[1]) return { ok: true, value: norm(m[1]), source: 'body:visit_date' };

      return { ok: false, value: '', source: null };
    })
    .catch(() => ({ ok: false, value: '', source: null }));
}

async function ensureFullertonVisitForm({ page, state, helpers }) {
  const GLOBAL_TIMEOUT_MS = 60000;
  const globalDeadline = Date.now() + GLOBAL_TIMEOUT_MS;

  const isExpired = () => Date.now() >= globalDeadline;

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

  const isSessionExpired = () =>
    page
      .evaluate(() => {
        const body = String(globalThis.document?.body?.innerText || '');
        return /session.*expired|session.*timeout|please login again|login has expired/i.test(body);
      })
      .catch(() => false);

  const waitForEditPage = async timeoutMs => {
    const deadline = Math.min(Date.now() + timeoutMs, globalDeadline);
    while (Date.now() < deadline) {
      if (await isEditPage()) return true;
      if (isExpired()) return false;
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

  // Check for expired session before attempting registration loop.
  if (await isSessionExpired()) {
    state.form_navigation = {
      mode: 'session_expired',
      url: String(page.url() || ''),
    };
    return;
  }

  for (let i = 0; i < 5; i += 1) {
    if (isExpired()) break;

    await clickDuplicateOk();
    if (await waitForEditPage(6000)) {
      state.form_navigation = {
        mode: 'popup_resolved_to_edit',
        url: String(page.url() || ''),
      };
      return;
    }
    if (isExpired()) break;

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

    await page.waitForTimeout(1000);
    await clickDuplicateOk();
    await page.waitForTimeout(1000);

    if (isExpired()) break;

    if (await waitForEditPage(8000)) {
      state.form_navigation = {
        mode: 'register_to_edit',
        url: String(page.url() || ''),
      };
      return;
    }

    // Check for session expiry mid-loop to avoid further futile retries.
    if (await isSessionExpired()) {
      state.form_navigation = {
        mode: 'session_expired',
        url: String(page.url() || ''),
      };
      return;
    }
  }

  state.form_navigation = {
    mode: isExpired() ? 'global_timeout' : 'register_not_advanced',
    url: String(page.url() || ''),
    timeoutMs: GLOBAL_TIMEOUT_MS,
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
    requiredFields: ['visitDate', 'diagnosis', 'fee'],
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
      // Clear Fullerton + 2xSecure cookies before each login. Persisted
      // session cookies from prior runs cause the portal to skip issuing a
      // fresh OTP email, which makes the Gmail poll time out even though
      // credentials are valid. By wiping the cookies we force a clean
      // authentication + OTP challenge every run.
      clearCookiesOnLogin: ['fhn3.com', 'fullertonhealth.com', '2xsecure'],
      selectors: buildSelectors(),
      beforeForm: async ({ page: runPage, state, helpers }) => {
        await ensureFullertonVisitForm({ page: runPage, state, helpers });
      },
      adjustFillVerification: async ({ page: runPage, fillVerification }) => {
        const visitDateStatus = String(fillVerification?.visitDate?.status || '');
        if (visitDateStatus !== 'verified' && visitDateStatus !== 'readonly') {
          const visitDateEvidence = await extractFullertonVisitDateEvidence(runPage);
          if (visitDateEvidence?.ok && visitDateEvidence?.value) {
            fillVerification.visitDate = {
              ...(fillVerification?.visitDate || {}),
              status: 'readonly',
              observed: visitDateEvidence.value,
              selector: `eval:${visitDateEvidence.source || 'visit_date'}`,
              error: fillVerification?.visitDate?.error || null,
            };
          }
        }

        const feeStatus = String(fillVerification?.fee?.status || '');
        if (feeStatus === 'verified' || feeStatus === 'readonly') return null;
        const feeEvidence = await extractFullertonFeeEvidence(runPage);
        if (!feeEvidence?.ok || !feeEvidence?.value) return null;
        return {
          fee: {
            ...(fillVerification?.fee || {}),
            status: 'readonly',
            observed: feeEvidence.value,
            selector: `eval:${feeEvidence.source || 'consultation_cost'}`,
            error: fillVerification?.fee?.error || null,
          },
        };
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
