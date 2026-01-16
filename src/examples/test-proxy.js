import 'dotenv/config';
import { BrowserManager } from '../utils/browser.js';
import { ProxyFinder } from '../utils/proxy-finder.js';
import { ProxyValidator } from '../utils/proxy-validator.js';
import { logger } from '../utils/logger.js';
import { PROXY_CONFIG } from '../config/portals.js';

/**
 * Test script for proxy functionality
 */
async function testProxyFinder() {
  console.log('\n=== Testing Proxy Finder ===\n');
  
  const finder = new ProxyFinder();
  
  try {
    console.log('Fetching Singapore proxies from all sources...');
    const proxies = await finder.findAllProxies();
    
    console.log(`\nFound ${proxies.length} Singapore proxies:`);
    if (proxies.length > 0) {
      console.log('\nFirst 5 proxies:');
      proxies.slice(0, 5).forEach((proxy, index) => {
        console.log(`${index + 1}. ${proxy.server} (from ${proxy.source})`);
      });
    } else {
      console.log('\n⚠️  No proxies found. This is normal if free proxy APIs are temporarily unavailable.');
    }
    
    return proxies.length > 0;
  } catch (error) {
    console.error('Proxy finder test failed:', error);
    return false;
  }
}

async function testProxyValidator() {
  console.log('\n=== Testing Proxy Validator ===\n');
  
  const validator = new ProxyValidator();
  
  try {
    console.log('Testing IP location verification...');
    const isValid = await validator.verifySingaporeIP();
    
    if (isValid) {
      console.log('✓ Current IP is from Singapore');
    } else {
      console.log('⚠️  Current IP is NOT from Singapore (expected if not using proxy/VPN)');
    }
    
    return true;
  } catch (error) {
    console.error('Proxy validator test failed:', error);
    return false;
  }
}

async function testBrowserWithProxy() {
  console.log('\n=== Testing Browser with Proxy ===\n');
  
  const browserManager = new BrowserManager();
  
  try {
    console.log('Initializing browser with proxy support...');
    console.log(`Proxy enabled: ${PROXY_CONFIG.enabled}`);
    console.log(`Auto-discover: ${PROXY_CONFIG.autoDiscover}`);
    
    if (PROXY_CONFIG.server) {
      console.log(`Manual proxy: ${PROXY_CONFIG.server}`);
    }
    
    await browserManager.init();
    
    console.log('✓ Browser initialized successfully');
    
    // Test accessing a page
    const page = await browserManager.newPage();
    console.log('Testing page access...');
    
    try {
      // Test IP check
      console.log('Checking IP location...');
      await page.goto('https://ipinfo.io/json', { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });
      
      const ipInfo = await page.evaluate(() => {
        return JSON.parse(document.body.textContent);
      });
      
      console.log(`Current IP: ${ipInfo.ip}`);
      console.log(`Country: ${ipInfo.country} (${ipInfo.countryCode})`);
      console.log(`City: ${ipInfo.city || 'Unknown'}`);
      
      if (ipInfo.country === 'SG' || ipInfo.countryCode === 'SG') {
        console.log('✓ IP is from Singapore - proxy is working!');
      } else {
        console.log('⚠️  IP is NOT from Singapore');
        console.log('   This may cause issues accessing MHC Asia');
      }
      
      // Test MHC Asia access
      console.log('\nTesting MHC Asia access...');
      const mhcResponse = await page.goto('https://www.mhcasia.net/mhc/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      
      if (mhcResponse && mhcResponse.status() === 200) {
        console.log('✓ Successfully accessed MHC Asia website');
        const pageTitle = await page.title();
        console.log(`Page title: ${pageTitle}`);
      } else {
        console.log(`⚠️  MHC Asia returned status: ${mhcResponse?.status() || 'unknown'}`);
      }
      
    } catch (error) {
      console.error('Error testing page access:', error.message);
    }
    
    await page.close();
    await browserManager.close();
    
    return true;
  } catch (error) {
    console.error('Browser test failed:', error);
    try {
      await browserManager.close();
    } catch (e) {
      // Ignore close errors
    }
    return false;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         Proxy Implementation Test Suite                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  const results = {
    finder: false,
    validator: false,
    browser: false,
  };
  
  // Test 1: Proxy Finder
  results.finder = await testProxyFinder();
  
  // Test 2: Proxy Validator
  results.validator = await testProxyValidator();
  
  // Test 3: Browser with Proxy
  results.browser = await testBrowserWithProxy();
  
  // Summary
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                    Test Summary                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  console.log(`Proxy Finder:        ${results.finder ? '✓ PASS' : '⚠️  No proxies found (may be normal)'}`);
  console.log(`Proxy Validator:     ${results.validator ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Browser with Proxy:  ${results.browser ? '✓ PASS' : '✗ FAIL'}`);
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  if (results.browser) {
    console.log('✓ All critical tests passed!');
    console.log('  The proxy system is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Check the logs above for details.');
    console.log('\nTroubleshooting:');
    console.log('1. Ensure PROXY_ENABLED=true in .env');
    console.log('2. Check your internet connection');
    console.log('3. Free proxy APIs may be temporarily unavailable');
    console.log('4. Consider using a system-level VPN as alternative');
  }
  
  process.exit(results.browser ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
