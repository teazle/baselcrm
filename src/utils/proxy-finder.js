import { logger } from './logger.js';

/**
 * Free proxy finder utility for discovering Singapore proxies from public APIs
 */
export class ProxyFinder {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Fetch proxies from GeoNix API
   */
  async fetchFromGeoNix() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch('https://free.geonix.com/api/proxies?country=SG&type=http,https', {
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`GeoNix API returned ${response.status}`);
      }
      
      const data = await response.json();
      const proxies = [];
      
      if (Array.isArray(data)) {
        for (const proxy of data) {
          if (proxy.ip && proxy.port && (proxy.country === 'SG' || proxy.country_code === 'SG')) {
            proxies.push({
              server: `http://${proxy.ip}:${proxy.port}`,
              source: 'geonix',
            });
          }
        }
      } else if (data.proxies && Array.isArray(data.proxies)) {
        // Handle different API response format
        for (const proxy of data.proxies) {
          if (proxy.ip && proxy.port && (proxy.country === 'SG' || proxy.country_code === 'SG')) {
            proxies.push({
              server: `http://${proxy.ip}:${proxy.port}`,
              source: 'geonix',
            });
          }
        }
      }
      
      return proxies;
    } catch (error) {
      if (error.name !== 'AbortError') {
        logger.warn('Failed to fetch proxies from GeoNix:', error.message);
      }
      return [];
    }
  }

  /**
   * Fetch proxies from Proxy5 API
   */
  async fetchFromProxy5() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch('https://proxy5.net/api/proxy?country=SG&type=http,https', {
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Proxy5 API returned ${response.status}`);
      }
      
      const data = await response.json();
      const proxies = [];
      
      if (data.proxies && Array.isArray(data.proxies)) {
        for (const proxy of data.proxies) {
          if ((proxy.host || proxy.ip) && proxy.port && (proxy.country === 'SG' || proxy.country_code === 'SG')) {
            const host = proxy.host || proxy.ip;
            proxies.push({
              server: `http://${host}:${proxy.port}`,
              source: 'proxy5',
            });
          }
        }
      } else if (Array.isArray(data)) {
        // Handle array response format
        for (const proxy of data) {
          if ((proxy.host || proxy.ip) && proxy.port && (proxy.country === 'SG' || proxy.country_code === 'SG')) {
            const host = proxy.host || proxy.ip;
            proxies.push({
              server: `http://${host}:${proxy.port}`,
              source: 'proxy5',
            });
          }
        }
      }
      
      return proxies;
    } catch (error) {
      if (error.name !== 'AbortError') {
        logger.warn('Failed to fetch proxies from Proxy5:', error.message);
      }
      return [];
    }
  }

  /**
   * Fetch proxies from ProxyFreeOnly API
   */
  async fetchFromProxyFreeOnly() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch('https://api.proxyfreeonly.com/v1/proxies?country=SG&type=http,https', {
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`ProxyFreeOnly API returned ${response.status}`);
      }
      
      const data = await response.json();
      const proxies = [];
      
      if (data.data && Array.isArray(data.data)) {
        for (const proxy of data.data) {
          if (proxy.ip && proxy.port && (proxy.country_code === 'SG' || proxy.country === 'SG')) {
            proxies.push({
              server: `http://${proxy.ip}:${proxy.port}`,
              source: 'proxyfreeonly',
            });
          }
        }
      } else if (Array.isArray(data)) {
        // Handle direct array response
        for (const proxy of data) {
          if (proxy.ip && proxy.port && (proxy.country_code === 'SG' || proxy.country === 'SG')) {
            proxies.push({
              server: `http://${proxy.ip}:${proxy.port}`,
              source: 'proxyfreeonly',
            });
          }
        }
      }
      
      return proxies;
    } catch (error) {
      if (error.name !== 'AbortError') {
        logger.warn('Failed to fetch proxies from ProxyFreeOnly:', error.message);
      }
      return [];
    }
  }

  /**
   * Fetch proxies from Proxify API
   */
  async fetchFromProxify() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch('https://api.proxify.io/proxies?country=SG&protocol=http,https', {
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Proxify API returned ${response.status}`);
      }
      
      const data = await response.json();
      const proxies = [];
      
      if (Array.isArray(data)) {
        for (const proxy of data) {
          if ((proxy.host || proxy.ip) && proxy.port && (proxy.country === 'SG' || proxy.country_code === 'SG')) {
            const host = proxy.host || proxy.ip;
            proxies.push({
              server: `http://${host}:${proxy.port}`,
              source: 'proxify',
            });
          }
        }
      } else if (data.proxies && Array.isArray(data.proxies)) {
        // Handle object with proxies array
        for (const proxy of data.proxies) {
          if ((proxy.host || proxy.ip) && proxy.port && (proxy.country === 'SG' || proxy.country_code === 'SG')) {
            const host = proxy.host || proxy.ip;
            proxies.push({
              server: `http://${host}:${proxy.port}`,
              source: 'proxify',
            });
          }
        }
      }
      
      return proxies;
    } catch (error) {
      if (error.name !== 'AbortError') {
        logger.warn('Failed to fetch proxies from Proxify:', error.message);
      }
      return [];
    }
  }

  /**
   * Fetch proxies from ProxyProvider.net API
   */
  async fetchFromProxyProvider() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch('https://api.proxyprovider.net/api/proxies?country=SG&type=http,https', {
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`ProxyProvider API returned ${response.status}`);
      }
      
      const data = await response.json();
      const proxies = [];
      
      if (Array.isArray(data)) {
        for (const proxy of data) {
          if ((proxy.ip || proxy.host) && proxy.port && (proxy.country === 'SG' || proxy.countryCode === 'SG')) {
            const host = proxy.ip || proxy.host;
            proxies.push({
              server: `http://${host}:${proxy.port}`,
              source: 'proxyprovider',
            });
          }
        }
      } else if (data.proxies && Array.isArray(data.proxies)) {
        for (const proxy of data.proxies) {
          if ((proxy.ip || proxy.host) && proxy.port && (proxy.country === 'SG' || proxy.countryCode === 'SG')) {
            const host = proxy.ip || proxy.host;
            proxies.push({
              server: `http://${host}:${proxy.port}`,
              source: 'proxyprovider',
            });
          }
        }
      }
      
      return proxies;
    } catch (error) {
      if (error.name !== 'AbortError') {
        logger.warn('Failed to fetch proxies from ProxyProvider:', error.message);
      }
      return [];
    }
  }

  /**
   * Fetch proxies from FreeProxyListing.com API
   */
  async fetchFromFreeProxyListing() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch('https://freeproxylisting.com/api?country=SG&type=http,https', {
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`FreeProxyListing API returned ${response.status}`);
      }
      
      const data = await response.json();
      const proxies = [];
      
      if (Array.isArray(data)) {
        for (const proxy of data) {
          if (proxy.ip && proxy.port && (proxy.country === 'SG' || proxy.countryCode === 'SG')) {
            proxies.push({
              server: `http://${proxy.ip}:${proxy.port}`,
              source: 'freeproxylisting',
            });
          }
        }
      } else if (data.data && Array.isArray(data.data)) {
        for (const proxy of data.data) {
          if (proxy.ip && proxy.port && (proxy.country === 'SG' || proxy.countryCode === 'SG')) {
            proxies.push({
              server: `http://${proxy.ip}:${proxy.port}`,
              source: 'freeproxylisting',
            });
          }
        }
      }
      
      return proxies;
    } catch (error) {
      if (error.name !== 'AbortError') {
        logger.warn('Failed to fetch proxies from FreeProxyListing:', error.message);
      }
      return [];
    }
  }

  /**
   * Fetch proxies from all available sources
   */
  async findAllProxies() {
    const cacheKey = 'all_proxies';
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      logger.info(`Using cached proxy list (${cached.proxies.length} proxies)`);
      return cached.proxies;
    }

    logger.info('Fetching Singapore proxies from multiple sources...');
    
    const [geonixProxies, proxy5Proxies, proxyFreeOnlyProxies, proxifyProxies, proxyProviderProxies, freeProxyListingProxies] = await Promise.all([
      this.fetchFromGeoNix(),
      this.fetchFromProxy5(),
      this.fetchFromProxyFreeOnly(),
      this.fetchFromProxify(),
      this.fetchFromProxyProvider(),
      this.fetchFromFreeProxyListing(),
    ]);

    // Combine and deduplicate proxies
    const allProxies = [
      ...geonixProxies,
      ...proxy5Proxies,
      ...proxyFreeOnlyProxies,
      ...proxifyProxies,
      ...proxyProviderProxies,
      ...freeProxyListingProxies,
    ];

    // Deduplicate by server URL
    const uniqueProxies = [];
    const seen = new Set();
    
    for (const proxy of allProxies) {
      if (!seen.has(proxy.server)) {
        seen.add(proxy.server);
        uniqueProxies.push(proxy);
      }
    }

    const totalFound = geonixProxies.length + proxy5Proxies.length + proxyFreeOnlyProxies.length + 
                       proxifyProxies.length + proxyProviderProxies.length + freeProxyListingProxies.length;
    logger.info(`Found ${uniqueProxies.length} unique Singapore proxies from ${totalFound} total results`);

    // Cache the results
    this.cache.set(cacheKey, {
      proxies: uniqueProxies,
      timestamp: Date.now(),
    });

    return uniqueProxies;
  }

  /**
   * Get a random proxy from the list
   */
  async getRandomProxy() {
    const proxies = await this.findAllProxies();
    if (proxies.length === 0) {
      return null;
    }
    return proxies[Math.floor(Math.random() * proxies.length)];
  }

  /**
   * Clear the proxy cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('Proxy cache cleared');
  }
}
