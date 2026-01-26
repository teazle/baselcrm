#!/usr/bin/env node

/**
 * Test script to verify access to mhcasia.net using Singapore proxy
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { logger } from '../utils/logger.js';
import { PORTALS } from '../config/portals.js';

dotenv.config();

async function checkIPLocation(page) {
  try {
    logger.info('Checking IP location...');
    
    // Navigate to an IP checking service
    await page.goto('https://ipinfo.io/json', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    
    const content = await page.content();
    const jsonMatch = content.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
    
    if (jsonMatch) {
      try {
        const ipInfo = JSON.parse(jsonMatch[1]);
        logger.info('IP Location Information:');
        logger.info(`  IP: ${ipInfo.ip || 'Unknown'}`);
        logger.info(`  Country: ${ipInfo.country || 'Unknown'} (${ipInfo.country_name || 'Unknown'})`);
        logger.info(`  Region: ${ipInfo.region || 'Unknown'}`);
        logger.info(`  City: ${ipInfo.city || 'Unknown'}`);
        
        if (ipInfo.country === 'SG') {
          logger.info('✓ IP is from Singapore - Proxy is working!');
          return true;
        } else {
          logger.warn(`⚠ IP is from ${ipInfo.country || 'Unknown'} - Proxy may not be working correctly`);
          return false;
        }
      } catch (e) {
        logger.warn('Could not parse IP info JSON');
      }
    }
    
    return false;
  } catch (error) {
    logger.warn('Could not check IP location:', error.message);
    return false;
  }
}

async function testMHCAsiaAccess() {
  const browserManager = new BrowserManager();
  let page = null;

  try {
    logger.info('=== Testing MHC Asia Access with Singapore Proxy ===\n');

    // Initialize browser (will auto-discover Singapore proxy)
    const context = await browserManager.init();
    page = await context.newPage();

    // Check IP location first
    logger.info('Step 1: Checking IP location...\n');
    const isSingapore = await checkIPLocation(page);
    
    if (!isSingapore) {
      logger.warn('\n⚠ Warning: IP does not appear to be from Singapore.');
      logger.warn('Proxy may not be working. Continuing with access test anyway...\n');
    }

    // Test access to mhcasia.net
    logger.info('Step 2: Testing access to mhcasia.net...\n');
    const mhcAsiaUrl = PORTALS.MHC_ASIA.url;
    logger.info(`Navigating to: ${mhcAsiaUrl}`);

    try {
      await page.goto(mhcAsiaUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 45000 
      });

      await page.waitForTimeout(3000); // Wait for page to fully load

      const title = await page.title();
      const url = page.url();

      logger.info(`✓ Successfully accessed mhcasia.net`);
      logger.info(`  Page title: ${title}`);
      logger.info(`  Current URL: ${url}`);

      // Take a screenshot
      const screenshotPath = 'screenshots/mhcasia-proxy-test.png';
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.info(`  Screenshot saved: ${screenshotPath}`);

      // Check for common error messages
      const pageText = await page.textContent('body');
      const errorIndicators = [
        'access denied',
        'blocked',
        'forbidden',
        'not available',
        'geo-restricted',
      ];

      const hasError = errorIndicators.some(indicator => 
        pageText.toLowerCase().includes(indicator)
      );

      if (hasError) {
        logger.warn('⚠ Page may be showing an error message. Check the screenshot.');
      } else {
        logger.info('✓ Page appears to be accessible');
      }

      // Check if login form is present
      const loginForm = await page.locator('input[type="text"], input[name*="user"], input[name*="login"]').count();
      if (loginForm > 0) {
        logger.info('✓ Login form detected - site is accessible');
        logger.info('\n=== Test Complete ===');
        logger.info('✓ Proxy is working correctly!');
        logger.info('✓ You can now use the automation with Singapore proxy enabled.\n');
      } else {
        logger.warn('⚠ Login form not detected. Check the screenshot to verify page loaded correctly.');
      }

    } catch (error) {
      logger.error('✗ Failed to access mhcasia.net:', error.message);
      logger.error('\nPossible issues:');
      logger.error('1. Proxy not connected to Singapore');
      logger.error('2. Site is blocking automated browsers');
      logger.error('3. Network connectivity issues');
      logger.error('4. Proxy server is down or slow');
      
      // Take error screenshot
      try {
        await page.screenshot({ path: 'screenshots/mhcasia-proxy-error.png', fullPage: true });
        logger.info('Error screenshot saved: screenshots/mhcasia-proxy-error.png');
      } catch (e) {
        // Ignore screenshot errors
      }
      
      throw error;
    }

  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  } finally {
    if (page) {
      await page.close();
    }
    await browserManager.close();
  }
}

// Run the test
testMHCAsiaAccess().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
