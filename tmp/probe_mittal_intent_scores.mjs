import fs from 'node:fs';
import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { ClinicAssistAutomation } from '../src/automations/clinic-assist.js';

dotenv.config();

const outPath = '/Users/vincent/Baselrpacrm/tmp/probe_mittal_intent_scores.json';
const patientNo = '78145';

const browser = new BrowserManager();
await browser.init();
const page = await browser.newPage();
const ca = new ClinicAssistAutomation(page);

try {
  await ca.login();
  const navOk = await ca.navigateToPatientPage();
  if (!navOk) throw new Error('navigateToPatientPage failed');

  await ca.searchPatientByNumber(patientNo);
  await ca.page.waitForTimeout(1200);
  await ca.openPatientFromSearchResultsByNumber(patientNo);
  await ca.page.waitForTimeout(1200);

  await ca.navigateToTXHistory();
  await ca.openPastNotesTab();
  await ca.page.waitForTimeout(1500);

  const dump = await ca.page.evaluate(() => {
    const norm = (s) =>
      String(s || '')
        .replace(/diagnosis\s*(rt|lt|right|left)/gi, 'diagnosis $1')
        .replace(/([a-z])(rt|lt)(?=\s*(acj|shoulder|knee|ankle|wrist|elbow|hip|back|neck))/gi, '$1 $2')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

    const base = norm('Pain in a joint shoulder region');

    const bodyPartMatchers = [
      { canonical: 'shoulder', regex: /\b(shoulder|shldr|acj|ac\s*joint|acromio[-\s]*clavicular)\b/i },
      { canonical: 'knee', regex: /\b(knee|patella|patellar)\b/i },
      { canonical: 'ankle', regex: /\b(ankle)\b/i },
      { canonical: 'wrist', regex: /\b(wrist)\b/i },
      { canonical: 'elbow', regex: /\b(elbow)\b/i },
      { canonical: 'hip', regex: /\b(hip)\b/i },
      { canonical: 'back', regex: /\b(back|upperback|lowerback|mid\s*back)\b/i },
      { canonical: 'neck', regex: /\b(neck)\b/i },
    ];

    const conditions = [
      'pain','ache','sprain','strain','degeneration','degenerative','tendinitis','tendinopathy','bursitis','fracture','contusion','dislocation','laceration','wound','swelling','infection','inflammation','arthritis','osteoarthritis','capsulitis','impingement','tear','rupture',
    ];

    const detectBodyPart = (text) => {
      for (const m of bodyPartMatchers) {
        if (m.regex.test(text)) return m.canonical;
      }
      return null;
    };
    const detectCondition = (text) => conditions.find((c) => text.includes(c)) || null;
    const detectSide = (text) => {
      if (/\b(right|rt)\b/i.test(text)) return 'right';
      if (/\b(left|lt)\b/i.test(text)) return 'left';
      if (/(right|rt)\s*(acj|shoulder|knee|ankle|wrist|elbow|hip|back|neck)\b/i.test(text)) return 'right';
      if (/(left|lt)\s*(acj|shoulder|knee|ankle|wrist|elbow|hip|back|neck)\b/i.test(text)) return 'left';
      return null;
    };

    const baseBodyPart = detectBodyPart(base);
    const baseCondition = detectCondition(base);

    const splitSentences = (text) =>
      text
        .split(/[.\n\r;]|(?=\b(?:history|aggravating|relieving|rx\)|mplan|diagnosis|medicine|procedure)\b)/i)
        .map((s) => String(s || '').trim())
        .filter((s) => s.length > 5);

    const containers = [
      ...Array.from(document.querySelectorAll('table')),
      ...Array.from(document.querySelectorAll('textarea, div[contenteditable]')),
      ...Array.from(document.querySelectorAll('div[class*="note"], div[class*="entry"]')),
    ];

    const scoreSentence = (sentence) => {
      const s = norm(sentence);
      const bp = detectBodyPart(s);
      if (!bp) return null;
      const cond = detectCondition(s);
      const side = detectSide(s);
      let score = 0;
      if (bp) score += 3;
      if (cond) score += 3;
      if (side) score += 2;
      if (baseBodyPart && bp === baseBodyPart) score += 6;
      if (baseBodyPart && bp !== baseBodyPart) score -= 3;
      if (baseCondition && cond && baseCondition === cond) score += 1;
      if (base && bp && base.includes(bp)) score += 1;
      return { score, bp, cond, side, sentence: sentence.trim(), norm: s };
    };

    const ranked = [];
    const pushScored = (scored, source) => {
      if (!scored) return;
      ranked.push({ ...scored, source });
    };

    for (const [idx, container] of containers.entries()) {
      const text = norm(container.textContent || '');
      const sentences = splitSentences(text);
      for (const sentence of sentences) {
        pushScored(scoreSentence(sentence), `container_${idx}`);
      }
    }

    const fullBody = norm(document.body?.innerText || '');
    for (const sentence of splitSentences(fullBody)) {
      pushScored(scoreSentence(sentence), 'full_body');
    }

    ranked.sort((a, b) => b.score - a.score);

    return {
      url: location.href,
      title: document.title,
      base,
      baseBodyPart,
      baseCondition,
      top: ranked.slice(0, 80),
      bodySample: fullBody.slice(0, 2000),
    };
  });

  fs.writeFileSync(outPath, `${JSON.stringify(dump, null, 2)}\n`, 'utf8');
  console.log(outPath);
} finally {
  await browser.close().catch(() => {});
}
