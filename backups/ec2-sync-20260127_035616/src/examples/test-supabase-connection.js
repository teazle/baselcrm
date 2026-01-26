import dotenv from 'dotenv';
import { createSupabaseClient } from '../utils/supabase-client.js';
import { logger } from '../utils/logger.js';

dotenv.config();

async function testSupabaseConnection() {
  logger.info('=== Testing Supabase Connection ===');
  
  const supabase = createSupabaseClient();
  
  if (!supabase) {
    logger.error('❌ Supabase client is null - check environment variables');
    logger.info('Required: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY');
    return;
  }
  
  logger.info('✅ Supabase client created');
  
  try {
    // Test connection by querying visits table
    logger.info('Testing connection to visits table...');
    const { data, error } = await supabase
      .from('visits')
      .select('id')
      .limit(1);
    
    if (error) {
      logger.error('❌ Supabase query error:', error.message);
      logger.error('Error details:', error);
    } else {
      logger.info('✅ Supabase connection successful');
      logger.info(`Found ${data?.length || 0} visits in database`);
    }
  } catch (e) {
    logger.error('❌ Fetch error:', e.message);
    logger.error('Error stack:', e.stack);
  }
}

testSupabaseConnection().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
