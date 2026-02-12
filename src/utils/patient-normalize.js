// Utilities for normalizing patient identifiers/names across systems.

export function normalizePcno(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  // Clinic Assist PCNO is typically 4-6+ digits; keep it flexible but numeric-only.
  if (!/^\d{4,}$/.test(digits)) return null;
  return digits;
}

export function normalizeNric(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  // Collapse separators/spaces: "S 1234 567 A" => "S1234567A"
  const compact = s.replace(/[\s\/\-]+/g, '').toUpperCase();
  if (!/^[STFGM]\d{7}[A-Z]$/.test(compact)) return null;
  return compact;
}

export function normalizePatientNameForSearch(value) {
  let s = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';

  // Remove leading tags/prefixes like "TAG AVIVA -", "SINGLIFE -", "AVIVA | SINGLIFE -",
  // "MHC MEDICAL NETWORK ... -", etc.
  // If there's a dash-separated prefix containing known contract/tags, keep the right-most segment.
  const upper = s.toUpperCase();
  const tagTokens = [
    'TAG',
    'AVIVA',
    'SINGLIFE',
    'MHC',
    'AIA',
    'AIACLIENT',
    'GE',
    'ALLIANZ',
    'FULLERT',
    'IHP',
    'TOKIOM',
    'ALLIANC',
    'ALLSING',
    'AXAMED',
    'PRUDEN',
  ];
  const hasTagToken = tagTokens.some(t => upper.includes(t));

  if (hasTagToken) {
    // Prefer splitting on '-' first (common format: "TAG AVIVA - NAME").
    if (s.includes('-')) {
      const parts = s
        .split('-')
        .map(p => p.trim())
        .filter(Boolean);
      if (parts.length >= 2) {
        const left = parts.slice(0, -1).join(' ').toUpperCase();
        const leftHasToken = tagTokens.some(t => new RegExp(`(^|\\b)${t}(\\b|$)`).test(left));
        if (leftHasToken) {
          s = parts[parts.length - 1];
        }
      }
    }

    // Also remove any remaining leading tokens and separators.
    s = s
      .replace(
        /^(?:\s*(?:TAG\s+)?(?:AVIVA|SINGLIFE|MHC|AIA|AIACLIENT|GE|ALLIANZ|FULLERT|IHP|TOKIOM|ALLIANC|ALLSING|AXAMED|PRUDEN)\s*)+(?:[|:/-]+\s*)*/i,
        ''
      )
      .trim();
  }

  return s;
}
