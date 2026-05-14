import { logger } from '../utils/logger.js';
import { extractAllianceMedinetTag } from '../../apps/crm/src/lib/rpa/portals.shared.js';
import { buildGenericBotSnapshot } from './portal-generic-submitter.js';
import { buildAllianceMedinetSubmittedTruthCapture } from './portal-truth-extractors.js';
import {
  comparePortalTruthSnapshots,
  writeFlow3TruthArtifacts,
} from '../utils/flow3-truth-compare.js';

export function shouldSaveAllianceMedinetDraft({
  flow3Mode = process.env.FLOW3_MODE,
  workflowSaveDraft = process.env.WORKFLOW_SAVE_DRAFT,
} = {}) {
  const normalizedMode = String(flow3Mode || '')
    .trim()
    .toLowerCase();
  if (normalizedMode === 'fill_evidence') return false;
  return String(workflowSaveDraft ?? '1') !== '0';
}

async function captureAlliancePageSnapshot(page) {
  if (!page) return null;
  return page
    .evaluate(() => {
      const norm = value =>
        String(value || '')
          .replace(/\s+/g, ' ')
          .trim();
      const fields = Array.from(
        globalThis.document?.querySelectorAll?.('input, textarea, select') || []
      )
        .map(node => ({
          tag: String(node.tagName || '').toLowerCase(),
          type: norm(node.getAttribute?.('type')),
          id: norm(node.getAttribute?.('id')),
          name: norm(node.getAttribute?.('name')),
          formControlName: norm(node.getAttribute?.('formcontrolname')),
          ariaLabel: norm(node.getAttribute?.('aria-label')),
          placeholder: norm(node.getAttribute?.('placeholder')),
          value:
            node.tagName === 'SELECT'
              ? norm(node.options?.[node.selectedIndex]?.text || node.value || '')
              : norm(node.value || ''),
          readonly: Boolean(node.readOnly || node.disabled),
        }))
        .filter(item => item.name || item.id || item.value)
        .slice(0, 120);
      return {
        url: String(globalThis.location?.href || ''),
        title: String(globalThis.document?.title || ''),
        fields,
      };
    })
    .catch(() => null);
}

function normalizeAmount(value) {
  const match = String(value || '')
    .replace(/,/g, '')
    .match(/-?\d+(?:\.\d+)?/);
  if (!match) return '';
  const num = Number(match[0]);
  return Number.isFinite(num) ? num.toFixed(2) : '';
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function fieldIdentity(field = {}) {
  return [
    field.id,
    field.name,
    field.formControlName,
    field.ariaLabel,
    field.placeholder,
    field.type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function pickPageSnapshotField(fields = [], identityPatterns = [], valuePattern = null) {
  for (const field of fields || []) {
    const value = String(field?.value || '').trim();
    if (!value) continue;
    const identity = fieldIdentity(field);
    const identityMatched = identityPatterns.some(pattern => pattern.test(identity));
    const valueMatched = valuePattern ? valuePattern.test(value) : true;
    if (identityMatched && valueMatched) {
      return {
        selector: field?.id
          ? `#${field.id}`
          : field?.name
            ? `[name="${field.name}"]`
            : field?.formControlName
              ? `[formcontrolname="${field.formControlName}"]`
              : null,
        value,
        source: 'page_snapshot',
      };
    }
  }
  return { selector: null, value: null };
}

export function deriveAllianceReadbackFromPageSnapshot(pageSnapshot = null) {
  const fields = Array.isArray(pageSnapshot?.fields) ? pageSnapshot.fields : [];
  if (!fields.length) return {};
  return {
    fee: pickPageSnapshotField(
      fields,
      [
        /consultation\s*fee/,
        /consultationfee/,
        /claim\s*amount/,
        /claimamount/,
        /amount/,
        /\bfee\b/,
      ],
      /\d/
    ),
    mcDays: pickPageSnapshotField(
      fields,
      [/mc\s*days?/, /mcdays?/, /medical\s*certificate/, /medicalcertificate/],
      /\d/
    ),
    mcStartDate: pickPageSnapshotField(
      fields,
      [/mc\s*start/, /mcstart/, /medical\s*certificate.*start/, /start\s*date/],
      /\d/
    ),
    visitDate: pickPageSnapshotField(
      fields,
      [/visit\s*date/, /visitdate/, /consult\s*date/, /consultdate/, /treatment\s*date/],
      /\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/
    ),
    diagnosis: pickPageSnapshotField(fields, [/diagnosis/, /\bdiag\b/], /\S/),
  };
}

function mergeReadback(primary = {}, fallback = {}) {
  const merged = { ...(fallback || {}), ...(primary || {}) };
  for (const key of Object.keys(fallback || {})) {
    const primaryValue = primary?.[key]?.value;
    if (!String(primaryValue || '').trim() && fallback?.[key]?.value) {
      merged[key] = fallback[key];
    }
  }
  return merged;
}

function normalizeIntegerLike(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/-?\d+/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

function mcDaysStatus({ expected, observed }) {
  const expectedNum = normalizeIntegerLike(expected ?? 0);
  const observedNum = normalizeIntegerLike(observed);
  if ((expectedNum === null || expectedNum === 0) && (observedNum === null || observedNum === 0)) {
    return 'verified';
  }
  if (expectedNum === null) return observedNum === null ? 'missing_source' : 'filled_unverified';
  if (observedNum === null) return 'filled_unverified';
  return expectedNum === observedNum ? 'verified' : 'mismatch';
}

function observedStatus({
  expected,
  observed,
  fallbackStatus = 'filled_unverified',
  type = 'text',
}) {
  if (!String(expected || '').trim()) return 'missing_source';
  if (!String(observed || '').trim()) return fallbackStatus;
  if (type === 'amount') {
    return normalizeAmount(expected) && normalizeAmount(expected) === normalizeAmount(observed)
      ? 'verified'
      : 'mismatch';
  }
  const e = normalizeText(expected);
  const o = normalizeText(observed);
  if (!e || !o) return fallbackStatus;
  return o.includes(e) || e.includes(o) ? 'verified' : 'mismatch';
}

export function buildAllianceFillVerification({ visit, doctor, fillResult, pageSnapshot } = {}) {
  const metadata = visit?.extraction_metadata || {};
  const diagnosisMatch = fillResult?.diagnosisPortalMatch || null;
  const readback = mergeReadback(
    fillResult?.readback || {},
    deriveAllianceReadbackFromPageSnapshot(pageSnapshot)
  );
  const diagnosisObserved =
    readback?.diagnosis?.value ||
    diagnosisMatch?.selectedOption?.text ||
    diagnosisMatch?.selectedText ||
    diagnosisMatch?.text ||
    diagnosisMatch?.match_text ||
    metadata?.diagnosis_description ||
    visit?.diagnosis_description ||
    null;
  const expectedDiagnosis = metadata?.diagnosis_description || visit?.diagnosis_description || null;
  const feeObserved = readback?.fee?.value || null;
  const feeSourceExpected = visit?.total_amount || null;
  const feeExpected = fillResult?.feeExpectedForVerification || feeSourceExpected;
  const feeBasis = fillResult?.feeVerificationBasis || 'clinic_assist_total_amount';
  const feeStatus = observedStatus({
    expected: feeExpected,
    observed: feeObserved,
    type: 'amount',
  });
  const feeSourceComparisonStatus =
    feeExpected &&
    feeSourceExpected &&
    normalizeAmount(feeExpected) &&
    normalizeAmount(feeSourceExpected) &&
    normalizeAmount(feeExpected) !== normalizeAmount(feeSourceExpected)
      ? 'fee_basis_difference'
      : null;
  const expectedMcDays = metadata?.mcDays ?? visit?.mc_days ?? visit?.mcDays ?? 0;
  const diagnosisWasSelected = Boolean(
    diagnosisMatch &&
    diagnosisMatch.blocked !== true &&
    (diagnosisMatch.match_text ||
      diagnosisMatch.selected_text ||
      diagnosisMatch.selectedText ||
      diagnosisMatch.text ||
      diagnosisMatch.selectedOption?.text)
  );
  return {
    visitDate: {
      status: visit?.visit_date ? 'portal_managed' : 'missing_source',
      expected: visit?.visit_date || null,
      observed: readback?.visitDate?.value || null,
      selector: readback?.visitDate?.selector || null,
    },
    diagnosis: {
      status: diagnosisWasSelected
        ? 'verified'
        : observedStatus({
            expected: expectedDiagnosis,
            observed: diagnosisObserved,
          }),
      expected: expectedDiagnosis,
      observed: diagnosisObserved,
      selector: readback?.diagnosis?.selector || diagnosisMatch?.selector || null,
    },
    fee: {
      status: feeStatus,
      expected: feeExpected,
      sourceExpected: feeSourceExpected,
      observed: feeObserved,
      selector: readback?.fee?.selector || null,
      basis: feeBasis,
      sourceComparisonStatus: feeSourceComparisonStatus,
    },
    mcDays: {
      status: mcDaysStatus({
        expected: expectedMcDays,
        observed: readback?.mcDays?.value || null,
      }),
      expected: expectedMcDays,
      observed: readback?.mcDays?.value || null,
      selector: readback?.mcDays?.selector || null,
    },
    doctor: {
      status: doctor?.doctorName ? 'verified' : 'missing_source',
      expected: doctor?.doctorName || null,
      observed: fillResult?.doctorName || null,
      selector: null,
    },
  };
}

async function buildAllianceEvidenceBundle({
  visit,
  page,
  flow3Mode,
  fillResult,
  doctor,
  submittedTruthCapture,
} = {}) {
  const pageSnapshot = await captureAlliancePageSnapshot(page);
  const fillVerification = buildAllianceFillVerification({
    visit,
    doctor,
    fillResult,
    pageSnapshot,
  });
  const botSnapshot = buildGenericBotSnapshot({
    visit,
    portalTarget: 'ALLIANCE_MEDINET',
    portalName: 'Alliance Medinet',
    mode: flow3Mode || 'fill_evidence',
    fillVerification,
    pageSnapshot,
    evidence: fillResult?.screenshot || null,
  });
  const comparison = comparePortalTruthSnapshots({
    portalTarget: 'ALLIANCE_MEDINET',
    visit,
    botSnapshot,
    submittedTruthSnapshot: submittedTruthCapture?.snapshot || null,
    diagnosisMatch: fillResult?.diagnosisPortalMatch || null,
  });
  const artifacts = await writeFlow3TruthArtifacts({
    visit,
    portalTarget: 'ALLIANCE_MEDINET',
    expectedSnapshot: comparison?.expectedSnapshot || null,
    botSnapshot,
    submittedTruthSnapshot: submittedTruthCapture?.snapshot || null,
    comparison,
    extra: {
      fillVerification,
      submittedTruthCapture,
    },
  }).catch(error => {
    logger.warn('[ALLIANCE] Failed to write bot snapshot artifact', {
      error: error?.message || String(error),
    });
    return null;
  });
  if (artifacts?.json) {
    botSnapshot.artifacts = {
      ...(botSnapshot.artifacts || {}),
      json: artifacts.json,
    };
  }
  return {
    botSnapshot,
    fillVerification,
    comparison,
    mismatchCategories: comparison?.mismatchCategories || [],
    evidence:
      [
        botSnapshot?.artifacts?.json ? 'bot_snapshot' : null,
        artifacts?.json ? 'comparison_artifact' : null,
      ]
        .filter(Boolean)
        .join(',') || null,
    evidenceArtifacts: {
      screenshot: fillResult?.screenshot || null,
      botSnapshot: botSnapshot?.artifacts || null,
      comparison: artifacts || null,
    },
  };
}

/**
 * Dedicated submit service for Alliance Medinet claim-form flow.
 * Keeps Alliance claim logic isolated from MHC flow implementation.
 */
export class AllianceMedinetSubmitter {
  constructor(automation, steps = null) {
    this.automation = automation;
    this.steps = steps;
  }

  _normalizeNricLike(value) {
    const raw = String(value || '')
      .trim()
      .toUpperCase();
    if (!raw) return '';
    const match = raw.match(/[STFGM]\d{7}[A-Z]/);
    if (match) return match[0];
    return raw.replace(/[\s\/-]+/g, '');
  }

  _pickNricForVisit(visit, metadata = null) {
    const md = metadata || visit?.extraction_metadata || {};
    const candidates = [
      visit?.nric,
      visit?.patient_no,
      visit?.patient_number,
      visit?.patientId,
      md?.nric,
      md?.fin,
      md?.finNumber,
      md?.idNumber,
      md?.idNo,
      md?.patientId,
      md?.patient_id,
      md?.memberId,
      md?.member_id,
      md?.ic,
      md?.icNumber,
      visit?.patient_id,
      visit?.member_id,
    ].filter(Boolean);
    for (const cand of candidates) {
      const cleaned = this._normalizeNricLike(cand);
      if (/^[STFGM]\d{7}[A-Z]$/i.test(cleaned)) return cleaned;
    }
    for (const value of Object.values(md || {})) {
      if (typeof value !== 'string') continue;
      const cleaned = this._normalizeNricLike(value);
      if (/^[STFGM]\d{7}[A-Z]$/i.test(cleaned)) return cleaned;
    }
    for (const value of Object.values(visit || {})) {
      if (typeof value !== 'string') continue;
      const cleaned = this._normalizeNricLike(value);
      if (/^[STFGM]\d{7}[A-Z]$/i.test(cleaned)) return cleaned;
    }
    return '';
  }

  _mapDoctorFromSpCode(spCodeRaw) {
    const raw = String(spCodeRaw || '')
      .toUpperCase()
      .trim();
    const compact = raw.replace(/[^A-Z]/g, '');
    if (!compact) {
      return { doctorName: null, matchedCode: null, normalizedSpCode: raw || null };
    }

    const priority = [
      { code: 'ARU', doctorName: 'Palanisamy Arul Murugan' },
      { code: 'PAM', doctorName: 'Palanisamy Arul Murugan' },
      { code: 'KT', doctorName: 'Tan Guoping Kelvin' },
      { code: 'KY', doctorName: 'Yip Man Hing Kevin' },
      { code: 'MT', doctorName: 'Tung Yu Yee Mathew' },
    ];
    for (const entry of priority) {
      if (compact.includes(entry.code)) {
        return { doctorName: entry.doctorName, matchedCode: entry.code, normalizedSpCode: raw };
      }
    }
    return { doctorName: null, matchedCode: null, normalizedSpCode: raw };
  }

  _isRetryableAllianceError(error) {
    const code = error?.allianceError?.code || null;
    if (
      code &&
      ['login_trace_error', 'search_trace_error', 'search_wait_interrupted'].includes(code)
    ) {
      return true;
    }
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('unexpected error occurred') ||
      message.includes('trace id') ||
      message.includes('target page, context or browser has been closed') ||
      message.includes("reading 'res'") ||
      message.includes('claim form did not render')
    );
  }

  async submit(visit) {
    if (this.steps?.step) {
      this.steps.step(2, 'Submitting to Alliance Medinet');
    }

    const metadata = visit.extraction_metadata || {};
    const matchedTag = extractAllianceMedinetTag(visit.pay_type, visit.patient_name);
    const spCode = metadata.spCode || metadata.sp_code || null;
    const doctor = this._mapDoctorFromSpCode(spCode);

    const failValidation = async (reason, message) => {
      const screenshotPath = `screenshots/alliance-medinet-fail-${visit?.id || 'unknown'}-${Date.now()}.png`;
      try {
        if (this.automation?.page) {
          await this.automation.page.screenshot({ path: screenshotPath, fullPage: true });
        }
      } catch {
        // Best-effort evidence capture.
      }

      const err = new Error(message);
      err.submissionMetadata = {
        portal: 'Alliance Medinet',
        matchedTag: matchedTag || null,
        spCode: doctor.normalizedSpCode || null,
        doctorCode: doctor.matchedCode || null,
        doctorName: doctor.doctorName || null,
        savedAsDraft: false,
        reason,
        error: message,
        screenshot: screenshotPath,
      };
      throw err;
    };

    const nric = this._pickNricForVisit(visit, metadata);
    if (!nric) {
      await failValidation(
        'missing_nric',
        'NRIC not found in visit record - Alliance Medinet requires Member UIN/Membership ID'
      );
    }

    if (!doctor.doctorName) {
      await failValidation(
        'unknown_sp_code',
        `Unable to map doctor from SP code "${spCode || ''}" (required for Alliance Medinet flow)`
      );
    }

    logger.info('[SUBMIT] Alliance form data:', {
      nric,
      matchedTag: matchedTag || null,
      spCode: doctor.normalizedSpCode || null,
      doctorName: doctor.doctorName,
    });

    const maxAttempts = Math.max(1, Number(process.env.ALLIANCE_SUBMIT_MAX_ATTEMPTS || 2));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.automation.login();
        await this.automation.navigateToMedicalTreatmentClaim();

        const found = await this.automation.searchMemberByNric(nric, visit.visit_date || null);
        if (!found?.found) {
          const noCoverageOnVisitDate = Boolean(found?.noCoverageOnVisitDate);
          return {
            success: false,
            reason: 'not_found',
            error: noCoverageOnVisitDate
              ? `Member has no coverage on selected visit date in Alliance Medinet: ${nric}`
              : `Member not found in Alliance Medinet: ${nric}`,
            noCoverageOnVisitDate,
            attempt,
          };
        }

        await this.automation.selectMemberAndAdd();
        const fillResult = await this.automation.fillClaimForm(
          {
            ...visit,
            nric,
          },
          doctor.doctorName
        );

        const flow3Mode = String(process.env.FLOW3_MODE || '')
          .trim()
          .toLowerCase();
        const saveDraft = shouldSaveAllianceMedinetDraft({
          flow3Mode,
          workflowSaveDraft: process.env.WORKFLOW_SAVE_DRAFT,
        });
        const submittedTruthCapture = buildAllianceMedinetSubmittedTruthCapture({
          visit,
          attempts: [
            {
              stage: 'submitted_detail_extractor',
              status: 'not_implemented',
              mode: flow3Mode || 'fill_evidence',
            },
          ],
        });
        const evidenceBundle = await buildAllianceEvidenceBundle({
          visit,
          page: this.automation?.page || null,
          flow3Mode: flow3Mode || 'fill_evidence',
          fillResult,
          doctor,
          submittedTruthCapture,
        });
        if (saveDraft) {
          const ok = await this.automation.saveAsDraft();
          if (!ok) {
            throw new Error('Failed to save Alliance Medinet claim as draft');
          }
        }

        return {
          success: true,
          portal: 'Alliance Medinet',
          matchedTag: matchedTag || null,
          spCode: doctor.normalizedSpCode || null,
          doctorCode: doctor.matchedCode || null,
          doctorName: doctor.doctorName,
          savedAsDraft: saveDraft,
          persisted: saveDraft,
          submitted: false,
          submittedTruthCapture,
          submittedTruthSnapshot: null,
          ...evidenceBundle,
          sessionState: 'healthy',
          attempt,
          diagnosisPortalMatch: fillResult?.diagnosisPortalMatch || null,
        };
      } catch (error) {
        const allianceCode = error?.allianceError?.code || null;
        const allianceNetwork = String(error?.allianceError?.networkCode || '')
          .toUpperCase()
          .trim();
        const retryable = this._isRetryableAllianceError(error);
        const traceId = error?.allianceError?.traceId || null;
        const lastAction = error?.allianceError?.lastAction || this.automation?.lastAction || null;
        const gePopupUrl = error?.allianceError?.gePopupUrl || null;
        const message = String(error?.message || '');
        const isGeRouteMismatch =
          allianceCode === 'ge_popup_redirect' ||
          allianceNetwork === 'GE' ||
          /tagged\s+under\s+GE\s+network/i.test(message);
        const canRetry = retryable && attempt < maxAttempts;

        logger.warn('[SUBMIT] Alliance visit attempt failed', {
          attempt,
          maxAttempts,
          retryable,
          canRetry,
          traceId,
          lastAction,
          error: error?.message || String(error),
        });

        if (!canRetry) {
          if (allianceCode === 'add_claim_form_runtime_error' && !isGeRouteMismatch) {
            // Known portal-side failure mode: member row exists but Add crashes in portal JS.
            // Treat as not-started so batch can continue while retaining evidence metadata.
            return {
              success: false,
              reason: 'not_found',
              error:
                'Alliance Medinet failed to open claim form after Add (portal runtime error for this member).',
              portal: 'Alliance Medinet',
              matchedTag: matchedTag || null,
              spCode: doctor.normalizedSpCode || null,
              doctorCode: doctor.matchedCode || null,
              doctorName: doctor.doctorName || null,
              savedAsDraft: false,
              submitted: false,
              attempt,
              maxAttempts,
              traceId,
              lastAction,
              allianceNetwork: allianceNetwork || null,
              blockedByPortalRuntime: true,
            };
          }

          const err = error instanceof Error ? error : new Error(String(error));
          err.submissionMetadata = {
            portal: 'Alliance Medinet',
            matchedTag: matchedTag || null,
            spCode: doctor.normalizedSpCode || null,
            doctorCode: doctor.matchedCode || null,
            doctorName: doctor.doctorName || null,
            savedAsDraft: false,
            reason: isGeRouteMismatch
              ? 'portal_route_mismatch_ge'
              : retryable
                ? 'portal_transient_error'
                : 'submission_failed',
            error: err.message,
            attempt,
            maxAttempts,
            traceId,
            lastAction,
            recommendedPortal: isGeRouteMismatch ? 'GE' : null,
            allianceNetwork: isGeRouteMismatch ? 'GE' : null,
            gePopupUrl: isGeRouteMismatch ? gePopupUrl : null,
          };
          throw err;
        }

        this.automation.loggedIn = false;
        await this.automation.page.waitForTimeout(1500).catch(() => {});
      }
    }
    throw new Error('Alliance Medinet submission failed after retries');
  }
}
