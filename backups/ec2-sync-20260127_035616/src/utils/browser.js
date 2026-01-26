import { chromium } from 'playwright';
import { BROWSER_CONFIG, PROXY_CONFIG } from '../config/portals.js';
import { logger } from './logger.js';
import { ProxyFinder } from './proxy-finder.js';
import { ProxyValidator } from './proxy-validator.js';

const EXTERNAL_PROTOCOL_GUARD_SCRIPT = `
(() => {
  const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'data:', 'about:', 'blob:', 'javascript:']);
  const URL_ATTRS = new Set(['href', 'src', 'action', 'data', 'poster']);

  const isAllowed = (url) => {
    if (!url) return true;
    try {
      const resolved = new URL(url, window.location.href);
      return ALLOWED_PROTOCOLS.has(resolved.protocol);
    } catch (e) {
      return true;
    }
  };

  const shouldBlock = (url) => !isAllowed(url);

  const warn = (method, url) => {
    try {
      console.warn(\`[automation] blocked \${method} external protocol\`, url);
    } catch (e) {
      // ignore
    }
  };

  const sanitizeAnchor = (anchor) => {
    if (!anchor || !anchor.getAttribute) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    try {
      const resolved = new URL(href, window.location.href);
      if (!ALLOWED_PROTOCOLS.has(resolved.protocol)) {
        warn('anchor.sanitize', href);
        anchor.setAttribute('data-blocked-href', href);
        anchor.setAttribute('href', '#');
      }
    } catch (e) {
      // ignore
    }
  };

  const sanitizeForm = (form) => {
    if (!form || !form.getAttribute) return;
    const action = form.getAttribute('action');
    if (!action) return;
    try {
      const resolved = new URL(action, window.location.href);
      if (!ALLOWED_PROTOCOLS.has(resolved.protocol)) {
        warn('form.sanitize', action);
        form.setAttribute('data-blocked-action', action);
        form.setAttribute('action', '#');
      }
    } catch (e) {
      // ignore
    }
  };

  const sanitizeElementAttr = (el, attr, value) => {
    if (!URL_ATTRS.has(attr)) return false;
    if (!value) return false;
    if (shouldBlock(value)) {
      warn('element.setAttribute', value);
      el.setAttribute('data-blocked-attr', attr);
      el.setAttribute('data-blocked-value', value);
      if (attr === 'href' || attr === 'action') {
        el.setAttribute(attr, '#');
      } else {
        el.setAttribute(attr, 'about:blank');
      }
      return true;
    }
    return false;
  };

  const sanitizeTree = (root) => {
    if (!root || !root.querySelectorAll) return;
    const anchors = root.querySelectorAll('a[href]');
    for (const anchor of anchors) sanitizeAnchor(anchor);
    const forms = root.querySelectorAll('form[action]');
    for (const form of forms) sanitizeForm(form);
  };

  const originalOpen = window.open;
  window.open = function(url, ...args) {
    if (shouldBlock(url)) {
      warn('window.open', url);
      return null;
    }
    return originalOpen.call(window, url, ...args);
  };

  const originalAssign = Location.prototype.assign;
  Location.prototype.assign = function(url) {
    if (shouldBlock(url)) {
      warn('location.assign', url);
      return;
    }
    return originalAssign.call(this, url);
  };

  const originalReplace = Location.prototype.replace;
  Location.prototype.replace = function(url) {
    if (shouldBlock(url)) {
      warn('location.replace', url);
      return;
    }
    return originalReplace.call(this, url);
  };

  const hrefDescriptor = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
  if (hrefDescriptor && hrefDescriptor.set) {
    Object.defineProperty(Location.prototype, 'href', {
      configurable: true,
      get: hrefDescriptor.get,
      set: function(url) {
        if (shouldBlock(url)) {
          warn('location.href', url);
          return;
        }
        return hrefDescriptor.set.call(this, url);
      },
    });
  }

  const overrideHref = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href');
  if (overrideHref && overrideHref.set) {
    Object.defineProperty(HTMLAnchorElement.prototype, 'href', {
      configurable: true,
      get: overrideHref.get,
      set: function(url) {
        if (shouldBlock(url)) {
          warn('anchor.href', url);
          this.setAttribute('data-blocked-href', url);
          this.setAttribute('href', '#');
          return;
        }
        return overrideHref.set.call(this, url);
      },
    });
  }

  const overrideAction = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'action');
  if (overrideAction && overrideAction.set) {
    Object.defineProperty(HTMLFormElement.prototype, 'action', {
      configurable: true,
      get: overrideAction.get,
      set: function(url) {
        if (shouldBlock(url)) {
          warn('form.action', url);
          this.setAttribute('data-blocked-action', url);
          this.setAttribute('action', '#');
          return;
        }
        return overrideAction.set.call(this, url);
      },
    });
  }

  const overrideSrc = (proto, label) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'src');
    if (!descriptor || !descriptor.set) return;
    Object.defineProperty(proto, 'src', {
      configurable: true,
      get: descriptor.get,
      set: function(url) {
        if (shouldBlock(url)) {
          warn(label, url);
          this.setAttribute('data-blocked-src', url);
          this.setAttribute('src', 'about:blank');
          return;
        }
        return descriptor.set.call(this, url);
      },
    });
  };

  const overrideHrefAttr = (proto, label) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'href');
    if (!descriptor || !descriptor.set) return;
    Object.defineProperty(proto, 'href', {
      configurable: true,
      get: descriptor.get,
      set: function(url) {
        if (shouldBlock(url)) {
          warn(label, url);
          this.setAttribute('data-blocked-href', url);
          this.setAttribute('href', '#');
          return;
        }
        return descriptor.set.call(this, url);
      },
    });
  };

  const overrideData = (proto, label) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'data');
    if (!descriptor || !descriptor.set) return;
    Object.defineProperty(proto, 'data', {
      configurable: true,
      get: descriptor.get,
      set: function(url) {
        if (shouldBlock(url)) {
          warn(label, url);
          this.setAttribute('data-blocked-data', url);
          this.setAttribute('data', 'about:blank');
          return;
        }
        return descriptor.set.call(this, url);
      },
    });
  };

  const overridePoster = (proto, label) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'poster');
    if (!descriptor || !descriptor.set) return;
    Object.defineProperty(proto, 'poster', {
      configurable: true,
      get: descriptor.get,
      set: function(url) {
        if (shouldBlock(url)) {
          warn(label, url);
          this.setAttribute('data-blocked-poster', url);
          this.setAttribute('poster', 'about:blank');
          return;
        }
        return descriptor.set.call(this, url);
      },
    });
  };

  overrideSrc(HTMLIFrameElement.prototype, 'iframe.src');
  overrideSrc(HTMLImageElement.prototype, 'img.src');
  overrideSrc(HTMLScriptElement.prototype, 'script.src');
  overrideSrc(HTMLEmbedElement.prototype, 'embed.src');
  overrideSrc(HTMLSourceElement.prototype, 'source.src');
  overrideSrc(HTMLTrackElement.prototype, 'track.src');
  overrideHrefAttr(HTMLLinkElement.prototype, 'link.href');
  overrideData(HTMLObjectElement.prototype, 'object.data');
  overridePoster(HTMLVideoElement.prototype, 'video.poster');

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    const attr = String(name || '').toLowerCase();
    if (sanitizeElementAttr(this, attr, value)) return;
    return originalSetAttribute.call(this, name, value);
  };

  const guardLink = (event) => {
    const target = event.target;
    const anchor = target && target.closest ? target.closest('a') : null;
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    try {
      const resolved = new URL(href, window.location.href);
      if (!ALLOWED_PROTOCOLS.has(resolved.protocol)) {
        warn('anchor.click', href);
        event.preventDefault();
        event.stopImmediatePropagation();
        sanitizeAnchor(anchor);
      }
    } catch (e) {
      // ignore
    }
  };

  document.addEventListener('click', guardLink, true);
  document.addEventListener('auxclick', guardLink, true);

  const guardForm = (event) => {
    const form = event.target;
    if (!form || !form.action) return;
    try {
      const resolved = new URL(form.action, window.location.href);
      if (!ALLOWED_PROTOCOLS.has(resolved.protocol)) {
        warn('form.submit', form.action);
        event.preventDefault();
        event.stopImmediatePropagation();
        sanitizeForm(form);
      }
    } catch (e) {
      // ignore
    }
  };

  document.addEventListener('submit', guardForm, true);

  if (navigator && typeof navigator.registerProtocolHandler === 'function') {
    navigator.registerProtocolHandler = () => {
      warn('navigator.registerProtocolHandler', '');
    };
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          sanitizeTree(node);
        }
      } else if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (target && target.tagName === 'A' && mutation.attributeName === 'href') {
          sanitizeAnchor(target);
        } else if (target && target.tagName === 'FORM' && mutation.attributeName === 'action') {
          sanitizeForm(target);
        }
      }
    }
  });

  const startObserver = () => {
    try {
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'action'],
      });
    } catch (e) {
      // ignore
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      sanitizeTree(document);
      startObserver();
    });
  } else {
    sanitizeTree(document);
    startObserver();
  }
})();
`;

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

  async _applyExternalProtocolGuard(context) {
    try {
      await context.addInitScript(EXTERNAL_PROTOCOL_GUARD_SCRIPT);
      logger.info('Applied external protocol guard script');
    } catch (error) {
      logger.warn('Failed to apply external protocol guard script:', error.message);
    }
  }

  async _applyExternalProtocolRoute(context) {
    try {
      await context.route('**/*', (route) => {
        const url = route.request().url();
        try {
          const resolved = new URL(url);
          const protocol = resolved.protocol;
          if (!['http:', 'https:', 'data:', 'about:', 'blob:'].includes(protocol)) {
            logger.warn(`[Route Block] Blocking external protocol request: ${url}`);
            route.abort();
            return;
          }
        } catch (e) {
          // If URL parsing fails, let it continue.
        }
        route.continue();
      });
      logger.info('Applied external protocol route guard');
    } catch (error) {
      logger.warn('Failed to apply external protocol route guard:', error.message);
    }
  }

  _attachPageDiagnostics(page) {
    try {
      page.on('console', (msg) => {
        const text = msg.text();
        if (text && text.includes('[automation] blocked')) {
          logger.warn(`[Page Console] ${text}`);
        }
      });
    } catch (error) {
      logger.warn('Failed to attach page diagnostics:', error.message);
    }
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
          '--no-default-browser-check',
          '--disable-default-apps',
          '--no-first-run',
          '--disable-external-intent-requests', // Disable external protocol dialogs
          '--disable-features=ExternalProtocolDialog,ExternalProtocolDialogShowAlwaysOpenCheckbox,IntentPicker', // Disable external protocol dialogs
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
      await this._applyExternalProtocolGuard(this.context);
      await this._applyExternalProtocolRoute(this.context);

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
    this._attachPageDiagnostics(page);
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
    await this._applyExternalProtocolGuard(ctx);
    await this._applyExternalProtocolRoute(ctx);
    ctx.setDefaultTimeout(BROWSER_CONFIG.timeout);
    this.extraContexts.push(ctx);
    return ctx;
  }

  /**
   * Create a new page in a fresh isolated context.
   */
  async newIsolatedPage() {
    const ctx = await this.newContext();
    const page = await ctx.newPage();
    this._attachPageDiagnostics(page);
    return page;
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
