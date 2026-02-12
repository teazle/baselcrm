/**
 * Portal configuration for RPA Flow 3
 * Source of truth lives in portals.shared.js so backend and frontend stay in sync.
 */

import {
  ALLIANCE_MEDINET_TAGS,
  PORTAL_PAY_TYPES,
  SUPPORTED_PORTALS,
  UNSUPPORTED_PORTALS,
  extractAllianceMedinetTag,
  getPortalPayTypes,
  getPortalScopeOrFilter,
  isSupportedPortal,
  isAllianceMedinetTagMatch,
  isAllianceMedinetVisit,
  isUnsupportedPortal,
  getSupportedPortals,
  getUnsupportedPortals,
} from './portals.shared';

export {
  ALLIANCE_MEDINET_TAGS,
  PORTAL_PAY_TYPES,
  SUPPORTED_PORTALS,
  UNSUPPORTED_PORTALS,
  extractAllianceMedinetTag,
  getPortalPayTypes,
  getPortalScopeOrFilter,
  isSupportedPortal,
  isAllianceMedinetTagMatch,
  isAllianceMedinetVisit,
  isUnsupportedPortal,
  getSupportedPortals,
  getUnsupportedPortals,
};

export type SupportedPortal =
  | 'MHC'
  | 'AIA'
  | 'AIACLIENT'
  | 'TOKIOM'
  | 'ALLIANC'
  | 'ALLSING'
  | 'AXAMED'
  | 'PRUDEN';
export type UnsupportedPortal = 'IHP' | 'GE' | 'FULLERT' | 'ALLIMED' | 'ALL' | 'ALLIANCE';
export type Portal = SupportedPortal | UnsupportedPortal;
