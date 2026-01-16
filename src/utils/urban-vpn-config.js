/**
 * Utility to configure Urban VPN extension to automatically connect to Singapore
 * This modifies the browser's preferences file to set default country
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const EXTENSION_ID = 'eppiocemhmnlbhjplcgkofciiegomcon';

/**
 * Get the browser preferences file path for Playwright
 */
export function getBrowserPreferencesPath(userDataDir) {
  // Playwright stores preferences in the user data directory
  return path.join(userDataDir, 'Default', 'Preferences');
}

/**
 * Configure Urban VPN to default to Singapore in browser preferences
 */
export function configureUrbanVPNPreferences(userDataDir) {
  try {
    const prefsPath = getBrowserPreferencesPath(userDataDir);
    const prefsDir = path.dirname(prefsPath);
    
    // Ensure directory exists
    if (!fs.existsSync(prefsDir)) {
      fs.mkdirSync(prefsDir, { recursive: true });
    }
    
    let preferences = {};
    
    // Read existing preferences if they exist
    if (fs.existsSync(prefsPath)) {
      try {
        const prefsContent = fs.readFileSync(prefsPath, 'utf8');
        preferences = JSON.parse(prefsContent);
      } catch (e) {
        // If preferences file is corrupted, start fresh
        preferences = {};
      }
    }
    
    // Initialize extensions preferences structure
    if (!preferences.extensions) {
      preferences.extensions = {};
    }
    
    if (!preferences.extensions.settings) {
      preferences.extensions.settings = {};
    }
    
    // Set Urban VPN extension preferences
    const extensionKey = EXTENSION_ID;
    if (!preferences.extensions.settings[extensionKey]) {
      preferences.extensions.settings[extensionKey] = {};
    }
    
    // Set default country to Singapore
    // Note: The exact structure may vary, but we'll try common patterns
    const extensionSettings = preferences.extensions.settings[extensionKey];
    
    // Try to set country preference
    if (!extensionSettings.preferences) {
      extensionSettings.preferences = {};
    }
    
    extensionSettings.preferences.selectedCountry = 'SG';
    extensionSettings.preferences.countryCode = 'SG';
    extensionSettings.preferences.country = 'Singapore';
    extensionSettings.preferences.autoConnect = true;
    
    // Write preferences back
    fs.writeFileSync(prefsPath, JSON.stringify(preferences, null, 2));
    
    return true;
  } catch (error) {
    console.warn('Could not configure Urban VPN preferences:', error.message);
    return false;
  }
}

/**
 * Alternative: Use proxy server for Singapore IP (more reliable for automation)
 */
export function getSingaporeProxyConfig() {
  // Return a proxy configuration that routes through Singapore
  // This is more reliable than extension automation
  return {
    enabled: true,
    server: process.env.SINGAPORE_PROXY_SERVER || null,
    // If proxy server is configured, use it
    // Otherwise, extension will be used
  };
}
