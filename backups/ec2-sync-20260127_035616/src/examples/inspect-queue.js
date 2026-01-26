#!/usr/bin/env node

/**
 * Inspect queue to see what patients are available
 * Helps debug why patient 78025 might not be found
 */

import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';
import { logger } from '../utils/logger.js';

dotenv.config();

async function inspectQueue() {
  const browserManager = new BrowserManager();
  let page = null;

  try {
    logger.info('=== Inspecting Clinic Assist Queue ===\n');

    // Initialize browser
    const context = await browserManager.init();
    page = await context.newPage();

    const clinicAssist = new ClinicAssistAutomation(page);

    // Step 1: Login
    logger.info('Step 1: Logging in...');
    await clinicAssist.login();
    logger.info('✓ Login successful\n');

    // Step 2: Navigate to Queue
    logger.info('Step 2: Navigating to Queue...');
    await clinicAssist.navigateToQueue('__FIRST__', 'Reception');
    logger.info('✓ Navigated to Queue\n');

    // Step 3: Extract queue data
    logger.info('Step 3: Extracting queue data...\n');
    
    const queueData = await page.evaluate(() => {
      const data = {
        jqGrid: [],
        table: [],
        allText: null,
      };

      // Get all text on page
      data.allText = document.body?.innerText || '';

      // jqGrid
      const jqGrid = document.querySelector('#queueLogGrid');
      if (jqGrid) {
        const jqRows = jqGrid.querySelectorAll('tr.jqgrow');
        jqRows.forEach((row, idx) => {
          const cells = Array.from(row.querySelectorAll('td'));
          const rowData = {
            index: idx,
            cells: [],
            text: row.textContent?.trim() || '',
          };
          
          cells.forEach((cell, cellIdx) => {
            const aria = cell.getAttribute('aria-describedby');
            const cellText = cell.textContent?.trim() || '';
            const cellData = {
              index: cellIdx,
              text: cellText,
              aria: aria || null,
            };
            
            if (aria) {
              const colName = aria.split('_').pop();
              cellData.columnName = colName;
            }
            
            rowData.cells.push(cellData);
          });
          
          data.jqGrid.push(rowData);
        });
      }

      // Regular table
      const tables = document.querySelectorAll('table');
      tables.forEach((table, tableIdx) => {
        const rows = table.querySelectorAll('tbody tr, tr:not(thead tr)');
        rows.forEach((row, rowIdx) => {
          const cells = Array.from(row.querySelectorAll('td, th'));
          data.table.push({
            tableIndex: tableIdx,
            rowIndex: rowIdx,
            cells: cells.map(c => c.textContent?.trim() || ''),
            text: row.textContent?.trim() || '',
          });
        });
      });

      return data;
    });

    // Save queue data
    const fs = await import('fs');
    fs.writeFileSync(
      'queue-inspection.json',
      JSON.stringify(queueData, null, 2)
    );

    logger.info('=== Queue Inspection Results ===\n');
    logger.info(`jqGrid rows: ${queueData.jqGrid.length}`);
    logger.info(`Table rows: ${queueData.table.length}`);
    logger.info(`Page text length: ${queueData.allText?.length || 0}\n`);

    // Show patient numbers found
    logger.info('=== Patient Numbers Found ===\n');
    const patientNumbers = [];
    
    // From jqGrid
    queueData.jqGrid.forEach((row, idx) => {
      const pcnoCell = row.cells.find(c => c.columnName === 'PCNO');
      const pcno = pcnoCell?.text || null;
      const nricCell = row.cells.find(c => c.columnName === 'NRIC');
      const nric = nricCell?.text || null;
      const nameCell = row.cells.find(c => c.columnName === 'PatientName');
      const name = nameCell?.text || null;
      
      if (pcno || nric || name) {
        patientNumbers.push({ index: idx, pcno, nric, name, rowText: row.text.substring(0, 100) });
      }
    });

    // From table
    queueData.table.forEach((row, idx) => {
      const rowText = row.text || '';
      // Look for 5-digit numbers (patient numbers)
      const numberMatch = rowText.match(/\b\d{5}\b/);
      if (numberMatch) {
        patientNumbers.push({ 
          index: idx, 
          pcno: numberMatch[0], 
          source: 'table',
          rowText: rowText.substring(0, 100) 
        });
      }
    });

    if (patientNumbers.length > 0) {
      logger.info(`Found ${patientNumbers.length} patients:\n`);
      patientNumbers.forEach((p, idx) => {
        logger.info(`${idx + 1}. PCNO: ${p.pcno || 'N/A'}, NRIC: ${p.nric || 'N/A'}, Name: ${p.name || 'N/A'}`);
        logger.info(`   Row text: ${p.rowText}`);
      });
      
      // Check if 78025 is in the list
      const found78025 = patientNumbers.find(p => 
        p.pcno === '78025' || 
        p.pcno === '078025' ||
        p.rowText.includes('78025')
      );
      
      if (found78025) {
        logger.info('\n✅ Patient 78025 FOUND in queue!');
      } else {
        logger.info('\n❌ Patient 78025 NOT found in queue');
        logger.info('Available patient numbers:');
        patientNumbers.forEach(p => {
          if (p.pcno) logger.info(`  - ${p.pcno}`);
        });
      }
    } else {
      logger.warn('No patient numbers found in queue');
      logger.info('Queue might be empty or structure is different');
    }

    // Take screenshot
    await page.screenshot({ 
      path: 'screenshots/queue-inspection.png', 
      fullPage: true 
    });

    logger.info('\n✓ Queue inspection complete!');
    logger.info('✓ Data saved to: queue-inspection.json');
    logger.info('✓ Screenshot saved to: screenshots/queue-inspection.png');

  } catch (error) {
    logger.error('Inspection failed:', error);
    if (page) {
      await page.screenshot({ 
        path: 'screenshots/queue-inspection-error.png', 
        fullPage: true 
      });
    }
    throw error;
  } finally {
    if (page) {
      await page.close();
    }
    await browserManager.close();
  }
}

// Run inspection
inspectQueue().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
