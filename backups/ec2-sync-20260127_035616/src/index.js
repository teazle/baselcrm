import dotenv from 'dotenv';
import { ClaimProcessor } from './core/claim-processor.js';
import { logger } from './utils/logger.js';

// Load environment variables
dotenv.config();

/**
 * Main entry point for the automation system
 */
async function main() {
  const processor = new ClaimProcessor();
  
  try {
    // Initialize the processor
    await processor.init();
    
    // Example: Process a single claim workflow
    const exampleWorkflowParams = {
      branchName: 'Main Branch', // Replace with actual branch name
      deptName: 'General', // Replace with actual department name
      patientIdentifier: 'John Doe', // Patient name or identifier
      cardNumber: '12345678', // Optional: Insurance card number
      verificationCode: null, // Optional: 2FA code if needed
      consultationMax: 100.00, // Optional: Maximum consultation amount
    };
    
    logger.info('Starting automation...');
    
    // Option 1: Process a complete workflow (Clinic Assist -> MHC Asia)
    await processor.processClaimWorkflow(exampleWorkflowParams);
    
    // Option 2: Process multiple claims for a specific portal
    // const claims = [exampleClaimData, /* more claims */];
    // await processor.processClaimsForPortal('MHC_ASIA', claims);
    
    logger.info('Automation completed successfully');
  } catch (error) {
    logger.error('Automation failed:', error);
    process.exit(1);
  } finally {
    await processor.close();
  }
}

// Run the automation
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});

