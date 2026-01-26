import { logger } from './logger.js';
import {
  getSupportedPortals as getDefaultSupportedPortals,
  getUnsupportedPortals as getDefaultUnsupportedPortals,
} from '../../apps/crm/src/lib/rpa/portals.shared.js';

function normalizePortalCode(value) {
  if (!value) return null;
  const code = String(value).trim().toUpperCase();
  return code.length > 0 ? code : null;
}

export async function fetchPortalConfig(supabase) {
  const defaults = {
    supported: [...getDefaultSupportedPortals()],
    unsupported: [...getDefaultUnsupportedPortals()],
  };

  if (!supabase) return defaults;

  try {
    const { data, error } = await supabase
      .from('rpa_portals')
      .select('portal_code,status');

    if (error) {
      logger.warn('[PORTALS] Failed to load portal config, using defaults', { error: error.message });
      return defaults;
    }

    if (!data || data.length === 0) {
      return defaults;
    }

    const supported = [];
    const unsupported = [];
    for (const row of data) {
      const code = normalizePortalCode(row.portal_code);
      if (!code) continue;
      if (row.status === 'supported') {
        supported.push(code);
      } else {
        unsupported.push(code);
      }
    }

    return { supported, unsupported };
  } catch (error) {
    logger.warn('[PORTALS] Error loading portal config, using defaults', { error: error.message });
    return defaults;
  }
}

export async function ensurePortalsExist(supabase, portalCodes = []) {
  if (!supabase) return;

  const normalized = Array.from(
    new Set(
      portalCodes
        .map(normalizePortalCode)
        .filter(Boolean)
    )
  );

  if (normalized.length === 0) return;

  try {
    const { data, error } = await supabase
      .from('rpa_portals')
      .select('portal_code')
      .in('portal_code', normalized);

    if (error) {
      logger.warn('[PORTALS] Failed to check existing portals', { error: error.message });
      return;
    }

    const existing = new Set((data || []).map((row) => normalizePortalCode(row.portal_code)).filter(Boolean));
    const missing = normalized.filter((code) => !existing.has(code));

    if (missing.length === 0) return;

    const payload = missing.map((code) => ({
      portal_code: code,
      status: 'unsupported',
      label: code,
    }));

    const { error: insertError } = await supabase
      .from('rpa_portals')
      .insert(payload);

    if (insertError) {
      logger.warn('[PORTALS] Failed to insert missing portals', { error: insertError.message });
    } else {
      logger.info(`[PORTALS] Added ${missing.length} new portal(s) as unsupported`, { portals: missing });
    }
  } catch (error) {
    logger.warn('[PORTALS] Error ensuring portals exist', { error: error.message });
  }
}

export function normalizePortalCodeValue(value) {
  return normalizePortalCode(value);
}
