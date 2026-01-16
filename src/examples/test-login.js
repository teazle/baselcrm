import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { MHCAsiaAutomation } from '../automations/mhc-asia.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/**
 * Test script to verify login functionality for both portals
 */
async function testLogins() {
  const browserManager = new BrowserManager();
  
  try {
    await browserManager.init();
    
    // Test Clinic Assist login
    logger.info('=== Testing Clinic Assist Login ===');
    const clinicAssistPage = await browserManager.newPage();
    const clinicAssist = new ClinicAssistAutomation(clinicAssistPage);
    
    try {
      await clinicAssist.login();
      logger.info('✓ Clinic Assist login successful');
      await clinicAssist.logout();
    } catch (error) {
      logger.error('✗ Clinic Assist login failed:', error.message);
    }
    
    await clinicAssistPage.close();
    
    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test MHC Asia login
    logger.info('=== Testing MHC Asia Login ===');
    const mhcAsiaPage = await browserManager.newPage();
    const mhcAsia = new MHCAsiaAutomation(mhcAsiaPage);
    
    try {
      await mhcAsia.login();
      logger.info('✓ MHC Asia login successful');
      await mhcAsia.logout();
    } catch (error) {
      logger.error('✗ MHC Asia login failed:', error.message);
    }
    
    await mhcAsiaPage.close();
    
    logger.info('=== Login tests completed ===');
  } catch (error) {
    logger.error('Test failed:', error);
  } finally {
    await browserManager.close();
  }
}

testLogins().catch(console.error);

