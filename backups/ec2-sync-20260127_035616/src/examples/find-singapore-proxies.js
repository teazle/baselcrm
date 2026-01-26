import 'dotenv/config';
import { ProxyFinder } from '../utils/proxy-finder.js';

/**
 * Enhanced proxy finder that tries additional sources
 */
async function findProxiesFromAlternativeSources() {
  console.log('🔍 Searching for Singapore proxies from alternative sources...\n');

  const proxies = [];

  // Try direct proxy list APIs
  const sources = [
    {
      name: 'Free Proxy List',
      url: 'https://www.proxy-list.download/api/v1/get?type=http&country=SG',
    },
    {
      name: 'ProxyScrape',
      url: 'https://api.proxyscrape.com/v2/?request=get&protocol=http&country=SG&timeout=10000',
    },
    {
      name: 'Geonode',
      url: 'https://proxylist.geonode.com/api/proxy-list?limit=50&page=1&sort_by=lastChecked&sort_type=desc&country=SG&protocols=http%2Chttps',
    },
  ];

  for (const source of sources) {
    try {
      console.log(`Trying ${source.name}...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(source.url, {
        signal: controller.signal,
        headers: {
          'Accept': 'text/plain, application/json, */*',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }

      const text = await response.text();
      const lines = text.trim().split('\n').filter(line => line.trim());

      let found = 0;
      for (const line of lines) {
        // Parse different formats: IP:PORT or JSON
        if (line.includes(':')) {
          const [ip, port] = line.trim().split(':');
          if (ip && port && /^\d+$/.test(port)) {
            proxies.push({
              server: `http://${ip}:${port}`,
              source: source.name.toLowerCase().replace(/\s+/g, '-'),
            });
            found++;
          }
        } else if (line.startsWith('{') || line.startsWith('[')) {
          // Try to parse as JSON
          try {
            const data = JSON.parse(line);
            if (Array.isArray(data)) {
              for (const item of data) {
                if (item.ip && item.port) {
                  proxies.push({
                    server: `http://${item.ip}:${item.port}`,
                    source: source.name.toLowerCase().replace(/\s+/g, '-'),
                  });
                  found++;
                }
              }
            } else if (data.data && Array.isArray(data.data)) {
              for (const item of data.data) {
                if (item.ip && item.port) {
                  proxies.push({
                    server: `http://${item.ip}:${item.port}`,
                    source: source.name.toLowerCase().replace(/\s+/g, '-'),
                  });
                  found++;
                }
              }
            }
          } catch (e) {
            // Not JSON, skip
          }
        }
      }

      if (found > 0) {
        console.log(`  ✅ Found ${found} proxies from ${source.name}`);
      } else {
        console.log(`  ⚠️  No proxies found from ${source.name}`);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.log(`  ❌ Failed: ${error.message}`);
      } else {
        console.log(`  ⏱️  Timeout`);
      }
    }
  }

  // Deduplicate
  const unique = [];
  const seen = new Set();
  for (const proxy of proxies) {
    if (!seen.has(proxy.server)) {
      seen.add(proxy.server);
      unique.push(proxy);
    }
  }

  return unique;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║      Enhanced Singapore Proxy Discovery                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Try original finder
  const finder = new ProxyFinder();
  console.log('1. Trying original proxy finder...');
  const originalProxies = await finder.findAllProxies();
  console.log(`   Found: ${originalProxies.length} proxies\n`);

  // Try alternative sources
  console.log('2. Trying alternative proxy sources...\n');
  const altProxies = await findProxiesFromAlternativeSources();

  // Combine
  const allProxies = [...originalProxies, ...altProxies];
  const unique = [];
  const seen = new Set();
  for (const proxy of allProxies) {
    if (!seen.has(proxy.server)) {
      seen.add(proxy.server);
      unique.push(proxy);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Total unique Singapore proxies found: ${unique.length}\n`);

  if (unique.length > 0) {
    console.log('First 10 proxies:');
    unique.slice(0, 10).forEach((proxy, i) => {
      console.log(`  ${i + 1}. ${proxy.server} (${proxy.source})`);
    });

    console.log('\n✅ Found proxies! You can test them by setting:');
    console.log(`   PROXY_SERVER=${unique[0].server}`);
    console.log('   PROXY_AUTO_DISCOVER=false');
  } else {
    console.log('❌ No Singapore proxies found from any source');
    console.log('\nRecommendation: Use a system-level VPN');
    console.log('  - Install Falcon VPN or VeePN');
    console.log('  - Connect to Singapore server');
    console.log('  - Set PROXY_ENABLED=false');
  }

  console.log('='.repeat(60));
}

main().catch(console.error);
