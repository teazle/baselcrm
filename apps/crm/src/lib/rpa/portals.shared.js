// Shared portal config for both frontend and backend (ESM)
export const SUPPORTED_PORTALS = ["MHC", "AIA", "AIACLIENT"];
export const UNSUPPORTED_PORTALS = ["IHP", "GE", "FULLERT", "ALLIMED", "ALL", "ALLIANCE"];

export function isSupportedPortal(payType) {
  if (!payType) return false;
  return SUPPORTED_PORTALS.includes(String(payType).toUpperCase());
}

export function isUnsupportedPortal(payType) {
  if (!payType) return false;
  return UNSUPPORTED_PORTALS.includes(String(payType).toUpperCase());
}

export function getSupportedPortals() {
  return SUPPORTED_PORTALS;
}

export function getUnsupportedPortals() {
  return UNSUPPORTED_PORTALS;
}
