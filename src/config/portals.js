/**
 * Portal configuration for different insurance/TPA systems
 */
export const PORTALS = {
  CLINIC_ASSIST: {
    name: 'Clinic Assist',
    url: process.env.CLINIC_ASSIST_URL || 'https://clinicassist.sg:1080/',
    username: process.env.CLINIC_ASSIST_USERNAME || 'Vincent',
    password: process.env.CLINIC_ASSIST_PASSWORD || 'Testing123!!!',
    clinicGroup: process.env.CLINIC_ASSIST_CLINIC_GROUP || 'ssoc',
    timeout: 30000,
  },
  MHC_ASIA: {
    name: 'MHC Asia',
    url: process.env.MHC_ASIA_URL || 'https://www.mhcasia.net/mhc/',
    username: process.env.MHC_ASIA_USERNAME || 'SSP000170',
    password: process.env.MHC_ASIA_PASSWORD || 'KY08240',
    timeout: 30000,
  },
  ALLIANCE_MEDINET: {
    name: 'Alliance Medinet',
    url: process.env.ALLIANCE_MEDINET_URL || 'https://connect.alliancemedinet.com/login',
    username: process.env.ALLIANCE_MEDINET_USERNAME || '',
    password: process.env.ALLIANCE_MEDINET_PASSWORD || '',
    timeout: 30000,
  },
};

/**
 * Browser configuration
 */
export const BROWSER_CONFIG = {
  headless: process.env.HEADLESS === 'true',
  slowMo: parseInt(process.env.SLOW_MO || '0'),
  timeout: parseInt(process.env.TIMEOUT || '30000'),
  viewport: {
    width: 1920,
    height: 1080,
  },
};

/**
 * Proxy configuration for accessing geo-restricted sites (e.g., Singapore IP for MHC Asia)
 */
export const PROXY_CONFIG = {
  enabled: process.env.PROXY_ENABLED === 'true',
  server: process.env.PROXY_SERVER || null,
  username: process.env.PROXY_USERNAME || null,
  password: process.env.PROXY_PASSWORD || null,
  bypass: process.env.PROXY_BYPASS
    ? process.env.PROXY_BYPASS.split(',')
    : ['localhost', '127.0.0.1'],
  // Auto-discovery settings
  autoDiscover: process.env.PROXY_AUTO_DISCOVER !== 'false', // Default to true
  maxRetries: parseInt(process.env.PROXY_MAX_RETRIES || '3'),
};
