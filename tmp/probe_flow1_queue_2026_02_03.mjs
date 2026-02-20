import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { BatchExtraction } from '../src/core/batch-extraction.js';

dotenv.config();

const browser = new BrowserManager();
try {
  const page = await browser.newPage();
  const batch = new BatchExtraction(page);
  await batch.clinicAssist.login();
  const items = await batch.extractFromReportsQueueList('2026-02-03');

  const wanted = (items || []).filter((it) => {
    const name = String(it.patientName || '').toUpperCase();
    const nric = String(it.nric || '').toUpperCase();
    const visitNo = String(it.visitRecordNo || it.visitNo || '').trim();
    return (
      name.includes('ENG CHAI PIN ELYNE XANDRIA') ||
      nric === 'S8570522I' ||
      visitNo === '129584' ||
      visitNo === '127954'
    );
  });

  const slim = wanted.map((it) => ({
    patientName: it.patientName,
    nric: it.nric,
    visitRecordNo: it.visitRecordNo,
    visitNo: it.visitNo,
    visitDate: it.visitDate,
    payType: it.payType,
    spCode: it.spCode,
    claimDetails: it.claimDetails,
    treatmentDetail: it.treatmentDetail,
    rawDiagnosis: it.diagnosisText || null,
    rawNotes: it.notesText || null,
    totalAmount: it.totalAmount
  }));

  console.log(JSON.stringify({ total: (items || []).length, matched: slim.length, items: slim }, null, 2));
} finally {
  await browser.close();
}
