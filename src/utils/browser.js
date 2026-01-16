import { chromium } from 'playwright';
import { BROWSER_CONFIG, PROXY_CONFIG } from '../config/portals.js';
import { logger } from './logger.js';
import { ProxyFinder } from './proxy-finder.js';
import { ProxyValidator } from './proxy-validator.js';
import { configureUrbanVPNPreferences } from './urban-vpn-config.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

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
    this.userDataDir = path.join(os.homedir(), '.playwright-browser-data');
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
   * Get extension paths if configured
   */
  getExtensionPaths() {
    const extensionsDir = path.join(process.cwd(), 'extensions');
    if (!fs.existsSync(extensionsDir)) {
      return [];
    }
    
    const extensions = [];
    const items = fs.readdirSync(extensionsDir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        const manifestPath = path.join(extensionsDir, item.name, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          extensions.push(path.join(extensionsDir, item.name));
        }
      }
    }
    return extensions;
  }

  /**
   * Initialize browser instance with proxy support and optional extensions
   */
  async init() {
    try {
      logger.info('Launching browser...');
      
      const extensionPaths = this.getExtensionPaths();
      const usePersistentContext = extensionPaths.length > 0 || process.env.USE_PERSISTENT_CONTEXT === 'true';
      
      // If using extension, prefer extension over proxy (unless proxy is explicitly configured)
      let proxyConfig = null;
      if (!usePersistentContext || process.env.FORCE_PROXY === 'true') {
        proxyConfig = await this.getProxyConfig();
      } else {
        // When using extension, disable proxy auto-discovery to avoid conflicts
        logger.info('Using extension for VPN - proxy auto-discovery disabled');
      }
      
      // Use persistent context if extensions are configured or explicitly requested
      if (usePersistentContext) {
        // Ensure user data directory exists
        if (!fs.existsSync(this.userDataDir)) {
          fs.mkdirSync(this.userDataDir, { recursive: true });
        }

        // Configure Urban VPN preferences to default to Singapore
        if (extensionPaths.some(p => path.basename(p).includes('urban-vpn'))) {
          logger.info('Configuring Urban VPN to default to Singapore...');
          configureUrbanVPNPreferences(this.userDataDir);
        }

        const contextOptions = {
          headless: BROWSER_CONFIG.headless,
          slowMo: BROWSER_CONFIG.slowMo,
          viewport: BROWSER_CONFIG.viewport,
          ignoreHTTPSErrors: true,
        };

        // Add extension loading args
        if (extensionPaths.length > 0) {
          contextOptions.args = [
            `--disable-extensions-except=${extensionPaths.join(',')}`,
            ...extensionPaths.map(ext => `--load-extension=${ext}`),
          ];
          logger.info(`Using persistent browser context with ${extensionPaths.length} extension(s)`);
          logger.info(`Extensions: ${extensionPaths.map(p => path.basename(p)).join(', ')}`);
        }

        // launchPersistentContext returns a BrowserContext directly
        this.context = await chromium.launchPersistentContext(this.userDataDir, contextOptions);
        // For persistent context, we don't have a separate browser object
        this.browser = null;
      } else {
        // Standard browser launch
        const launchOptions = {
          headless: BROWSER_CONFIG.headless,
          slowMo: BROWSER_CONFIG.slowMo,
        };

        this.browser = await chromium.launch(launchOptions);

        const contextOptions = {
          viewport: BROWSER_CONFIG.viewport,
          ignoreHTTPSErrors: true,
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
      }

      // Set default timeout
      this.context.setDefaultTimeout(BROWSER_CONFIG.timeout);

      // Validate proxy if configured (skip if using persistent context with extensions)
      if (proxyConfig && !usePersistentContext) {
        try {
          const validation = await this.proxyValidator.validateProxyWithBrowser(
            this.context,
            proxyConfig
          );
          
          if (!validation.valid && this.proxyRetryCount < PROXY_CONFIG.maxRetries) {
            logger.warn(`Proxy validation failed: ${validation.reason}. Retrying with different proxy...`);
            this.proxyRetryCount++;
            await this.context.close();
            if (this.browser) {
              await this.browser.close();
            }
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
      } else if (usePersistentContext && extensionPaths.length > 0) {
        logger.info('Using browser extensions for VPN/proxy.');
        // Automatically connect to Singapore if Urban VPN extension is present
        await this.autoConnectUrbanVPN();
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
   * Automatically connect Urban VPN extension to Singapore
   * Uses multiple methods to ensure connection
   */
  async autoConnectUrbanVPN() {
    try {
      const extensionPaths = this.getExtensionPaths();
      const hasUrbanVPN = extensionPaths.some(p => path.basename(p).includes('urban-vpn'));
      
      if (!hasUrbanVPN) {
        return;
      }

      logger.info('Attempting to auto-connect Urban VPN to Singapore...');
      
      const extensionId = 'eppiocemhmnlbhjplcgkofciiegomcon';
      const page = await this.context.newPage();
      
      try {
        // Method 1: Use Chrome DevTools Protocol to modify extension storage
        try {
          const cdp = await this.context.newCDPSession(page);
          
          // Try to access extension's background service worker
          const targets = await cdp.send('Target.getTargets');
          const extensionTarget = targets.targetInfos.find(
            t => t.type === 'service_worker' && t.url.includes(extensionId)
          );
          
          if (extensionTarget) {
            // Connect to extension's background context
            const extensionSession = await this.context.newCDPSession(
              await this.context.newPage()
            );
            
            // Try to set storage values for Singapore
            try {
              await extensionSession.send('Runtime.evaluate', {
                expression: `
                  (async function() {
                    try {
                      // Access chrome.storage API
                      if (typeof chrome !== 'undefined' && chrome.storage) {
                        // Set Singapore as selected country
                        await chrome.storage.local.set({
                          selectedCountry: 'SG',
                          countryCode: 'SG',
                          country: 'Singapore',
                          autoConnect: true,
                          isConnected: false
                        });
                        
                        // Trigger connection
                        if (chrome.runtime && chrome.runtime.sendMessage) {
                          chrome.runtime.sendMessage({
                            action: 'connect',
                            country: 'SG'
                          });
                        }
                        return 'success';
                      }
                      return 'chrome.storage not available';
                    } catch (e) {
                      return 'error: ' + e.message;
                    }
                  })();
                `,
                awaitPromise: true
              });
            } catch (e) {
              // Extension context might not be accessible this way
            }
          }
        } catch (e) {
          // CDP method failed, try popup method
        }
        
        // Method 2: Access extension popup and interact with it
        try {
          const popupUrl = `chrome-extension://${extensionId}/popup/index.html`;
          await page.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
          await page.waitForTimeout(2000); // Wait for popup to fully load
          
          // Take screenshot for debugging
          await page.screenshot({ path: 'screenshots/urban-vpn-popup.png', fullPage: true }).catch(() => {});
          
          // Try multiple strategies to find and select Singapore
          const strategies = [
            // Strategy 1: Look for country dropdown/select
            async () => {
              const selects = await page.locator('select').all();
              for (const select of selects) {
                try {
                  await select.selectOption({ label: /singapore/i });
                  logger.info('✓ Selected Singapore from dropdown');
                  return true;
                } catch (e) {
                  try {
                    await select.selectOption({ value: /SG|singapore/i });
                    logger.info('✓ Selected Singapore by value');
                    return true;
                  } catch (e2) {
                    continue;
                  }
                }
              }
              return false;
            },
            
            // Strategy 2: Click on Singapore text/element
            async () => {
              const singaporeSelectors = [
                'text=/singapore/i',
                '[data-country="SG"]',
                '[data-country="singapore"]',
                '[data-code="SG"]',
                'button:has-text("Singapore")',
                'div:has-text("Singapore")',
                'span:has-text("Singapore")',
                'li:has-text("Singapore")',
              ];
              
              for (const selector of singaporeSelectors) {
                try {
                  const element = page.locator(selector).first();
                  const count = await element.count();
                  if (count > 0) {
                    const isVisible = await element.isVisible({ timeout: 1000 }).catch(() => false);
                    if (isVisible) {
                      await element.click({ timeout: 2000 });
                      await page.waitForTimeout(500);
                      logger.info(`✓ Clicked Singapore element: ${selector}`);
                      return true;
                    }
                  }
                } catch (e) {
                  continue;
                }
              }
              return false;
            },
            
            // Strategy 3: Use JavaScript to find and click
            async () => {
              const result = await page.evaluate(() => {
                // Find all elements containing "Singapore"
                const elements = Array.from(document.querySelectorAll('*'));
                const singaporeEl = elements.find(el => {
                  const text = (el.textContent || '').toLowerCase();
                  return text.includes('singapore') && 
                         (el.tagName === 'BUTTON' || el.tagName === 'DIV' || 
                          el.tagName === 'LI' || el.tagName === 'SPAN' ||
                          el.onclick || el.getAttribute('role') === 'button');
                });
                
                if (singaporeEl) {
                  singaporeEl.click();
                  return true;
                }
                return false;
              });
              
              if (result) {
                logger.info('✓ Clicked Singapore via JavaScript');
                await page.waitForTimeout(500);
                return true;
              }
              return false;
            }
          ];
          
          let singaporeSelected = false;
          for (const strategy of strategies) {
            try {
              singaporeSelected = await strategy();
              if (singaporeSelected) break;
            } catch (e) {
              continue;
            }
          }
          
          // If Singapore is selected, try to connect
          if (singaporeSelected) {
            await page.waitForTimeout(1000);
            
            // Try to find and click connect button
            const connectStrategies = [
              async () => {
                const connectSelectors = [
                  'button:has-text("Connect")',
                  'button:has-text("ON")',
                  'button[aria-label*="connect" i]',
                  '.connect-button',
                  'button[type="button"]',
                  'div[role="button"]:has-text("Connect")',
                ];
                
                for (const selector of connectSelectors) {
                  try {
                    const btn = page.locator(selector).first();
                    const count = await btn.count();
                    if (count > 0 && await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
                      await btn.click({ timeout: 2000 });
                      logger.info(`✓ Clicked connect button: ${selector}`);
                      return true;
                    }
                  } catch (e) {
                    continue;
                  }
                }
                return false;
              },
              
              async () => {
                // Try JavaScript to find connect button
                const connected = await page.evaluate(() => {
                  const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                  const connectBtn = buttons.find(btn => {
                    const text = (btn.textContent || '').toLowerCase();
                    return text.includes('connect') || text.includes('on') || 
                           btn.getAttribute('aria-label')?.toLowerCase().includes('connect');
                  });
                  
                  if (connectBtn) {
                    connectBtn.click();
                    return true;
                  }
                  return false;
                });
                
                if (connected) {
                  logger.info('✓ Clicked connect via JavaScript');
                  return true;
                }
                return false;
              }
            ];
            
            for (const strategy of connectStrategies) {
              try {
                const connected = await strategy();
                if (connected) {
                  await page.waitForTimeout(3000); // Wait for connection to establish
                  break;
                }
              } catch (e) {
                continue;
              }
            }
          }
          
        } catch (error) {
          logger.warn('Could not access extension popup:', error.message);
        }
        
      } finally {
        await page.close();
      }
      
      // Wait for connection to establish
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verify connection
      const isConnected = await this.verifySingaporeConnection();
      
      if (!isConnected) {
        logger.warn('⚠ Could not verify Singapore connection. Extension may need manual configuration.');
        logger.warn('Please ensure Urban VPN is set to connect to Singapore automatically.');
      }
      
    } catch (error) {
      logger.warn('Auto-connect Urban VPN failed:', error.message);
      logger.warn('Extension may need manual configuration on first run.');
    }
  }

  /**
   * Verify that we're connected to Singapore
   */
  async verifySingaporeConnection() {
    try {
      const page = await this.context.newPage();
      try {
        await page.goto('https://ipinfo.io/json', { waitUntil: 'networkidle', timeout: 10000 });
        await page.waitForTimeout(1000);
        
        const content = await page.content();
        const jsonMatch = content.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
        
        if (jsonMatch) {
          const ipInfo = JSON.parse(jsonMatch[1]);
          if (ipInfo.country === 'SG') {
            logger.info(`✓ Verified: Connected to Singapore (IP: ${ipInfo.ip})`);
            await page.close();
            return true;
          } else {
            logger.warn(`⚠ IP is from ${ipInfo.country}, not Singapore. Extension may need manual configuration.`);
          }
        }
      } catch (e) {
        // IP check failed, but that's okay
      } finally {
        await page.close();
      }
    } catch (error) {
      // Verification failed, but continue anyway
    }
    return false;
  }

  /**
   * Create a new page
   */
  async newPage() {
    if (!this.context) {
      await this.init();
    }
    return await this.context.newPage();
  }

  /**
   * Create a new isolated browser context (useful when one portal enforces single-tab rules)
   */
  async newContext() {
    // If using persistent context, we can't create new contexts, return the existing one
    if (!this.browser && this.context) {
      return this.context;
    }
    
    if (!this.browser) {
      await this.init();
    }
    
    // If still no browser (persistent context), return existing context
    if (!this.browser) {
      return this.context;
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
    if (this.context) {
      await this.context.close();
      logger.info('Browser closed');
    }
    if (this.browser) {
      await this.browser.close();
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

