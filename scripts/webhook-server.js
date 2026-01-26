#!/usr/bin/env node

/**
 * Simple webhook server for auto-deployment
 * Listens for GitHub webhooks and automatically pulls from Git
 * 
 * Usage:
 *   node scripts/webhook-server.js
 * 
 * Or with PM2:
 *   pm2 start scripts/webhook-server.js --name webhook-server
 */

import http from 'http';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);

const PORT = process.env.WEBHOOK_PORT || 9000;
const SECRET = process.env.WEBHOOK_SECRET || 'your-secret-key-change-this';
const DEPLOY_PATH = process.env.DEPLOY_PATH || process.cwd();
const BRANCH = process.env.DEPLOY_BRANCH || 'main';

/**
 * Verify GitHub webhook signature
 */
function verifySignature(payload, signature) {
  if (!signature) return false;
  
  const hmac = crypto.createHmac('sha256', SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}

/**
 * Execute deployment
 */
async function deploy() {
  console.log(`[${new Date().toISOString()}] 🚀 Starting deployment...`);
  
  try {
    // Change to deploy directory
    process.chdir(DEPLOY_PATH);
    
    // Pull latest changes
    console.log('📥 Pulling latest changes...');
    await execAsync(`git fetch origin`);
    await execAsync(`git reset --hard origin/${BRANCH}`);
    
    // Check if package.json changed
    const { stdout: changedFiles } = await execAsync(
      `git diff HEAD@{1} HEAD --name-only || echo ""`
    );
    
    if (changedFiles.includes('package.json') || changedFiles.includes('package-lock.json')) {
      console.log('📦 Installing dependencies...');
      await execAsync('npm install');
      await execAsync('npm run install-browsers');
    }
    
    // Restart PM2 if available
    try {
      await execAsync('pm2 restart all');
      console.log('🔄 PM2 processes restarted');
    } catch (err) {
      console.log('ℹ️  PM2 not running or not installed');
    }
    
    console.log(`[${new Date().toISOString()}] ✅ Deployment complete!`);
    
    return { success: true, message: 'Deployment successful' };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Deployment failed:`, error.message);
    return { success: false, message: error.message };
  }
}

/**
 * Create HTTP server
 */
const server = http.createServer(async (req, res) => {
  // Only accept POST requests
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  
  // Only accept /webhook endpoint
  if (req.url !== '/webhook') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  
  let body = '';
  
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', async () => {
    try {
      // Verify signature
      const signature = req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'];
      
      if (!verifySignature(body, signature)) {
        console.warn(`[${new Date().toISOString()}] ⚠️  Invalid signature`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      
      // Parse payload
      const payload = JSON.parse(body);
      
      // Only deploy on push to main/master
      if (payload.ref === `refs/heads/${BRANCH}` || payload.ref === `refs/heads/master`) {
        console.log(`[${new Date().toISOString()}] 📨 Webhook received for ${payload.ref}`);
        
        // Send response immediately
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Webhook received, deploying...' }));
        
        // Deploy in background
        const result = await deploy();
        console.log(`[${new Date().toISOString()}] Deployment result:`, result);
      } else {
        console.log(`[${new Date().toISOString()}] ℹ️  Ignoring push to ${payload.ref}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Ignored - not main branch' }));
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Error processing webhook:`, error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Webhook server listening on port ${PORT}`);
  console.log(`📁 Deploy path: ${DEPLOY_PATH}`);
  console.log(`🌿 Branch: ${BRANCH}`);
  console.log(`🔐 Secret: ${SECRET.substring(0, 10)}...`);
  console.log(`\n📝 Configure GitHub webhook: http://your-ec2-ip:${PORT}/webhook`);
});

// Handle errors
server.on('error', (error) => {
  console.error('❌ Server error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down webhook server...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Shutting down webhook server...');
  server.close(() => {
    process.exit(0);
  });
});
