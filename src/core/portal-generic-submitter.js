import { logger } from '../utils/logger.js';
import { getOtpCode } from '../utils/portal-otp.js';
import { comparePortalLatestClaim } from '../utils/flow3-portal-compare.js';
import { writeFlow3TruthArtifacts } from '../utils/flow3-truth-compare.js';

function sleep(ms) {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms));
}

function toDdMmYyyy(dateStr) {
  const raw = String(dateStr || '').trim();
  if (!raw) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  return raw;
}

function normalizeNricLike(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (!raw) return '';
  const match = raw.match(/[STFGM]\d{7}[A-Z]/);
  if (match) return match[0];
  return raw.replace(/[^A-Z0-9]/g, '');
}

function normalizeIdentifier(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (!raw) return '';
  const nricMatch = raw.match(/[STFGM]\d{7}[A-Z]/);
  if (nricMatch) return nricMatch[0];
  return raw.replace(/[^A-Z0-9]/g, '');
}

function extractSearchIdentifiers(visit) {
  const metadata = visit?.extraction_metadata || {};
  const candidates = [
    visit?.nric,
    metadata?.nric,
    metadata?.fin,
    metadata?.idNumber,
    metadata?.idNo,
    visit?.member_id,
    visit?.memberId,
    metadata?.member_id,
    metadata?.memberId,
    metadata?.healthCardNo,
    metadata?.healthcardNo,
    visit?.patient_no,
    visit?.patient_number,
    visit?.patientId,
    metadata?.patient_no,
    metadata?.patient_number,
    metadata?.patientId,
  ]
    .map(normalizeIdentifier)
    .filter(Boolean);
  return [...new Set(candidates)];
}

function extractNric(visit) {
  const metadata = visit?.extraction_metadata || {};
  const candidates = [
    visit?.nric,
    visit?.patient_no,
    visit?.patient_number,
    metadata?.nric,
    metadata?.fin,
    metadata?.memberId,
    metadata?.member_id,
    metadata?.idNumber,
    metadata?.idNo,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const cleaned = normalizeNricLike(candidate);
    if (!cleaned) continue;
    return cleaned;
  }
  return '';
}

// Body-part → readable diagnosis text for non-MHC portals that accept free-text diagnosis.
const BODY_PART_TEXT_MAP = {
  knee: 'Knee pain',
  back: 'Low back pain',
  'low back': 'Low back pain',
  'lower back': 'Low back pain',
  'upper back': 'Upper back pain',
  shoulder: 'Shoulder pain',
  neck: 'Neck pain',
  ankle: 'Ankle pain',
  wrist: 'Wrist pain',
  hip: 'Hip pain',
  elbow: 'Elbow pain',
  foot: 'Foot pain',
  hand: 'Hand pain',
  chest: 'Chest pain',
  head: 'Headache',
  throat: 'Sore throat',
  abdomen: 'Abdominal pain',
  eye: 'Eye pain',
  ear: 'Ear pain',
};

function extractDiagnosisText(visit) {
  const metadata = visit?.extraction_metadata || {};
  const canonical = metadata?.diagnosisCanonical || {};

  // Tier 1: direct diagnosis fields
  const direct =
    visit?.diagnosis_description ||
    visit?.diagnosis_desc ||
    canonical?.description_canonical ||
    metadata?.diagnosis?.description ||
    '';
  const directText = String(direct || '').trim();
  if (directText && !/^missing\s+diagnosis$/i.test(directText)) return directText;

  // Tier 2: body-part + condition inference
  const bodyPart = String(canonical?.body_part || '')
    .trim()
    .toLowerCase();
  const condition = String(canonical?.condition || '')
    .trim()
    .toLowerCase();
  if (bodyPart && BODY_PART_TEXT_MAP[bodyPart]) {
    if (condition && condition !== 'pain') {
      return `${bodyPart.charAt(0).toUpperCase() + bodyPart.slice(1)} ${condition}`;
    }
    return BODY_PART_TEXT_MAP[bodyPart];
  }
  if (condition) {
    return condition.charAt(0).toUpperCase() + condition.slice(1);
  }

  // Tier 3: last resort
  return 'General medical condition';
}

function extractAmount(visit) {
  const metadata = visit?.extraction_metadata || {};
  const raw =
    visit?.total_amount ??
    visit?.totalAmount ??
    visit?.consultation_fee ??
    visit?.consultationFee ??
    visit?.charge_amount ??
    metadata?.consultationAmount;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return '';
  return amount.toFixed(2);
}

function extractLineItems(visit) {
  const metadata = visit?.extraction_metadata || {};
  if (Array.isArray(metadata?.medicines) && metadata.medicines.length > 0) {
    return metadata.medicines.map(item => ({
      name: String(item?.name || '').trim() || null,
      quantity: item?.quantity ?? null,
      unit: item?.unit ?? null,
      unitPrice: item?.unitPrice ?? item?.unit_price ?? null,
      amount: item?.amount ?? null,
      source: 'flow2_medicines',
    }));
  }

  const treatment = String(visit?.treatment_detail || '').trim();
  if (!treatment) return [];
  return treatment
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const qtyMatch = line.match(/\s+x\s*(\d+(?:\.\d+)?)\s*$/i);
      return {
        name: qtyMatch ? line.slice(0, qtyMatch.index).trim() : line,
        quantity: qtyMatch ? qtyMatch[1] : null,
        unit: null,
        unitPrice: null,
        amount: null,
        source: 'treatment_detail',
      };
    });
}

function verificationObserved(fillVerification, key) {
  const node = fillVerification?.[key] || {};
  return String(node.observed || node.expected || '').trim() || null;
}

export function buildGenericBotSnapshot({
  visit,
  portalTarget,
  portalName,
  mode,
  fillVerification,
  pageSnapshot = null,
  evidence = null,
} = {}) {
  const metadata = visit?.extraction_metadata || {};
  const canonical = metadata?.diagnosisCanonical || {};
  const diagnosisResolution = metadata?.diagnosisResolution || null;
  const amount = extractAmount(visit);
  const visitDate = toDdMmYyyy(visit?.visit_date);
  const diagnosisText =
    verificationObserved(fillVerification, 'diagnosis') || extractDiagnosisText(visit);
  const diagnosisCode =
    String(
      metadata?.diagnosisCode || canonical?.code_normalized || canonical?.code_raw || ''
    ).trim() || null;

  return {
    capturedAt: new Date().toISOString(),
    source: 'bot_filled_form',
    mode: mode || 'fill_evidence',
    portal: portalName || portalTarget || null,
    portalService: portalTarget || null,
    patientName: String(visit?.patient_name || '').trim() || null,
    patientNric: extractNric(visit) || null,
    visitDate: verificationObserved(fillVerification, 'visitDate') || visitDate || null,
    expectedVisitDate: visitDate || null,
    chargeType:
      metadata?.chargeType ||
      metadata?.detailsExtractionSources?.chargeType ||
      visit?.charge_type ||
      null,
    diagnosisText,
    diagnosisCode,
    diagnosisResolution: diagnosisResolution
      ? {
          status: diagnosisResolution.status || null,
          confidence: diagnosisResolution.confidence ?? null,
          reason: diagnosisResolution.reason_if_unresolved || null,
          sourceDate: canonical?.source_date || null,
          sourceAgeDays: canonical?.source_age_days ?? null,
        }
      : null,
    mcDays: metadata?.mcDays ?? visit?.mc_days ?? null,
    mcStartDate: metadata?.mcStartDate || visit?.mc_start_date || null,
    consultationFee: verificationObserved(fillVerification, 'fee') || amount || null,
    totalFee: amount || null,
    totalClaim: amount || null,
    lineItems: extractLineItems(visit),
    remarks: verificationObserved(fillVerification, 'remarks'),
    claimStatus: null,
    fillVerification: fillVerification || null,
    pageSnapshot,
    artifacts: {
      screenshot: evidence || null,
    },
  };
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toRegexList(items) {
  const list = Array.isArray(items) ? items : [];
  return list
    .map(item => {
      if (item instanceof RegExp) return item;
      const raw = String(item || '').trim();
      if (!raw) return null;
      return new RegExp(raw, 'i');
    })
    .filter(Boolean);
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeDateValue(value) {
  const raw = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const dd = String(Number(dmy[1])).padStart(2, '0');
    const mm = String(Number(dmy[2])).padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const mm = String(Number(ymd[2])).padStart(2, '0');
    const dd = String(Number(ymd[3])).padStart(2, '0');
    return `${ymd[1]}-${mm}-${dd}`;
  }
  return raw.toLowerCase();
}

function normalizeAmountValue(value) {
  const raw = String(value || '')
    .replace(/,/g, '')
    .trim();
  if (!raw) return '';
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return '';
  const num = Number(match[0]);
  if (!Number.isFinite(num)) return '';
  return num.toFixed(2);
}

function normalizeGenericValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function valuesMatchByField(field, expected, observed) {
  const key = String(field || '').toLowerCase();
  if (!expected && !observed) return true;
  if (key === 'visitdate' || key === 'date') {
    return normalizeDateValue(expected) === normalizeDateValue(observed);
  }
  if (key === 'fee' || key === 'amount' || key === 'consultation') {
    const e = normalizeAmountValue(expected);
    const o = normalizeAmountValue(observed);
    if (!e || !o) return false;
    return Number(e) === Number(o);
  }
  const e = normalizeGenericValue(expected);
  const o = normalizeGenericValue(observed);
  if (!e || !o) return false;
  return o.includes(e) || e.includes(o);
}

export class GenericPortalSubmitter {
  constructor(config) {
    this.config = config;
    this.page = config?.page;
    this.portalTarget = String(config?.portalTarget || '')
      .trim()
      .toUpperCase();
    this.portalName = config?.portalName || this.portalTarget;
    this.defaultUrl = config?.defaultUrl || '';
    this.supportsOtp = config?.supportsOtp === true;
    this.selectors = config?.selectors || {};
    this.steps = config?.steps || null;
    this.beforeLogin = typeof config?.beforeLogin === 'function' ? config.beforeLogin : null;
    this.beforeSearch = typeof config?.beforeSearch === 'function' ? config.beforeSearch : null;
    this.beforeForm = typeof config?.beforeForm === 'function' ? config.beforeForm : null;
    // Optional list of cookie-domain substrings to clear before navigating to the
    // login URL. Used by Fullerton (and potentially others) to ensure a fresh
    // OTP challenge each run — when the 2xsecure session cookie is persisted,
    // the portal skips issuing a new OTP email and our Gmail poll times out.
    this.clearCookiesOnLogin = Array.isArray(config?.clearCookiesOnLogin)
      ? config.clearCookiesOnLogin.filter(Boolean).map(v => String(v))
      : null;
    this.searchIdentifierExtractor =
      typeof config?.searchIdentifierExtractor === 'function'
        ? config.searchIdentifierExtractor
        : null;
    this.searchAttemptBuilder =
      typeof config?.searchAttemptBuilder === 'function' ? config.searchAttemptBuilder : null;
    this.disableDefaultSearchFallback = config?.disableDefaultSearchFallback === true;
    this.adjustFillVerification =
      typeof config?.adjustFillVerification === 'function' ? config.adjustFillVerification : null;
    this.requiredFieldResolver =
      typeof config?.requiredFieldResolver === 'function' ? config.requiredFieldResolver : null;
    this.verifyFilledValues = toBoolean(process.env.FLOW3_VERIFY_FILLED_VALUES, true);
    this.compareHistorical = toBoolean(process.env.FLOW3_COMPARE_HISTORICAL, true);
  }

  async _captureSearchDebug() {
    return this.page
      .evaluate(() => {
        const doc = globalThis.document;
        const loc = globalThis.location;
        if (!doc) return null;
        const norm = v => String(v || '').trim();
        const slice = (arr, n = 40) => arr.filter(Boolean).slice(0, n);
        const inputs = Array.from(doc.querySelectorAll('input, textarea, select')).map(el => ({
          tag: el.tagName.toLowerCase(),
          type: 'type' in el ? norm(el.type) : '',
          name: norm(el.getAttribute('name')),
          id: norm(el.id),
          placeholder: norm(el.getAttribute('placeholder')),
          ariaLabel: norm(el.getAttribute('aria-label')),
          value: 'value' in el ? norm(el.value) : '',
        }));
        const buttons = Array.from(
          doc.querySelectorAll('button, input[type=\"button\"], input[type=\"submit\"], a')
        )
          .map(el => ({
            tag: el.tagName.toLowerCase(),
            text: norm(el.textContent),
            type: norm(el.getAttribute('type')),
            name: norm(el.getAttribute('name')),
            id: norm(el.id),
            value: norm(el.getAttribute('value')),
            href: norm(el.getAttribute('href')),
          }))
          .filter(item => item.text || item.value || item.href);
        return {
          url: loc?.href || '',
          title: doc.title || '',
          bodySnippet: norm(doc.body?.innerText || '').slice(0, 1200),
          inputs: slice(inputs),
          buttons: slice(buttons),
        };
      })
      .catch(() => null);
  }

  async _safeScreenshot(visit, stage) {
    const visitId = String(visit?.id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
    const slug = String(this.portalTarget || this.portalName || 'portal').toLowerCase();
    const path = `screenshots/${slug}-visit-${visitId}-${stage}-${Date.now()}.png`;
    const saved = await this.page
      ?.screenshot({ path, fullPage: true })
      .then(() => true)
      .catch(() => false);
    return saved ? path : null;
  }

  async _captureFormFieldSnapshot() {
    return this.page
      .evaluate(() => {
        const norm = value =>
          String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
        const labelFor = node => {
          const id = node.getAttribute?.('id');
          if (id && globalThis.CSS?.escape) {
            const label = globalThis.document?.querySelector?.(
              `label[for="${globalThis.CSS.escape(id)}"]`
            );
            if (label?.textContent) return norm(label.textContent);
          }
          const wrapped = node.closest?.('label');
          if (wrapped?.textContent) return norm(wrapped.textContent);
          const row = node.closest?.('tr');
          if (row?.textContent) return norm(row.textContent).slice(0, 180);
          const parent = node.parentElement;
          if (parent?.textContent) return norm(parent.textContent).slice(0, 180);
          return '';
        };
        const fields = Array.from(
          globalThis.document?.querySelectorAll?.('input, textarea, select') || []
        )
          .map(node => ({
            tag: String(node.tagName || '').toLowerCase(),
            type: norm(node.getAttribute?.('type')),
            id: norm(node.getAttribute?.('id')),
            name: norm(node.getAttribute?.('name')),
            label: labelFor(node),
            value:
              node.tagName === 'SELECT'
                ? norm(node.options?.[node.selectedIndex]?.text || node.value || '')
                : norm(node.value || ''),
            readonly: Boolean(node.readOnly || node.disabled),
          }))
          .filter(item => item.name || item.id || item.label || item.value)
          .slice(0, 120);
        return {
          url: String(globalThis.location?.href || ''),
          title: String(globalThis.document?.title || ''),
          fields,
        };
      })
      .catch(() => null);
  }

  async _buildBotSnapshotArtifact({ visit, state, evidence }) {
    const botSnapshot = buildGenericBotSnapshot({
      visit,
      portalTarget: this.portalTarget,
      portalName: this.portalName,
      mode:
        String(process.env.FLOW3_MODE || '')
          .trim()
          .toLowerCase() || 'fill_evidence',
      fillVerification: state?.fillVerification || null,
      pageSnapshot: await this._captureFormFieldSnapshot(),
      evidence,
    });

    const artifacts = {
      screenshot: evidence || null,
      botSnapshot: null,
    };

    try {
      const written = await writeFlow3TruthArtifacts({
        visit,
        portalTarget: this.portalTarget,
        botSnapshot,
        comparison: state?.comparison || null,
        extra: {
          fillVerification: state?.fillVerification || null,
          requiredFieldGate: state?.requiredFieldGate || null,
          sessionState: state?.sessionState || null,
        },
      });
      if (written?.json) {
        botSnapshot.artifacts = {
          ...(botSnapshot.artifacts || {}),
          json: written.json,
        };
        artifacts.botSnapshot = botSnapshot.artifacts;
      }
    } catch (error) {
      logger.warn(`[${this.portalTarget}] Failed to write bot snapshot artifact`, {
        error: error?.message || String(error),
      });
    }

    state.botSnapshot = botSnapshot;
    state.evidenceArtifacts = artifacts;
    return { botSnapshot, evidenceArtifacts: artifacts };
  }

  async _waitForFirst(selectors, options = {}) {
    const timeout = Number(options.timeout || 2000);
    const visibleOnly = options.visibleOnly !== false;
    const list = Array.isArray(selectors) ? selectors : [];
    const maxCandidatesPerSelector = Number(options.maxCandidatesPerSelector || 8);
    const frameContexts = this.page.frames().filter(frame => frame !== this.page.mainFrame());
    const contexts = [this.page, ...frameContexts];
    const deadline = Date.now() + timeout;
    const attemptFloorMs = Number(options.attemptFloorMs || 250);
    const attemptCeilMs = Number(options.attemptCeilMs || 800);

    for (const context of contexts) {
      for (const selector of list) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        const attemptTimeout = Math.max(attemptFloorMs, Math.min(attemptCeilMs, remaining / 2));
        const locatorSet = context.locator(selector);
        const count = await locatorSet.count().catch(() => 0);
        if (!count) continue;
        const candidateCount = Math.min(count, maxCandidatesPerSelector);

        for (let i = 0; i < candidateCount; i += 1) {
          const candidate = locatorSet.nth(i);
          try {
            await candidate.waitFor({
              state: visibleOnly ? 'visible' : 'attached',
              timeout: attemptTimeout,
            });
            return { locator: candidate, selector };
          } catch {
            // try next candidate
          }
        }
      }
    }
    return null;
  }

  async _fillFirst(selectors, value, options = {}) {
    if (value === undefined || value === null || value === '') return null;
    const found = await this._waitForFirst(selectors, { timeout: options.timeout || 2500 });
    if (!found) return null;
    await found.locator.click({ timeout: 2000 }).catch(() => {});
    try {
      await found.locator.fill(String(value), { timeout: 3000 });
    } catch {
      // Some legacy portals use readonly date/time widgets.
      // Fall back to direct DOM value assignment + input/change events.
      await found.locator.evaluate((el, v) => {
        if (!el) return;
        const input = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (el);
        if (input.hasAttribute('readonly')) input.removeAttribute('readonly');
        if (input.hasAttribute('disabled')) input.removeAttribute('disabled');
        input.value = String(v ?? '');
        input.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
        input.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
      }, String(value));
    }
    return found.selector;
  }

  async _readLocatorObserved(locator) {
    return locator
      .evaluate(el => {
        if (!el) return { value: '', readonly: false, disabled: false };
        const tag = String(el.tagName || '').toLowerCase();
        const input = /** @type {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} */ (
          el
        );
        const value =
          'value' in input && typeof input.value === 'string' && input.value.trim()
            ? input.value
            : String(el.textContent || '');
        const readonly = Boolean(
          input.hasAttribute?.('readonly') ||
          input.getAttribute?.('aria-readonly') === 'true' ||
          input.getAttribute?.('readonly') === 'readonly'
        );
        const disabled = Boolean(
          input.hasAttribute?.('disabled') ||
          input.getAttribute?.('aria-disabled') === 'true' ||
          input.getAttribute?.('disabled') === 'disabled'
        );
        return {
          value: String(value || '')
            .replace(/\s+/g, ' ')
            .trim(),
          readonly,
          disabled,
          tag,
          type: String(input.getAttribute?.('type') || '').toLowerCase(),
        };
      })
      .catch(() => ({ value: '', readonly: false, disabled: false }));
  }

  async _fillAndVerify(field, selectors, expectedValue, options = {}) {
    const attemptedSelectors = Array.isArray(selectors) ? selectors.filter(Boolean) : [];
    const expected = String(expectedValue ?? '').trim();
    const result = {
      status: 'not_found',
      expected,
      observed: '',
      selector: null,
      error: null,
      attemptedSelectors,
    };

    if (!expected) {
      return { ...result, status: 'skipped' };
    }

    const found = await this._waitForFirst(attemptedSelectors, {
      timeout: Number(options.timeout || 2500),
      visibleOnly: options.visibleOnly !== false,
    });
    if (!found) return result;

    result.selector = found.selector;
    // Capture admin's pre-fill value BEFORE bot writes anything. This becomes
    // the per-field "baseline" for comparator: if admin had filled the field
    // already, we have ground truth; otherwise priorValue is empty and the
    // comparator reports unavailable for that field.
    const priorObserved = await this._readLocatorObserved(found.locator);
    result.priorValue = String(priorObserved?.value || '').trim();
    let writeFailed = false;
    try {
      await found.locator.click({ timeout: 2000 }).catch(() => null);
      await found.locator.fill(expected, { timeout: 3200 });
    } catch (error) {
      writeFailed = true;
      result.error = error?.message || String(error);
      await found.locator
        .evaluate((el, v) => {
          if (!el) return false;
          const input = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (el);
          if (input.hasAttribute('readonly') || input.hasAttribute('disabled')) {
            return false;
          }
          input.value = String(v ?? '');
          input.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
          input.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
          return true;
        }, expected)
        .catch(() => false);
    }

    await this.page.waitForTimeout(140);
    const observed = await this._readLocatorObserved(found.locator);
    result.observed = String(observed?.value || '').trim();
    const matched = valuesMatchByField(field, expected, result.observed);
    if (matched) {
      result.status = 'verified';
      return result;
    }
    if (observed?.readonly || observed?.disabled) {
      result.status = 'readonly';
      if (!result.error && writeFailed) {
        result.error = 'field_is_readonly_or_disabled';
      }
      return result;
    }
    result.status = 'mismatch';
    return result;
  }

  async _clickFirst(selectors, options = {}) {
    const found = await this._waitForFirst(selectors, {
      timeout: options.timeout || 2500,
      visibleOnly: options.visibleOnly !== false,
    });
    if (!found) return null;
    await found.locator
      .click({
        timeout: options.clickTimeout || 3000,
        force: options.force === true,
      })
      .catch(async () => {
        await found.locator.dispatchEvent('click').catch(() => {});
      });
    return found.selector;
  }

  async _isOtpVisible() {
    const otpInputs = Array.isArray(this.selectors.otpInputs) ? this.selectors.otpInputs : [];
    if (!otpInputs.length) return false;
    const found = await this._waitForFirst(otpInputs, { timeout: 3000 }).catch(() => null);
    if (found) return true;

    const bodyText = await this.page
      .evaluate(() => String(globalThis.document?.body?.innerText || ''))
      .catch(() => '');
    return /otp|one[-\s]?time password|verification code|security code|2-step verification|validate otp|resend otp/i.test(
      bodyText
    );
  }

  async _waitForOtpToClear(timeoutMs = 300000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const stillVisible = await this._isOtpVisible();
      if (!stillVisible) return true;
      await sleep(3000);
    }
    return false;
  }

  _buildResult(base, overrides = {}) {
    const requestedMode =
      String(process.env.FLOW3_MODE || '')
        .trim()
        .toLowerCase() || 'fill_evidence';
    const blockedReason =
      overrides.blocked_reason ||
      base.blocked_reason ||
      (overrides.success === false || base.success === false
        ? overrides.reason || base.reason || null
        : null);
    return {
      success: false,
      portal: this.portalName,
      portalService: this.portalTarget,
      mode: requestedMode,
      savedAsDraft: false,
      submitted: false,
      blocked_reason: blockedReason || null,
      ...base,
      ...overrides,
    };
  }

  async _login(url, username, password, state, visit) {
    const page = this.page;

    // Optional cookie reset before login. We clear all cookies in the browser
    // context, then filter in only the ones not matching the configured
    // domain substrings. This avoids wiping unrelated portal sessions while
    // still forcing the target portal to re-authenticate (and, for portals
    // that use cookie-based 2FA like Fullerton's 2xsecure, re-issue an OTP).
    if (this.clearCookiesOnLogin && this.clearCookiesOnLogin.length) {
      try {
        const context = page.context?.();
        if (context && typeof context.cookies === 'function') {
          const allCookies = await context.cookies().catch(() => []);
          const toDrop = [];
          const toKeep = [];
          for (const cookie of allCookies) {
            const domain = String(cookie?.domain || '').toLowerCase();
            const matches = this.clearCookiesOnLogin.some(hint =>
              domain.includes(String(hint).toLowerCase())
            );
            (matches ? toDrop : toKeep).push(cookie);
          }
          if (toDrop.length) {
            // Playwright does not expose a per-cookie removal API, so we
            // clear everything and re-add the non-matching cookies.
            await context.clearCookies().catch(() => {});
            if (toKeep.length) {
              await context.addCookies(toKeep).catch(error => {
                logger.warn(
                  `[${this.portalTarget}] Failed to re-add unrelated cookies after clear`,
                  { error: error?.message || String(error) }
                );
              });
            }
            state.clearedCookiesOnLogin = toDrop.length;
            logger.info(`[${this.portalTarget}] Cleared portal cookies to force fresh login/OTP`, {
              cleared: toDrop.length,
              kept: toKeep.length,
              domains: this.clearCookiesOnLogin,
            });
          }
        }
      } catch (error) {
        logger.warn(`[${this.portalTarget}] Cookie reset before login failed (continuing)`, {
          error: error?.message || String(error),
        });
      }
    }

    if (this.beforeLogin) {
      try {
        await this.beforeLogin({
          page,
          state,
          visit,
          helpers: {
            _fillFirst: (...a) => this._fillFirst(...a),
            _clickFirst: (...a) => this._clickFirst(...a),
          },
        });
      } catch (error) {
        logger.warn(`[${this.portalTarget}] beforeLogin hook failed`, {
          error: error?.message || String(error),
        });
      }
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);

    // Session-conflict guard: portals (Allianz, IXCHANGE, Fullerton, IHP) may show
    // a single-session page, expired-session redirect, or access-denied interstitial
    // that blocks the login form from rendering.
    const bodyBeforeLogin = await page
      .evaluate(() => String(globalThis.document?.body?.innerText || ''))
      .catch(() => '');
    const sessionConflictPatterns =
      /only one browser window.*can be open|click here to login again|session has expired|session timeout|your session.*expired|access denied|please login again|already logged in/i;
    if (sessionConflictPatterns.test(bodyBeforeLogin)) {
      state.session_conflict_detected = true;
      await this._clickFirst(
        [
          'a:has-text("here")',
          'a:has-text("login again")',
          'a:has-text("Login")',
          'button:has-text("Login")',
          'a:has-text("Go Back")',
          'button:has-text("Go Back")',
          'a:has-text("OK")',
          'button:has-text("OK")',
        ],
        { timeout: 2500 }
      );
      await page.waitForTimeout(1500);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
      await page.waitForTimeout(1000);
    }

    // Wait for page to stabilize (table-based portals like Allianz may load slowly)
    await page.waitForLoadState('networkidle').catch(() => {});

    const usernameSelector = await this._fillFirst(this.selectors.loginUsername, username, {
      timeout: 10000,
    });
    const passwordSelector = await this._fillFirst(this.selectors.loginPassword, password, {
      timeout: 7000,
    });
    // Diagnostic: if login inputs not found, log what inputs exist on the page
    if (!usernameSelector || !passwordSelector) {
      const pageInputs = await page
        .evaluate(() => {
          const inputs = Array.from(globalThis.document?.querySelectorAll?.('input') || []);
          return inputs.slice(0, 15).map(inp => ({
            type: inp.type,
            name: inp.name,
            id: inp.id,
            placeholder: inp.placeholder,
            visible: inp.offsetParent !== null,
            inFrame: inp.ownerDocument !== globalThis.document,
          }));
        })
        .catch(() => []);
      const frameCount = page.frames().length;
      logger.warn(`[${this.portalTarget}] Login inputs not found`, {
        usernameFound: !!usernameSelector,
        passwordFound: !!passwordSelector,
        pageInputs,
        frameCount,
        url: page.url(),
      });
    }

    if (!usernameSelector || !passwordSelector) {
      const pageAnalysis = await this.page
        .evaluate(() => {
          const t = String(globalThis.document?.body?.innerText || '');
          const hasLogout = /logout|sign\s*out|log\s*out/i.test(t);
          const hasDashboard =
            /policy search|user type|dashboard|my claims|member search|search patient/i.test(t);
          const hasLoginForm = /username|password|log\s*in|sign\s*in/i.test(t);
          return { hasLogout, hasDashboard, hasLoginForm };
        })
        .catch(() => ({ hasLogout: false, hasDashboard: false, hasLoginForm: false }));

      const looksAuthenticated =
        pageAnalysis.hasLogout ||
        pageAnalysis.hasDashboard ||
        (!pageAnalysis.hasLoginForm &&
          (await this.page
            .evaluate(() => /welcome/i.test(String(globalThis.document?.body?.innerText || '')))
            .catch(() => false)));

      if (looksAuthenticated) {
        state.login_state = 'already_authenticated';
        return true;
      }
      // Only use the "no submit button found → already authenticated" heuristic
      // when the page does NOT look like a login form. If the page has login form
      // text (Username, Password, Login), the submit button might just not match
      // our selectors — that's a selector problem, not proof of being authenticated.
      if (!pageAnalysis.hasLoginForm) {
        const alreadyAuthenticated = !(await this._waitForFirst(this.selectors.loginSubmit, {
          timeout: 2000,
        }));
        if (alreadyAuthenticated) {
          state.login_state = 'already_authenticated';
          return true;
        }
      }
      const hasSessionConflict = await this.page
        .evaluate(() =>
          /only one browser window.*can be open|click here to login again|session has expired|session timeout|your session.*expired|access denied|please login again|already logged in/i.test(
            String(globalThis.document?.body?.innerText || '')
          )
        )
        .catch(() => false);
      if (hasSessionConflict) {
        state.login_state = 'session_conflict';
      }
      if (!state.login_state || state.login_state === 'pending') {
        state.login_state = 'login_inputs_missing';
      }
      state.evidence = await this._safeScreenshot(visit, 'login-input-missing');
      return false;
    }

    const submitSelector = await this._clickFirst(this.selectors.loginSubmit, { timeout: 3500 });
    if (!submitSelector) {
      state.login_state = 'login_submit_missing';
      state.evidence = await this._safeScreenshot(visit, 'login-submit-missing');
      return false;
    }
    logger.info(`[${this.portalTarget}] Login submitted`, { submitSelector, url: page.url() });
    // Wait for post-login page transition (OTP pages may take 3-4s to load)
    await page.waitForTimeout(3500);
    // Wait for page to stabilize after potential reload/redirect
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    // Extra settle time for slow table-based portals
    await page.waitForTimeout(1500);

    const hasLoginUser = await this._waitForFirst(this.selectors.loginUsername, {
      timeout: 2500,
      visibleOnly: true,
    }).catch(() => null);
    const hasLoginPassword = await this._waitForFirst(this.selectors.loginPassword, {
      timeout: 1500,
      visibleOnly: true,
    }).catch(() => null);
    const otpVisible = await this._isOtpVisible();
    if (hasLoginUser && hasLoginPassword && !otpVisible) {
      const bodyText = await page
        .evaluate(() => String(globalThis.document?.body?.innerText || ''))
        .catch(() => '');
      const hasAuthError =
        /invalid|incorrect|failed|unsuccessful|wrong password|wrong username|authentication/i.test(
          bodyText
        );
      const hasCredentialDecryptError =
        /problem decrypting login credential|decrypting login credential|login credential/i.test(
          bodyText
        );
      state.login_state =
        hasAuthError || hasCredentialDecryptError
          ? 'login_invalid_credentials'
          : 'login_not_advanced';
      logger.warn(`[${this.portalTarget}] Login did not advance`, {
        loginState: state.login_state,
        hasAuthError,
        hasCredentialDecryptError,
        url: page.url(),
      });
      state.evidence = await this._safeScreenshot(visit, 'login-not-advanced');
      return false;
    }

    state.login_state = 'ok';
    state.loginSubmitSelector = submitSelector;
    logger.info(`[${this.portalTarget}] Login OK`, { url: page.url() });
    return true;
  }

  async _handleOtp(state, visit) {
    if (!this.supportsOtp) {
      state.otp_state = 'not_required';
      return true;
    }

    const otpVisible = await this._isOtpVisible();
    if (!otpVisible) {
      state.otp_state = 'not_required';
      return true;
    }

    state.otp_state = 'required';
    // Anchor the OTP lookup to ~5s before now so we only accept OTP emails
    // that arrived AFTER the current login-submit. This prevents back-to-back
    // visits (same portal, same mailbox) from reading the PREVIOUS visit's
    // already-consumed OTP — which the portal would reject, burning the run.
    // The 5s backdate absorbs clock skew between this host and Gmail.
    const otpTriggeredAt = Date.now() - 5000;
    state.otp_triggered_at = otpTriggeredAt;
    const isHeadless =
      toBoolean(process.env.HEADLESS, false) ||
      toBoolean(process.env.CI, false) ||
      toBoolean(process.env.CLOUD_RUN, false);
    const headlessOtpTimeoutMs = Number(
      process.env.FLOW3_HEADLESS_OTP_TIMEOUT_MS || process.env.OTP_HEADLESS_TIMEOUT_MS || 15000
    );
    const otpResult = await getOtpCode({
      portal: this.portalTarget,
      triggeredAfter: otpTriggeredAt,
      timeoutMs:
        isHeadless && Number.isFinite(headlessOtpTimeoutMs) && headlessOtpTimeoutMs > 0
          ? headlessOtpTimeoutMs
          : undefined,
    });
    state.otp = otpResult;

    if (otpResult?.ok && otpResult?.code) {
      const otpInputSel = await this._fillFirst(this.selectors.otpInputs, otpResult.code, {
        timeout: 3000,
      });
      if (!otpInputSel) {
        state.otp_state = 'parse_failed';
      } else {
        await this._clickFirst(this.selectors.otpSubmit, { timeout: 3000 });
        await this.page.waitForTimeout(2200);
        state.otp_state = 'auto_read';
        return true;
      }
    } else {
      state.otp_state = otpResult?.status || 'timeout';
    }

    // In headless / cloud mode there is no operator to enter the code manually.
    // Fail fast so the visit is tagged as OTP-blocked rather than burning 5 minutes.
    if (isHeadless) {
      logger.warn(
        `[${this.portalTarget}] OTP auto-read failed in headless mode; skipping manual wait`,
        {
          otpState: state.otp_state,
        }
      );
      state.evidence = await this._safeScreenshot(visit, 'otp-headless-skip');
      state.otp_state = 'skipped_headless';
      return false;
    }

    // Manual fallback: pause on OTP screen and wait for operator to enter code.
    const manualTimeoutMs = Number(process.env.OTP_MANUAL_TIMEOUT_MS || 300000);
    logger.warn(`[${this.portalTarget}] OTP auto-read failed; waiting for manual entry`, {
      otpState: state.otp_state,
      timeoutMs: manualTimeoutMs,
    });

    state.evidence = await this._safeScreenshot(visit, 'otp-manual-wait');
    const cleared = await this._waitForOtpToClear(manualTimeoutMs);
    if (!cleared) {
      state.otp_state = state.otp_state === 'parse_failed' ? 'parse_failed' : 'timeout';
      return false;
    }

    state.otp_state = 'manual_fallback';
    return true;
  }

  async _searchPatient(visit, state) {
    if (this.beforeSearch) {
      try {
        await this.beforeSearch({
          page: this.page,
          visit,
          state,
          selectors: this.selectors,
          helpers: {
            waitForFirst: (...args) => this._waitForFirst(...args),
            fillFirst: (...args) => this._fillFirst(...args),
            clickFirst: (...args) => this._clickFirst(...args),
          },
        });
      } catch (error) {
        logger.warn(`[${this.portalTarget}] beforeSearch hook failed`, {
          error: error?.message || String(error),
        });
      }
    }

    const preSearchClicks = Array.isArray(this.selectors.preSearchClicks)
      ? this.selectors.preSearchClicks
      : [];
    for (const selector of preSearchClicks) {
      await this._clickFirst([selector], { timeout: 1500, clickTimeout: 1800 }).catch(() => null);
      await this.page.waitForTimeout(400);
    }

    const preSearchUrls = Array.isArray(this.selectors.preSearchUrls)
      ? this.selectors.preSearchUrls
      : [];
    for (const targetUrl of preSearchUrls) {
      const next = String(targetUrl || '').trim();
      if (!next) continue;
      await this.page
        .goto(next, { waitUntil: 'domcontentloaded', timeout: 30000 })
        .then(async () => {
          await this.page.waitForTimeout(700);
        })
        .catch(() => null);
    }

    if (
      this.selectors.requireSearchProgramType === true &&
      state.search_program_type_verified !== true
    ) {
      state.search_state = 'program_type_unverified';
      state.search_debug = await this._captureSearchDebug();
      return { ok: false, reason: 'program_type_unverified', nric: null };
    }

    const nric = extractNric(visit);
    let attempts = [];
    if (this.searchAttemptBuilder) {
      try {
        const built = await this.searchAttemptBuilder({
          page: this.page,
          visit,
          state,
          selectors: this.selectors,
          helpers: {
            waitForFirst: (...args) => this._waitForFirst(...args),
            fillFirst: (...args) => this._fillFirst(...args),
            clickFirst: (...args) => this._clickFirst(...args),
          },
        });
        if (Array.isArray(built)) {
          attempts = built
            .map(item => {
              if (typeof item === 'string') {
                const value = normalizeIdentifier(item);
                return value
                  ? {
                      value,
                      inputSelectors: this.selectors.searchInput,
                      label: null,
                    }
                  : null;
              }
              const rawValue = String(item?.value ?? item?.identifier ?? '').trim();
              if (!rawValue) return null;
              const normalizeValue = item?.normalize !== false;
              const value = normalizeValue ? normalizeIdentifier(rawValue) : rawValue;
              if (!value) return null;
              const inputSelectors =
                Array.isArray(item?.inputSelectors) && item.inputSelectors.length > 0
                  ? item.inputSelectors
                  : this.selectors.searchInput;
              return {
                value,
                inputSelectors,
                label: String(item?.label || '').trim() || null,
                // Preserve extraInputs so multi-field attempts (e.g. Allianz
                // AMOS Surname + DOB) actually fill the secondary field.
                // Stripping this during normalization silently collapsed the
                // surname_and_dob attempt to surname-only.
                extraInputs: Array.isArray(item?.extraInputs) ? item.extraInputs : undefined,
              };
            })
            .filter(Boolean);
        }
      } catch (error) {
        logger.warn(`[${this.portalTarget}] searchAttemptBuilder hook failed`, {
          error: error?.message || String(error),
        });
      }
    }

    if (!attempts.length && !this.disableDefaultSearchFallback) {
      const identifiers = this.searchIdentifierExtractor
        ? [
            ...new Set(
              (this.searchIdentifierExtractor(visit) || []).map(normalizeIdentifier).filter(Boolean)
            ),
          ]
        : extractSearchIdentifiers(visit);
      attempts = identifiers.map(identifier => ({
        value: identifier,
        inputSelectors: this.selectors.searchInput,
        label: null,
      }));
    }

    if (!attempts.length) {
      state.search_state = 'missing_identifier';
      return { ok: false, reason: 'missing_identifier', nric: null };
    }

    state.search_attempts = attempts.map(attempt => ({
      value: attempt.value,
      label: attempt.label || null,
    }));

    const searchVisitDateSelectors = Array.isArray(this.selectors.searchVisitDate)
      ? this.selectors.searchVisitDate
      : [];
    const noResultPatterns = [
      /no record/i,
      /not found/i,
      /no member/i,
      /no result/i,
      /invalid member/i,
      /no patient records found/i,
      /please collect cash/i,
      ...toRegexList(this.selectors.searchNoResultPatterns),
    ];

    let lastNotFoundIdentifier = attempts[0]?.value || nric || null;
    for (let idx = 0; idx < attempts.length; idx += 1) {
      const attempt = attempts[idx] || {};
      const identifier = attempt.value;
      state.searchIdentifier = identifier || null;
      state.searchLabel = attempt.label || null;
      lastNotFoundIdentifier = identifier || lastNotFoundIdentifier;

      const filled = await this._fillFirst(
        attempt.inputSelectors || this.selectors.searchInput,
        identifier,
        {
          timeout: 3500,
        }
      );
      if (!filled) {
        // If this attempt's input selectors don't match, try the next attempt
        if (idx < attempts.length - 1) {
          logger.info(
            `[${this.portalTarget}] Search attempt ${idx + 1} input not found (${attempt.label || 'default'}), trying next attempt`
          );
          continue;
        }
        state.search_state = 'search_input_missing';
        state.search_debug = await this._captureSearchDebug();
        return { ok: false, reason: 'search_input_missing', nric: identifier || nric || null };
      }

      // Multi-field attempts: portals like Allianz AMOS need Surname + DOB.
      // searchAttemptBuilder may include `extraInputs: [{ value, inputSelectors, label }]`.
      // Each extra input is filled in order; if none match, the attempt continues
      // (the primary identifier is the main signal).
      const extraInputs = Array.isArray(attempt.extraInputs) ? attempt.extraInputs : [];
      const extraFillResults = [];
      for (const extra of extraInputs) {
        if (!extra || !extra.value) continue;
        const extraFilled = await this._fillFirst(extra.inputSelectors || [], extra.value, {
          timeout: 2500,
        });
        extraFillResults.push({ label: extra.label || 'extra', filled: Boolean(extraFilled) });
        if (!extraFilled) {
          logger.info(`[${this.portalTarget}] Extra input not filled (${extra.label || 'extra'})`, {
            attemptLabel: attempt.label || null,
          });
          continue;
        }
        // Some legacy portals (Allianz AMOS) wire their "enable SEARCH" logic to
        // the field's onblur/onchange/onkeyup. Playwright's .fill() dispatches
        // `input` + `change`, which is not enough for validators that run only on
        // blur. Opt-in via `blurAfterFill:true` to press Tab so the client-side
        // validator fires and un-disables the search button before we click it.
        if (extra.blurAfterFill) {
          await this.page.keyboard.press('Tab').catch(() => null);
          await this.page.waitForTimeout(250);
        }
      }
      if (extraFillResults.length) {
        state.searchExtraFills = extraFillResults;
      }

      if (searchVisitDateSelectors.length > 0) {
        const visitDate = toDdMmYyyy(visit?.visit_date);
        const candidates = [visitDate, visitDate ? `${visitDate} 10:00` : ''].filter(Boolean);
        let filledSearchDate = null;
        for (const candidate of candidates) {
          filledSearchDate = await this._fillFirst(searchVisitDateSelectors, candidate, {
            timeout: 1800,
          });
          if (filledSearchDate) break;
        }
        state.searchVisitDateSelector = filledSearchDate || null;
      }

      const searchSubmitSelector = await this._clickFirst(this.selectors.searchSubmit, {
        timeout: 2500,
      }).catch(() => null);
      if (!searchSubmitSelector) {
        await this.page.keyboard.press('Enter').catch(() => null);
      }
      const postSubmitWaitMs = Number(this.selectors.searchPostSubmitWaitMs || 2500);
      await this.page.waitForTimeout(postSubmitWaitMs);

      // Some portals (notably AMOS / Allianz) return from click() before the
      // navigation has even committed — so postSubmitWaitMs elapses on the
      // OLD page, then the results page finally loads. Poll until the page
      // finishes parsing AND the result-row selectors appear in the DOM.
      // Doing the row check inside page.evaluate avoids Playwright locators
      // short-circuiting when a navigation transition happens mid-wait.
      const navigateUrlPattern = this.selectors.searchResultUrlPattern
        ? new RegExp(this.selectors.searchResultUrlPattern, 'i')
        : null;
      const rowSelectors = Array.isArray(this.selectors.searchResultRow)
        ? this.selectors.searchResultRow
        : [];
      const navigateTimeoutMs = Number(this.selectors.searchNavigateTimeoutMs || 15000);
      let rowsAppeared = false;
      let urlChanged = false;
      let pollsCompleted = 0;
      let lastEvalError = null;
      // Direct-poll strategy: AMOS's results page never fires the 'load' or
      // 'domcontentloaded' events Playwright's waitForURL / waitForLoadState
      // rely on — they block the full timeout even though the page content
      // renders. Instead, poll page.url() (cheap, non-blocking) and use
      // locator.count() (also non-blocking, returns 0 for attached-but-invisible
      // or not-yet-present elements). Races nicely around navigation commits.
      const deadline = Date.now() + navigateTimeoutMs;
      const countRows = async () => {
        for (const sel of rowSelectors) {
          try {
            const n = await this.page.locator(sel).count();
            if (n > 0) return true;
          } catch {
            // Ignore selector errors (unsupported syntax, detached frame, etc.)
          }
        }
        return false;
      };
      while (Date.now() < deadline) {
        pollsCompleted += 1;
        const curUrl = this.page.url();
        const urlOk = !navigateUrlPattern || navigateUrlPattern.test(curUrl);
        if (urlOk) urlChanged = true;
        // Poll for rows on EVERY iteration — page.url() is unreliable during
        // AMOS navigation (returns the old URL while the new context is still
        // being attached). locator.count() re-binds across navigations and
        // correctly returns > 0 once rows render, regardless of URL state.
        const found = await countRows().catch(e => {
          lastEvalError = e?.message || String(e);
          return false;
        });
        if (found) {
          rowsAppeared = true;
          break;
        }
        await this.page.waitForTimeout(400).catch(() => null);
      }
      logger.info(`[${this.portalTarget}] Navigate-poll summary`, {
        rowsAppeared,
        urlChanged,
        pollsCompleted,
        lastEvalError,
        finalUrl: this.page.url(),
      });

      const bodyText = normalizeText(
        await this.page
          .evaluate(() => String(globalThis.document?.body?.innerText || ''))
          .catch(() => '')
      );

      logger.info(`[${this.portalTarget}] Post-search state`, {
        url: this.page.url(),
        searchSubmitSelector: searchSubmitSelector || 'Enter-key',
        bodySnippet: bodyText.substring(0, 200),
        attemptLabel: attempt.label || null,
      });

      // Akamai edge-block detection — portals fronted by Akamai (e.g. AMOS)
      // occasionally serve an error reference page that looks like a normal
      // navigation but contains no portal content. When we see #NNN.xxxxxxxx
      // ref numbers, bail out of the whole attempt chain so we fail fast
      // with a clear reason instead of burning time on every attempt.
      const akamaiBlocked =
        /an error occurred while processing your request.*reference #\d+\.[a-z0-9]+/i.test(
          bodyText
        ) || /errors\.edgesuite\.net/i.test(bodyText);
      if (akamaiBlocked) {
        logger.warn(`[${this.portalTarget}] Edge (Akamai) blocked the search request`, {
          bodySnippet: bodyText.substring(0, 200),
        });
        state.search_state = 'edge_blocked';
        state.search_debug = await this._captureSearchDebug();
        return { ok: false, reason: 'edge_blocked', nric: identifier || nric || null };
      }

      // Prefer the evaluate-based signal from the navigate-poll above, since
      // Playwright's waitFor can return early during navigation races. Fall
      // back to waitForFirst only if navigate-poll didn't conclude rows are
      // present (gives the DOM a final chance on a stable page).
      let resultMarkerVisible = Boolean(rowsAppeared);
      if (!resultMarkerVisible && this.selectors.searchResultRow?.length) {
        resultMarkerVisible = Boolean(
          await this._waitForFirst(this.selectors.searchResultRow, {
            timeout: Number(this.selectors.searchResultPresenceTimeoutMs || 1200),
            visibleOnly: false,
          }).catch(() => null)
        );
      }
      // DEBUG: dump DOM match counts when the presence check fails, so we can
      // distinguish "page hasn't rendered yet" from "selector didn't match".
      if (!resultMarkerVisible && this.selectors.searchResultRow?.length) {
        try {
          const diag = await this.page
            .evaluate(sels => {
              const doc = globalThis.document;
              const out = { url: globalThis.location.href, readyState: doc.readyState };
              out.selectorCounts = {};
              for (const s of sels || []) {
                try {
                  out.selectorCounts[s] = doc.querySelectorAll(s).length;
                } catch (e) {
                  out.selectorCounts[s] = `err:${e?.message || e}`;
                }
              }
              const rows = Array.from(doc.querySelectorAll('tr[id^="policies_tr_"]'));
              out.policyRowCount = rows.length;
              out.firstRowAttrs = rows[0]
                ? {
                    id: rows[0].id,
                    onclick: rows[0].getAttribute('onclick'),
                    textSample: (rows[0].textContent || '').replace(/\s+/g, ' ').slice(0, 120),
                  }
                : null;
              out.frameCount = globalThis.frames?.length ?? null;
              return out;
            }, this.selectors.searchResultRow)
            .catch(e => ({ error: e?.message || String(e) }));
          logger.info(`[${this.portalTarget}] Search result presence diag`, diag);
        } catch {
          // best-effort
        }
      }
      const hasNoResult = !resultMarkerVisible && noResultPatterns.some(re => re.test(bodyText));
      if (hasNoResult && idx < attempts.length - 1) {
        continue;
      }
      if (hasNoResult) {
        state.search_state = 'not_found';
        state.search_debug = await this._captureSearchDebug();
        return { ok: false, reason: 'not_found', nric: identifier || nric || null };
      }

      logger.info(`[${this.portalTarget}] Search result check`, {
        resultMarkerVisible,
        hasNoResult,
        attemptLabel: attempt.label || null,
      });

      const rowSelector = await this._clickFirst(this.selectors.searchResultRow, {
        timeout: Number(this.selectors.searchResultTimeoutMs || 5000),
        clickTimeout: Number(this.selectors.searchResultClickTimeoutMs || 2500),
        force: this.selectors.searchResultForceClick === true,
        // Some portals (AMOS) render results inside tables laid out with
        // absolute positioning / zero-height wrappers; Playwright's default
        // `visible` wait can time out even though the row is clickable. Opt
        // in to `attached`-only matching via selectors.searchResultVisibleOnly=false.
        visibleOnly: this.selectors.searchResultVisibleOnly !== false,
      });

      logger.info(`[${this.portalTarget}] Search result row click`, {
        rowSelector: rowSelector || null,
        urlAfterClick: this.page.url(),
      });

      if (!rowSelector && this.selectors.searchResultRow?.length) {
        const formIndicators = []
          .concat(
            Array.isArray(this.selectors.formPageIndicators)
              ? this.selectors.formPageIndicators
              : []
          )
          .concat(Array.isArray(this.selectors.formVisitDate) ? this.selectors.formVisitDate : [])
          .concat(Array.isArray(this.selectors.formDiagnosis) ? this.selectors.formDiagnosis : [])
          .concat(Array.isArray(this.selectors.formAmount) ? this.selectors.formAmount : []);
        const searchIndicators = Array.isArray(this.selectors.searchPageIndicators)
          ? this.selectors.searchPageIndicators
          : [];
        const formVisible = formIndicators.length
          ? Boolean(await this._waitForFirst(formIndicators, { timeout: 1500 }).catch(() => null))
          : false;
        const searchStillVisible = searchIndicators.length
          ? Boolean(await this._waitForFirst(searchIndicators, { timeout: 1200 }).catch(() => null))
          : false;

        if (formVisible && !searchStillVisible) {
          state.search_state = 'ok_without_row_click';
          return { ok: true, nric: identifier || nric || null };
        }

        if (idx < attempts.length - 1) {
          continue;
        }

        state.search_state = 'search_result_not_selected';
        state.search_debug = await this._captureSearchDebug();
        return {
          ok: false,
          reason: 'search_result_not_selected',
          nric: identifier || nric || null,
        };
      }

      state.search_state = 'ok';
      return { ok: true, nric: identifier || nric || null };
    }

    state.search_state = 'not_found';
    return { ok: false, reason: 'not_found', nric: lastNotFoundIdentifier || nric || null };
  }

  async _fillForm(visit, state) {
    const preFormClicks = Array.isArray(this.selectors.preFormClicks)
      ? this.selectors.preFormClicks
      : [];
    const preFormClicked = [];
    for (const selector of preFormClicks) {
      const clicked = await this._clickFirst([selector], {
        timeout: Number(this.selectors.preFormClickTimeoutMs || 2200),
        clickTimeout: Number(this.selectors.preFormClickTimeoutMs || 2200),
        force: this.selectors.preFormForceClick === true,
      }).catch(() => null);
      if (clicked) preFormClicked.push(clicked);
      await this.page.waitForTimeout(Number(this.selectors.preFormPostClickWaitMs || 1200));
    }
    state.preFormClicked = preFormClicked;

    if (this.beforeForm) {
      try {
        await this.beforeForm({
          page: this.page,
          visit,
          state,
          selectors: this.selectors,
          helpers: {
            waitForFirst: (...args) => this._waitForFirst(...args),
            fillFirst: (...args) => this._fillFirst(...args),
            clickFirst: (...args) => this._clickFirst(...args),
          },
        });
      } catch (error) {
        logger.warn(`[${this.portalTarget}] beforeForm hook failed`, {
          error: error?.message || String(error),
        });
      }
    }

    // If the beforeForm hook signaled that the portal has no structured claim
    // form (e.g. Allianz AMOS TPA is read-only), skip the form-fill step
    // entirely and return success with a diagnostic marker. The caller will
    // classify this via state.form_state + state.portal_submission_mode.
    if (state.form_state === 'portal_read_only') {
      logger.info(`[${this.portalTarget}] portal is read-only — skipping form-fill`, {
        portal_submission_mode: state.portal_submission_mode,
        detailReason: state.detailReason,
      });
      state.fillVerification = null;
      state.formSelectors = { visitDate: null, diagnosis: null, amount: null, remarks: null };
      state.requiredFieldGate = {
        required: [],
        passed: true,
        failed: [],
        note: 'skipped_portal_read_only',
      };
      return { ok: true, filledCount: 0, portalReadOnly: true };
    }

    const diagnosis = extractDiagnosisText(visit);
    const amount = extractAmount(visit);
    const visitDate = toDdMmYyyy(visit?.visit_date);
    const remarksText = `Flow3 probe ${new Date().toISOString()}`;

    let fillVerification = {
      visitDate: this.verifyFilledValues
        ? await this._fillAndVerify('visitDate', this.selectors.formVisitDate, visitDate, {
            timeout: 2200,
          })
        : {
            status: (await this._fillFirst(this.selectors.formVisitDate, visitDate, {
              timeout: 2200,
            }))
              ? 'verified'
              : 'not_found',
            expected: visitDate,
            observed: '',
            selector: null,
            error: null,
            attemptedSelectors: this.selectors.formVisitDate || [],
          },
      diagnosis: this.verifyFilledValues
        ? await this._fillAndVerify('diagnosis', this.selectors.formDiagnosis, diagnosis, {
            timeout: 2600,
          })
        : {
            status: (await this._fillFirst(this.selectors.formDiagnosis, diagnosis, {
              timeout: 2500,
            }))
              ? 'verified'
              : 'not_found',
            expected: diagnosis,
            observed: '',
            selector: null,
            error: null,
            attemptedSelectors: this.selectors.formDiagnosis || [],
          },
      fee: this.verifyFilledValues
        ? await this._fillAndVerify('fee', this.selectors.formAmount, amount, {
            timeout: 2300,
          })
        : {
            status: (await this._fillFirst(this.selectors.formAmount, amount, {
              timeout: 2200,
            }))
              ? 'verified'
              : 'not_found',
            expected: amount,
            observed: '',
            selector: null,
            error: null,
            attemptedSelectors: this.selectors.formAmount || [],
          },
      remarks: this.selectors.formRemarks?.length
        ? await this._fillAndVerify('remarks', this.selectors.formRemarks, remarksText, {
            timeout: 1400,
          })
        : {
            status: 'skipped',
            expected: '',
            observed: '',
            selector: null,
            error: null,
            attemptedSelectors: [],
          },
    };

    if (this.adjustFillVerification) {
      try {
        const patch = await this.adjustFillVerification({
          page: this.page,
          visit,
          state,
          fillVerification,
        });
        if (patch && typeof patch === 'object') {
          fillVerification = {
            ...fillVerification,
            ...patch,
          };
        }
      } catch (error) {
        logger.warn(`[${this.portalTarget}] adjustFillVerification failed`, {
          error: error?.message || String(error),
        });
      }
    }

    state.fillVerification = fillVerification;
    state.formSelectors = {
      visitDate: fillVerification?.visitDate?.selector || null,
      diagnosis: fillVerification?.diagnosis?.selector || null,
      amount: fillVerification?.fee?.selector || null,
      remarks: fillVerification?.remarks?.selector || null,
    };

    let requiredFields = [];
    if (this.requiredFieldResolver) {
      try {
        const resolved = await this.requiredFieldResolver({ visit, state, fillVerification });
        if (Array.isArray(resolved)) requiredFields = resolved;
      } catch (error) {
        logger.warn(`[${this.portalTarget}] requiredFieldResolver failed`, {
          error: error?.message || String(error),
        });
      }
    } else if (Array.isArray(this.selectors.requiredFields)) {
      requiredFields = [...this.selectors.requiredFields];
    }

    const passingStatuses = new Set(['verified', 'readonly']);
    const failedRequired = requiredFields.filter(
      field => !passingStatuses.has(fillVerification?.[field]?.status || '')
    );

    if (requiredFields.length > 0) {
      state.requiredFieldGate = {
        required: requiredFields,
        passed: failedRequired.length === 0,
        failed: failedRequired,
      };
      if (failedRequired.length > 0) {
        state.form_state = 'form_fields_missing';
        if (failedRequired.length === 1 && failedRequired[0] === 'fee') {
          state.form_detail_reason = 'fee_evidence_missing';
        }
        return { ok: false, filledCount: 0 };
      }
      state.form_state = 'filled';
      return { ok: true, filledCount: requiredFields.length };
    }

    const minFilledFields = Number(this.selectors.minFilledFormFields || 1);
    const verifiedCount = ['visitDate', 'diagnosis', 'fee', 'remarks'].filter(key =>
      passingStatuses.has(fillVerification?.[key]?.status || '')
    ).length;

    state.requiredFieldGate = {
      required: [`minFilledFormFields>=${minFilledFields}`],
      passed: verifiedCount >= minFilledFields,
      failed: verifiedCount >= minFilledFields ? [] : ['minFilledFormFields'],
    };

    if (verifiedCount < minFilledFields) {
      state.form_state = 'form_fields_missing';
      return { ok: false, filledCount: verifiedCount };
    }

    state.form_state = 'filled';
    return { ok: true, filledCount: verifiedCount };
  }

  async submit(visit, runtimeCredential = null) {
    const state = {
      login_state: 'pending',
      otp_state: this.supportsOtp ? 'pending' : 'not_required',
      search_state: 'pending',
      form_state: 'pending',
      otp: null,
      evidence: null,
      fillVerification: null,
      requiredFieldGate: null,
      comparison: null,
      sessionState: 'healthy',
    };

    const url = String(runtimeCredential?.url || this.defaultUrl || '').trim();
    const username = String(
      runtimeCredential?.username || this.config?.defaultUsername || ''
    ).trim();
    const password = String(
      runtimeCredential?.password || this.config?.defaultPassword || ''
    ).trim();

    if (!url || !username || !password) {
      return this._buildResult(state, {
        reason: 'credentials_missing',
        blocked_reason: 'portal_credentials_missing',
        detailReason: 'portal_credentials_missing',
        error: `${this.portalTarget} portal credentials are missing`,
        sessionState: 'blocked',
        portalUrl: url || null,
        hasRuntimeCredential: Boolean(runtimeCredential?.username || runtimeCredential?.password),
      });
    }

    try {
      this.steps?.step?.(2, `[${this.portalTarget}] Login + fill (probe mode)`);

      const loggedIn = await this._login(url, username, password, state, visit);
      if (!loggedIn) {
        const loginBlockedReason =
          state.login_state === 'login_invalid_credentials'
            ? 'portal_auth_failed'
            : state.login_state === 'session_conflict'
              ? 'portal_session_conflict'
              : 'portal_login_failed';
        return this._buildResult(state, {
          reason: 'login_failed',
          blocked_reason: loginBlockedReason,
          detailReason: state.login_state || 'login_failed',
          error: `${this.portalTarget} login failed`,
          sessionState: state.login_state === 'session_conflict' ? 'session_conflict' : 'blocked',
          portalUrl: url,
        });
      }

      const otpOk = await this._handleOtp(state, visit);
      if (!otpOk) {
        return this._buildResult(state, {
          reason: 'otp_required',
          blocked_reason: 'portal_otp_required',
          detailReason: state.otp_state || 'otp_failed',
          error: `${this.portalTarget} OTP was not completed`,
          sessionState: 'otp_blocked',
          portalUrl: url,
        });
      }

      // Some portals render OTP prompt with a delay after login response.
      if (
        this.supportsOtp &&
        (state.otp_state === 'not_required' || state.otp_state === 'pending')
      ) {
        const otpVisibleLate = await this._isOtpVisible();
        if (otpVisibleLate) {
          const otpLateOk = await this._handleOtp(state, visit);
          if (!otpLateOk) {
            return this._buildResult(state, {
              reason: 'otp_required',
              blocked_reason: 'portal_otp_required',
              detailReason: state.otp_state || 'otp_failed',
              error: `${this.portalTarget} OTP was not completed`,
              sessionState: 'otp_blocked',
              portalUrl: url,
            });
          }
        }
      }

      const search = await this._searchPatient(visit, state);
      if (!search.ok && search.reason === 'not_found') {
        state.evidence = await this._safeScreenshot(visit, 'search-not-found');
        return this._buildResult(state, {
          reason: 'not_found',
          blocked_reason: 'member_not_found',
          detailReason: 'member_not_found',
          error: `Member not found in ${this.portalName}: ${search.nric || 'unknown'}`,
          portalUrl: url,
        });
      }
      if (!search.ok) {
        state.evidence = await this._safeScreenshot(visit, 'search-failed');
        return this._buildResult(state, {
          reason: 'search_failed',
          blocked_reason: 'portal_search_failed',
          detailReason: search.reason || 'search_failed',
          error: `Patient search failed in ${this.portalName}`,
          sessionState: 'blocked',
          portalUrl: url,
        });
      }

      const formFill = await this._fillForm(visit, state);
      if (!formFill?.ok) {
        state.form_debug = await this._captureSearchDebug();
        state.evidence = await this._safeScreenshot(visit, 'form-fields-missing');
        const snapshotArtifacts = await this._buildBotSnapshotArtifact({
          visit,
          state,
          evidence: state.evidence,
        });
        return this._buildResult(state, {
          reason: 'form_failed',
          blocked_reason: state.form_blocked_reason || 'portal_contract_unvalidated',
          detailReason: state.form_detail_reason || state.form_state || 'form_failed',
          error: `Claim form fields were not found in ${this.portalName}`,
          sessionState: 'blocked',
          portalUrl: url,
          ...snapshotArtifacts,
        });
      }

      // Portal-read-only path (e.g. Allianz AMOS TPA): we verified member
      // coverage + extracted policy evidence, but no claim form exists.
      // This is not a successful fill; downstream must treat it as blocked.
      if (formFill?.portalReadOnly) {
        const evidence =
          state.allianz_policy_evidence_screenshot ||
          (await this._safeScreenshot(visit, 'policy-verified'));
        return this._buildResult(state, {
          success: false,
          reason: 'policy_verified_no_claim_form',
          blocked_reason: 'portal_read_only_no_claim_form',
          detailReason: state.detailReason || 'portal_read_only',
          error: null,
          sessionState: 'blocked',
          portalUrl: url,
          nric: search.nric || null,
          evidence,
        });
      }

      if (this.compareHistorical) {
        state.comparison = await comparePortalLatestClaim({
          portalTarget: this.portalTarget,
          page: this.page,
          visit,
          state,
        }).catch(error => ({
          baselineSource: null,
          state: 'unavailable',
          matchedFields: [],
          mismatchedFields: [],
          unavailableReason: error?.message || String(error),
        }));
      } else {
        state.comparison = {
          baselineSource: null,
          state: 'unavailable',
          matchedFields: [],
          mismatchedFields: [],
          unavailableReason: 'comparison_disabled',
        };
      }

      const evidence = await this._safeScreenshot(visit, 'form-filled');
      const snapshotArtifacts = await this._buildBotSnapshotArtifact({
        visit,
        state,
        evidence,
      });

      return this._buildResult(state, {
        success: true,
        reason: 'filled_evidence',
        detailReason: 'fill_only_probe',
        error: null,
        portalUrl: url,
        hasRuntimeCredential: Boolean(runtimeCredential?.username || runtimeCredential?.password),
        nric: search.nric || null,
        evidence,
        ...snapshotArtifacts,
      });
    } catch (error) {
      state.evidence = await this._safeScreenshot(visit, 'fatal-error');
      logger.error(`[${this.portalTarget}] Submitter error`, {
        visitId: visit?.id || null,
        error: error?.message || String(error),
      });
      return this._buildResult(state, {
        reason: 'portal_runtime_error',
        blocked_reason: 'portal_runtime_error',
        detailReason: 'portal_runtime_error',
        error: error?.message || String(error),
        sessionState: 'error',
        portalUrl: url,
      });
    }
  }
}

export function createDefaultSelectors() {
  return {
    loginUsername: [
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[name*="login" i]',
      'input[id*="login" i]',
      'input[name*="email" i]',
      'input[type="email"]',
      'input[placeholder*="User" i]',
      'input[placeholder*="Email" i]',
      'input[type="text"]',
    ],
    loginPassword: ['input[type="password"]', 'input[name*="pass" i]', 'input[id*="pass" i]'],
    loginSubmit: [
      'button:has-text("Login")',
      'button:has-text("Sign In")',
      'button:has-text("Submit")',
      'input[type="submit"]',
      'button[type="submit"]',
    ],
    otpInputs: [
      'input[autocomplete="one-time-code"]',
      'input[name*="otp" i]',
      'input[id*="otp" i]',
      'input[name*="verification" i]',
      'input[id*="verification" i]',
      'input[placeholder*="OTP" i]',
      'input[placeholder*="code" i]',
    ],
    otpSubmit: [
      'button:has-text("Verify")',
      'button:has-text("Submit")',
      'button:has-text("Continue")',
      'input[type="submit"]',
      'button[type="submit"]',
    ],
    searchInput: [
      'input[name*="nric" i]',
      'input[id*="nric" i]',
      'input[placeholder*="NRIC" i]',
      'input[name*="member" i]',
      'input[id*="member" i]',
      'input[placeholder*="Membership" i]',
      'input[name*="fin" i]',
      'input[id*="fin" i]',
      'input[name*="id" i]',
      'input[id*="id" i]',
      'input[type="search"]',
      'input[type="text"]',
    ],
    searchSubmit: [
      'button:has-text("Search")',
      'input[type="submit"]',
      'button:has-text("Find")',
      'button:has-text("Enquire")',
      'button:has-text("Query")',
    ],
    preSearchUrls: [],
    searchPageIndicators: [],
    formPageIndicators: [],
    searchNoResultPatterns: [],
    searchResultTimeoutMs: 5000,
    searchResultClickTimeoutMs: 2500,
    searchResultForceClick: false,
    searchPostSubmitWaitMs: 2500,
    preFormClicks: [],
    preFormClickTimeoutMs: 2200,
    preFormForceClick: false,
    preFormPostClickWaitMs: 1200,
    minFilledFormFields: 1,
    searchVisitDate: [],
    searchResultRow: [
      'table tbody tr:has(button:has-text("Select")) button:has-text("Select")',
      'table tbody tr:has(a:has-text("Select")) a:has-text("Select")',
      'table tbody tr:first-child td a',
      'table tbody tr:first-child td button',
      'table tbody tr:first-child',
    ],
    formVisitDate: [
      'input[name*="visit" i][type="date"]',
      'input[id*="visit" i][type="date"]',
      'input[name*="visit" i]',
      'input[id*="visit" i]',
      'input[placeholder*="Visit Date" i]',
      'input[name*="date" i]',
    ],
    formDiagnosis: [
      'textarea[name*="diagnosis" i]',
      'textarea[id*="diagnosis" i]',
      'input[name*="diagnosis" i]',
      'input[id*="diagnosis" i]',
      'textarea[name*="illness" i]',
      'input[name*="icd" i]',
    ],
    formAmount: [
      'input[name*="amount" i]',
      'input[id*="amount" i]',
      'input[name*="consult" i]',
      'input[id*="consult" i]',
      'input[name*="fee" i]',
      'input[id*="fee" i]',
    ],
    formRemarks: ['textarea[name*="remark" i]', 'textarea[id*="remark" i]'],
  };
}
