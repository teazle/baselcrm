import { logger } from './logger.js';

/**
 * Validation utilities for extracted Clinic Assist data
 */

// Patterns to exclude from diagnosis/notes (modal text, UI elements, etc.)
const EXCLUDED_PATTERNS = [
  /Update\s+User\s+Info/i,
  /Please enter your login/i,
  /User ID|Full Name|New Password|Retype Password|Email|Mobile/i,
  /Confirm|Cancel|Submit|Save|Close/i,
  /Please\s+(fill|select|choose)/i,
  /^\s*(Click|Select|Choose|Enter)/i,
  /^[\s\W]+$/, // Only whitespace/punctuation
  /^(OK|Yes|No|Cancel|Close|Submit|Save)$/i,
  /^(Loading|Please wait|Processing)/i,
];

// Valid medical/symptom keywords that suggest real diagnosis content
const MEDICAL_KEYWORDS = [
  /\b(fever|headache|pain|ache|sore|infection|flu|cough|cold|rash|swelling|injury|wound|fracture|sprain|strain|bruise|cut|burn|nausea|vomit|diarrhea|constipation|dizziness|fatigue|weakness|malaise|chills|sweating|itching|bleeding|discharge|inflammation|ulcer|lesion|abscess|infection|bacteria|virus|fungus|allergy|reaction|asthma|hypertension|diabetes|cholesterol|heart|lung|liver|kidney|stomach|intestine|muscle|bone|joint|skin|eye|ear|nose|throat|chest|back|neck|shoulder|knee|ankle|wrist|elbow|hand|foot|toe|finger)\b/i,
  /\b(consult|review|follow|check|examine|assess|evaluate|diagnose|treat|prescribe|advise|recommend|refer|admit|discharge)\b/i,
  /\b(cm|kg|mg|ml|days|weeks|months|years|times|doses|tablets|capsules|syrup|cream|ointment|injection|vaccine)\b/i,
];

/**
 * Validate and clean diagnosis/notes text
 * @param {string} text - Raw extracted text
 * @returns {Object} { isValid, cleaned, reason }
 */
export function validateDiagnosis(text) {
  if (!text || typeof text !== 'string') {
    return { isValid: false, cleaned: null, reason: 'empty_or_not_string' };
  }

  const trimmed = text.trim();

  // Check minimum length
  if (trimmed.length < 10) {
    return { isValid: false, cleaned: null, reason: 'too_short' };
  }

  // Check maximum length (prevent grabbing entire page)
  if (trimmed.length > 5000) {
    return { isValid: false, cleaned: null, reason: 'too_long' };
  }

  // Check for excluded patterns (modal text, UI elements)
  for (const pattern of EXCLUDED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { isValid: false, cleaned: null, reason: 'contains_excluded_pattern', pattern: pattern.toString() };
    }
  }

  // Check if text appears to be medical content
  const hasMedicalKeywords = MEDICAL_KEYWORDS.some(keyword => keyword.test(trimmed));
  if (!hasMedicalKeywords && trimmed.length < 50) {
    // Short text without medical keywords is suspicious
    return { isValid: false, cleaned: null, reason: 'no_medical_keywords_short' };
  }

  // Clean the text (remove excessive whitespace, normalize)
  const cleaned = trimmed
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[\r\n]{3,}/g, '\n\n') // Max 2 consecutive newlines
    .trim();

  // Final length check after cleaning
  if (cleaned.length < 10) {
    return { isValid: false, cleaned: null, reason: 'too_short_after_cleaning' };
  }

  return { isValid: true, cleaned, reason: 'valid' };
}

/**
 * Validate NRIC format (Singapore)
 * @param {string} nric - NRIC to validate
 * @returns {Object} { isValid, cleaned, reason }
 */
export function validateNRIC(nric) {
  if (!nric || typeof nric !== 'string') {
    return { isValid: false, cleaned: null, reason: 'empty_or_not_string' };
  }

  // Remove spaces and convert to uppercase
  const cleaned = nric.replace(/\s+/g, '').toUpperCase();

  // Singapore NRIC/FIN format: S/T/F/G/M + 7 digits + 1 letter
  const nricPattern = /^[STFGM]\d{7}[A-Z]$/;
  
  if (!nricPattern.test(cleaned)) {
    return { isValid: false, cleaned: null, reason: 'invalid_format' };
  }

  return { isValid: true, cleaned, reason: 'valid' };
}

/**
 * Validate claim amount
 * @param {number|null} amount - Amount to validate
 * @param {Object} options - Validation options
 * @returns {Object} { isValid, cleaned, reason }
 */
export function validateClaimAmount(amount, options = {}) {
  const { min = 0, max = 100000 } = options;

  if (amount === null || amount === undefined) {
    return { isValid: false, cleaned: null, reason: 'null_or_undefined' };
  }

  const numAmount = typeof amount === 'string' ? parseFloat(amount.replace(/[^0-9.]/g, '')) : Number(amount);

  if (isNaN(numAmount)) {
    return { isValid: false, cleaned: null, reason: 'not_a_number' };
  }

  if (numAmount < min) {
    return { isValid: false, cleaned: null, reason: 'below_minimum', min };
  }

  if (numAmount > max) {
    return { isValid: false, cleaned: null, reason: 'above_maximum', max };
  }

  // Round to 2 decimal places
  const cleaned = Math.round(numAmount * 100) / 100;

  return { isValid: true, cleaned, reason: 'valid' };
}

/**
 * Validate items/services array
 * @param {Array} items - Array of items to validate
 * @returns {Object} { isValid, cleaned, reason }
 */
export function validateItems(items) {
  if (!Array.isArray(items)) {
    return { isValid: false, cleaned: [], reason: 'not_an_array' };
  }

  if (items.length === 0) {
    return { isValid: true, cleaned: [], reason: 'valid_empty' }; // Empty is valid
  }

  const cleaned = items
    .filter(item => {
      if (!item || typeof item !== 'string') return false;
      const trimmed = item.trim();
      // Minimum length check
      if (trimmed.length < 2) return false;
      // Exclude generic/UI text
      if (/^(Item|Drug|Medicine|Description|Qty|Quantity|Price|Amount|Total)$/i.test(trimmed)) return false;
      // Exclude numbers only
      if (/^\d+$/.test(trimmed)) return false;
      // Exclude currency amounts only
      if (/^\$?[\d,]+\.?\d*$/.test(trimmed)) return false;
      return true;
    })
    .map(item => item.trim())
    .filter((item, index, self) => self.indexOf(item) === index); // Deduplicate

  if (cleaned.length === 0 && items.length > 0) {
    return { isValid: false, cleaned: [], reason: 'all_items_filtered_out' };
  }

  return { isValid: true, cleaned, reason: 'valid' };
}

/**
 * Validate referral clinic
 * @param {string|null} referralClinic - Referral clinic to validate
 * @returns {Object} { isValid, cleaned, reason }
 */
export function validateReferralClinic(referralClinic) {
  if (!referralClinic || typeof referralClinic !== 'string') {
    return { isValid: false, cleaned: null, reason: 'empty_or_not_string' };
  }

  const trimmed = referralClinic.trim();

  // Check for excluded patterns
  for (const pattern of EXCLUDED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { isValid: false, cleaned: null, reason: 'contains_excluded_pattern' };
    }
  }

  // Minimum length
  if (trimmed.length < 2) {
    return { isValid: false, cleaned: null, reason: 'too_short' };
  }

  // Maximum length
  if (trimmed.length > 200) {
    return { isValid: false, cleaned: null, reason: 'too_long' };
  }

  return { isValid: true, cleaned: trimmed, reason: 'valid' };
}

/**
 * Validate extracted claim details object
 * @param {Object} claimDetails - Claim details to validate
 * @returns {Object} { isValid, validated, errors }
 */
export function validateClaimDetails(claimDetails) {
  const errors = {};
  const validated = {};

  // Validate diagnosis
  const diagnosisResult = validateDiagnosis(claimDetails?.diagnosisText);
  if (diagnosisResult.isValid) {
    validated.diagnosisText = diagnosisResult.cleaned;
    validated.notesText = claimDetails?.notesText ? validateDiagnosis(claimDetails.notesText).cleaned : diagnosisResult.cleaned;
  } else {
    errors.diagnosis = diagnosisResult.reason;
    validated.diagnosisText = null;
    validated.notesText = null;
  }

  // Validate claim amount
  const amountResult = validateClaimAmount(claimDetails?.claimAmount, { min: 0, max: 50000 });
  if (amountResult.isValid) {
    validated.claimAmount = amountResult.cleaned;
  } else {
    errors.claimAmount = amountResult.reason;
    validated.claimAmount = null;
  }

  // Validate items
  const itemsResult = validateItems(claimDetails?.items);
  if (itemsResult.isValid) {
    validated.items = itemsResult.cleaned;
  } else {
    errors.items = itemsResult.reason;
    validated.items = [];
  }

  // Validate referral clinic (optional, so null is OK)
  if (claimDetails?.referralClinic) {
    const referralResult = validateReferralClinic(claimDetails.referralClinic);
    if (referralResult.isValid) {
      validated.referralClinic = referralResult.cleaned;
    } else {
      errors.referralClinic = referralResult.reason;
      validated.referralClinic = null;
    }
  } else {
    validated.referralClinic = null;
  }

  // MC days is always 0, so always valid
  validated.mcDays = claimDetails?.mcDays || 0;

  // Overall validity: at least diagnosis or items should be present
  const isValid = !!(validated.diagnosisText || validated.items.length > 0);

  return {
    isValid,
    validated,
    errors,
  };
}

/**
 * Log validation results
 * @param {Object} validationResult - Result from validateClaimDetails
 * @param {string} context - Context for logging (e.g., patient name)
 */
export function logValidationResults(validationResult, context = '') {
  if (validationResult.isValid) {
    logger.info(`[VALIDATION] ✅ Valid extraction${context ? ` for ${context}` : ''}`, {
      hasDiagnosis: !!validationResult.validated.diagnosisText,
      itemsCount: validationResult.validated.items?.length || 0,
      hasAmount: validationResult.validated.claimAmount !== null,
    });
  } else {
    logger.warn(`[VALIDATION] ⚠️ Validation issues${context ? ` for ${context}` : ''}`, {
      errors: validationResult.errors,
      hasDiagnosis: !!validationResult.validated.diagnosisText,
      itemsCount: validationResult.validated.items?.length || 0,
    });
  }
}
