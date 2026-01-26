import { chromium } from 'playwright';
import { BROWSER_CONFIG, PROXY_CONFIG } from '../config/portals.js';
import { logger } from './logger.js';
import { ProxyFinder } from './proxy-finder.js';
import { ProxyValidator } from './proxy-validator.js';

/**
 * Browser manager for creating and managing browser instances
 */
export class BrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
    this.extraContexts = [];
    this.proxyFinder = new ProxyFinder();
    this.proxyValidator = new ProxyValidator();
    this.currentProxy = null;
    this.proxyRetryCount = 0;
  }

  /**
   * Get proxy configuration
   */
  async getProxyConfig() {
    // If proxy is explicitly disabled, return null
    if (!PROXY_CONFIG.enabled) {
      return null;
    }

    // If proxy server is manually configured, use it
    if (PROXY_CONFIG.server) {
      logger.info(`Using manually configured proxy: ${PROXY_CONFIG.server}`);
      return {
        server: PROXY_CONFIG.server,
        username: PROXY_CONFIG.username || undefined,
        password: PROXY_CONFIG.password || undefined,
      };
    }

    // Auto-discover proxy if enabled
    if (PROXY_CONFIG.autoDiscover) {
      try {
        logger.info('Auto-discovering free Singapore proxies...');
        const proxy = await this.proxyFinder.getRandomProxy();
        if (proxy) {
          logger.info(`Using auto-discovered proxy: ${proxy.server} (from ${proxy.source})`);
          this.currentProxy = proxy;
          return {
            server: proxy.server,
          };
        } else {
          logger.warn('No Singapore proxies found via auto-discovery');
          logger.warn('Consider:');
          logger.warn('1. Using a system-level VPN (Falcon VPN, VeePN) and set PROXY_ENABLED=false');
          logger.warn('2. Manually configuring a proxy server in .env (PROXY_SERVER=...)');
          logger.warn('3. Retrying later (free proxy lists may be temporarily unavailable)');
        }
      } catch (error) {
        logger.warn('Proxy auto-discovery failed:', error.message);
        logger.warn('Falling back to direct connection (may fail if Singapore IP required)');
      }
    }

    return null;
  }

  /**
   * Initialize browser instance with proxy support
   */
  async init() {
    try {
      logger.info('Launching browser...');
      
      const proxyConfig = await this.getProxyConfig();
      
      // Check if we should use headed mode (for debugging/review via VNC)
      // Use headed mode if:
      // 1. USE_HEADED_BROWSER is explicitly set to true
      // 2. DISPLAY environment variable is set (VNC/X11 available)
      // 3. BROWSER_CONFIG.headless is explicitly false
      const hasDisplay = !!process.env.DISPLAY;
      const useHeaded = process.env.USE_HEADED_BROWSER === 'true' || 
                       process.env.USE_HEADED_BROWSER === '1' ||
                       BROWSER_CONFIG.headless === false ||
                       hasDisplay; // Auto-enable if DISPLAY is set
      
      const launchOptions = {
        headless: !useHeaded, // Use headed if requested or DISPLAY available
        slowMo: BROWSER_CONFIG.slowMo,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          // AGGRESSIVE: Disable ALL external protocol dialog prompts
          '--disable-features=ExternalProtocolDialog',
          '--block-new-web-contents',
          '--no-default-browser-check',
          '--disable-default-apps',
          '--disable-client-side-phishing-detection',
          '--disable-component-update',
          '--disable-hang-monitor',
          '--disable-popup-blocking',
          '--disable-prompt-on-repost',
          '--disable-sync',
          '--disable-translate',
          '--metrics-recording-only',
          '--no-first-run',
          '--safebrowsing-disable-auto-update',
        ],
      };

      // Add display if VNC/X11 is available
      if (hasDisplay) {
        launchOptions.args.push(`--display=${process.env.DISPLAY}`);
        logger.info(`Browser will use display: ${process.env.DISPLAY}`);
        // Force headed mode when DISPLAY is set
        launchOptions.headless = false;
      } else if (!useHeaded) {
        // If no display and not explicitly requested, use headless
        launchOptions.headless = true;
      }
      
      // Log the final headless setting
      logger.info(`Browser launch mode: ${launchOptions.headless ? 'HEADLESS' : 'HEADED'} (useHeaded=${useHeaded}, hasDisplay=${hasDisplay}, DISPLAY=${process.env.DISPLAY})`);

      this.browser = await chromium.launch(launchOptions);

      const contextOptions = {
        viewport: BROWSER_CONFIG.viewport,
        ignoreHTTPSErrors: true, // Important for self-signed certificates
        // AGGRESSIVE: Deny all permissions to prevent any dialogs
        permissions: [],
        bypassCSP: true,
      };

      // Add proxy configuration if available
      if (proxyConfig) {
        contextOptions.proxy = {
          server: proxyConfig.server,
        };
        
        if (proxyConfig.username && proxyConfig.password) {
          contextOptions.proxy.username = proxyConfig.username;
          contextOptions.proxy.password = proxyConfig.password;
        }

        // Add bypass rules
        if (PROXY_CONFIG.bypass && PROXY_CONFIG.bypass.length > 0) {
          contextOptions.proxy.bypass = PROXY_CONFIG.bypass.join(',');
        }

        logger.info(`Browser context configured with proxy: ${proxyConfig.server}`);
      }

      this.context = await this.browser.newContext(contextOptions);

      // Set default timeout
      this.context.setDefaultTimeout(BROWSER_CONFIG.timeout);

      // Validate proxy if configured
      if (proxyConfig) {
        try {
          const validation = await this.proxyValidator.validateProxyWithBrowser(
            this.context,
            proxyConfig
          );
          
          if (!validation.valid && this.proxyRetryCount < PROXY_CONFIG.maxRetries) {
            logger.warn(`Proxy validation failed: ${validation.reason}. Retrying with different proxy...`);
            this.proxyRetryCount++;
            await this.context.close();
            await this.browser.close();
            // Clear current proxy and retry
            this.currentProxy = null;
            this.proxyFinder.clearCache();
            return await this.init();
          } else if (!validation.valid) {
            logger.error(`Proxy validation failed after ${this.proxyRetryCount} retries: ${validation.reason}`);
            logger.error('Consider using a system-level VPN or manually configuring a proxy in .env');
          }
        } catch (error) {
          logger.warn('Proxy validation error (continuing anyway):', error.message);
        }
      }

      logger.info('Browser launched successfully');
      return this.context;
    } catch (error) {
      logger.error('Failed to launch browser:', error);
      
      // If proxy-related error, provide helpful message
      if (error.message.includes('proxy') || error.message.includes('PROXY')) {
        logger.error('\n=== Proxy Configuration Help ===');
        logger.error('If you\'re having proxy issues, try:');
        logger.error('1. Set PROXY_ENABLED=false in .env to disable proxy');
        logger.error('2. Use a system-level VPN (Falcon VPN, VeePN) and set PROXY_ENABLED=false');
        logger.error('3. Manually configure a proxy: PROXY_SERVER=http://proxy.example.com:8080');
        logger.error('================================\n');
      }
      
      throw error;
    }
  }

  /**
   * Create a new page
   */
  async newPage() {
    if (!this.context) {
      await this.init();
    }
    const page = await this.context.newPage();
    // Set viewport size to ensure proper page rendering
    await page.setViewportSize({ width: 1920, height: 1080 });
    return page;
  }

  /**
   * Create a new isolated browser context (useful when one portal enforces single-tab rules)
   */
  async newContext() {
    if (!this.browser) {
      await this.init();
    }
    
    const contextOptions = {
      viewport: BROWSER_CONFIG.viewport,
      ignoreHTTPSErrors: true,
    };

    // Use same proxy configuration if available
    const proxyConfig = await this.getProxyConfig();
    if (proxyConfig) {
      contextOptions.proxy = {
        server: proxyConfig.server,
      };
      
      if (proxyConfig.username && proxyConfig.password) {
        contextOptions.proxy.username = proxyConfig.username;
        contextOptions.proxy.password = proxyConfig.password;
      }

      if (PROXY_CONFIG.bypass && PROXY_CONFIG.bypass.length > 0) {
        contextOptions.proxy.bypass = PROXY_CONFIG.bypass.join(',');
      }
    }

    const ctx = await this.browser.newContext(contextOptions);
    ctx.setDefaultTimeout(BROWSER_CONFIG.timeout);
    this.extraContexts.push(ctx);
    return ctx;
  }

  /**
   * Create a new page in a fresh isolated context.
   */
  async newIsolatedPage() {
    const ctx = await this.newContext();
    return await ctx.newPage();
  }

  /**
   * Close browser
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      logger.info('Browser closed');
    }
  }

  /**
   * Take screenshot for debugging
   */
  async screenshot(page, filename) {
    try {
      await page.screenshot({ path: `screenshots/${filename}`, fullPage: true });
      logger.info(`Screenshot saved: ${filename}`);
    } catch (error) {
      logger.error('Failed to take screenshot:', error);
    }
  }
}

