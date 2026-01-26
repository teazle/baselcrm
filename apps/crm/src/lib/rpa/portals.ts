/**
 * Portal configuration for RPA Flow 3
 * Source of truth lives in portals.shared.js so backend and frontend stay in sync.
 */

import {
  SUPPORTED_PORTALS,
  UNSUPPORTED_PORTALS,
  isSupportedPortal,
  isUnsupportedPortal,
  getSupportedPortals,
  getUnsupportedPortals,
} from "./portals.shared";

export { SUPPORTED_PORTALS, UNSUPPORTED_PORTALS, isSupportedPortal, isUnsupportedPortal, getSupportedPortals, getUnsupportedPortals };

export type SupportedPortal = "MHC" | "AIA" | "AIACLIENT";
export type UnsupportedPortal = "IHP" | "GE" | "FULLERT" | "ALLIMED" | "ALL" | "ALLIANCE";
export type Portal = SupportedPortal | UnsupportedPortal;
