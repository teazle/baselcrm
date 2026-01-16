import 'dotenv/config';
import { BrowserManager } from '../utils/browser.js';
import { ProxyFinder } from '../utils/proxy-finder.js';
import { logger } from '../utils/logger.js';
import { PROXY_CONFIG } from '../config/portals.js';

/**
 * Test script to verify Singapore IP connection
 */
async function checkIPLocation(page) {
  try {
    console.log('\n📍 Checking IP location...');
    await page.goto('https://ipinfo.io/json', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    const ipInfo = await page.evaluate(() => {
      return JSON.parse(document.body.textContent);
    });

    console.log(`   IP Address: ${ipInfo.ip}`);
    console.log(`   Country: ${ipInfo.country} (${ipInfo.countryCode})`);
    console.log(`   Region: ${ipInfo.region || 'Unknown'}`);
    console.log(`   City: ${ipInfo.city || 'Unknown'}`);
    console.log(`   ISP: ${ipInfo.org || 'Unknown'}`);

    const isSingapore = ipInfo.country === 'SG' || ipInfo.countryCode === 'SG';

    if (isSingapore) {
      console.log('\n✅ SUCCESS: Connected from Singapore IP!');
      return { success: true, ipInfo };
    } else {
      console.log(`\n❌ FAILED: Connected from ${ipInfo.country}, not Singapore`);
      return { success: false, ipInfo };
    }
  } catch (error) {
    console.error('❌ Error checking IP location:', error.message);
    return { success: false, error: error.message };
  }
}

async function testMHCAsiaAccess(page) {
  try {
    console.log('\n🌐 Testing MHC Asia website access...');
    const response = await page.goto('https://www.mhcasia.net/mhc/', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    if (response) {
      const status = response.status();
      console.log(`   HTTP Status: ${status}`);

      if (status === 200) {
        const title = await page.title();
        console.log(`   Page Title: ${title}`);
        console.log('\n✅ SUCCESS: Can access MHC Asia website!');
        return { success: true, status, title };
      } else if (status === 403 || status === 401) {
        console.log('\n❌ FAILED: Access denied (likely IP restriction)');
        return { success: false, status, reason: 'Access denied' };
      } else {
        console.log(`\n⚠️  WARNING: Unexpected status code: ${status}`);
        return { success: false, status };
      }
    } else {
      console.log('\n⚠️  WARNING: No response received');
      return { success: false, reason: 'No response' };
    }
  } catch (error) {
    if (error.message.includes('Timeout')) {
      console.log('\n❌ FAILED: Timeout - MHC Asia may be blocking the connection');
      console.log('   This usually means the IP is not from Singapore');
    } else {
      console.error('❌ Error accessing MHC Asia:', error.message);
    }
    return { success: false, error: error.message };
  }
}

async function testWithProxy() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║      Singapore IP Connection Test (with Proxy)         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  PROXY_ENABLED: ${PROXY_CONFIG.enabled}`);
  console.log(`  PROXY_AUTO_DISCOVER: ${PROXY_CONFIG.autoDiscover}`);
  console.log(`  PROXY_SERVER: ${PROXY_CONFIG.server || 'not set'}\n`);

  const browserManager = new BrowserManager();
  let page = null;

  try {
    console.log('🚀 Initializing browser with proxy support...');
    await browserManager.init();

    page = await browserManager.newPage();
    console.log('✅ Browser initialized\n');

    // Test 1: Check IP location
    const ipResult = await checkIPLocation(page);

    // Test 2: Try to access MHC Asia
    const mhcResult = await testMHCAsiaAccess(page);

    // Summary
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                      Test Results                         ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    console.log('IP Location Test:');
    if (ipResult.success) {
      console.log('  ✅ Connected from Singapore');
      console.log(`     IP: ${ipResult.ipInfo.ip}`);
      console.log(`     Location: ${ipResult.ipInfo.city || 'Unknown'}, ${ipResult.ipInfo.country}`);
    } else {
      console.log('  ❌ NOT connected from Singapore');
      if (ipResult.ipInfo) {
        console.log(`     Current IP: ${ipResult.ipInfo.ip}`);
        console.log(`     Current Country: ${ipResult.ipInfo.country}`);
      }
    }

    console.log('\nMHC Asia Access Test:');
    if (mhcResult.success) {
      console.log('  ✅ Can access MHC Asia website');
      console.log(`     Status: ${mhcResult.status}`);
    } else {
      console.log('  ❌ Cannot access MHC Asia website');
      if (mhcResult.status) {
        console.log(`     Status: ${mhcResult.status}`);
      }
      if (mhcResult.reason) {
        console.log(`     Reason: ${mhcResult.reason}`);
      }
    }

    // Final verdict
    console.log('\n' + '='.repeat(60));
    if (ipResult.success && mhcResult.success) {
      console.log('✅ ALL TESTS PASSED - Ready to use MHC Asia!');
      console.log('='.repeat(60));
      return true;
    } else if (ipResult.success && !mhcResult.success) {
      console.log('⚠️  IP is Singapore but MHC Asia access failed');
      console.log('   This may be a temporary issue or additional restrictions');
      console.log('='.repeat(60));
      return false;
    } else {
      console.log('❌ NOT CONNECTED FROM SINGAPORE');
      console.log('\nSolutions:');
      console.log('1. Use a system-level VPN with Singapore servers:');
      console.log('   - Install Falcon VPN or VeePN');
      console.log('   - Connect to Singapore server');
      console.log('   - Set PROXY_ENABLED=false in .env');
      console.log('\n2. Use a manual proxy server:');
      console.log('   - Get a Singapore proxy server');
      console.log('   - Set PROXY_SERVER=http://proxy.com:8080 in .env');
      console.log('   - Set PROXY_AUTO_DISCOVER=false');
      console.log('\n3. Retry later (free proxy APIs may be temporarily unavailable)');
      console.log('='.repeat(60));
      return false;
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    return false;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        // Ignore
      }
    }
    try {
      await browserManager.close();
    } catch (e) {
      // Ignore
    }
  }
}

async function testWithoutProxy() {
  console.log('\n\n╔══════════════════════════════════════════════════════════╗');
  console.log('║    Singapore IP Connection Test (without Proxy)        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const browserManager = new BrowserManager();
  let page = null;

  try {
    console.log('🚀 Initializing browser (direct connection)...');
    // Temporarily disable proxy
    const originalEnabled = PROXY_CONFIG.enabled;
    PROXY_CONFIG.enabled = false;

    await browserManager.init();
    page = await browserManager.newPage();
    console.log('✅ Browser initialized\n');

    // Restore original setting
    PROXY_CONFIG.enabled = originalEnabled;

    const ipResult = await checkIPLocation(page);

    console.log('\n' + '='.repeat(60));
    if (ipResult.success) {
      console.log('✅ Direct connection is from Singapore!');
      console.log('   You may not need a proxy - set PROXY_ENABLED=false');
    } else {
      console.log('❌ Direct connection is NOT from Singapore');
      console.log('   You need a proxy or VPN to access MHC Asia');
    }
    console.log('='.repeat(60));

    await page.close();
    await browserManager.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (page) {
      try {
        await page.close();
      } catch (e) {}
    }
    try {
      await browserManager.close();
    } catch (e) {}
  }
}

async function main() {
  // Test with proxy enabled
  const withProxy = await testWithProxy();

  // Also test direct connection for comparison
  await testWithoutProxy();

  process.exit(withProxy ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
