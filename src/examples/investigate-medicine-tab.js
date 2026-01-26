#!/usr/bin/env node

/**
 * Investigation script: Medicine Tab structure for patient 75434
 * This will help us understand the data structure before implementing extraction
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { logger } from '../utils/logger.js';

dotenv.config();

async function investigateMedicineTab() {
  const browserManager = new BrowserManager();
  
  try {
    logger.info('=== Investigating Medicine Tab Structure ===\n');
    
    // Initialize browser
    await browserManager.init();
    const page = await browserManager.newPage();
    
    // Login to Clinic Assist
    logger.info('Step 1: Logging into Clinic Assist...');
    const clinicAssist = new ClinicAssistAutomation(page);
    await clinicAssist.login();
    logger.info('✓ Login successful\n');
    
    // Navigate to Patient Page
    logger.info('Step 2: Navigating to Patient Page...');
    await clinicAssist.navigateToPatientPage();
    logger.info('✓ Navigated to Patient Page\n');
    
    // Search for patient 75434
    logger.info('Step 3: Searching for patient 75434...');
    const patientNumber = '75434';
    await clinicAssist.searchPatientByNumber(patientNumber);
    logger.info('✓ Patient search completed\n');
    
    // Open patient from search results
    logger.info('Step 4: Opening patient record...');
    await clinicAssist.openPatientFromSearchResultsByNumber(patientNumber);
    logger.info('✓ Patient record opened\n');
    
    // Navigate to TX History
    logger.info('Step 5: Navigating to TX History...');
    await clinicAssist.navigateToTXHistory();
    logger.info('✓ Navigated to TX History\n');
    
    // Take screenshot of TX History page
    await page.screenshot({ path: 'screenshots/tx-history-tabs.png', fullPage: true });
    logger.info('📸 Screenshot saved: tx-history-tabs.png\n');
    
    // Try to find and click Medicine tab
    logger.info('Step 6: Looking for Medicine tab...');
    
    const medicineTabSelectors = [
      '[role="tab"]:has-text("Medicine")',
      'a:has-text("Medicine")',
      'button:has-text("Medicine")',
      'li:has-text("Medicine")',
      '.tab:has-text("Medicine")',
      '[class*="tab"]:has-text("Medicine")',
      'a:has-text("Drug")',
      'a:has-text("Medication")',
      '[role="tab"]:has-text("Drug")',
      '[role="tab"]:has-text("Medication")',
    ];
    
    let medicineTabFound = false;
    for (const selector of medicineTabSelectors) {
      try {
        const tab = page.locator(selector).first();
        if ((await tab.count().catch(() => 0)) > 0) {
          const isVisible = await tab.isVisible().catch(() => false);
          if (isVisible) {
            logger.info(`✓ Found Medicine tab with selector: ${selector}`);
            await tab.click();
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForTimeout(2000);
            medicineTabFound = true;
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }
    
    if (!medicineTabFound) {
      logger.warn('⚠ Medicine tab not found with standard selectors');
      logger.info('Examining all visible tabs on the page...\n');
      
      // Get all visible tabs/links
      const allTabs = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('a, button, [role="tab"], li'));
        return elements
          .filter(el => el.offsetParent !== null) // Only visible elements
          .map(el => ({
            tag: el.tagName,
            text: (el.textContent || '').trim().substring(0, 50),
            class: el.className,
            role: el.getAttribute('role'),
            href: el.getAttribute('href')
          }))
          .filter(item => item.text.length > 0);
      });
      
      logger.info('All visible tabs/links on TX History page:');
      allTabs.forEach((tab, index) => {
        logger.info(`  ${index + 1}. [${tab.tag}] "${tab.text}" (class: ${tab.class || 'none'}, role: ${tab.role || 'none'})`);
      });
    } else {
      logger.info('✓ Medicine tab opened\n');
      
      // Take screenshot of Medicine tab
      await page.screenshot({ path: 'screenshots/medicine-tab.png', fullPage: true });
      logger.info('📸 Screenshot saved: medicine-tab.png\n');
      
      // Extract medicine table structure
      logger.info('Step 7: Analyzing medicine table structure...\n');
      
      const medicineData = await page.evaluate(() => {
        // Find all tables on the page
        const tables = Array.from(document.querySelectorAll('table'));
        const results = {
          tableCount: tables.length,
          tables: []
        };
        
        tables.forEach((table, tableIndex) => {
          const tableInfo = {
            index: tableIndex,
            headers: [],
            sampleRows: []
          };
          
          // Get headers
          const headerCells = table.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td');
          tableInfo.headers = Array.from(headerCells).map(cell => cell.textContent.trim());
          
          // Get first 3 data rows
          const dataRows = Array.from(table.querySelectorAll('tbody tr, tr')).slice(0, 3);
          tableInfo.sampleRows = dataRows.map(row => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            return cells.map(cell => cell.textContent.trim().substring(0, 100));
          });
          
          tableInfo.totalRows = table.querySelectorAll('tbody tr, tr').length;
          
          results.tables.push(tableInfo);
        });
        
        return results;
      });
      
      logger.info(`Found ${medicineData.tableCount} table(s) on Medicine tab:\n`);
      
      medicineData.tables.forEach((table, index) => {
        logger.info(`Table ${index + 1}:`);
        logger.info(`  Headers: ${table.headers.join(' | ')}`);
        logger.info(`  Total rows: ${table.totalRows}`);
        logger.info(`  Sample rows:`);
        table.sampleRows.forEach((row, rowIndex) => {
          logger.info(`    Row ${rowIndex + 1}: ${row.join(' | ')}`);
        });
        logger.info('');
      });
      
      // Try to extract medicine records with dates
      logger.info('Step 8: Extracting medicine records...\n');
      
      const medicines = await page.evaluate(() => {
        const results = [];
        const tables = Array.from(document.querySelectorAll('table'));
        
        tables.forEach(table => {
          const rows = Array.from(table.querySelectorAll('tbody tr, tr'));
          
          rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            if (cells.length > 0) {
              const rowText = cells.map(cell => cell.textContent.trim()).filter(text => text.length > 0);
              if (rowText.length > 0) {
                results.push({
                  cells: rowText,
                  fullText: rowText.join(' | ')
                });
              }
            }
          });
        });
        
        return results.slice(0, 10); // First 10 records
      });
      
      logger.info(`Extracted ${medicines.length} medicine records:\n`);
      medicines.forEach((med, index) => {
        logger.info(`  ${index + 1}. ${med.fullText}`);
      });
    }
    
    logger.info('\n✓ Investigation complete!');
    logger.info('Review screenshots and logs to understand Medicine tab structure');
    logger.info('\nKeeping browser open for 5 minutes for manual inspection...');
    logger.info('Press Ctrl+C to close\n');
    
    await new Promise(resolve => setTimeout(resolve, 300000)); // 5 minutes
    
  } catch (error) {
    logger.error('Investigation failed:', error);
    
    // Take error screenshot
    try {
      const pages = await browserManager.getAllPages();
      if (pages.length > 0) {
        await pages[0].screenshot({ 
          path: 'screenshots/investigation-error.png', 
          fullPage: true 
        });
        logger.info('Error screenshot saved');
      }
    } catch (e) {
      logger.warn('Could not take error screenshot');
    }
    
    logger.info('\nKeeping browser open for review...');
    await new Promise(resolve => setTimeout(resolve, 300000));
  } finally {
    logger.info('Closing browser...');
    await browserManager.close();
  }
}

investigateMedicineTab().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
