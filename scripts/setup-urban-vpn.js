#!/usr/bin/env node

/**
 * Script to download and set up Urban VPN extension for Playwright
 * This will download the extension from Chrome Web Store and extract it
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSIONS_DIR = path.join(process.cwd(), 'extensions');
const URBAN_VPN_DIR = path.join(EXTENSIONS_DIR, 'urban-vpn');
const URBAN_VPN_ID = 'eppiocemhmnlbhjplcgkofciiegomcon'; // Urban VPN Chrome extension ID

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function downloadExtension() {
  console.log('Setting up Urban VPN extension for Playwright...\n');

  // Create extensions directory
  if (!fs.existsSync(EXTENSIONS_DIR)) {
    fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
    console.log(`Created extensions directory: ${EXTENSIONS_DIR}`);
  }

  // Check if already installed
  const manifestPath = path.join(URBAN_VPN_DIR, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    console.log('Urban VPN extension already installed.');
    console.log(`Location: ${URBAN_VPN_DIR}\n`);
    return;
  }

  console.log('Urban VPN extension not found. Please install it manually:');
  console.log('\n=== Manual Installation Steps ===');
  console.log('1. Open Chrome browser');
  console.log('2. Go to: https://chromewebstore.google.com/detail/urban-vpn-free-vpn-proxy/eppiocemhmnlbhjplcgkofciiegomcon');
  console.log('3. Click "Add to Chrome" to install the extension');
  console.log('4. After installation, find the extension in Chrome:');
  console.log('   - Go to chrome://extensions/');
  console.log('   - Enable "Developer mode" (toggle in top right)');
  console.log('   - Find "Urban VPN" extension');
  console.log('   - Click "Details"');
  console.log('   - Note the "ID" (should be: eppiocemhmnlbhjplcgkofciiegomcon)');
  console.log('\n5. Copy the extension from Chrome to the project:');
  console.log(`   - Extension location in Chrome: ~/Library/Application Support/Google/Chrome/Default/Extensions/${URBAN_VPN_ID}/`);
  console.log(`   - Copy the latest version folder to: ${URBAN_VPN_DIR}`);
  console.log('\n   Or use this command (replace VERSION with the version number):');
  console.log(`   cp -r ~/Library/Application\\ Support/Google/Chrome/Default/Extensions/${URBAN_VPN_ID}/VERSION ${URBAN_VPN_DIR}`);
  console.log('\n=== Alternative: Use System-Level VPN ===');
  console.log('If you prefer, you can use Urban VPN as a system-level application:');
  console.log('1. Download Urban VPN desktop app from: https://www.urban-vpn.com/');
  console.log('2. Install and connect to Singapore server');
  console.log('3. Set PROXY_ENABLED=false in .env');
  console.log('4. The browser will use the system VPN automatically\n');
}

async function verifyInstallation() {
  const manifestPath = path.join(URBAN_VPN_DIR, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    console.log('✓ Urban VPN extension found');
    console.log(`  Name: ${manifest.name || 'Unknown'}`);
    console.log(`  Version: ${manifest.version || 'Unknown'}`);
    console.log(`  Location: ${URBAN_VPN_DIR}\n`);
    return true;
  }
  return false;
}

// Main
(async () => {
  try {
    await downloadExtension();
    const installed = await verifyInstallation();
    
    if (installed) {
      console.log('Setup complete! The extension will be loaded automatically when you run the automation.');
      console.log('\nNext steps:');
      console.log('1. Make sure to configure Urban VPN to use Singapore server');
      console.log('2. Set USE_PERSISTENT_CONTEXT=true in your .env file');
      console.log('3. Run your test script to verify access to mhcasia.net\n');
    } else {
      console.log('Please complete the manual installation steps above.\n');
    }
  } catch (error) {
    console.error('Error setting up Urban VPN:', error.message);
    process.exit(1);
  }
})();
