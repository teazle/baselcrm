import dotenv from 'dotenv';
import { BrowserManager } from '../utils/browser.js';
import { VisitDetailsExtractor } from '../core/visit-details-extractor.js';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';

dotenv.config();

async function testPcnoSearch() {
  logger.info('=== Testing PCNO-based Patient Search ===\n');

  const supabase = createSupabaseClient();
  
  // Get a visit with PCNO
  const { data: visit, error } = await supabase
    .from('visits')
    .select('*')
    .eq('id', '29cc9d47-6651-46ff-b7c3-a05d3ff56de3')
    .single();

  if (error || !visit) {
    logger.error('Failed to fetch test visit:', error);
    process.exit(1);
  }

  logger.info(`Testing with visit:`);
  logger.info(`  Patient: ${visit.patient_name}`);
  logger.info(`  PCNO: ${visit.extraction_metadata?.pcno || 'NOT SET'}`);
  logger.info(`  Visit Date: ${visit.visit_date}\n`);

  if (!visit.extraction_metadata?.pcno) {
    logger.warn('⚠️  Visit does not have PCNO set. This test will use name-based search (fallback).');
    logger.warn('   To test PCNO search, set extraction_metadata.pcno to a 4-5 digit number.\n');
  } else {
    logger.info('✅ Visit has PCNO - will test PCNO-based search\n');
  }

  const browserManager = new BrowserManager();
  const page = await browserManager.newPage();

  try {
    const extractor = new VisitDetailsExtractor(page, supabase);
    
    logger.info('Starting extraction...\n');
    const result = await extractor.extractForVisit(visit);

    logger.info('\n' + '='.repeat(70));
    if (result.success) {
      logger.info('✅ Extraction Successful');
      logger.info(`   Used PCNO: ${visit.extraction_metadata?.pcno ? 'Yes' : 'No (fallback to name)'}`);
      logger.info(`   Diagnosis: ${result.diagnosis?.substring(0, 100)}${result.diagnosis?.length > 100 ? '...' : ''}`);
      if (result.diagnosisCode) {
        logger.info(`   Diagnosis Code: ${result.diagnosisCode}`);
      }
    } else {
      logger.error('❌ Extraction Failed');
      logger.error(`   Error: ${result.error}`);
    }
    logger.info('='.repeat(70));

  } catch (error) {
    logger.error('Fatal error during extraction:', error);
  } finally {
    await browserManager.close();
  }
}

testPcnoSearch().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
