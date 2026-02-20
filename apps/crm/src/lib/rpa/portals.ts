/**
 * Portal configuration for RPA Flow 3
 * Source of truth lives in portals.shared.js so backend and frontend stay in sync.
 */

import {
  ALLIANZ_TAGS,
  ALLIANCE_MEDINET_TAGS,
  FLOW3_PORTAL_TARGETS,
  FULLERTON_TAGS,
  GE_NTUC_TAGS,
  IHP_TAGS,
  IXCHANGE_TAGS,
  MHC_TAGS,
  PATIENT_NAME_PORTAL_TAGS,
  PORTAL_PAY_TYPES,
  SUPPORTED_PORTALS,
  UNSUPPORTED_PORTALS,
  extractAlliancePortalHint,
  extractAllianceMedinetTag,
  getFlow3PortalTargets,
  getPortalPayTypes,
  getPortalScopeOrFilter,
  isSupportedPortal,
  matchesFlow3PortalTargets,
  isAllianceMedinetTagMatch,
  isAllianceMedinetVisit,
  normalizeFlow3PortalTarget,
  resolveFlow3PortalTarget,
  isUnsupportedPortal,
  getSupportedPortals,
  getUnsupportedPortals,
} from './portals.shared';

export {
  ALLIANZ_TAGS,
  ALLIANCE_MEDINET_TAGS,
  FLOW3_PORTAL_TARGETS,
  FULLERTON_TAGS,
  GE_NTUC_TAGS,
  IHP_TAGS,
  IXCHANGE_TAGS,
  MHC_TAGS,
  PATIENT_NAME_PORTAL_TAGS,
  PORTAL_PAY_TYPES,
  SUPPORTED_PORTALS,
  UNSUPPORTED_PORTALS,
  extractAlliancePortalHint,
  extractAllianceMedinetTag,
  getFlow3PortalTargets,
  getPortalPayTypes,
  getPortalScopeOrFilter,
  isSupportedPortal,
  matchesFlow3PortalTargets,
  isAllianceMedinetTagMatch,
  isAllianceMedinetVisit,
  normalizeFlow3PortalTarget,
  resolveFlow3PortalTarget,
  isUnsupportedPortal,
  getSupportedPortals,
  getUnsupportedPortals,
};

export type SupportedPortal =
  (typeof SUPPORTED_PORTALS)[number];
export type UnsupportedPortal = (typeof UNSUPPORTED_PORTALS)[number];
export type Portal = SupportedPortal | UnsupportedPortal;
export type Flow3PortalTarget = (typeof FLOW3_PORTAL_TARGETS)[number];
