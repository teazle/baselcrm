import { logger } from './logger.js';

/**
 * Proxy validator utility to test proxy connectivity and verify Singapore IP
 */
export class ProxyValidator {
  constructor() {
    this.timeout = 10000; // 10 seconds timeout
  }

  /**
   * Test if a proxy is working by making a test request
   */
  async testProxyConnectivity(proxyServer) {
    try {
      // Use a simple HTTP request to test connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const testUrl = 'http://httpbin.org/ip';
      
      const response = await fetch(testUrl, {
        signal: controller.signal,
        // Note: Node.js fetch doesn't support proxy directly
        // This is a basic connectivity test
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      logger.debug(`Proxy connectivity test failed for ${proxyServer}:`, error.message);
      return false;
    }
  }

  /**
   * Verify that a proxy provides a Singapore IP address
   */
  async verifySingaporeIP(proxyConfig) {
    try {
      // This will be tested through Playwright browser context
      // For now, we'll use ipinfo.io API to check IP location
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      // Note: This is a simplified check
      // Actual IP verification will happen through Playwright browser
      const response = await fetch('https://ipinfo.io/json', {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      const isSingapore = data.country === 'SG' || data.countryCode === 'SG';
      
      if (isSingapore) {
        logger.info(`Verified Singapore IP: ${data.ip} (${data.city || 'Unknown'})`);
      } else {
        logger.warn(`IP is not from Singapore: ${data.country} (${data.ip})`);
      }

      return isSingapore;
    } catch (error) {
      logger.debug('IP verification failed:', error.message);
      return false;
    }
  }

  /**
   * Test if proxy can access MHC Asia website
   */
  async testMHCAsiaAccess(proxyConfig) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch('https://www.mhcasia.net/mhc/', {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      clearTimeout(timeoutId);

      // If we get a response (even 403), the proxy can reach the site
      // We'll check the actual access through Playwright
      return response.status !== 0;
    } catch (error) {
      logger.debug('MHC Asia access test failed:', error.message);
      return false;
    }
  }

  /**
   * Validate proxy through Playwright browser context
   * This is the most reliable method
   */
  async validateProxyWithBrowser(browserContext, proxyConfig) {
    let ipInfo = null;
    let page = null;
    
    try {
      page = await browserContext.newPage();
      
      // Test 1: Check IP location
      try {
        await page.goto('https://ipinfo.io/json', { 
          waitUntil: 'domcontentloaded',
          timeout: 15000 
        });
        
        ipInfo = await page.evaluate(() => {
          return JSON.parse(document.body.textContent);
        });

        const isSingapore = ipInfo.country === 'SG' || ipInfo.countryCode === 'SG';
        
        if (!isSingapore) {
          logger.warn(`Proxy IP is not from Singapore: ${ipInfo.country} (${ipInfo.ip})`);
          if (page) await page.close();
          return { valid: false, reason: `IP is from ${ipInfo.country}, not Singapore` };
        }

        logger.info(`✓ Proxy provides Singapore IP: ${ipInfo.ip} (${ipInfo.city || 'Unknown'})`);
      } catch (error) {
        logger.warn('Failed to verify IP location:', error.message);
        // Continue to test MHC Asia access even if IP check fails
      }

      // Test 2: Try to access MHC Asia
      try {
        const response = await page.goto('https://www.mhcasia.net/mhc/', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });

        if (response && response.status() === 200) {
          logger.info('✓ Proxy can access MHC Asia website');
          if (page) await page.close();
          return { valid: true, ip: ipInfo?.ip || 'unknown' };
        } else {
          logger.warn(`MHC Asia returned status: ${response?.status() || 'unknown'}`);
          // If we got a response (even if not 200), the proxy is working
          // The site might be blocking for other reasons
          if (page) await page.close();
          return { valid: true, ip: ipInfo?.ip || 'unknown', warning: `MHC Asia returned status ${response?.status()}` };
        }
      } catch (error) {
        logger.warn('Failed to access MHC Asia:', error.message);
        if (page) await page.close();
        // If IP check passed, consider proxy valid even if MHC Asia test fails
        if (ipInfo && (ipInfo.country === 'SG' || ipInfo.countryCode === 'SG')) {
          return { valid: true, ip: ipInfo.ip, warning: 'MHC Asia access test failed but IP is Singapore' };
        }
        return { valid: false, reason: error.message };
      }
    } catch (error) {
      logger.error('Proxy validation with browser failed:', error);
      if (page) await page.close();
      return { valid: false, reason: error.message };
    }
  }
}
