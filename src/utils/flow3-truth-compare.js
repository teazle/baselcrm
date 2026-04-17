import fs from 'fs/promises';
import path from 'path';

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeDate(value) {
  const raw = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${String(Number(dmy[2])).padStart(2, '0')}-${String(Number(dmy[1])).padStart(2, '0')}`;
  }
  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${String(Number(ymd[2])).padStart(2, '0')}-${String(Number(ymd[3])).padStart(2, '0')}`;
  }
  return normalizeText(raw);
}

function normalizeAmount(value) {
  const raw = String(value || '')
    .replace(/,/g, '')
    .trim();
  if (!raw) return '';
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return '';
  const num = Number(match[0]);
  return Number.isFinite(num) ? num.toFixed(2) : '';
}

function normalizeInteger(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const match = raw.match(/-?\d+/);
  if (!match) return '';
  const num = Number.parseInt(match[0], 10);
  return Number.isFinite(num) ? String(num) : '';
}

function normalizeChargeType(value) {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (raw.includes('first')) return 'first';
  if (raw.includes('follow')) return 'follow';
  if (raw.includes('repeat')) return 'repeat';
  return raw;
}

function normalizeNric(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (!raw) return '';
  const match = raw.match(/[STFGM]\d{7}[A-Z]/);
  if (match) return match[0];
  return raw.replace(/[\s/-]+/g, '');
}

function normalizeIcdCode(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (!raw) return '';
  const match = raw.match(/([A-Z]\d{2})\.?(\d{0,5})/);
  if (!match) return raw;
  const base = match[1];
  const sub = (match[2] || '').replace(/0+$/, '');
  return sub ? `${base}.${sub}` : base;
}

function stripPortalTag(value) {
  return String(value || '')
    .trim()
    .replace(
      /^(MHC|MHCAXA|AVIVA|SINGLIFE|AIA|AIACLIENT|FULLERT|ALLIANZ|ALLIANCE|ALL|IHP|GE|NTUC_IM|PARKWAY)\s*[-:|]+\s*/i,
      ''
    )
    .trim();
}

function toDdMmYyyy(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy)
    return `${String(Number(dmy[1])).padStart(2, '0')}/${String(Number(dmy[2])).padStart(2, '0')}/${dmy[3]}`;
  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd)
    return `${String(Number(ymd[3])).padStart(2, '0')}/${String(Number(ymd[2])).padStart(2, '0')}/${ymd[1]}`;
  return raw;
}

function cleanDiagnosisText(value) {
  return String(value || '')
    .replace(/^[A-Z]\d{2,3}(?:\.\d+)?\s*-\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toDiagnosisTokens(value) {
  const stop = new Set(['the', 'and', 'for', 'with', 'without', 'part', 'parts', 'region']);
  return normalizeText(cleanDiagnosisText(value))
    .split(/\s+/)
    .filter(token => token.length >= 3 && !stop.has(token));
}

function hasStrongTokenOverlap(left, right) {
  const leftTokens = toDiagnosisTokens(left);
  const rightTokens = toDiagnosisTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  const denom = Math.max(leftSet.size, rightSet.size);
  return denom > 0 ? intersection / denom >= 0.7 : false;
}

function hasEquivalentBodyConditionClass(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return false;
  const kneeA = /\bknee\b/.test(a);
  const kneeB = /\bknee\b/.test(b);
  const sprainA = /\b(sprain|strain|injury)\b/.test(a);
  const sprainB = /\b(sprain|strain|injury)\b/.test(b);
  return kneeA && kneeB && sprainA && sprainB;
}

function diagnosisSemanticMatch(expected, actual) {
  const left = cleanDiagnosisText(expected);
  const right = cleanDiagnosisText(actual);
  const normLeft = normalizeText(left);
  const normRight = normalizeText(right);
  if (!normLeft || !normRight) return false;
  if (normLeft === normRight) return true;
  if (normLeft.includes(normRight) || normRight.includes(normLeft)) return true;
  if (hasStrongTokenOverlap(left, right)) return true;
  if (hasEquivalentBodyConditionClass(left, right)) return true;
  return false;
}

function normalizeLineItemName(value) {
  return normalizeText(value)
    .replace(/\bx\d+\b/g, '')
    .trim();
}

function normalizeLineItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(item => ({
      kind: normalizeText(item?.kind || 'item'),
      name: normalizeLineItemName(item?.name || item?.raw || ''),
      quantity: normalizeInteger(item?.quantity || ''),
      amount: normalizeAmount(item?.amount || ''),
    }))
    .filter(item => item.name)
    .sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`));
}

function drugNameFuzzyMatch(nameA, nameB) {
  const a = normalizeText(nameA);
  const b = normalizeText(nameB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Extract brand name (first word) and dosage for fuzzy comparison
  const brandA = a.split(/[\s(]+/)[0];
  const brandB = b.split(/[\s(]+/)[0];
  if (!brandA || !brandB || brandA.length < 3 || brandB.length < 3) return false;
  if (brandA !== brandB) return false;
  // Same brand — check dosage overlap
  const dosagePattern = /(\d+(?:\.\d+)?)\s*(?:mg|ml|mcg|g|iu|%)/gi;
  const dosagesA = [...a.matchAll(dosagePattern)].map(m => m[1]);
  const dosagesB = [...b.matchAll(dosagePattern)].map(m => m[1]);
  if (dosagesA.length && dosagesB.length) {
    return dosagesA.some(d => dosagesB.includes(d));
  }
  // Same brand, no dosage to compare — treat as match
  return true;
}

function compareLineItems(expectedItems, actualItems) {
  const expected = normalizeLineItems(expectedItems);
  const actual = normalizeLineItems(actualItems);
  if (!expected.length && !actual.length) {
    return {
      state: 'unavailable',
      unavailableReason: 'no_line_items',
      missing: [],
      unexpected: [],
      matched: [],
    };
  }

  const expectedKeys = new Map(expected.map(item => [`${item.kind}:${item.name}`, item]));
  const actualKeys = new Map(actual.map(item => [`${item.kind}:${item.name}`, item]));
  const matched = [];
  const missing = [];
  const unexpected = [];

  const matchedActualKeys = new Set();
  for (const [key, item] of expectedKeys.entries()) {
    if (actualKeys.has(key)) {
      matched.push(item);
      matchedActualKeys.add(key);
    } else {
      // Fuzzy match: try to find an actual item with same kind and similar name
      let fuzzyFound = false;
      for (const [actKey, actItem] of actualKeys.entries()) {
        if (matchedActualKeys.has(actKey)) continue;
        if (item.kind === actItem.kind && drugNameFuzzyMatch(item.name, actItem.name)) {
          matched.push(item);
          matchedActualKeys.add(actKey);
          fuzzyFound = true;
          break;
        }
      }
      if (!fuzzyFound) missing.push(item);
    }
  }
  for (const [key, item] of actualKeys.entries()) {
    if (!matchedActualKeys.has(key) && !expectedKeys.has(key)) unexpected.push(item);
  }

  return {
    state:
      missing.length === 0 && unexpected.length === 0
        ? 'match'
        : matched.length > 0
          ? 'partial'
          : 'mismatch',
    unavailableReason: null,
    matched,
    missing,
    unexpected,
  };
}

function classifyDiagnosisDrift({ visit, expectedSnapshot, botSnapshot, truthSnapshot }) {
  const flow2Diagnosis = expectedSnapshot?.diagnosisText || '';
  const botDiagnosis = botSnapshot?.diagnosisText || '';
  const truthDiagnosis = truthSnapshot?.diagnosisText || '';
  const flow2Matches = diagnosisSemanticMatch(flow2Diagnosis, truthDiagnosis);
  const botMatches = diagnosisSemanticMatch(botDiagnosis, truthDiagnosis);
  const flow2Resolution = visit?.extraction_metadata?.diagnosisResolution || {};
  const flow2DateOk = flow2Resolution?.date_ok === true;
  const sourceAgeDays = Number.isFinite(Number(flow2Resolution?.fallback_age_days))
    ? Number(flow2Resolution.fallback_age_days)
    : Number.isFinite(Number(visit?.extraction_metadata?.diagnosisCanonical?.source_age_days))
      ? Number(visit.extraction_metadata.diagnosisCanonical.source_age_days)
      : null;

  let classification = 'match';
  if (!truthDiagnosis) {
    classification = 'submitted_truth_unavailable';
  } else if (flow2Matches && botMatches) {
    classification = 'match';
  } else if (flow2Matches && !flow2DateOk && sourceAgeDays !== null && sourceAgeDays > 30) {
    classification = 'stale_diagnosis_chosen';
  } else if (flow2Matches && !botMatches) {
    classification = 'wrong_portal_mapping';
  } else if (!flow2Matches && sourceAgeDays !== null && sourceAgeDays > 0) {
    classification = 'stale_diagnosis_chosen';
  } else if (!flow2Matches && botMatches) {
    classification = 'wrong_source_extraction';
  } else {
    classification = 'admin_override_not_in_clinic_assist';
  }

  return {
    classification,
    flow2Diagnosis: flow2Diagnosis || null,
    botDiagnosis: botDiagnosis || null,
    submittedDiagnosis: truthDiagnosis || null,
    flow2DiagnosisCode: expectedSnapshot?.diagnosisCode || null,
    botDiagnosisCode: botSnapshot?.diagnosisCode || null,
    submittedDiagnosisCode: truthSnapshot?.diagnosisCode || null,
    flow2Resolution: flow2Resolution || null,
  };
}

function makeFieldRule(field) {
  switch (field) {
    case 'visitDate':
    case 'mcStartDate':
      return {
        normalize: normalizeDate,
        matches: (expected, actual) => {
          const left = normalizeDate(expected);
          const right = normalizeDate(actual);
          return !!left && !!right && left === right;
        },
      };
    case 'patientNric':
      return {
        normalize: normalizeNric,
        matches: (expected, actual) => {
          const left = normalizeNric(expected);
          const right = normalizeNric(actual);
          return !!left && !!right && left === right;
        },
      };
    case 'patientName':
      return {
        normalize: value => normalizeText(stripPortalTag(value)),
        matches: (expected, actual) => {
          const left = normalizeText(stripPortalTag(expected));
          const right = normalizeText(stripPortalTag(actual));
          if (!left || !right) return false;
          if (left === right) return true;
          if (left.includes(right) || right.includes(left)) return true;
          // Token-level match: all tokens of the shorter name must appear in the longer name
          const leftTokens = left.split(/\s+/).filter(t => t.length >= 2);
          const rightTokens = right.split(/\s+/).filter(t => t.length >= 2);
          const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
          const longerSet = new Set(
            leftTokens.length <= rightTokens.length ? rightTokens : leftTokens
          );
          return shorter.length >= 2 && shorter.every(token => longerSet.has(token));
        },
      };
    case 'diagnosisText':
      return {
        normalize: cleanDiagnosisText,
        matches: diagnosisSemanticMatch,
      };
    case 'diagnosisCode':
      return {
        normalize: normalizeIcdCode,
        matches: (expected, actual) => {
          const left = normalizeIcdCode(expected);
          const right = normalizeIcdCode(actual);
          return !!left && !!right && left === right;
        },
      };
    case 'totalFee':
    case 'totalClaim':
    case 'consultationFee':
      return {
        normalize: normalizeAmount,
        matches: (expected, actual) => {
          const left = normalizeAmount(expected);
          const right = normalizeAmount(actual);
          return !!left && !!right && left === right;
        },
      };
    case 'mcDays':
      return {
        normalize: normalizeInteger,
        matches: (expected, actual) => {
          const left = normalizeInteger(expected);
          const right = normalizeInteger(actual);
          return !!left && !!right && left === right;
        },
      };
    case 'chargeType':
      return {
        normalize: normalizeChargeType,
        matches: (expected, actual) => {
          const left = normalizeChargeType(expected);
          const right = normalizeChargeType(actual);
          return !!left && !!right && left === right;
        },
      };
    default:
      return {
        normalize: normalizeText,
        matches: (expected, actual) => {
          const left = normalizeText(expected);
          const right = normalizeText(actual);
          return (
            !!left && !!right && (left === right || left.includes(right) || right.includes(left))
          );
        },
      };
  }
}

function compareField(field, expected, actual) {
  const rule = makeFieldRule(field);
  const expectedPresent = String(expected ?? '').trim() !== '';
  const actualPresent = String(actual ?? '').trim() !== '';
  if (!expectedPresent && !actualPresent) {
    return {
      field,
      status: 'skipped',
      expected: expected ?? null,
      actual: actual ?? null,
      normalizedExpected: '',
      normalizedActual: '',
      reason: 'both_missing',
    };
  }
  if (!expectedPresent) {
    return {
      field,
      status: 'skipped',
      expected: expected ?? null,
      actual: actual ?? null,
      normalizedExpected: '',
      normalizedActual: rule.normalize(actual),
      reason: 'expected_missing',
    };
  }
  if (!actualPresent) {
    return {
      field,
      status: 'missing_actual',
      expected: expected ?? null,
      actual: actual ?? null,
      normalizedExpected: rule.normalize(expected),
      normalizedActual: '',
      reason: 'actual_missing',
    };
  }
  const matched = rule.matches(expected, actual);
  return {
    field,
    status: matched ? 'match' : 'mismatch',
    expected: expected ?? null,
    actual: actual ?? null,
    normalizedExpected: rule.normalize(expected),
    normalizedActual: rule.normalize(actual),
    reason: matched ? null : 'value_mismatch',
  };
}

function summarizeComparison(details = {}) {
  const comparisons = Object.values(details).filter(Boolean);
  const comparable = comparisons.filter(entry => entry.status !== 'skipped');
  const matchedFields = comparable
    .filter(entry => entry.status === 'match')
    .map(entry => entry.field);
  const mismatchedFields = comparable
    .filter(entry => entry.status !== 'match')
    .map(entry => ({
      field: entry.field,
      status: entry.status,
      expected: entry.expected ?? null,
      actual: entry.actual ?? null,
      reason: entry.reason || null,
    }));

  if (!comparable.length) {
    return {
      state: 'unavailable',
      matchedFields: [],
      mismatchedFields: [],
      unavailableReason: 'no_comparable_fields',
      details,
    };
  }
  if (!mismatchedFields.length) {
    return {
      state: 'match',
      matchedFields,
      mismatchedFields: [],
      unavailableReason: null,
      details,
    };
  }
  if (matchedFields.length) {
    return {
      state: 'partial',
      matchedFields,
      mismatchedFields,
      unavailableReason: null,
      details,
    };
  }
  return {
    state: 'mismatch',
    matchedFields: [],
    mismatchedFields,
    unavailableReason: null,
    details,
  };
}

function deriveMismatchCategories({
  flow2VsSubmittedTruth,
  botVsSubmittedTruth,
  expectedSnapshot,
  botSnapshot,
  submittedTruthSnapshot,
}) {
  const categories = new Set();
  const push = value => {
    if (value) categories.add(value);
  };

  // Check whether NRIC matches across both comparisons — if so, a name-only
  // difference is a benign variant (married/maiden name, alias) not an identity problem.
  const nricMatchesInComparison = comparison => {
    const nricEntry = comparison?.details?.patientNric;
    return nricEntry?.status === 'match';
  };
  const nricConfirmed =
    nricMatchesInComparison(flow2VsSubmittedTruth) || nricMatchesInComparison(botVsSubmittedTruth);

  const checkEntries = comparison => {
    for (const item of comparison?.mismatchedFields || []) {
      const field = String(item?.field || '');
      if (item?.status === 'missing_actual') {
        push('missing_portal_field');
      }
      if (field === 'patientNric') {
        push('patient_identity_mismatch');
      }
      if (field === 'patientName') {
        if (nricConfirmed) {
          push('patient_name_variant');
        } else {
          push('patient_identity_mismatch');
        }
      }
      if (field === 'diagnosisText') {
        push('diagnosis_semantic_mismatch');
      }
      if (field === 'diagnosisCode') {
        const flow2Text = expectedSnapshot?.diagnosisText || null;
        const portalText = submittedTruthSnapshot?.diagnosisText || null;
        if (diagnosisSemanticMatch(flow2Text, portalText)) push('portal_code_mapping_difference');
        else push('diagnosis_semantic_mismatch');
      }
      if (field === 'totalFee' || field === 'totalClaim' || field === 'consultationFee') {
        push('fee_basis_difference');
      }
      if (field === 'mcDays') push('mc_days_difference');
      if (field === 'chargeType') push('charge_type_difference');
    }
  };

  checkEntries(flow2VsSubmittedTruth);
  checkEntries(botVsSubmittedTruth);

  if (botSnapshot?.fieldState?.drug_drugName && submittedTruthSnapshot?.fieldState?.drug_drugName) {
    const left = normalizeText(botSnapshot.fieldState.drug_drugName);
    const right = normalizeText(submittedTruthSnapshot.fieldState.drug_drugName);
    if (left && right && left !== right) push('line_items_mismatch');
  }

  return Array.from(categories);
}

const CONSULTATION_NAME_PATTERN =
  /\bconsultation\b|\bconsult\b|\bphysiotherapy\b|\bradiology\b|\bx-ray\b|\bmri\b|\bultrasound\b|\bwrist brace\b|\bknee brace\b|\bbrace\b/i;

function classifyMedicineItem(item, diagnosisText) {
  const name = String(item?.name || '');
  if (CONSULTATION_NAME_PATTERN.test(name)) return 'procedure';
  // Detect diagnosis text contamination: medicine name matches diagnosis description
  if (diagnosisText && name) {
    if (hasStrongTokenOverlap(name, diagnosisText)) return 'diagnosis_contamination';
    if (hasEquivalentBodyConditionClass(name, diagnosisText)) return 'diagnosis_contamination';
  }
  return 'drug';
}

function deriveConsultationFee(medicines) {
  if (!Array.isArray(medicines)) return '';
  const consultItem = medicines.find(
    item =>
      /\bconsultation\b|\bconsult\b/i.test(String(item?.name || '')) &&
      Number.isFinite(Number(item?.amount))
  );
  return consultItem ? String(consultItem.amount) : '';
}

export function buildExpectedPortalSnapshotFromVisit(visit, opts = {}) {
  const metadata = visit?.extraction_metadata || {};
  const diagnosisCanonical = metadata?.diagnosisCanonical || {};
  const diagnosisResolution = metadata?.diagnosisResolution || {};
  const diagnosisMatch = opts?.diagnosisMatch || metadata?.diagnosisMatch || null;
  const diagnosisText =
    diagnosisMatch?.portalDescription ||
    diagnosisMatch?.description ||
    diagnosisMatch?.resolvedDescription ||
    diagnosisCanonical?.description_canonical ||
    visit?.diagnosis_description ||
    '';
  const diagnosisCode =
    diagnosisMatch?.portalCode ||
    diagnosisMatch?.code ||
    diagnosisCanonical?.code ||
    metadata?.diagnosisCode ||
    '';

  const consultFeeFromMedicines = deriveConsultationFee(metadata?.medicines);

  return {
    portalTarget: String(opts?.portalTarget || 'MHC'),
    patientName: stripPortalTag(visit?.patient_name || ''),
    patientNric:
      visit?.nric ||
      metadata?.nric ||
      metadata?.fin ||
      metadata?.idNumber ||
      metadata?.patientId ||
      '',
    visitDate: toDdMmYyyy(visit?.visit_date || ''),
    chargeType:
      metadata?.chargeType === 'first'
        ? 'First Consult'
        : metadata?.chargeType === 'follow'
          ? 'Follow Up'
          : metadata?.chargeType || '',
    mcDays: metadata?.mcDays ?? '',
    mcStartDate: metadata?.mcStartDate || '',
    diagnosisText,
    diagnosisCode,
    totalFee:
      visit?.total_amount ??
      visit?.totalAmount ??
      visit?.consultation_fee ??
      visit?.charge_amount ??
      metadata?.consultationAmount ??
      '',
    totalClaim:
      visit?.total_amount ??
      visit?.totalAmount ??
      visit?.consultation_fee ??
      visit?.charge_amount ??
      metadata?.consultationAmount ??
      '',
    consultationFee: consultFeeFromMedicines || (metadata?.consultationAmount ?? ''),
    diagnosisResolution: {
      status: diagnosisResolution?.status || null,
      reason: diagnosisResolution?.reason_if_unresolved || null,
      confidence: diagnosisResolution?.confidence ?? null,
    },
    lineItems: Array.isArray(metadata?.medicines)
      ? metadata.medicines
          .filter(item => classifyMedicineItem(item, diagnosisText) === 'drug')
          .map(item => ({
            kind: 'drug',
            name: item?.name || '',
            quantity: item?.quantity ?? '',
            unitPrice: item?.unitPrice ?? '',
            amount: item?.amount ?? '',
          }))
      : [],
  };
}

export function buildFillVerificationFromSnapshots({ expectedSnapshot, botSnapshot }) {
  const mapField = (field, expectedKey, actualKey = expectedKey) => {
    const compared = compareField(field, expectedSnapshot?.[expectedKey], botSnapshot?.[actualKey]);
    if (compared.status === 'match') {
      return {
        status: 'verified',
        expected: compared.expected,
        observed: compared.actual,
        error: null,
      };
    }
    if (compared.status === 'skipped') {
      return {
        status: 'skipped',
        expected: compared.expected,
        observed: compared.actual,
        error: compared.reason,
      };
    }
    if (compared.status === 'missing_actual') {
      return {
        status: 'not_found',
        expected: compared.expected,
        observed: compared.actual,
        error: compared.reason,
      };
    }
    return {
      status: 'mismatch',
      expected: compared.expected,
      observed: compared.actual,
      error: compared.reason,
    };
  };

  return {
    visitDate: mapField('visitDate', 'visitDate'),
    diagnosis: mapField('diagnosisText', 'diagnosisText'),
    fee: mapField('totalFee', 'totalFee'),
    patientNric: mapField('patientNric', 'patientNric'),
    chargeType: mapField('chargeType', 'chargeType'),
    mcDays: mapField('mcDays', 'mcDays'),
  };
}

export function comparePortalTruthSnapshots({
  portalTarget = 'MHC',
  visit,
  botSnapshot = null,
  submittedTruthSnapshot = null,
  draftVerification: _draftVerification = null,
  diagnosisMatch = null,
} = {}) {
  const expectedSnapshot = buildExpectedPortalSnapshotFromVisit(visit, {
    portalTarget,
    diagnosisMatch,
  });

  if (!submittedTruthSnapshot || typeof submittedTruthSnapshot !== 'object') {
    return {
      baselineSource: null,
      truthSource: null,
      state: 'unavailable',
      matchedFields: [],
      mismatchedFields: [],
      unavailableReason: 'submitted_truth_unavailable',
      expectedSnapshot,
      flow2VsSubmittedTruth: {
        state: 'unavailable',
        matchedFields: [],
        mismatchedFields: [],
        unavailableReason: 'submitted_truth_unavailable',
        details: {},
      },
      botVsSubmittedTruth: {
        state: 'unavailable',
        matchedFields: [],
        mismatchedFields: [],
        unavailableReason: 'submitted_truth_unavailable',
        details: {},
      },
      diagnosisDrift: {
        classification: 'submitted_truth_unavailable',
        flow2Diagnosis: expectedSnapshot?.diagnosisText || null,
        botDiagnosis: botSnapshot?.diagnosisText || null,
        submittedDiagnosis: null,
        flow2DiagnosisCode: expectedSnapshot?.diagnosisCode || null,
        botDiagnosisCode: botSnapshot?.diagnosisCode || null,
        submittedDiagnosisCode: null,
        flow2Resolution: visit?.extraction_metadata?.diagnosisResolution || null,
      },
      flow2LineItemsComparison: {
        state: 'unavailable',
        unavailableReason: 'submitted_truth_unavailable',
        missing: [],
        unexpected: [],
        matched: [],
      },
      botLineItemsComparison: {
        state: 'unavailable',
        unavailableReason: 'submitted_truth_unavailable',
        missing: [],
        unexpected: [],
        matched: [],
      },
      mismatchCategories: ['submitted_truth_unavailable'],
    };
  }

  const fields = [
    'patientName',
    'patientNric',
    'visitDate',
    'chargeType',
    'mcDays',
    'mcStartDate',
    'diagnosisText',
    'diagnosisCode',
    'consultationFee',
    'totalFee',
    'totalClaim',
  ];

  const flow2Details = {};
  const botDetails = {};
  for (const field of fields) {
    flow2Details[field] = compareField(
      field,
      expectedSnapshot?.[field],
      submittedTruthSnapshot?.[field]
    );
    botDetails[field] = compareField(field, botSnapshot?.[field], submittedTruthSnapshot?.[field]);
  }

  // When NRIC matches, a patientName mismatch is just a name variant (married/maiden)
  // — promote it to match so it doesn't drag the overall state to "partial".
  const promoteNameIfNricMatches = details => {
    if (details.patientNric?.status === 'match' && details.patientName?.status === 'mismatch') {
      details.patientName = {
        ...details.patientName,
        status: 'match',
        reason: 'nric_confirmed_name_variant',
      };
    }
  };
  promoteNameIfNricMatches(flow2Details);
  promoteNameIfNricMatches(botDetails);

  const flow2VsSubmittedTruth = summarizeComparison(flow2Details);
  const botVsSubmittedTruth = summarizeComparison(botDetails);
  const flow2LineItemsComparison = compareLineItems(
    expectedSnapshot?.lineItems || [],
    submittedTruthSnapshot?.lineItems || []
  );
  const botDrugItems = (botSnapshot?.lineItems || []).filter(
    item => normalizeText(item?.kind || 'drug') === 'drug'
  );
  const botLineItemsComparison = compareLineItems(
    botDrugItems,
    submittedTruthSnapshot?.lineItems || []
  );
  const diagnosisDrift = classifyDiagnosisDrift({
    visit,
    expectedSnapshot,
    botSnapshot,
    truthSnapshot: submittedTruthSnapshot,
  });

  const mismatchCategories = deriveMismatchCategories({
    flow2VsSubmittedTruth,
    botVsSubmittedTruth,
    expectedSnapshot,
    botSnapshot,
    submittedTruthSnapshot,
  });
  if (
    flow2LineItemsComparison.state === 'mismatch' ||
    flow2LineItemsComparison.state === 'partial' ||
    botLineItemsComparison.state === 'mismatch' ||
    botLineItemsComparison.state === 'partial'
  ) {
    if (!mismatchCategories.includes('line_items_mismatch'))
      mismatchCategories.push('line_items_mismatch');
  }
  if (diagnosisDrift.classification && diagnosisDrift.classification !== 'match') {
    if (!mismatchCategories.includes('diagnosis_semantic_mismatch')) {
      mismatchCategories.push('diagnosis_semantic_mismatch');
    }
  }

  return {
    baselineSource: submittedTruthSnapshot?.source || null,
    truthSource: submittedTruthSnapshot?.source || null,
    state: botVsSubmittedTruth.state,
    matchedFields: botVsSubmittedTruth.matchedFields,
    mismatchedFields: botVsSubmittedTruth.mismatchedFields,
    unavailableReason: botVsSubmittedTruth.unavailableReason,
    expectedSnapshot,
    flow2VsSubmittedTruth,
    botVsSubmittedTruth,
    diagnosisDrift,
    flow2LineItemsComparison,
    botLineItemsComparison,
    mismatchCategories,
  };
}

export async function writeFlow3TruthArtifacts({
  visit,
  portalTarget = 'MHC',
  expectedSnapshot = null,
  botSnapshot = null,
  truthSnapshot = null,
  submittedTruthSnapshot = null,
  comparison = null,
  extra = null,
} = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeId = String(visit?.id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  const safePortal = String(portalTarget || 'portal')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .toLowerCase();
  const baseDir = path.resolve(process.cwd(), 'output', 'playwright');
  const jsonPath = path.join(baseDir, `flow3-truth-${safePortal}-${safeId}-${stamp}.json`);
  await fs.mkdir(baseDir, { recursive: true });
  const normalizedSubmittedTruthSnapshot = submittedTruthSnapshot || truthSnapshot || null;
  await fs.writeFile(
    jsonPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        visit: {
          id: visit?.id || null,
          patient_name: visit?.patient_name || null,
          visit_date: visit?.visit_date || null,
          pay_type: visit?.pay_type || null,
          nric: visit?.nric || null,
        },
        expectedSnapshot,
        botSnapshot,
        submittedTruthSnapshot: normalizedSubmittedTruthSnapshot,
        comparison,
        extra,
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  return {
    json: jsonPath,
  };
}
