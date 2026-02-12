import { logger } from '../utils/logger.js';
import { PORTALS } from '../config/portals.js';
import { validateDiagnosis, validateClaimDetails, logValidationResults } from '../utils/extraction-validator.js';
import { PDFParse } from 'pdf-parse';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { normalizePcno, normalizeNric, normalizePatientNameForSearch } from '../utils/patient-normalize.js';

/**
 * Clinic Assist automation module
 * 
 * NAVIGATION RULE: Always use UI clicks for navigation, NEVER use direct URL navigation (page.goto).
 * Direct URLs cause "Access Denied" errors. This applies especially to:
 * - Patient page navigation
 * - Any page that requires authentication context
 * 
 * Use UI clicks (link.click(), button.click()) instead of page.goto() for all navigation.
 */
export class ClinicAssistAutomation {
  constructor(page) {
    this.page = page;
    this.config = PORTALS.CLINIC_ASSIST;
    this._caStep = 0;
    
    // Set up route to block external protocol handlers (xdg-open, etc.)
    this.page.route('**/*', (route) => {
      const url = route.request().url();
      // Block any non-http/https URLs that might trigger xdg-open
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:')) {
        logger.info(`[Route Block] Blocking external URL: ${url}`);
        route.abort();
        return;
      }
      route.continue();
    });
    
    // Set up dialog handler to auto-dismiss xdg-open and other dialogs
    this.page.on('dialog', async (dialog) => {
      logger.info(`[Dialog] ${dialog.type()}: ${dialog.message()}`);
      try {
        await dialog.dismiss();
        logger.info('[Dialog] Dismissed');
      } catch (e) {
        try {
          await dialog.accept();
          logger.info('[Dialog] Accepted');
        } catch (e2) {
          logger.warn('[Dialog] Could not dismiss or accept', { error: e2.message });
        }
      }
    });
  }

  _logStep(message, meta) {
    this._caStep += 1;
    const tag = `[CA ${String(this._caStep).padStart(2, '0')}]`;
    if (meta !== undefined) logger.info(`${tag} ${message}`, meta);
    else logger.info(`${tag} ${message}`);
  }

  async _getReportsFrame() {
    // Clinic Assist "ReportsMenu" is rendered inside an iframe in some deployments.
    // If present, we must interact with report links/filters inside the iframe DOM.
    try {
      const iframe = this.page.locator('#iframe-email').first();
      if ((await iframe.count().catch(() => 0)) === 0) return null;
      const handle = await iframe.elementHandle().catch(() => null);
      if (!handle) return null;
      const frame = await handle.contentFrame().catch(() => null);
      if (!frame) return null;

      // Wait briefly for the frame to have a non-blank URL.
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const u = frame.url();
        if (u && u !== 'about:blank') break;
        await this.page.waitForTimeout(200);
      }
      return frame;
    } catch {
      return null;
    }
  }

  async _getQueueReportRoot() {
    // Prefer the Reports iframe if it contains Queue Report controls/content.
    const frame = await this._getReportsFrame();
    const hasQueueReportSignals = async (root) => {
      try {
        return await root.evaluate(() => {
          const sel = [
            // Report menu items
            'a#60017',
            'a.cls_Reports_Daily_Queue_Report',
            // Queue report page controls
            '#btnOK',
            'input[name*="date" i]',
            'input[id*="date" i]',
            '#queueLogGrid',
            'iframe[src*="ReportViewer" i]',
            'iframe[src*="queueListing" i]',
          ].join(',');
          return !!document.querySelector(sel);
        });
      } catch {
        return false;
      }
    };

    const pageHas = await hasQueueReportSignals(this.page);
    const frameHas = frame ? await hasQueueReportSignals(frame) : false;

    if (frame && frameHas && !pageHas) return { root: frame, kind: 'frame' };
    if (frame && frameHas) return { root: frame, kind: 'frame' };
    return { root: this.page, kind: 'page' };
  }

  async _dismissUpdateUserInfoIfPresent() {
    // IMPORTANT: only consider it present if it's visible.
    // Clinic Assist can keep hidden modal templates in the DOM and the ids include "_update"
    // which can confuse unrelated heuristics (e.g., date-input discovery).
    const modalLocators = [
      this.page.locator('.modal.show:has-text("Update User Info")').first(),
      this.page.locator('.ui-dialog:has-text("Update User Info")').first(),
      this.page.locator('[role="dialog"]:has-text("Update User Info")').first(),
      this.page.locator('.modal:visible:has-text("Update User Info")').first(),
      this.page.locator('text=/Update\\s+User\\s+Info/i').first(),
    ];

    let modalFound = false;
    for (const loc of modalLocators) {
      const visible = await loc.isVisible().catch(() => false);
      if (visible) {
        modalFound = true;
        break;
      }
    }

    if (!modalFound) return false;

    this._logStep('Update User Info modal detected; attempting to dismiss');

    const tries = 5; // Increased attempts
    for (let attempt = 1; attempt <= tries; attempt++) {
      // Strategy 1: Try Cancel button (multiple selectors)
      const cancelCandidates = [
        this.page.getByRole('button', { name: /^Cancel$/i }).first(),
        this.page.locator('button:has-text("Cancel")').first(),
        this.page.locator('input[type="button"][value*="Cancel" i]').first(),
        this.page.locator('input[type="submit"][value*="Cancel" i]').first(),
        this.page.locator('a:has-text("Cancel")').first(),
        this.page.locator('[onclick*="cancel" i]').first(),
        this.page.locator('[onclick*="close" i]').first(),
      ];
      
      let clicked = false;
      for (const c of cancelCandidates) {
        try {
          const count = await c.count().catch(() => 0);
          if (count === 0) continue;
          
          // Check if visible
          const isVisible = await c.isVisible().catch(() => false);
          if (!isVisible) continue;
          
          await c.click({ timeout: 3000 }).catch(async () => {
            // Fallback: use evaluate to click directly
            await this.page.evaluate((el) => {
              if (el) el.click();
            }, await c.elementHandle().catch(() => null));
          });
          clicked = true;
          break;
        } catch (e) {
          continue;
        }
      }

      // Strategy 2: Try close button (×, X, Close)
      if (!clicked) {
        const closeCandidates = [
          this.page.locator('button:has-text("×")').first(),
          this.page.locator('button:has-text("✕")').first(),
          this.page.locator('button:has-text("X")').first(),
          this.page.locator('.close').first(),
          this.page.locator('[aria-label*="close" i]').first(),
          this.page.locator('[class*="close" i]').first(),
          this.page.locator('[id*="close" i]').first(),
          this.page.locator('[data-dismiss="modal"]').first(),
          this.page.locator('[data-bs-dismiss="modal"]').first(),
        ];
        
        for (const closeBtn of closeCandidates) {
          try {
            const count = await closeBtn.count().catch(() => 0);
            if (count === 0) continue;
            const isVisible = await closeBtn.isVisible().catch(() => false);
            if (!isVisible) continue;
            
            await closeBtn.click({ timeout: 3000 }).catch(async () => {
              await this.page.evaluate((el) => {
                if (el) el.click();
              }, await closeBtn.elementHandle().catch(() => null));
            });
            clicked = true;
            break;
          } catch (e) {
            continue;
          }
        }
      }

      // Strategy 3: Try Escape key
      if (!clicked) {
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.waitForTimeout(500);
      }

      // Strategy 4: Use page.evaluate to find and click Cancel button DIRECTLY (MOST AGGRESSIVE)
      if (!clicked) {
        try {
          const clickedViaEval = await this.page.evaluate(() => {
            // Search entire document for Cancel button (not just within modal)
            // This is more reliable if modal structure is complex
            const allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a, span[onclick], div[onclick], [role="button"]'));
            
            // Find button with exact "Cancel" text
            for (const btn of allButtons) {
              const text = (btn.textContent || btn.value || btn.innerText || btn.title || '').trim();
              if (text.toLowerCase() === 'cancel') {
                // Check if it's visible (not hidden)
                const style = window.getComputedStyle(btn);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                  continue;
                }
                
                // Try to click it
                try {
                  btn.focus();
                  btn.click();
                  // Also dispatch events to ensure it's triggered
                  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                  btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                  return true;
                } catch (e) {
                  // Try alternative methods
                  try {
                    if (btn.onclick) {
                      btn.onclick();
                    }
                    btn.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
                    return true;
                  } catch (e2) {
                    continue;
                  }
                }
              }
            }
            
            // Fallback: Find modal and search within it
            let modalContainer = null;
            const modalText = Array.from(document.querySelectorAll('*')).find(el => {
              const text = (el.textContent || '').trim();
              return /Update\s+User\s+Info/i.test(text);
            });
            
            if (modalText) {
              // Walk up to find modal container
              let parent = modalText;
              for (let i = 0; i < 15; i++) {
                if (!parent) break;
                const classList = (parent.className || '').toLowerCase();
                const id = (parent.id || '').toLowerCase();
                if (classList.includes('modal') || classList.includes('dialog') || 
                    classList.includes('popup') || id.includes('modal') || 
                    id.includes('dialog') || parent.tagName === 'DIALOG') {
                  modalContainer = parent;
                  break;
                }
                parent = parent.parentElement;
              }
            }
            
            if (modalContainer) {
              const modalButtons = Array.from(modalContainer.querySelectorAll('button, input[type="button"], input[type="submit"], a'));
              for (const btn of modalButtons) {
                const text = (btn.textContent || btn.value || '').trim().toLowerCase();
                if (text === 'cancel' || text.includes('cancel')) {
                  try {
                    btn.click();
                    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    return true;
                  } catch (e) {
                    continue;
                  }
                }
              }
            }
            
            return false;
          });
          
          if (clickedViaEval) {
            clicked = true;
            await this.page.waitForTimeout(1500); // Give modal more time to close
          }
        } catch (e) {
          // Ignore
        }
      }

      // Strategy 5: Try clicking outside modal (backdrop)
      if (!clicked) {
        try {
          const backdrop = this.page.locator('.modal-backdrop, .ui-widget-overlay, [class*="overlay"]').first();
          const backdropCount = await backdrop.count().catch(() => 0);
          if (backdropCount > 0) {
            await backdrop.click({ timeout: 2000, force: true }).catch(() => {});
          }
        } catch (e) {
          // Ignore
        }
      }

      // Wait and check if modal is gone
      await this.page.waitForTimeout(1000);
      
      modalFound = false;
      for (const loc of modalLocators) {
        const visible = await loc.isVisible().catch(() => false);
        if (visible) {
          modalFound = true;
          break;
        }
      }
      
      if (!modalFound) {
        this._logStep('Update User Info modal dismissed successfully');
        await this.page
          .screenshot({ path: 'screenshots/clinic-assist-dismissed-update-user-info.png', fullPage: true })
          .catch(() => {});
        return true;
      }
      
      this._logStep('Update User Info modal still present after attempt', { attempt });
    }

    // If still blocking, try one final aggressive approach: find and click Cancel using direct DOM query
    this._logStep('Update User Info modal could not be dismissed; trying final DOM-based approach');
    
    try {
      const finalDismiss = await this.page.evaluate(() => {
        // Find all buttons/inputs with "Cancel" text anywhere in the document
        const allElements = Array.from(document.querySelectorAll('*'));
        for (const el of allElements) {
          const tag = el.tagName.toLowerCase();
          if (tag !== 'button' && tag !== 'input' && tag !== 'a' && tag !== 'span' && tag !== 'div') continue;
          
          const text = (el.textContent || el.value || el.innerText || '').trim();
          if (text.toLowerCase() === 'cancel') {
            // Check visibility
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            
            // Try to click
            try {
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
              el.focus();
              el.click();
              
              // Also trigger events
              const events = ['mousedown', 'mouseup', 'click'];
              for (const eventType of events) {
                el.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true, view: window }));
              }
              
              return true;
            } catch (e) {
              // Try onclick if it exists
              if (el.onclick) {
                try {
                  el.onclick();
                  return true;
                } catch (e2) {
                  continue;
                }
              }
            }
          }
        }
        return false;
      });
      
      if (finalDismiss) {
        await this.page.waitForTimeout(2000);
        // Check if modal is gone
        let stillThere = false;
        for (const loc of modalLocators) {
          const visible = await loc.isVisible().catch(() => false);
          if (visible) {
            stillThere = true;
            break;
          }
        }
        if (!stillThere) {
          this._logStep('Update User Info modal dismissed via final DOM approach');
          return true;
        }
      }
    } catch (e) {
      // Ignore
    }
    
    await this.page.screenshot({ path: 'screenshots/clinic-assist-update-user-info-blocking.png', fullPage: true }).catch(() => {});
    
    // Return false - extraction will proceed but may be limited
    return false;
  }

  _normalizeVisitType(s) {
    const t = (s || '').toString().trim().toLowerCase();
    if (!t) return null;
    if (t.includes('new')) return 'NEW_VISIT';
    if (t.includes('follow')) return 'FOLLOW_UP';
    return t.toUpperCase().replace(/\s+/g, '_');
  }

  async _findAutoMhcQueueRowJqGrid() {
    const jqGrid = this.page.locator('#queueLogGrid');
    if ((await jqGrid.count().catch(() => 0)) === 0) return null;

    const mhcRow = jqGrid.locator('tr.jqgrow:has(td[aria-describedby$="_PayType"]:has-text("MHC"))').first();
    const aiaRow = jqGrid.locator('tr.jqgrow:has(td[aria-describedby$="_PayType"]:has-text("AIA"))').first();
    const row = (await mhcRow.count().catch(() => 0)) > 0 ? mhcRow : aiaRow;
    if ((await row.count().catch(() => 0)) === 0) return null;
    return row;
  }

  async _openVisitFromQueueRow(row) {
    // SIMPLIFIED: Just click the patient name directly to open the visit record
    // This is the most direct way and avoids unnecessary Action menu clicks
    const rowSummary = {
      patientName: ((await row.locator('td[aria-describedby$="_PatientName"]').first().textContent().catch(() => '')) || '').trim(),
      nric: ((await row.locator('td[aria-describedby$="_NRIC"]').first().textContent().catch(() => '')) || '').trim(),
      payType: ((await row.locator('td[aria-describedby$="_PayType"]').first().textContent().catch(() => '')) || '').trim(),
      visitType: ((await row.locator('td[aria-describedby$="_VisitType"]').first().textContent().catch(() => '')) || '').trim(),
    };
    this._logStep('Opening visit by clicking patient name', rowSummary);

    const dismissQueueEditModalIfPresent = async () => {
      const modalTitle = this.page.locator('text=/Edit\\s+Queue\\s+Record/i').first();
      if ((await modalTitle.count().catch(() => 0)) === 0) return false;
      this._logStep('Edit Queue Record modal detected; dismissing');
      const cancel = this.page.getByRole('button', { name: /^Cancel$/i }).first();
      if ((await cancel.count().catch(() => 0)) > 0) {
        await cancel.click().catch(async () => cancel.click({ force: true }));
      } else {
        await this.page.keyboard.press('Escape').catch(() => {});
      }
      await this.page.waitForTimeout(800);
      return true;
    };

    // PRIMARY METHOD: Click the row or any cell to open visit record
    // In jqGrid, clicking anywhere on the row often opens the record
    // Dismiss any existing modals before clicking
    await this._dismissUpdateUserInfoIfPresent().catch(() => false);
    
    // Try clicking patient name cell first, if found
    let clicked = false;
    const nameCell = row.locator('td[aria-describedby$="_PatientName"]').first();
    if ((await nameCell.count().catch(() => 0)) > 0) {
      this._logStep('Clicking patient name cell to open visit record');
      try {
        await nameCell.click({ timeout: 5000 });
        clicked = true;
      } catch (e) {
        // Continue to fallback
      }
    }
    
    // Fallback: click any cell in the row (often works in jqGrid)
    if (!clicked) {
      this._logStep('Patient name cell not found; clicking first cell in row');
      const firstCell = row.locator('td').first();
      if ((await firstCell.count().catch(() => 0)) > 0) {
        try {
          await firstCell.click({ timeout: 5000 });
          clicked = true;
        } catch (e) {
          // Continue to final fallback
        }
      }
    }
    
    // Final fallback: click the row itself
    if (!clicked) {
      this._logStep('Clicking row directly to open visit record');
      await row.click({ timeout: 10000 }).catch(async () => {
        await row.click({ timeout: 10000, force: true });
      });
    }
    
    await this.page.waitForTimeout(2000); // Wait for navigation
    
    // Dismiss Update User Info modal if it appeared
    const modalAppeared = (await this.page.locator('text=/Update\\s+User\\s+Info/i').count().catch(() => 0)) > 0;
    if (modalAppeared) {
      this._logStep('Update User Info modal appeared; dismissing');
      await this._dismissUpdateUserInfoIfPresent().catch(() => false);
      await this.page.waitForTimeout(1000);
    }
    
    // Dismiss Edit Queue Record modal if it appeared (wrong page)
    if (await dismissQueueEditModalIfPresent()) {
      this._logStep('Edit Queue Record modal appeared; this is not the visit record');
      return false;
    }
    
    // Check if we successfully navigated away from queue page
    const currentUrl = this.page.url();
    const stillOnQueue = currentUrl.includes('/QueueLog') || currentUrl.includes('/Queue');
    if (stillOnQueue) {
      this._logStep('Still on queue page after clicking patient name');
      return false;
    }
    
    // Successfully navigated to visit record
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(1000);
    await this.page.screenshot({ path: 'screenshots/clinic-assist-visit-opened.png', fullPage: true }).catch(() => {});
    this._logStep('Successfully opened visit record');
    return true;
  }

  async _pickBestVisibleLocator(selectors) {
    // Pick the first locator that exists AND has a real bounding box (or isVisible).
    for (const selector of selectors) {
      const loc = this.page.locator(selector);
      const count = await loc.count().catch(() => 0);
      if (!count) continue;

      for (let i = 0; i < count; i++) {
        const candidate = loc.nth(i);
        try {
          const box = await candidate.boundingBox();
          const visible = await candidate.isVisible().catch(() => false);
          if (visible) return candidate;
          if (box && box.width > 1 && box.height > 1) return candidate;
        } catch {
          // ignore and keep trying
        }
      }
    }
    return null;
  }

  async _selectFirstNonEmptyOption(selectLocator) {
    const optionValues = await selectLocator.locator('option').evaluateAll((opts) =>
      opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
    );
    const candidate =
      optionValues.find((o) => o.value && o.value.trim().length > 0) ||
      optionValues.find((o) => o.label && o.label.trim().length > 0);
    if (!candidate) return false;

    try {
      await selectLocator.selectOption({ value: candidate.value });
      return true;
    } catch {
      try {
        await selectLocator.selectOption({ label: candidate.label });
        return true;
      } catch {
        return false;
      }
    }
  }

  async _extractLabeledValue(labelRegexSource) {
    return await this.page.evaluate((labelRegexSource) => {
      const labelRe = new RegExp(labelRegexSource, 'i');
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

      // Filter out modal content - exclude elements that are part of "Update User Info" modal
      const isModalElement = (el) => {
        const text = (el.textContent || '').trim();
        if (/Update\s+User\s+Info|Please enter your login|User ID|Full Name|New Password|Retype Password|Email|Mobile|Confirm|Cancel/i.test(text)) {
          // Check if this is actually the modal (not just text that happens to contain these words)
          const parent = el.closest('.modal, .ui-dialog, [class*="dialog"], [class*="popup"]');
          return !!parent;
        }
        return false;
      };

      const candidates = Array.from(document.querySelectorAll('label, div, span, td, th, strong, b'));
      for (const el of candidates) {
        // Skip modal elements
        if (isModalElement(el)) continue;
        
        const text = norm(el.textContent);
        if (!text) continue;
        if (!labelRe.test(text)) continue;

        const next = el.nextElementSibling;
        if (next && !isModalElement(next)) {
          const v = norm(next.textContent);
          // Filter out modal text
          if (v && !/Update\s+User\s+Info|Please enter your login/i.test(v)) return v;
        }

        const tr = el.closest('tr');
        if (tr) {
          const cells = Array.from(tr.querySelectorAll('td, th')).map((c) => norm(c.textContent));
          const idx = cells.findIndex((c) => labelRe.test(c));
          if (idx >= 0 && cells[idx + 1]) {
            const value = cells[idx + 1];
            // Filter out modal text
            if (!/Update\s+User\s+Info|Please enter your login/i.test(value)) return value;
          }
        }

        const container = el.parentElement;
        if (container && !isModalElement(container)) {
          const full = norm(container.textContent);
          // Filter out modal text before matching
          if (!/Update\s+User\s+Info|Please enter your login/i.test(full)) {
            const match = full.match(new RegExp(`${labelRegexSource}\\s*[:#-]?\\s*([A-Z]{1,2}\\d{7}[A-Z])`, 'i'));
            if (match?.[1]) return match[1];
          }
        }
      }

      return null;
    }, labelRegexSource);
  }

  async openQueuedPatientForExtraction(patientIdentifierOrKeywords) {
    this._logStep('Open queued patient/visit for extraction', { patientIdentifierOrKeywords });
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(1000);

    if (!patientIdentifierOrKeywords || patientIdentifierOrKeywords === '__AUTO_MHC_AIA__') {
      // Preferred: jqGrid table used by QueueLog
      const jqRow = await this._findAutoMhcQueueRowJqGrid();
      if (jqRow) {
        this._logStep('Queue: found MHC/AIA row in jqGrid; opening visit');
        await this._openVisitFromQueueRow(jqRow);
        return;
      }

      // QueueLog/Index is rendered as an ARIA grid in many builds (divs with role=row),
      // but some builds may also include a real <table>. Support both.
      const roleRows = this.page.locator('[role="row"]');
      const roleRowCount = await roleRows.count().catch(() => 0);

      let row = null;
      if (roleRowCount > 1) {
        // Filter to data rows by requiring a queue status keyword
        const dataRows = roleRows.filter({ hasText: /\b(Paid|Seen|New)\b/i });
        row = dataRows.filter({ hasText: /(MHC|AIA|AIACLient)/i }).first();
      } else {
        const queueTable = this.page.locator('table:has(th:has-text("QNo"))').first();
        const rows = queueTable.locator('tbody tr');
        await rows.first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
        row = rows.filter({ hasText: /(MHC|AIA|AIACLient)/i }).first();
      }

      const rowCount = row ? await row.count().catch(() => 0) : 0;
      if (rowCount === 0) {
        // Log available pay types for debugging
        const availablePayTypes = await this.page.evaluate(() => {
          const payTypeCells = Array.from(document.querySelectorAll('td[aria-describedby*="PayType"]'));
          const payTypes = new Set();
          payTypeCells.forEach(cell => {
            const text = (cell.textContent || '').trim();
            if (text) payTypes.add(text);
          });
          return Array.from(payTypes);
        }).catch(() => []);
        
        this._logStep('No MHC/AIA patients found in queue', { availablePayTypes });
        throw new Error(`No queue row matched MHC/AIA keywords. Available pay types: ${availablePayTypes.join(', ') || 'none'}`);
      }
      this._logStep('Queue: opening visit by clicking matched row');
      await row.click({ timeout: 10000 }).catch(async () => row.click({ timeout: 10000, force: true }));
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(1500);
      await this.page.screenshot({ path: 'screenshots/clinic-assist-visit-opened.png', fullPage: true }).catch(() => {});
      return;
    }

    const patientIdentifier = patientIdentifierOrKeywords;
    
    // Check if identifier looks like a patient number (5 digits)
    const isPatientNumber = /^\d{4,5}$/.test(String(patientIdentifier).trim());
    const normalizedPatientNumber = isPatientNumber ? String(patientIdentifier).trim().padStart(5, '0') : null;
    
    // Preferred: jqGrid table used by QueueLog
    const jqGrid = this.page.locator('#queueLogGrid');
    if ((await jqGrid.count().catch(() => 0)) > 0) {
      let row = null;
      
      // If it's a patient number, search in PCNO column specifically
      if (isPatientNumber && normalizedPatientNumber) {
        this._logStep('Queue: searching by patient number (PCNO)', { patientNumber: normalizedPatientNumber });
        // Try to find row by PCNO column
        const pcnoRows = jqGrid.locator('tr.jqgrow');
        const rowCount = await pcnoRows.count().catch(() => 0);
        
        for (let i = 0; i < rowCount; i++) {
          const testRow = pcnoRows.nth(i);
          const pcnoCell = testRow.locator('td[aria-describedby$="_PCNO"]').first();
          if ((await pcnoCell.count().catch(() => 0)) > 0) {
            const pcnoText = (await pcnoCell.textContent().catch(() => '') || '').trim();
            const cellNormalized = pcnoText.padStart(5, '0');
            if (cellNormalized === normalizedPatientNumber || pcnoText === patientIdentifier) {
              row = testRow;
              this._logStep('Queue: found patient by PCNO', { pcno: pcnoText, normalized: normalizedPatientNumber });
              break;
            }
          }
        }
        
        // Also try searching in all cells of the row
        if (!row) {
          for (let i = 0; i < rowCount; i++) {
            const testRow = pcnoRows.nth(i);
            const rowText = (await testRow.textContent().catch(() => '') || '').trim();
            if (rowText.includes(normalizedPatientNumber) || rowText.includes(patientIdentifier)) {
              row = testRow;
              this._logStep('Queue: found patient by number in row text', { patientNumber });
              break;
            }
          }
        }
      }
      
      // Fallback to general text search
      if (!row) {
        row = jqGrid.locator('tr').filter({ hasText: patientIdentifier }).first();
      }
      
      if ((await row.count().catch(() => 0)) === 0) {
        // Take screenshot for debugging
        await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-search-failed.png', fullPage: true }).catch(() => {});
        throw new Error(`Patient not found in queue by identifier: ${patientIdentifier}`);
      }
      this._logStep('Queue: opening visit for specified patient (jqGrid)', { patientIdentifier });
      await this._openVisitFromQueueRow(row);
      return;
    }

    // Fallback: regular table
    const queueTable = this.page.locator('table:has(th:has-text("QNo"))').first();
    let row = null;
    
    // If patient number, search more carefully
    if (isPatientNumber && normalizedPatientNumber) {
      const rows = queueTable.locator('tbody tr');
      const rowCount = await rows.count().catch(() => 0);
      
      for (let i = 0; i < rowCount; i++) {
        const testRow = rows.nth(i);
        const rowText = (await testRow.textContent().catch(() => '') || '').trim();
        // Check if row contains the patient number (with or without zero padding)
        if (rowText.includes(normalizedPatientNumber) || 
            rowText.includes(patientIdentifier) ||
            rowText.match(new RegExp(`\\b${patientIdentifier}\\b`)) ||
            rowText.match(new RegExp(`\\b${normalizedPatientNumber}\\b`))) {
          row = testRow;
          this._logStep('Queue: found patient by number in table', { patientNumber });
          break;
        }
      }
    }
    
    // Fallback to general text search
    if (!row) {
      row = queueTable.locator('tbody tr').filter({ hasText: patientIdentifier }).first();
    }
    
    if ((await row.count().catch(() => 0)) === 0) {
      // Take screenshot for debugging
      await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-search-failed.png', fullPage: true }).catch(() => {});
      throw new Error(`Patient not found in queue by identifier: ${patientIdentifier}`);
    }
    this._logStep('Queue: opening visit for specified patient (table)', { patientIdentifier });
    await row.click({ timeout: 10000 }).catch(async () => row.click({ timeout: 10000, force: true }));
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(1500);
    await this.page.screenshot({ path: 'screenshots/clinic-assist-visit-opened.png', fullPage: true }).catch(() => {});
  }

  /**
   * Improved diagnosis extraction with validation and better filtering
   * @param {string} context - 'visit_notes' or 'dispense_payment'
   * @returns {Object} { isValid, text, reason }
   */
  async _extractDiagnosisWithValidation(context = 'visit_notes') {
    return await this.page.evaluate((context) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      
      // Patterns to exclude (modal text, UI elements, etc.)
      const excludedPatterns = [
        /Update\s+User\s+Info/i,
        /Please enter your login/i,
        /User ID|Full Name|New Password|Retype Password|Email|Mobile/i,
        /Confirm|Cancel|Submit|Save|Close|OK/i,
        /Please\s+(fill|select|choose)/i,
        /^(Click|Select|Choose|Enter|Loading|Please wait)/i,
        /^[\s\W]+$/, // Only whitespace/punctuation
      ];

      // Medical keywords that suggest real diagnosis content
      const medicalKeywords = [
        /\b(fever|headache|pain|ache|sore|infection|flu|cough|cold|rash|swelling|injury|wound|fracture|sprain|strain|bruise|cut|burn|nausea|vomit|diarrhea|constipation|dizziness|fatigue|weakness|malaise|chills|sweating|itching|bleeding|discharge|inflammation|ulcer|lesion|abscess|infection|bacteria|virus|fungus|allergy|reaction|asthma|hypertension|diabetes|cholesterol|heart|lung|liver|kidney|stomach|intestine|muscle|bone|joint|skin|eye|ear|nose|throat|chest|back|neck|shoulder|knee|ankle|wrist|elbow|hand|foot)\b/i,
        /\b(consult|review|follow|check|examine|assess|evaluate|diagnose|treat|prescribe|advise|recommend|refer|admit|discharge)\b/i,
        /\b(cm|kg|mg|ml|days|weeks|months|years|times|doses|tablets|capsules|syrup|cream|ointment|injection|vaccine)\b/i,
      ];

      // Helper: Check if element is in a modal or dialog
      const isInModal = (el) => {
        const modalParents = el.closest('.modal, .ui-dialog, [class*="dialog"], [class*="popup"], [class*="overlay"], [role="dialog"]');
        return !!modalParents;
      };

      // Helper: Check if text matches excluded patterns
      const isExcluded = (text) => {
        return excludedPatterns.some(pattern => pattern.test(text));
      };

      // Helper: Score text for medical relevance
      const scoreMedicalRelevance = (text) => {
        let score = 0;
        // Length score (moderate length is better - too short is suspicious, too long might be page text)
        if (text.length >= 20 && text.length <= 2000) score += 10;
        else if (text.length > 2000) score -= 5;
        
        // Medical keywords score
        const keywordMatches = medicalKeywords.filter(kw => kw.test(text)).length;
        score += keywordMatches * 5;
        
        // Penalize if looks like UI element
        if (/^(OK|Yes|No|Cancel|Close|Submit|Save)$/i.test(text)) score -= 50;
        if (isExcluded(text)) score -= 100;
        
        return score;
      };

      // Selectors based on context
      const selectors = context === 'visit_notes' 
        ? [
            // Preferred: Specific textarea/input fields
            'textarea[name*="note" i]',
            'textarea[name*="diagnosis" i]',
            'textarea[name*="visit" i]',
            'textarea[name*="consult" i]',
            'textarea[id*="note" i]',
            'textarea[id*="diagnosis" i]',
            'textarea[id*="visit" i]',
            'textarea[id*="consult" i]',
            // Fallback: Divs with specific class names
            'div[class*="visit-note" i]',
            'div[class*="consultation-note" i]',
            'div[class*="diagnosis" i]',
            'div[class*="case-note" i]',
            // Generic fallback
            'textarea',
            'div[class*="note" i]:not([class*="modal"]):not([class*="dialog"])',
            'div[class*="visit" i]:not([class*="modal"]):not([class*="dialog"])',
            'div[class*="consult" i]:not([class*="modal"]):not([class*="dialog"])',
          ]
        : [
            // Dispense/payment specific
            'textarea[name*="case" i]',
            'textarea[name*="note" i]',
            'div[class*="case-note" i]',
            'td:has-text("Case") + td',
            'td:has-text("Note") + td',
            'textarea',
            'div[class*="note" i]:not([class*="modal"]):not([class*="dialog"])',
            'div[class*="case" i]:not([class*="modal"]):not([class*="dialog"])',
          ];

      const candidates = [];
      
      // Try each selector
      for (const selector of selectors) {
        try {
          const elements = Array.from(document.querySelectorAll(selector));
          for (const el of elements) {
            // Skip if in modal
            if (isInModal(el)) continue;
            
            // Skip hidden elements
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            
            // Get text (prefer value for inputs/textarea, textContent for divs)
            const text = norm(el.value !== undefined ? el.value : el.textContent || '');
            
            // Skip empty or too short
            if (text.length < 10) continue;
            
            // Skip if matches excluded patterns
            if (isExcluded(text)) continue;
            
            // Score the candidate
            const score = scoreMedicalRelevance(text);
            
            // Only include candidates with positive score
            if (score > 0) {
              candidates.push({ text, score, len: text.length, selector });
            }
          }
        } catch (e) {
          // Continue to next selector
          continue;
        }
      }

      // Sort by score (highest first), then by length
      candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.len - a.len;
      });

      // Return best candidate if we have one
      if (candidates.length > 0) {
        const best = candidates[0];
        // Final validation: minimum score threshold
        if (best.score >= 5 && best.text.length >= 10 && best.text.length <= 5000) {
          // Clean the text
          const cleaned = best.text
            .replace(/\s+/g, ' ')
            .replace(/[\r\n]{3,}/g, '\n\n')
            .trim();
          
          return { isValid: true, text: cleaned, reason: 'valid', source: context };
        }
      }

      return { isValid: false, text: null, reason: 'no_valid_candidates', source: context };
    }, context).catch(() => ({ isValid: false, text: null, reason: 'extraction_error', source: context }));
  }

  async extractClaimDetailsFromCurrentVisit() {
    this._logStep('Extract claim details from Clinic Assist visit page');

    const sources = {};

    // If profile update modal blocks the page, dismiss it first (otherwise extraction reads modal text).
    // Try multiple times with delays
    for (let i = 0; i < 3; i++) {
      const dismissed = await this._dismissUpdateUserInfoIfPresent().catch(() => false);
      if (dismissed) {
        await this.page.waitForTimeout(1000); // Wait for modal to fully close
        break;
      }
      await this.page.waitForTimeout(500);
    }

    // Guardrail: if we're still on the Queue edit modal, abort extraction (it doesn't contain diagnosis/services)
    const isQueueEditModal =
      (await this.page.locator('text=/Edit\\s+Queue\\s+Record/i').count().catch(() => 0)) > 0;
    if (isQueueEditModal) {
      this._logStep('Extraction aborted: currently on Edit Queue Record modal (not clinical record)');
      await this.page.screenshot({ path: 'screenshots/clinic-assist-not-clinical-record.png', fullPage: true }).catch(() => {});
      return { mcDays: 0, diagnosisText: null, notesText: null, referralClinic: null, items: [], sources: { reason: 'queue_edit_modal' } };
    }

    // Final check: if Update User Info is still present after all dismissal attempts, try one more aggressive dismissal
    const isUpdateUserInfo =
      (await this.page.locator('text=/Update\\s+User\\s+Info/i').count().catch(() => 0)) > 0;
    if (isUpdateUserInfo) {
      this._logStep('Update User Info modal still present; attempting final aggressive dismissal');
      
      // Try clicking anywhere outside the modal (backdrop)
      try {
        await this.page.evaluate(() => {
          const backdrop = document.querySelector('.modal-backdrop, .ui-widget-overlay, [class*="overlay" i]');
          if (backdrop) backdrop.click();
        });
        await this.page.waitForTimeout(500);
      } catch (e) {
        // Ignore
      }
      
      // Try Escape multiple times
      for (let i = 0; i < 3; i++) {
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.waitForTimeout(300);
      }
      
      await this.page.waitForTimeout(500);
      
      // Final check
      const stillThere = (await this.page.locator('text=/Update\\s+User\\s+Info/i').count().catch(() => 0)) > 0;
      if (stillThere) {
        this._logStep('Extraction proceeding despite Update User Info modal (may affect data quality)');
        await this.page.screenshot({ path: 'screenshots/clinic-assist-update-user-info-blocking.png', fullPage: true }).catch(() => {});
        // Don't abort - try to extract what we can
      }
    }

    // Extract the 5 key details:
    // 1. MC days: always 0 per user requirement
    const mcDays = 0;
    sources.mcDays = 'always_0';

    // 2. Diagnosis: Try visit notes first, then fallback to case notes in dispense/payment
    let diagnosisText = null;
    let notesText = null;
    
    // 3. Claim amount: Extract total fee/amount (we'll max it later in submission)
    let claimAmount = null;

    // Step 1: Try to extract from visit notes (current page) - IMPROVED VERSION
    this._logStep('Extracting diagnosis from visit notes');
    const visitNotesResult = await this._extractDiagnosisWithValidation('visit_notes');
    
    if (visitNotesResult.isValid && visitNotesResult.text) {
      diagnosisText = visitNotesResult.text;
      notesText = visitNotesResult.text;
      sources.diagnosis = 'visit_notes';
      sources.diagnosisValidated = true;
      this._logStep('Diagnosis found in visit notes (validated)', { 
        sample: visitNotesResult.text.slice(0, 100),
        length: visitNotesResult.text.length
      });
    } else {
      // Step 2: Navigate to dispense/payment and extract from case notes there
      this._logStep('Visit notes not found or invalid; navigating to dispense/payment for case notes');
      const navigated = await this._navigateToDispenseAndPayment();
      if (navigated) {
        await this.page.waitForTimeout(2000);
        const caseNotesResult = await this._extractDiagnosisWithValidation('dispense_payment');
        
        if (caseNotesResult.isValid && caseNotesResult.text) {
          diagnosisText = caseNotesResult.text;
          notesText = caseNotesResult.text;
          sources.diagnosis = 'dispense_payment_case_notes';
          sources.diagnosisValidated = true;
          this._logStep('Diagnosis found in dispense/payment case notes (validated)', { 
            sample: caseNotesResult.text.slice(0, 100),
            length: caseNotesResult.text.length
          });
        } else {
          sources.diagnosis = 'not_found';
          sources.diagnosisValidated = false;
          sources.diagnosisRejectionReason = caseNotesResult.reason;
          this._logStep('Diagnosis not found or invalid in visit notes or dispense/payment case notes', {
            reason: caseNotesResult.reason
          });
        }
      } else {
        sources.diagnosis = 'dispense_payment_not_accessible';
        sources.diagnosisValidated = false;
        this._logStep('Could not navigate to dispense/payment');
      }
    }

    // Referral clinic (needed for NEW VISIT). Best-effort label-based; may be null until we confirm exact UI location.
    let referralClinic =
      (await this._extractLabeledValue('referral\\s*clinic|referred\\s*by|referral\\s*from|referring').catch(() => null)) ||
      null;
    
    // Filter out modal text if it was mistakenly extracted
    if (referralClinic && /Update\s+User\s+Info|Please enter your login|User ID|Full Name|New Password|Retype Password|Email|Mobile|Confirm|Cancel/i.test(referralClinic)) {
      referralClinic = null;
      sources.referralClinic = 'filtered_modal_text';
    } else {
      sources.referralClinic = referralClinic ? 'labeled' : 'not_found';
    }

    // 3. Claim amount: Extract total fee/amount (we'll max it later in submission)
    this._logStep('Extracting claim amount/total fee');
    claimAmount = await this.page
      .evaluate(() => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        // Look for total, amount, fee, charge labels
        const patterns = [
          /total\s*(?:amount|fee|charge)?\s*[:\$]?\s*\$?([\d,]+\.?\d*)/i,
          /amount\s*(?:due|payable)?\s*[:\$]?\s*\$?([\d,]+\.?\d*)/i,
          /fee\s*[:\$]?\s*\$?([\d,]+\.?\d*)/i,
          /charge\s*[:\$]?\s*\$?([\d,]+\.?\d*)/i,
        ];
        
        const bodyText = document.body?.innerText || '';
        for (const pattern of patterns) {
          const match = bodyText.match(pattern);
          if (match && match[1]) {
            const amount = parseFloat(match[1].replace(/,/g, ''));
            if (!isNaN(amount) && amount > 0) return amount;
          }
        }
        
        // Also try labeled fields
        const labels = ['Total', 'Amount', 'Fee', 'Charge', 'Total Amount', 'Total Fee'];
        for (const label of labels) {
          const labelEl = Array.from(document.querySelectorAll('*')).find(el => {
            const text = norm(el.textContent || '');
            return text.includes(label) && /[\d,]+\.?\d*/.test(text);
          });
          if (labelEl) {
            const text = norm(labelEl.textContent || '');
            const match = text.match(/\$?([\d,]+\.?\d*)/);
            if (match && match[1]) {
              const amount = parseFloat(match[1].replace(/,/g, ''));
              if (!isNaN(amount) && amount > 0) return amount;
            }
          }
        }
        
        return null;
      })
      .catch(() => null);
    
    sources.claimAmount = claimAmount ? 'extracted' : 'not_found';
    if (claimAmount) {
      this._logStep('Claim amount extracted', { amount: claimAmount });
    }

    // 4. Visit type: Already extracted from queue row, but verify on visit page
    // 5. Services/drugs: Extract from dispense and payment table
    this._logStep('Extracting services/drugs from dispense/payment table');
    let items = [];
    
    // If we're not already on dispense/payment, navigate there
    const isOnDispensePayment = await this.page
      .evaluate(() => {
        const bodyText = (document.body?.innerText || '').toLowerCase();
        return bodyText.includes('dispense') && bodyText.includes('payment');
      })
      .catch(() => false);

    if (!isOnDispensePayment) {
      await this._navigateToDispenseAndPayment();
      await this.page.waitForTimeout(2000);
    }

    items = await this.page
      .evaluate(() => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const results = [];

        // Look for dispense/payment table specifically
        const tables = Array.from(document.querySelectorAll('table'));
        for (const table of tables) {
          const headerText = norm(table.querySelector('thead')?.innerText || table.querySelector('tr')?.innerText || '');
          // Match dispense/payment table headers
          const isDispensePaymentTable = /(drug|medicine|medication|item|description|qty|quantity|unit|price|amount)/i.test(headerText);
          if (!isDispensePaymentTable) continue;

          const rows = Array.from(table.querySelectorAll('tbody tr, tr:not(thead tr)'));
          for (const tr of rows) {
            const tds = Array.from(tr.querySelectorAll('td')).map((td) => norm(td.innerText));
            // Skip header rows and empty rows
            if (tds.length < 2) continue;
            const joined = tds.filter((td) => td && td.length > 0).join(' | ');
            if (joined && joined.length > 3) {
              // Extract drug/service name (usually first or second column)
              const name = tds.find((td) => td && td.length > 2 && !/^\d+$/.test(td) && !/^\$/.test(td)) || joined;
              if (name) results.push(name);
            }
          }
        }

        // De-dupe and return
        return Array.from(new Set(results)).slice(0, 50);
      })
      .catch(() => []);

    sources.items = items.length > 0 ? 'dispense_payment_table' : 'not_found';

    this._logStep('Clinic Assist extracted all 5 key details', {
      mcDays,
      diagnosisSample: (diagnosisText || '').slice(0, 120) || null,
      claimAmount,
      referralClinic,
      itemsCount: items.length,
      sources,
    });

    // Validate all extracted data before returning
    const rawClaimDetails = {
      mcDays: 0, // 1. MC days: Always 0 per user requirement
      diagnosisText, // 2. Diagnosis
      notesText: notesText || null,
      claimAmount, // 3. Claim amount (will be maxed in submission)
      referralClinic, // 4. Referral clinic (for new visits)
      items, // 5. Services/drugs given
      sources,
    };

    // Run validation
    const validationResult = validateClaimDetails(rawClaimDetails);
    
    // Log validation results
    logValidationResults(validationResult, 'extraction');

    // Merge validated data with sources
    const validatedClaimDetails = {
      ...validationResult.validated,
      sources: {
        ...sources,
        validation: {
          isValid: validationResult.isValid,
          errors: validationResult.errors,
          validatedAt: new Date().toISOString(),
        },
      },
    };

    // Use validated data, but keep original for reference if validation failed
    if (!validationResult.isValid) {
      this._logStep('⚠️ Some extracted data failed validation; using validated data where possible', {
        errors: validationResult.errors,
        originalDiagnosisLength: diagnosisText?.length || 0,
        validatedDiagnosisLength: validatedClaimDetails.diagnosisText?.length || 0,
        originalItemsCount: items.length,
        validatedItemsCount: validatedClaimDetails.items?.length || 0,
      });
    }

    return validatedClaimDetails;
  }

  async _navigateToDispenseAndPayment() {
    try {
      this._logStep('Navigating to dispense/payment section');
      const dispenseSelectors = [
        'a:has-text("Dispense")',
        'a:has-text("Payment")',
        'a:has-text("Dispense and Payment")',
        'button:has-text("Dispense")',
        '[href*="dispense" i]',
        '[href*="payment" i]',
        'a[title*="dispense" i]',
        'a[title*="payment" i]',
      ];

      for (const selector of dispenseSelectors) {
        try {
          const link = this.page.locator(selector).first();
          if ((await link.count().catch(() => 0)) > 0) {
            await link.click();
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            await this.page.waitForTimeout(1500);
            this._logStep('Navigated to dispense/payment', { selector });
            await this.page.screenshot({ path: 'screenshots/clinic-assist-dispense-payment.png', fullPage: true }).catch(() => {});
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      this._logStep('Could not find dispense/payment navigation link');
      return false;
    } catch (error) {
      this._logStep('Failed to navigate to dispense/payment', { error: error.message });
      return false;
    }
  }

  /**
   * Extract NRIC from patient biodata/info page
   * This should be called after opening a patient record, before navigating to TX History
   * @returns {Promise<string|null>} NRIC if found, null otherwise
   */
  async extractPatientNricFromPatientInfo() {
    try {
      this._logStep('Extract NRIC from patient biodata/info page');
      await this.page.waitForLoadState('networkidle').catch(() => {});
      await this.page.waitForTimeout(1000);

      // NRIC/FIN can appear with spaces or separators (e.g., "S 1234 567 A", "S-1234567-A", "M 1234 567 L").
      // Match broadly, then normalize to "S1234567A" / "M1234567L".
      const nricPattern =
        /[STFGM]\s*\d{4}\s*\d{3}\s*[A-Z]|[STFGM]\d{7}\s*[A-Z]|[STFGM][\/\-]\d{7}[\/\-][A-Z]/i;

      const normalizeNric = (s) => (s || '').toUpperCase().replace(/[\s\/\-]+/g, '');
      
      // Method 1: Look for labeled fields (most reliable)
      // Try common labels for NRIC/IC on biodata page
      const nricLabels = [
        'nric',
        'n.r.i.c',
        'ic',
        'i.c',
        'id number',
        'identification number',
        'national id',
        'national registration',
        'registration id'
      ];
      
      for (const label of nricLabels) {
        const labeled = await this._extractLabeledValue(label);
        if (labeled) {
          const m = labeled.match(nricPattern);
          if (m) {
            const nric = normalizeNric(m[0]);
            this._logStep('NRIC found via labeled field', { label, nric });
            return nric;
          }
        }
      }

      // Method 2: Look in common biodata/form sections
      // Try finding NRIC in form fields, input fields, or table cells
      const formSelectors = [
        'input[name*="nric" i]',
        'input[id*="nric" i]',
        'input[name*="ic" i][type="text"]',
        'td:has-text("NRIC"), td:has-text("IC"), td:has-text("I.C")',
        'label:has-text("NRIC"), label:has-text("IC")',
      ];

      for (const selector of formSelectors) {
        try {
          if (selector.includes('input')) {
            const input = this.page.locator(selector).first();
            if ((await input.count().catch(() => 0)) > 0) {
              const value = await input.inputValue().catch(() => '');
              const m = value.match(nricPattern);
              if (m) {
                const nric = normalizeNric(m[0]);
                this._logStep('NRIC found in input field', { selector, nric });
                return nric;
              }
            }
          } else {
            // For td/label selectors, get the value from adjacent cells
            const element = this.page.locator(selector).first();
            if ((await element.count().catch(() => 0)) > 0) {
              // Try to find the value in the next cell or sibling
              const row = element.locator('..').first(); // Get parent row
              const cells = await row.locator('td, th').allTextContents().catch(() => []);
              for (const cellText of cells) {
                const m = cellText.match(nricPattern);
                if (m) {
                  const nric = normalizeNric(m[0]);
                  this._logStep('NRIC found in table cell', { selector, nric });
                  return nric;
                }
              }
              
              // Also try the element's text content
              const text = await element.textContent().catch(() => '');
              const m = text.match(nricPattern);
              if (m) {
                const nric = normalizeNric(m[0]);
                this._logStep('NRIC found in element text', { selector, nric });
                return nric;
              }
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Method 2b: Scan all input elements for NRIC/FIN patterns (some forms don't label the field)
      try {
        const inputs = this.page.locator('input');
        const count = await inputs.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const input = inputs.nth(i);
          const value = await input.inputValue().catch(() => '');
          const attrValue = (await input.getAttribute('value').catch(() => '')) || '';
          const combined = `${value} ${attrValue}`;
          const m = combined.match(nricPattern);
          if (m) {
            const nric = normalizeNric(m[0]);
            this._logStep('NRIC found in generic input scan', { nric });
            return nric;
          }
        }
      } catch (e) {
        // ignore generic scan errors
      }

      // Method 3: Search entire page body for NRIC pattern (fallback)
      const bodyText = await this.page.textContent('body').catch(() => '');
      const m2 = bodyText.match(nricPattern);
      if (m2) {
        const nric = normalizeNric(m2[0]);
        this._logStep('NRIC found in page body text', { nric });
        return nric;
      }

      this._logStep('NRIC not found in patient biodata/info page');
      return null;
    } catch (error) {
      logger.error('Error extracting NRIC from patient info:', error);
      this._logStep('Error extracting NRIC', { error: error.message });
    return null;
    }
  }

  /**
   * Get patient NRIC from the current patient record page
   * Wrapper around extractPatientNricFromPatientInfo with additional fallbacks
   * @returns {Promise<string|null>} NRIC if found, null otherwise
   */
  async getPatientNRIC() {
    try {
      this._logStep('Get patient NRIC');
      
      // First try the existing extraction method
      const nric = await this.extractPatientNricFromPatientInfo();
      if (nric) {
        return nric;
      }
      
      // Fallback: Try to find in Patient Basic Info tab
      const basicInfoTab = this.page.locator('a:has-text("Basic Info"), [href*="BasicInfo"]').first();
      if ((await basicInfoTab.count().catch(() => 0)) > 0) {
        await basicInfoTab.click().catch(() => {});
        await this.page.waitForTimeout(500);
        const nricFromBasicInfo = await this.extractPatientNricFromPatientInfo();
        if (nricFromBasicInfo) {
          return nricFromBasicInfo;
        }
      }
      
      logger.warn('Could not find patient NRIC');
      return null;
    } catch (error) {
      logger.error('Error getting patient NRIC:', error);
      return null;
    }
  }

  /**
   * Navigate to Reports section in Clinic Assist
   * @returns {Promise<boolean>} True if navigation successful
   */
  /**
   * Navigate directly to QueueReport page
   * This is the most direct way when queue is empty
   * @returns {Promise<boolean>} True if navigation successful
   */
  async navigateDirectlyToQueueReport() {
    try {
      this._logStep('Navigating directly to QueueReport page');
      
      // Get current URL to build the QueueReport URL
      const currentUrl = new URL(this.page.url());
      const queueReportUrl = new URL('/QueueLog/QueueReport', currentUrl.origin).toString();
      
      this._logStep('Navigating to QueueReport URL', { url: queueReportUrl });
      
      // Navigate directly
      await this.page.goto(queueReportUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await this.page.waitForTimeout(2000);
      
      const finalUrl = this.page.url();
      
      if (finalUrl.includes('QueueReport')) {
        this._logStep('Successfully navigated to QueueReport page', { url: finalUrl });
        await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list.png', fullPage: true }).catch(() => {});
        return true;
      } else if (finalUrl.includes('Error') || finalUrl.includes('Access Denied')) {
        this._logStep('Direct navigation failed - Access Denied', { url: finalUrl });
        return false;
      } else {
        this._logStep('Unexpected redirect', { expected: queueReportUrl, actual: finalUrl });
        return false;
      }
    } catch (error) {
      this._logStep('Error navigating directly to QueueReport', { error: error.message });
      return false;
    }
  }

  async navigateToReports() {
    try {
      this._logStep('Navigating to Reports section');
      
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(1000);

      // This modal can appear after login and blocks all interactions.
      // Dismiss it early so downstream navigation/search doesn't mistake its fields for report inputs.
      await this._dismissUpdateUserInfoIfPresent().catch(() => false);

      // Guard: some sessions bounce back to the login screen unexpectedly.
      // If we detect a login form here, re-login once so sidebar navigation works.
      const loginFormVisible = await this.page
        .locator('input[type="password"], input[name*="password" i], #Password, #txtPassword')
        .first()
        .isVisible()
        .catch(() => false);
      if (loginFormVisible) {
        this._logStep('Login form visible while navigating to Reports; re-logging in');
        await this.login().catch(() => false);
        await this.page.waitForTimeout(1500);
      }
      
      // IMPORTANT: After login, we need to click Reception first before accessing Reports
      // Check if we're already in a room (URL contains /Home/)
      const currentUrl = this.page.url();
      if (!currentUrl.includes('/Home/')) {
        this._logStep('Need to select Reception/room first before accessing Reports');
        
        // Look for Reception button/room (same logic as navigateToQueue)
        const roomSelectors = [
          'a:has-text("Reception")',
          'button:has-text("Reception")',
          '[role="button"]:has-text("Reception")',
          '[role="tab"]:has-text("Reception")',
          'a[href*="Reception"]',
          'a[href*="reception" i]',
          'div:has-text("Reception")',
        ];
        
        let receptionClicked = false;
        for (const selector of roomSelectors) {
          try {
            const roomLink = this.page.locator(selector).first();
            if ((await roomLink.count().catch(() => 0)) > 0) {
              const isVisible = await roomLink.isVisible().catch(() => false);
              if (isVisible) {
                this._logStep('Clicking Reception/room to access system', { selector });
                await roomLink.click();
                await this.page.waitForLoadState('domcontentloaded').catch(() => {});
                await this.page.waitForTimeout(2000);
                // Wait for navigation to room page (e.g. /Home/Reception)
                await this.page.waitForURL(/\/Home\//, { timeout: 10000 }).catch(() => {});
                await this.page.waitForTimeout(1000);
                receptionClicked = true;
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        if (!receptionClicked) {
          this._logStep('Could not find Reception/room button - may already be in a room or not needed');
        }
      }
      
      // FIRST: Try to open sidebar/hamburger menu if it exists (might be collapsed)
      this._logStep('Trying to open sidebar/hamburger menu');
      const menuToggleSelectors = [
        '[class*="hamburger"]',
        '[class*="sidebar-toggle"]',
        '[class*="menu-toggle"]',
        '[class*="nav-toggle"]',
        'button[class*="toggle"]',
        '.fa-bars',
        '[aria-label*="menu" i]',
        'a[data-toggle="sidebar"]',
        // Common hamburger patterns
        'button:has(span:has-text("≡"))',
        '[class*="navbar"] button',
      ];
      
      for (const selector of menuToggleSelectors) {
        try {
          const toggle = this.page.locator(selector).first();
          const count = await toggle.count().catch(() => 0);
          if (count > 0) {
            const isVisible = await toggle.isVisible().catch(() => false);
            if (isVisible) {
              this._logStep('Found menu toggle, clicking to open sidebar', { selector });
              await toggle.click({ force: true }).catch(() => {});
              await this.page.waitForTimeout(1000);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Now find the Reports sidebar link
      this._logStep('Looking for Reports link in sidebar');
      
      // Wait a moment for sidebar animation to complete
      await this.page.waitForTimeout(500);
      
      // Take screenshot to see sidebar state
      await this.page.screenshot({ path: 'screenshots/clinic-assist-sidebar-open.png', fullPage: true }).catch(() => {});
      
      // Try multiple approaches to click Reports
      // Approach 1: Click the LI element with SidebarmenuReports id (triggers JavaScript navigation)
      const reportLi = this.page.locator('#SidebarmenuReports');
      if (await reportLi.count().catch(() => 0) > 0) {
        this._logStep('Found SidebarmenuReports, trying to trigger click via JavaScript');
        try {
          // Some sidebar menus use JavaScript onclick handlers
          await this.page.evaluate(() => {
            const li = document.querySelector('#SidebarmenuReports');
            if (li) {
              // Try clicking the li's child anchor
              const anchor = li.querySelector('a.SideMenuList');
              if (anchor) {
                anchor.click();
                return 'clicked anchor';
              }
              // Otherwise trigger click on li
              li.click();
              return 'clicked li';
            }
            return 'not found';
          });
          await this.page.waitForLoadState('domcontentloaded').catch(() => {});
          await this.page.waitForTimeout(3000); // Wait longer for navigation
          
          const urlAfterClick = this.page.url();
          this._logStep('After JS click on SidebarmenuReports', { url: urlAfterClick });
          
          if (urlAfterClick.includes('ReportsMenu') || urlAfterClick.includes('Report')) {
            this._logStep('Successfully navigated via SidebarmenuReports click');
            await this._dismissUpdateUserInfoIfPresent().catch(() => false);
            return true;
          }
        } catch (e) {
          this._logStep('JS click approach failed', { error: e.message });
        }
      }
      
      // Approach 2: Try getByRole
      const reportsSidebarLink = this.page.getByRole('link', { name: /^Reports$/i });
      const reportsLinkCount = await reportsSidebarLink.count().catch(() => 0);
      this._logStep('Reports link count', { count: reportsLinkCount });
      
      if (reportsLinkCount > 0) {
        const isVisible = await reportsSidebarLink.isVisible().catch(() => false);
        this._logStep('Reports link visibility', { isVisible });
        if (isVisible) {
          const urlBefore = this.page.url();
          await reportsSidebarLink.click().catch(async () => reportsSidebarLink.click({ force: true }));
          await this.page.waitForLoadState('domcontentloaded').catch(() => {});
          await this.page.waitForTimeout(2000);
          const newUrl = this.page.url();
          this._logStep('Clicked Reports link', { newUrl, urlBefore });
          
          // Check if we actually navigated to ReportsMenu
          if (newUrl.includes('ReportsMenu') || newUrl.includes('Report')) {
            await this.page.screenshot({ path: 'screenshots/clinic-assist-reports.png', fullPage: true }).catch(() => {});
            return true;
          }
          
          // URL didn't change - Reports might be a sidebar toggle, try clicking again or look for submenu
          this._logStep('URL did not change after Reports click, trying to expand submenu');
          
          // Look for expanded submenu with Queue Report
          await this.page.waitForTimeout(1000);
          const queueReportInSubmenu = this.page.locator('a:has-text("Queue Report"), [class*="Queue_Report"], a.cls_Reports_Daily_Queue_Report').first();
          if (await queueReportInSubmenu.count().catch(() => 0) > 0) {
            const isQrVisible = await queueReportInSubmenu.isVisible().catch(() => false);
            if (isQrVisible) {
              this._logStep('Found Queue Report in expanded submenu, clicking');
              await queueReportInSubmenu.click();
              await this.page.waitForLoadState('domcontentloaded').catch(() => {});
              await this.page.waitForTimeout(2000);
              return true;
            }
          }
          
          // Try clicking Reports link that might navigate (look for link with href)
          const reportsNavLink = this.page.locator('a[href*="ReportsMenu"]').first();
          if (await reportsNavLink.count().catch(() => 0) > 0) {
            this._logStep('Found Reports navigation link with href');
            await reportsNavLink.click();
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            await this.page.waitForTimeout(2000);
            return true;
          }
          
          await this.page.screenshot({ path: 'screenshots/clinic-assist-reports.png', fullPage: true }).catch(() => {});
          return true; // Continue anyway, navigateToQueueListReport will handle finding the report
        }
      }
      
      // Fallback: Try other selectors
      const reportsSelectors = [
        'a:has-text("Reports")',
        'a:has-text("Report")',
        'a[href*="report" i]',
        'a[href*="Report" i]',
        'button:has-text("Reports")',
        'li:has-text("Reports") > a',
        '[title*="Report" i]',
        'a[title*="report" i]',
        'text=/Reports/i',
      ];

      for (const selector of reportsSelectors) {
        try {
          const link = this.page.locator(selector).first();
          if ((await link.count().catch(() => 0)) > 0) {
            const isVisible = await link.isVisible().catch(() => false);
            if (isVisible) {
              await link.click();
              await this.page.waitForLoadState('domcontentloaded').catch(() => {});
              await this.page.waitForTimeout(2000);
              this._logStep('Navigated to Reports', { selector });
              await this.page.screenshot({ path: 'screenshots/clinic-assist-reports.png', fullPage: true }).catch(() => {});
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Take a screenshot to see current state
      await this.page.screenshot({ path: 'screenshots/clinic-assist-looking-for-reports.png', fullPage: true }).catch(() => {});
      
      // Last resort: List all links to see what's available
      const allLinks = await this.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button, [role="link"], [role="button"], li, nav *'));
        return links.slice(0, 60).map(el => ({
          tag: el.tagName,
          text: (el.textContent || el.innerText || '').trim().substring(0, 50),
          href: el.href || '',
          className: (el.className || '').substring(0, 50),
          id: el.id || '',
        }));
      }).catch(() => []);
      
      // Look for anything related to Reports/Queue
      const reportsRelated = allLinks.filter(l => 
        l.text.toLowerCase().includes('report') || 
        l.text.toLowerCase().includes('queue') ||
        l.href.toLowerCase().includes('report') ||
        l.href.toLowerCase().includes('queue')
      );
      
      this._logStep('Could not find Reports navigation link - available elements', { 
        currentUrl: this.page.url(),
        reportsRelated: reportsRelated,
        allLinks: allLinks.filter(l => l.text.length > 0).slice(0, 30)
      });
      
      return false;
    } catch (error) {
      this._logStep('Error navigating to Reports', { error: error.message });
      return false;
    }
  }

  /**
   * Navigate to Queue List report within Reports section
   * @returns {Promise<boolean>} True if navigation successful
   */
  async navigateToQueueListReport() {
    try {
      this._logStep('Navigating to Queue List report');

      const { root, kind } = await this._getQueueReportRoot();
      this._logStep('Queue List navigation context', {
        kind,
        pageUrl: this.page.url(),
        frameUrl: kind === 'frame' ? root.url() : null,
      });
      
      // Wait for submenu to expand after Reports was clicked
      await this.page.waitForTimeout(1000);
      
      // Take screenshot to see current submenu state
      await this.page.screenshot({ path: 'screenshots/clinic-assist-reports-submenu.png', fullPage: true }).catch(() => {});

      // Important: do NOT click the global sidebar "Queue" item here (it navigates back to QueueLog/Index).
      // Queue list reports are accessed via the ReportsMenu section itself.
      
      // First, try to find the specific Queue Report link by ID, class, or text
      // User provided: <a id="60017" class="cls_Reports_Daily_Queue_Report UnLocked">Queue Report</a>
      const specificSelectors = [
        'a[id="60017"]',  // ID match (escaped for numeric ID)
        'a.cls_Reports_Daily_Queue_Report',  // Class match
        'a[class*="Queue_Report"]',  // Partial class match
        'a:has-text("Queue Report")',  // Text match - exact
        'text=Queue Report',  // Playwright text selector
        'a:text("Queue Report")',  // Another text match
        '[class*="Reports"] a:has-text("Queue")',  // Queue under Reports section
        '.SideMenuList:has-text("Queue Report")',  // In SideMenuList
        'li:has-text("Queue Report") > a',  // Li > a pattern
      ];
      
      // First try clicking the Queue Report link by ID=60017 using JavaScript
      // This link has empty href and no onclick attribute, so we need to trigger its event listener
      this._logStep('Trying to click Queue Report link by ID 60017');
      try {
        const clickResult = await root.evaluate(() => {
          // Use getElementById for numeric IDs (querySelector doesn't work with IDs starting with numbers)
          const link = document.getElementById('60017');
          if (link && link.tagName === 'A') {
            console.log('Found link by ID, triggering click and mousedown/mouseup events');
            // Try multiple ways to trigger the click
            // 1. Direct click
            link.click();
            // 2. Dispatch mouse events (in case there are event listeners)
            link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            link.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return { found: true, text: link.textContent?.trim(), id: '60017' };
          }
          // Also try by class name
          const linkByClass = document.querySelector('a.cls_Reports_Daily_Queue_Report');
          if (linkByClass) {
            console.log('Found link by class, triggering click');
            linkByClass.click();
            linkByClass.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return { found: true, text: linkByClass.textContent?.trim(), method: 'class' };
          }
          return { found: false };
        });
        this._logStep('JS click result for Queue Report', clickResult);
        
        if (clickResult.found) {
          await this.page.waitForTimeout(4000); // wait for either page or frame navigation

          const finalPageUrl = this.page.url();
          const finalFrameUrl = kind === 'frame' ? root.url() : null;
          this._logStep('URL after JS click on Queue Report', { pageUrl: finalPageUrl, frameUrl: finalFrameUrl });
          const ok = finalPageUrl.includes('QueueReport') || finalPageUrl.includes('QueueLog') || (finalFrameUrl && (finalFrameUrl.includes('QueueReport') || finalFrameUrl.includes('QueueLog')));
          if (ok) {
            this._logStep('Successfully navigated to QueueReport page via JS click', { pageUrl: finalPageUrl, frameUrl: finalFrameUrl });
            await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list.png', fullPage: true }).catch(() => {});
            return true;
          }
        }
      } catch (e) {
        this._logStep('JS click on Queue Report failed', { error: e.message });
      }
      
      // Fallback: try Playwright selectors
      for (const selector of specificSelectors) {
        try {
          const link = root.locator(selector).first();
          if ((await link.count().catch(() => 0)) > 0) {
            const isVisible = await link.isVisible().catch(() => false);
            if (isVisible) {
              this._logStep('Found Queue Report link by specific selector', { selector });
              await link.click({ force: true }); // Force click to bypass interceptors
              await this.page.waitForTimeout(3000);

              const finalPageUrl = this.page.url();
              const finalFrameUrl = kind === 'frame' ? root.url() : null;
              const ok = finalPageUrl.includes('QueueReport') || finalPageUrl.includes('QueueLog') || (finalFrameUrl && (finalFrameUrl.includes('QueueReport') || finalFrameUrl.includes('QueueLog')));
              if (ok) {
                this._logStep('Successfully navigated to QueueReport page', { selector, pageUrl: finalPageUrl, frameUrl: finalFrameUrl });
                await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list.png', fullPage: true }).catch(() => {});
                return true;
              }
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // Fallback: Get all links on the page for debugging and finding
      const allLinks = await root.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button, [role="menuitem"], li'));
        return links.map(link => ({
          id: link.id || '',
          className: link.className || '',
          href: link.href || link.getAttribute('href') || '',
          text: (link.textContent || link.innerText || '').trim().substring(0, 60),
          onclick: link.getAttribute('onclick') || '',
          tag: link.tagName,
        }));
      }).catch(() => []);
      
      // Find all report-related links
      const reportRelated = allLinks.filter(l => 
        l.text.toLowerCase().includes('report') || 
        l.text.toLowerCase().includes('queue') ||
        l.className.toLowerCase().includes('report') ||
        l.className.toLowerCase().includes('queue') ||
        (l.href && l.href.toLowerCase().includes('report'))
      );
      
      this._logStep('All links on Reports page', { 
        count: allLinks.length, 
        reportRelated: reportRelated.slice(0, 15)
      });

      // Extra debug: list queue-related candidates (helps when the report label/id differs per deployment)
      const queueCandidates = reportRelated.filter((l) => {
        const t = (l.text || '').toLowerCase();
        const c = (l.className || '').toLowerCase();
        const id = (l.id || '').toLowerCase();
        const oc = (l.onclick || '').toLowerCase();
        const href = (l.href || '').toLowerCase();
        return t.includes('queue') || c.includes('queue') || id.includes('queue') || oc.includes('queue') || href.includes('queue');
      });
      if (queueCandidates.length > 0) {
        this._logStep('Queue-related candidates on Reports page', { count: queueCandidates.length, candidates: queueCandidates.slice(0, 40) });
      }
      
      // Look for QueueReport link by ID, class, or text
      const queueReportLink = allLinks.find(link => 
        link.id === '60017' || 
        link.className.includes('Queue_Report') ||
        (link.href && (link.href.toLowerCase().includes('queuereport') || link.href.includes('QueueLog/QueueReport')))
      );
      
      // Also try to find by text
      const queueReportByText = allLinks.find(link => {
        const text = link.text.toLowerCase();
        return text === 'queue report' || text.includes('queue report') && 
               !link.href.includes('ReportsMenu');
      });
      
      // If Queue link goes to ReportsMenu, try clicking it to see if it opens submenu or navigates
      const queueMenuLink = allLinks.find(l => 
        l.href.includes('ReportsMenu/ReportsMenu') && l.text.toLowerCase().includes('queue')
      );
      
      if (queueMenuLink && !queueReportLink && !queueReportByText) {
        this._logStep('Found Queue menu link, clicking to navigate to ReportsMenu page', queueMenuLink);
        try {
          const menuLinkLocator = root.locator(`a[href*="ReportsMenu/ReportsMenu"]:has-text("Queue")`).first();
          if ((await menuLinkLocator.count().catch(() => 0)) > 0) {
            await menuLinkLocator.click();
            await this.page.waitForTimeout(3000); // Wait longer for page to load
            
            // Check current URL and page
            const menuPageUrl = this.page.url();
            this._logStep('After clicking Queue menu link', { url: menuPageUrl });
            await this.page.screenshot({ path: 'screenshots/clinic-assist-after-queue-menu.png', fullPage: true }).catch(() => {});
            
            // Now check for QueueReport link again (including all possible variations)
            const newLinks = await root.evaluate(() => {
              const links = Array.from(document.querySelectorAll('a[href], button[onclick], [onclick]'));
              return links.map(link => {
                const href = (link.href || link.getAttribute('href') || '').toLowerCase();
                const text = (link.textContent || link.innerText || '').trim();
                return {
                  href: href,
                  fullHref: link.href || link.getAttribute('href') || '',
                  text: text,
                  onclick: link.getAttribute('onclick') || '',
                };
              });
            }).catch(() => []);
            
            this._logStep('Links after clicking Queue menu', { count: newLinks.length, queueRelated: newLinks.filter(l => 
              l.href.includes('queue') || l.text.toLowerCase().includes('queue')
            )});
            
            // Look for QueueReport link - check for ID, class, text, or href
            const newQueueReportLink = await root.evaluate(() => {
              // Try ID first
              const byId = document.querySelector('a#60017');
              if (byId) {
                return { type: 'id', id: '60017', text: byId.textContent?.trim() || '' };
              }
              
              // Try class
              const byClass = document.querySelector('a.cls_Reports_Daily_Queue_Report, a[class*="Queue_Report"]');
              if (byClass) {
                return { type: 'class', className: byClass.className, text: byClass.textContent?.trim() || '' };
              }
              
              // Try text
              const byText = Array.from(document.querySelectorAll('a')).find(a => 
                (a.textContent || '').trim() === 'Queue Report' || 
                (a.textContent || '').trim().includes('Queue Report')
              );
              if (byText) {
                return { type: 'text', text: byText.textContent?.trim() || '', href: byText.href || '' };
              }
              
              return null;
            }).catch(() => null);
            
            if (newQueueReportLink) {
              this._logStep('Found Queue Report link after clicking Queue menu', newQueueReportLink);
              
              // Click based on type
              try {
                let clicked = false;
                if (newQueueReportLink.type === 'id') {
                  const idLocator = root.locator('#60017');
                  if ((await idLocator.count().catch(() => 0)) > 0) {
                    await idLocator.click();
                    clicked = true;
                  }
                } else if (newQueueReportLink.type === 'class') {
                  const classLocator = root.locator('.cls_Reports_Daily_Queue_Report');
                  if ((await classLocator.count().catch(() => 0)) > 0) {
                    await classLocator.click();
                    clicked = true;
                  }
                } else if (newQueueReportLink.type === 'text') {
                  const textLocator = root.locator('a:has-text("Queue Report")');
                  if ((await textLocator.count().catch(() => 0)) > 0) {
                    await textLocator.click();
                    clicked = true;
                  }
                }
                
                if (clicked) {
                  await this.page.waitForTimeout(2000);
                  
                  const finalPageUrl = this.page.url();
                  const finalFrameUrl = kind === 'frame' ? root.url() : null;
                  const ok = finalPageUrl.includes('QueueReport') || (finalFrameUrl && finalFrameUrl.includes('QueueReport'));
                  if (ok) {
                    this._logStep('Successfully navigated to QueueReport page', { pageUrl: finalPageUrl, frameUrl: finalFrameUrl });
                    await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list.png', fullPage: true }).catch(() => {});
                    return true;
                  }
                }
              } catch (e) {
                this._logStep('Error clicking QueueReport link', { error: e.message });
              }
            }
          }
        } catch (e) {
          this._logStep('Error clicking Queue menu link', { error: e.message });
        }
      }
      
      const linkToUse = queueReportLink || queueReportByText;
      
      if (linkToUse) {
        this._logStep('Found Queue Report link', linkToUse);
        
        // Try to click by href first
        if (linkToUse.href) {
          try {
            const linkLocator = this.page.locator(`a[href*="${linkToUse.href.split('/').pop()}"]`).first();
            if ((await linkLocator.count().catch(() => 0)) > 0) {
              await linkLocator.click();
              await this.page.waitForLoadState('domcontentloaded').catch(() => {});
              await this.page.waitForTimeout(2000);
              
              const finalUrl = this.page.url();
              if (finalUrl.includes('QueueReport')) {
                this._logStep('Successfully navigated to Queue List report page via link', { url: finalUrl });
                await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list.png', fullPage: true }).catch(() => {});
                await this._dismissUpdateUserInfoIfPresent().catch(() => false);
                return true;
              }
            }
          } catch (e) {
            this._logStep('Error clicking link by href', { error: e.message });
          }
        }
        
        // Try clicking by text
        if (linkToUse.text) {
          try {
            const linkLocator = this.page.locator(`a:has-text("${linkToUse.text}")`).first();
            if ((await linkLocator.count().catch(() => 0)) > 0) {
              await linkLocator.click();
              await this.page.waitForLoadState('domcontentloaded').catch(() => {});
              await this.page.waitForTimeout(2000);
              
              const finalUrl = this.page.url();
              if (finalUrl.includes('QueueReport')) {
                this._logStep('Successfully navigated to Queue List report page via text', { url: finalUrl });
                await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list.png', fullPage: true }).catch(() => {});
                await this._dismissUpdateUserInfoIfPresent().catch(() => false);
                return true;
              }
            }
          } catch (e) {
            this._logStep('Error clicking link by text', { error: e.message });
          }
        }
      }

      // Discovery fallback: some deployments don't label the report as "Queue Report" and/or don't
      // use id=60017. Try clicking any queue-related report item we can find.
      try {
        const patterns = [/queue\s*report/i, /queue\s*list/i, /queue\s*listing/i, /daily\s*queue/i];
        const clickable = root.locator('a, button, [role="menuitem"], [onclick]').filter({ hasText: /queue/i });
        const n = Math.min(await clickable.count().catch(() => 0), 60);
        for (let i = 0; i < n; i++) {
          const el = clickable.nth(i);
          const text = ((await el.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
          if (!text) continue;
          if (!patterns.some((re) => re.test(text))) continue;
          if (/^queue$/i.test(text)) continue; // likely category toggle, not a report

          this._logStep('Discovery click candidate for queue report', { text });
          const before = this.page.url();
          await el.click({ force: true }).catch(() => {});
          await this.page.waitForTimeout(2500);
          const afterPage = this.page.url();
          const afterFrame = kind === 'frame' ? root.url() : null;
          if (afterPage !== before) {
            this._logStep('After discovery click', { before, afterPage, afterFrame, text });
          }
          if (afterPage.includes('QueueReport') || afterPage.includes('QueueLog') || (afterFrame && (afterFrame.includes('QueueReport') || afterFrame.includes('QueueLog')))) {
            this._logStep('Successfully navigated to Queue report via discovery click', { pageUrl: afterPage, frameUrl: afterFrame, text });
            await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list.png', fullPage: true }).catch(() => {});
            await this._dismissUpdateUserInfoIfPresent().catch(() => false);
            return true;
          }
        }
      } catch (e) {
        // Non-fatal; continue to direct URL fallback.
      }
      
      // NOTE: Direct URL navigation commonly triggers "Access Denied" in Clinic Assist.
      // If we reached here, keep it as a hard failure so we can fix the selectors/iframe path.
      // Fallback: Try direct navigation to /QueueLog/QueueReport 
      // Since we're already on Reports page, we should have the right session context
      this._logStep('Trying direct navigation to /QueueLog/QueueReport from Reports page context');
      const currentUrl = new URL(this.page.url());
      const queueReportUrl = new URL('/QueueLog/QueueReport', currentUrl.origin).toString();
      
      this._logStep('Navigating to QueueReport URL', { url: queueReportUrl, fromUrl: currentUrl.href });
      
      // Try navigating - from Reports page context this should work
      await this.page.goto(queueReportUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await this.page.waitForTimeout(2000);
      
      const finalUrl = this.page.url();
      
      if (finalUrl.includes('QueueReport')) {
        this._logStep('Successfully navigated to Queue List report page via direct URL', { url: finalUrl });
        await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list.png', fullPage: true }).catch(() => {});
        await this._dismissUpdateUserInfoIfPresent().catch(() => false);
        return true;
      } else if (finalUrl.includes('Error') || finalUrl.includes('Access Denied')) {
        this._logStep('Navigation failed - Access Denied or Error page. May need to navigate from ReportsMenu first.', { url: finalUrl });
        await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list-error.png', fullPage: true }).catch(() => {});
        // Try navigating to ReportsMenu first, then to QueueReport
        try {
          await this.page.goto(`${currentUrl.origin}/ReportsMenu/ReportsMenu`, { waitUntil: 'domcontentloaded', timeout: 10000 });
          await this.page.waitForTimeout(2000);
          await this.page.goto(queueReportUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await this.page.waitForTimeout(2000);
          const retryUrl = this.page.url();
          if (retryUrl.includes('QueueReport')) {
            this._logStep('Successfully navigated via ReportsMenu → QueueReport', { url: retryUrl });
            await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list.png', fullPage: true }).catch(() => {});
            await this._dismissUpdateUserInfoIfPresent().catch(() => false);
            return true;
          }
        } catch (retryError) {
          this._logStep('Retry navigation also failed', { error: retryError.message });
        }
      }
      
      this._logStep('Could not navigate to Queue Report page', { finalUrl });
      return false;
    } catch (error) {
      this._logStep('Error navigating to Queue List report', { error: error.message });
      return false;
    }
  }
  
  /**
   * Search Queue List by date
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {Promise<boolean>} True if search successful
   */
  async searchQueueListByDate(date) {
    try {
      this._logStep('Searching Queue List by date', { date });

      // If the "Update User Info" modal is open, its "..._update" ids contain "date" and can confuse
      // date-input discovery (e.g., "txtUserID_update" includes "update" -> contains "date").
      await this._dismissUpdateUserInfoIfPresent().catch(() => false);
      
      // Parse date to different formats that might be needed
      const dateParts = date.split('-');
      const dateFormats = {
        yyyymmdd: date, // 2025-12-26
        ddmmyyyy: `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`, // 26/12/2025
        mmddyyyy: `${dateParts[1]}/${dateParts[2]}/${dateParts[0]}`, // 12/26/2025
        ddmmmyyyy: `${dateParts[2]} ${this._getMonthName(dateParts[1])} ${dateParts[0]}`, // 26 Dec 2025
      };

      // Try to find date input field - look for input near "Date" label
      // The date field is likely labeled "Date" on the QueueReport page
      const dateInputSelectors = [
        'input[name*="date" i]',
        'input[id*="date" i]',
        'input[placeholder*="date" i]',
        'input[name*="Date" i]',
        'input[id*="Date" i]',
        'input[type="date"]',
        'input[type="text"]',
      ];

      let dateFilled = false;
      
      // Try to find date input by looking for label "Date" and then the input next to it
      const dateInput = await this.page.evaluate((dateFormats) => {
        const norm = (s) => (s || '').trim().toLowerCase();
        
        // Find label with "Date" text
        const labels = Array.from(document.querySelectorAll('label, td, th, div, span'));
        let dateLabel = null;
        for (const label of labels) {
          const text = norm(label.textContent || label.innerText);
          if (text === 'date' || text.startsWith('date ')) {
            dateLabel = label;
            break;
          }
        }
        
        if (dateLabel) {
          // Find input near this label
          const parent = dateLabel.closest('tr, div, form, fieldset');
          if (parent) {
            const inputs = parent.querySelectorAll('input[type="text"], input[type="date"], input:not([type="button"]):not([type="submit"]):not([type="hidden"])');
            if (inputs.length > 0) {
              return {
                selector: null, // Will use direct reference
                element: inputs[0],
              };
            }
          }
        }
        
        // Fallback: find first text input that might be date
        const textInputs = document.querySelectorAll('input[type="text"], input[type="date"]');
        for (const input of textInputs) {
          const name = norm(input.name || '');
          const id = norm(input.id || '');
          if (name.includes('date') || id.includes('date')) {
            return { selector: null, element: input };
          }
        }
        
        return null;
      }, dateFormats).catch(() => null);

      // OLD CODE DISABLED - Using new datepicker interaction code below instead
      // The new code at lines 1659+ handles datepicker interaction more robustly
      // if (dateInput && dateInput.element) {
      //   ... old code disabled ...
      // }
      
      // Find ALL date inputs on the page (there might be start and end date)
      const allDateInputs = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="date"]'));
        const hasDate = (s) => {
          const t = (s || '').toLowerCase();
          // Avoid false positives like "..._update" which contains "date"
          if (t.includes('update')) return false;
          return t.includes('date');
        };
        return inputs
          .filter(input => {
            const name = input.name || '';
            const id = input.id || '';
            const placeholder = input.placeholder || '';
            return hasDate(name) || hasDate(id) || hasDate(placeholder);
          })
          .map(input => ({
            name: input.name || '',
            id: input.id || '',
            value: input.value || '',
          }));
      });
      
      this._logStep('Found date inputs on page', { count: allDateInputs.length, inputs: allDateInputs });
      
      // IMPORTANT: Try datepicker calendar interaction FIRST (before direct fill)
      // This ensures we properly use the datepicker widget instead of direct input fill
      
      // Try datepicker interaction FIRST - don't set dateFilled until we verify it worked
      if (allDateInputs.length > 0) {
        const targetDay = dateParts[2];
        const targetMonth = dateParts[1];
        const targetYear = dateParts[0];
        const expectedDate = `${targetDay}/${targetMonth}/${targetYear}`;
        
        // Try the first date input with datepicker
        const firstDateInput = allDateInputs[0];
        const selector = firstDateInput.id 
          ? `#${firstDateInput.id}` 
          : firstDateInput.name 
            ? `input[name="${firstDateInput.name}"]`
            : 'input[name*="date" i]';
        
        this._logStep('Attempting datepicker interaction', { selector, targetDate: expectedDate });
        
        try {
          const dateInputLocator = this.page.locator(selector).first();
          if (await dateInputLocator.count() > 0) {
            // Click the date input first to open calendar picker
            await dateInputLocator.click();
            await this.page.waitForTimeout(2000); // Wait longer for calendar to appear
            
            // Wait for calendar to appear
            await this.page.waitForTimeout(1000);
                
                // First, check if we need to navigate to the correct month/year
                // Look for month/year navigation buttons or dropdowns
                const currentMonthYear = await this.page.evaluate(() => {
                  const cal = document.querySelector('.calendar, .datepicker, [class*="picker"], [class*="calendar"]');
                  if (cal) {
                    const text = cal.textContent || '';
                    const monthMatch = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
                    const yearMatch = text.match(/202[0-9]/);
                    return { month: monthMatch ? monthMatch[0] : null, year: yearMatch ? yearMatch[0] : null };
                  }
                  return null;
                });
            
            this._logStep('Calendar month/year check', { current: currentMonthYear, target: { month: targetMonth, year: targetYear } });
            
            // Wait for datepicker calendar to appear and be visible
            await this.page.waitForTimeout(2000);
            
            // Use JavaScript to set the date via datepicker API if available
            // Try multiple formats since Bootstrap Datepicker can accept different formats
            const dateSetViaJS = await this.page.evaluate((selector, targetDate, day, month, year) => {
              const input = document.querySelector(selector);
              if (!input) return { success: false, reason: 'input not found' };
              
              // Try Bootstrap Datepicker API
              if (typeof jQuery !== 'undefined' && jQuery(input).datepicker) {
                try {
                  // Try 1: Date object (most reliable - month is 0-indexed, so month-1)
                  const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                  jQuery(input).datepicker('setDate', dateObj);
                  const value1 = input.value || '';
                  if (value1 && (value1.includes(day) || value1.includes(year))) {
                    return { success: true, method: 'jQuery datepicker setDate (Date object)', dateSet: value1 };
                  }
                  
                  // Try 2: DD/MM/YYYY string format (matches input field format)
                  jQuery(input).datepicker('setDate', targetDate);
                  const value2 = input.value || '';
                  if (value2 && (value2.includes(day) || value2.includes(year))) {
                    return { success: true, method: 'jQuery datepicker setDate (DD/MM/YYYY string)', dateSet: value2 };
                  }
                  
                  // Try 3: MM/DD/YYYY format (US format)
                  const usFormat = `${month}/${day}/${year}`;
                  jQuery(input).datepicker('setDate', usFormat);
                  const value3 = input.value || '';
                  if (value3 && (value3.includes(day) || value3.includes(year))) {
                    return { success: true, method: 'jQuery datepicker setDate (MM/DD/YYYY string)', dateSet: value3 };
                  }
                  
                  return { success: false, reason: 'datepicker setDate did not update input value', values: { v1: value1, v2: value2, v3: value3 } };
                } catch (e) {
                  return { success: false, reason: 'jQuery datepicker error: ' + e.message };
                }
              }
              
              return { success: false, reason: 'jQuery datepicker not available' };
            }, selector, expectedDate, targetDay, targetMonth, targetYear).catch((e) => ({ success: false, reason: 'evaluate error: ' + e.message }));
            
            if (dateSetViaJS.success) {
              await this.page.waitForTimeout(500);
              const verifyValue = await dateInputLocator.inputValue().catch(() => '');
              if (verifyValue && (verifyValue.includes(targetDay) || verifyValue.includes(targetMonth) || verifyValue.includes(targetYear))) {
                dateFilled = true;
                this._logStep('Date set via JavaScript datepicker API', { selector, dateSet: dateSetViaJS.dateSet, verifyValue });
                // Date successfully set via API
              } else {
                this._logStep('Date set via JS but value not verified', { verifyValue, expected: expectedDate });
              }
            } else {
              this._logStep('JavaScript datepicker API not available, using manual calendar selection', { reason: dateSetViaJS.reason });
            }
            
            // Manual calendar selection - check if datepicker is visible
            if (!dateFilled) {
              const datepickerState = await this.page.evaluate(() => {
                  const datepicker = document.querySelector('.datepicker, [class*="datepicker"]');
                  if (!datepicker) return { found: false };
                  
                  const rect = datepicker.getBoundingClientRect();
                  const isVisible = rect.width > 0 && rect.height > 0 && datepicker.offsetParent !== null;
                  const activeView = datepicker.querySelector('.datepicker-days:not(.hide), .datepicker-months:not(.hide), .datepicker-years:not(.hide)');
                  const switchElement = datepicker.querySelector('.datepicker-switch');
                  
                  return {
                    found: true,
                    isVisible,
                    visible: isVisible,
                    position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    activeView: activeView ? activeView.className : null,
                    currentMonth: switchElement?.textContent || '',
                  };
                });
              
              this._logStep('Datepicker state after click', datepickerState);
              
              // If datepicker is not visible, try clicking again or opening it via JavaScript
              if (datepickerState.found && !datepickerState.isVisible) {
                this._logStep('Datepicker found but not visible, trying to show it');
                // Try to trigger datepicker via JavaScript
                await this.page.evaluate((selector) => {
                  const input = document.querySelector(selector);
                  if (input) {
                    if (typeof jQuery !== 'undefined' && jQuery(input).datepicker) {
                      jQuery(input).datepicker('show');
                    } else {
                      input.focus();
                      input.click();
                    }
                  }
                }, selector);
                await this.page.waitForTimeout(2000);
                
                // Re-check visibility
                const recheck = await this.page.evaluate(() => {
                  const datepicker = document.querySelector('.datepicker, [class*="datepicker"]');
                  if (!datepicker) return { visible: false };
                  const rect = datepicker.getBoundingClientRect();
                  return { visible: rect.width > 0 && rect.height > 0 && datepicker.offsetParent !== null };
                });
                
                if (!recheck.visible) {
                  this._logStep('Datepicker still not visible after trying to show it');
                }
              }
              
              // Manual calendar selection using Playwright locators (more reliable than JavaScript clicks)
              if (datepickerState.found && datepickerState.isVisible) {
                this._logStep('Attempting manual calendar selection with Playwright locators', { targetDate: expectedDate });
                
                try {
                  // Get current month/year text from the switch
                  const currentText = await this.page.locator('.datepicker-switch').textContent().catch(() => '');
                  this._logStep('Current datepicker view', { currentText, targetYear, targetMonth });
                  
                  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                  const targetMonthName = monthNames[parseInt(targetMonth) - 1];
                  const monthIndex = parseInt(targetMonth) - 1;
                  
                  // Navigate to year if needed
                  if (!currentText.includes(targetYear)) {
                    this._logStep('Navigating to year view', { targetYear });
                    await this.page.locator('.datepicker-switch').click();
                    await this.page.locator('.datepicker-years').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                    await this.page.waitForTimeout(500);
                    
                    // Click the target year
                    const yearLocator = this.page.locator('.datepicker-years span, .datepicker-years .year')
                      .filter({ hasText: new RegExp(`^${targetYear}$`) })
                      .filter({ hasNotClass: 'disabled' })
                      .first();
                    
                    if (await yearLocator.count() > 0) {
                      await yearLocator.click();
                      await this.page.waitForTimeout(500);
                      this._logStep('Year selected', { targetYear });
                    } else {
                      this._logStep('Year not found or disabled', { targetYear });
                    }
                  }
                  
                  // Navigate to month if needed
                  // After year selection, we should be in months view, so get text from months view switch or days view
                  const currentTextAfterYear = await this.page.locator('.datepicker-months .datepicker-switch, .datepicker-days .datepicker-switch').first().textContent().catch(() => '');
                  if (!currentTextAfterYear.includes(targetMonthName) && !currentTextAfterYear.includes(targetMonth)) {
                    this._logStep('Navigating to month view', { targetMonthName });
                    // Click the switch in the current view (could be years or days view)
                    const switchInCurrentView = this.page.locator('.datepicker-years .datepicker-switch, .datepicker-days .datepicker-switch').first();
                    if (await switchInCurrentView.count() > 0) {
                      await switchInCurrentView.click();
                      await this.page.locator('.datepicker-months').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                      await this.page.waitForTimeout(500);
                    }
                    
                    // Click the target month using data-month attribute or text
                    const monthLocator = this.page.locator(`.datepicker-months span[data-month="${monthIndex}"], .datepicker-months .month[data-month="${monthIndex}"]`)
                      .first();
                    
                    if (await monthLocator.count() === 0) {
                      // Fallback: try by text
                      const monthTextLocator = this.page.locator('.datepicker-months span, .datepicker-months .month')
                        .filter({ hasText: new RegExp(targetMonthName, 'i') })
                        .first();
                      if (await monthTextLocator.count() > 0) {
                        await monthTextLocator.click();
                        await this.page.waitForTimeout(500);
                        this._logStep('Month selected by text', { targetMonthName });
                      }
                    } else {
                      await monthLocator.click();
                      await this.page.waitForTimeout(500);
                      this._logStep('Month selected by data-month', { monthIndex });
                    }
                  }
                  
                  // Wait for days view to be visible
                  await this.page.locator('.datepicker-days').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                  await this.page.waitForTimeout(500);
                  
                  // Click the target day
                  this._logStep('Selecting day', { targetDay });
                  const dayLocator = this.page.locator('.datepicker-days td.day')
                    .filter({ hasText: new RegExp(`^${targetDay}$`) })
                    .filter({ hasNotClass: 'disabled' })
                    .filter({ hasNotClass: 'old' })
                    .filter({ hasNotClass: 'new' })
                    .first();
                  
                  if (await dayLocator.count() > 0) {
                    await dayLocator.click();
                    await this.page.waitForTimeout(500);
                    
                    // Verify date was set
                    const verifyValue = await dateInputLocator.inputValue().catch(() => '');
                    if (verifyValue && (verifyValue.includes(targetDay) || verifyValue.includes(targetMonth) || verifyValue.includes(targetYear))) {
                      dateFilled = true;
                      this._logStep('Date selected from datepicker via Playwright locators', { selector, finalValue: verifyValue, targetDate: expectedDate });
                    } else {
                      this._logStep('Day clicked but date not updated in input', { verifyValue, targetDate: expectedDate });
                    }
                  } else {
                    this._logStep('Day not found or disabled', { targetDay, reason: 'day locator count is 0' });
                    
                    // Log available days for debugging
                    const availableDays = await this.page.locator('.datepicker-days td.day:not(.disabled):not(.old):not(.new)').allTextContents().catch(() => []);
                    this._logStep('Available days in calendar', { days: availableDays.slice(0, 15) });
                  }
                } catch (e) {
                  this._logStep('Error during manual calendar selection', { error: e.message, stack: e.stack });
                }
              } else if (datepickerState.found && !datepickerState.isVisible) {
                this._logStep('Datepicker not visible, cannot select date manually');
              }
            }
            
            // LAST RESORT: fill directly with comprehensive event triggering
            // Only use if datepicker API and calendar clicks both failed
            // This should rarely be needed, but kept as fallback
            if (!dateFilled) {
              this._logStep('All datepicker methods failed, using direct fill as last resort', { warning: 'This may not work correctly as it bypasses the datepicker widget' });
              
              const ddmmyyyy = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
              await dateInputLocator.clear();
              await dateInputLocator.fill(ddmmyyyy);
              await this.page.waitForTimeout(300);
              
              // Trigger comprehensive events that datepicker widgets typically listen to
              await this.page.evaluate((selector, dateValue) => {
                const input = document.querySelector(selector);
                if (input) {
                  // Set value programmatically
                  input.value = dateValue;
                  
                  // Trigger all possible events
                  ['focus', 'input', 'change', 'blur'].forEach(eventType => {
                    input.dispatchEvent(new Event(eventType, { bubbles: true, cancelable: true }));
                  });
                  
                  // Try to trigger datepicker-specific events if jQuery is available
                  if (typeof jQuery !== 'undefined') {
                    const $input = jQuery(input);
                    // Try to update datepicker if it exists
                    if ($input.data('datepicker')) {
                      try {
                        $input.trigger('changeDate');
                        $input.trigger('change');
                      } catch (e) {
                        // Ignore errors
                      }
                    }
                  }
                }
              }, selector, ddmmyyyy).catch(() => {});
              
              await dateInputLocator.press('Tab'); // Tab out to trigger change
              await this.page.waitForTimeout(500);
              
              // Verify date was set
              const value = await dateInputLocator.inputValue().catch(() => '');
              if (value && (value.includes(dateParts[2]) || value.includes(dateParts[0]))) {
                dateFilled = true;
                this._logStep('Date filled via direct fill (last resort)', { format: 'DD/MM/YYYY', selector, value, warning: 'This bypasses datepicker widget - form may not recognize it' });
              } else {
                this._logStep('Direct fill also failed - date may not be recognized by form', { value, expected: ddmmyyyy });
              }
            }
          }
        } catch (e) {
          this._logStep('Error in datepicker interaction', { error: e.message });
        }
        
        // If date was filled successfully via datepicker, we're done
        if (dateFilled) {
          this._logStep('Date successfully set via datepicker', { date: expectedDate });
        }
      }

      // Click Generate button - prioritize "Generate" button (green button on QueueReport page)
      const searchSelectors = [
        'button:has-text("Generate")',  // Primary - this is the green Generate button
        'button:has-text("Generate Report")',
        'input[type="button"][value*="Generate" i]',
        'input[type="submit"][value*="Generate" i]',
        'button[id*="generate" i]',
        'button[class*="generate" i]',
        'button[type="submit"]',
        'button:has-text("View Report")',
        'button:has-text("Search")',
        'button:has-text("Query")',
        'button:has-text("Submit")',
      ];

      let searchClicked = false;
      for (const selector of searchSelectors) {
        try {
          const searchBtn = this.page.locator(selector).first();
          if ((await searchBtn.count().catch(() => 0)) > 0) {
            const isVisible = await searchBtn.isVisible().catch(() => false);
            if (isVisible) {
              await searchBtn.click();
              await this.page.waitForLoadState('networkidle').catch(() => {});
              // Wait longer for the report to generate - tables may take time to populate
              await this.page.waitForTimeout(5000);
              
              // After Generate, check if there are Excel/PDF export buttons
              // The report might be displayed as PDF or we need to click Excel to download
              const exportInfo = await this.page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"]'));
                const exports = buttons.map(btn => ({
                  text: (btn.textContent || btn.value || '').trim(),
                  href: btn.href || '',
                  onclick: btn.getAttribute('onclick') || '',
                  className: btn.className || '',
                  id: btn.id || '',
                })).filter(btn => {
                  const text = btn.text.toLowerCase();
                  return text.includes('excel') || text.includes('pdf') || text.includes('export') ||
                         text.includes('download') || btn.href.includes('.xlsx') || btn.href.includes('.pdf') ||
                         btn.href.includes('.xls');
                });
                return exports;
              }).catch(() => []);
              
              if (exportInfo.length > 0) {
                this._logStep('Found export buttons after Generate', { exports: exportInfo });
              }
              
              // Wait for table, grid, PDF viewer, or export buttons to appear
              // Also check if page navigates to a new URL (some reports open in new page)
              await Promise.race([
                this.page.waitForSelector('table, #queueLogGrid, iframe[src*="pdf"], embed[type*="pdf"], button:has-text("Excel"), a:has-text("Excel"), button:has-text("PDF"), a:has-text("PDF"), button:has-text("Export"), a:has-text("Export"), img[alt*="Excel"], img[alt*="PDF"]', { timeout: 15000 }).catch(() => {}),
                this.page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
              ]);
              
              // Wait longer for report iframe to load
              await this.page.waitForTimeout(10000);
              
              // Check if URL changed (might have navigated to report page)
              const currentUrl = this.page.url();
              this._logStep('Search/Generate executed', { selector, url: currentUrl });
              await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list-results.png', fullPage: true }).catch(() => {});
              searchClicked = true;
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      if (!searchClicked) {
        this._logStep('Could not find search/generate button', { dateFilled });
        // Take screenshot to see what's on the page
        await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list-no-button.png', fullPage: true }).catch(() => {});
      }
      
      return dateFilled || searchClicked; // Return true if date was filled OR search was clicked
    } catch (error) {
      this._logStep('Error searching queue list by date', { error: error.message });
      return false;
    }
  }
  
  /**
   * Helper: Get month name from month number
   */
  _getMonthName(monthNum) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[parseInt(monthNum) - 1] || 'Jan';
  }

  /**
   * Extract queue list results from the page
   * Can handle table, grid, or list formats
   * @returns {Promise<Array>} Array of queue items
   */
  async extractQueueListResults() {
    try {
      this._logStep('Extracting queue list results');

      const { root, kind } = await this._getQueueReportRoot();
      const rootFrameLocator = typeof root.frameLocator === 'function'
        ? root.frameLocator.bind(root)
        : this.page.frameLocator.bind(this.page);
      const evalInRoot = root.evaluate.bind(root);
      const locInRoot = root.locator.bind(root);

      this._logStep('QueueReport extraction context', {
        kind,
        pageUrl: this.page.url(),
        frameUrl: kind === 'frame' ? root.url() : null,
      });
      
      // Take a screenshot for debugging
      await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list-extraction.png', fullPage: true }).catch(() => {});
      
      // Wait longer for iframe/PDF to load - report might take time to generate
      await this.page.waitForTimeout(8000);
      
      // First, let's check what's actually on the page
      const pageInfo = await this.page.evaluate(() => {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        const pdfIframes = iframes.filter(f => {
          const src = (f.src || '').toLowerCase();
          return src.includes('reportviewer') || src.includes('pdf') || src.includes('queuelisting') || src.includes('report');
        });
        
        // Also check all table cells for any patient data
        const allTables = Array.from(document.querySelectorAll('table'));
        const tableRowsWithData = [];
        allTables.forEach((table, idx) => {
          const rows = table.querySelectorAll('tr');
          const dataRows = Array.from(rows).filter(row => {
            const cells = row.querySelectorAll('td, th');
            const text = row.textContent || '';
            // Check if row has patient-like data (NRIC pattern or multiple cells)
            return cells.length > 3 && (text.match(/[STFGM]\d{7}[A-Z]/i) || cells.length >= 5);
          });
          if (dataRows.length > 0) {
            tableRowsWithData.push({ tableIndex: idx, rowCount: dataRows.length });
          }
        });
        
        return {
          url: window.location.href,
          title: document.title,
          hasJqGrid: !!document.querySelector('#queueLogGrid'),
          jqGridRows: document.querySelectorAll('#queueLogGrid tr.jqgrow').length,
          hasTables: allTables.length,
          tablesWithData: tableRowsWithData.length,
          hasInputs: document.querySelectorAll('input').length,
          hasIframes: iframes.length,
          hasPDFIframes: pdfIframes.length,
          iframeSrcs: pdfIframes.map(f => f.src).slice(0, 3),
          allIframeSrcs: iframes.map(f => f.src || '').slice(0, 5),
          bodyText: document.body?.innerText?.substring(0, 1000) || '',
        };
      });
      
      this._logStep('Page info', pageInfo);
      
      // ALWAYS try to extract from iframe FIRST - the report is shown in iframe
      this._logStep('Checking for ReportViewer iframe...');
      
      const iframeCheck = await this.page.evaluate(() => {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        const reportViewerIframes = iframes.filter(f => {
          const src = (f.src || '').toLowerCase();
          return src.includes('reportviewer') || src.includes('queuelisting');
        });
        return {
          totalIframes: iframes.length,
          reportViewerCount: reportViewerIframes.length,
          srcs: reportViewerIframes.map(f => f.src),
        };
      });
      
      this._logStep('Iframe check result', iframeCheck);
      
      if (iframeCheck.reportViewerCount > 0) {
        this._logStep('PDF iframe detected, waiting for it to load', { iframeCount: iframeCheck.reportViewerCount, srcs: iframeCheck.srcs });
        await this.page.waitForTimeout(5000);
        
        // Try to check if iframe has loaded content
        try {
          const iframe = this.page.locator('iframe[src*="ReportViewer"], iframe[src*="queueListing"]').first();
          if (await iframe.count() > 0) {
            // Wait for iframe to load
            await this.page.waitForTimeout(3000);
            this._logStep('ReportViewer iframe found, attempting to extract data');
          }
        } catch (e) {
          this._logStep('Could not access iframe', { error: e.message });
        }
      }
      
      // If we're on QueueReport page and jqGrid exists but is empty, try to find and use date filter
      if (pageInfo.url.includes('QueueReport') && pageInfo.hasJqGrid && pageInfo.jqGridRows === 0) {
        this._logStep('QueueReport page is empty, trying to find date filter');
        
        // Look for date filter inputs or buttons
        const dateFilterSelectors = [
          'input[type="date"]',
          'input[name*="date" i]',
          'input[id*="date" i]',
          'input[placeholder*="date" i]',
          'button:has-text("Filter")',
          'button:has-text("Search")',
          'a:has-text("Filter")',
        ];
        
        for (const selector of dateFilterSelectors) {
          const element = this.page.locator(selector).first();
          if ((await element.count().catch(() => 0)) > 0) {
            this._logStep('Found potential date filter element', { selector });
            // Try clicking filter button or filling date
            try {
              if (selector.includes('button') || selector.includes('a')) {
                await element.click();
                await this.page.waitForTimeout(2000);
              }
            } catch (e) {
              // Continue
            }
            break;
          }
        }
      }
      
      // Extract from iframe if it exists (already checked above)
      if (iframeCheck.reportViewerCount > 0) {
        this._logStep('Attempting to extract data from ReportViewer iframe', { iframeCount: iframeCheck.reportViewerCount });
        try {
          // Access iframe content - it's same-origin so we can access it!
          const iframeData = await this.page.evaluate(() => {
            const iframe = document.querySelector('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');
            if (!iframe) return null;
            
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (!iframeDoc) return null;
              
              // Extract all text content
              const bodyText = iframeDoc.body?.innerText || '';
              
              // Look for tables in iframe
              const tables = Array.from(iframeDoc.querySelectorAll('table'));
              
              // Look for buttons/links in iframe (export buttons might be here)
              const buttons = Array.from(iframeDoc.querySelectorAll('button, a, input[type="button"]'));
              
              // Extract table data
              const tableData = tables.map((table, idx) => {
                const rows = Array.from(table.querySelectorAll('tr'));
                const data = rows.map(row => {
                  const cells = Array.from(row.querySelectorAll('td, th'));
                  return cells.map(cell => (cell.textContent || '').trim());
                });
                return { index: idx, rows: data, rowCount: rows.length };
              });
              
              return {
                bodyText: bodyText.substring(0, 5000), // Limit text size
                tableCount: tables.length,
                tables: tableData,
                buttonCount: buttons.length,
                buttons: buttons.map(btn => ({
                  text: (btn.textContent || btn.value || btn.innerText || '').trim(),
                  id: btn.id || '',
                  className: btn.className || '',
                  onclick: btn.getAttribute('onclick') || '',
                })),
              };
            } catch (e) {
              return { error: e.message };
            }
          });
          
          if (iframeData && !iframeData.error) {
            this._logStep('Successfully accessed iframe content', { 
              tableCount: iframeData.tableCount, 
              buttonCount: iframeData.buttonCount,
              bodyTextLength: iframeData.bodyText.length 
            });
            
            // Check for export buttons in iframe
            if (iframeData.buttonCount > 0) {
              this._logStep('Found buttons in iframe', { buttons: iframeData.buttons });
            }
            
            // Extract data from tables in iframe
            if (iframeData.tableCount > 0) {
              this._logStep('Found tables in iframe', { tableCount: iframeData.tableCount });
              
              // Parse tables to extract queue items
              const items = [];
              for (const table of iframeData.tables) {
                // Look for rows with patient data (NRIC patterns, names, etc.)
                for (const row of table.rows) {
                  if (row.length < 3) continue;
                  
                  const rowText = row.join(' ').toLowerCase();
                  
                  // Look for NRIC pattern
                  const nricMatch = rowText.match(/[stfg]\d{7}[a-z]/i);
                  if (nricMatch) {
                    const nric = nricMatch[0].toUpperCase();
                    
                    // Find patient name (usually before NRIC or in first column)
                    let patientName = null;
                    for (const cell of row) {
                      const cellText = (cell || '').trim();
                      if (cellText.length > 3 && 
                          !/^\d+$/.test(cellText) && 
                          !/[stfg]\d{7}[a-z]/i.test(cellText) &&
                          !cellText.includes('$') &&
                          !cellText.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
                        patientName = cellText;
                        break;
                      }
                    }
                    
                    if (patientName || nric) {
                      items.push({
                        nric,
                        patientName,
                        source: 'reports_queue_list_iframe',
                        rawRow: row,
                      });
                    }
                  }
                }
              }
              
              if (items.length > 0) {
                this._logStep('Extracted items from iframe tables', { count: items.length });
                return items;
              }
            }
            
            // If no tables, try extracting from body text
            if (iframeData.bodyText) {
              this._logStep('Extracting from iframe body text', { textLength: iframeData.bodyText.length });
              
              const lines = iframeData.bodyText.split('\n');
              const items = [];
              
              for (const line of lines) {
                const nricMatch = line.match(/[STFGM]\d{7}[A-Z]/i);
                if (nricMatch) {
                  const nric = nricMatch[0];
                  // Try to find patient name nearby
                  const lineIndex = lines.indexOf(line);
                  let patientName = null;
                  
                  for (let i = Math.max(0, lineIndex - 2); i <= Math.min(lines.length - 1, lineIndex + 2); i++) {
                    const nearbyLine = lines[i].trim();
                    if (nearbyLine.length > 3 && 
                        !nric.includes(nearbyLine) &&
                        !/^\d+$/.test(nearbyLine) &&
                        !nearbyLine.includes('$') &&
                        !nearbyLine.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
                      patientName = nearbyLine;
                      break;
                    }
                  }
                  
                  items.push({
                    nric,
                    patientName,
                    source: 'reports_queue_list_iframe_text',
                  });
                }
              }
              
              if (items.length > 0) {
                this._logStep('Extracted items from iframe text', { count: items.length });
                return items;
              }
            }
          } else if (iframeData && iframeData.error) {
            this._logStep('Error accessing iframe', { error: iframeData.error });
          }
        } catch (e) {
          this._logStep('Error extracting from iframe', { error: e.message });
        }
      }
      
      // Fallback: Try old method if iframe extraction didn't work
      if (pageInfo.hasPDFIframes > 0 && pageInfo.jqGridRows === 0 && pageInfo.hasTables === 0) {
        this._logStep('Attempting to extract text from PDF iframe (fallback method)');
        try {
          // Try to get iframe content
          const iframeText = await this.page.evaluate(() => {
            const iframe = document.querySelector('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');
            if (!iframe) return null;
            
            // Try to access iframe content (might fail if cross-origin)
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (iframeDoc) {
                return iframeDoc.body?.innerText || null;
              }
            } catch (e) {
              // Cross-origin - can't access directly
              return null;
            }
            return null;
          });
          
          if (iframeText) {
            this._logStep('Extracted text from iframe', { textLength: iframeText.length, preview: iframeText.substring(0, 200) });
            // Parse text from PDF - look for NRIC patterns and patient names
            const items = [];
            const lines = iframeText.split('\n');
            let currentPatient = null;
            
            for (const line of lines) {
              // Look for NRIC pattern
              const nricMatch = line.match(/[STFGM]\d{7}[A-Z]/i);
              if (nricMatch) {
                const nric = nricMatch[0].toUpperCase();
                // Try to find patient name in nearby lines
                let patientName = null;
                const lineIndex = lines.indexOf(line);
                for (let i = Math.max(0, lineIndex - 3); i <= Math.min(lines.length - 1, lineIndex + 3); i++) {
                  const nearbyLine = lines[i].trim();
                  if (nearbyLine.length > 3 && !nricMatch[0].toUpperCase().includes(nearbyLine) && 
                      !nearbyLine.match(/^\d+$/) && !nearbyLine.includes('$') && !nearbyLine.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
                    patientName = nearbyLine;
                    break;
                  }
                }
                
                items.push({
                  nric,
                  patientName,
                  source: 'reports_queue_list_pdf',
                  rawLine: line.trim(),
                });
              }
            }
            
            if (items.length > 0) {
              this._logStep('Extracted items from PDF text', { count: items.length });
              return items;
            }
          }
        } catch (e) {
          this._logStep('Error extracting from PDF iframe', { error: e.message });
        }
      }
      
      // Continue with extraction logic below...
      
      return await this.page.evaluate(() => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const items = [];

        // Try jqGrid format first (same as queue page)
        const jqGrid = document.querySelector('#queueLogGrid');
        if (jqGrid) {
          const rows = jqGrid.querySelectorAll('tr.jqgrow');
          for (const row of rows) {
            const getCellValue = (ariaDesc) => {
              const cell = row.querySelector(`td[aria-describedby$="${ariaDesc}"]`);
              return cell ? norm(cell.textContent) : null;
            };

            const patientName = getCellValue('_PatientName');
            const nric = getCellValue('_NRIC');
            const qno = getCellValue('_QNo');
            const payType = getCellValue('_PayType');
            const visitType = getCellValue('_VisitType');
            const fee = getCellValue('_Fee');
            const inTime = getCellValue('_In');
            const outTime = getCellValue('_Out');
            const status = getCellValue('_Status');

            if (patientName || nric) {
              items.push({
                qno,
                status,
                patientName,
                nric,
                payType,
                visitType,
                fee,
                inTime,
                outTime,
                source: 'reports_queue_list',
              });
            }
          }
        } else {
          // Try regular table format
          const tables = Array.from(document.querySelectorAll('table'));
          for (const table of tables) {
            const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
            for (const row of rows) {
              const cells = Array.from(row.querySelectorAll('td'));
              if (cells.length < 5) continue;

              // Try to identify columns by header or content
              const rowText = norm(row.textContent);
              
              // Look for NRIC pattern
              const nricMatch = rowText.match(/[STFGM]\s*\d{4}\s*\d{3}\s*[A-Z]/i);
              const nric = nricMatch ? nricMatch[0].replace(/\s+/g, '').toUpperCase() : null;

              // Extract patient name (usually text before NRIC or in name column)
              let patientName = null;
              for (const cell of cells) {
                const text = norm(cell.textContent);
                if (text && text.length > 3 && !/^\d+$/.test(text) && !/^[STFGM]\d{7}[A-Z]$/i.test(text) && !text.includes('$')) {
                  patientName = text;
                  break;
                }
              }

              if (patientName || nric) {
                items.push({
                  qno: cells[0] ? norm(cells[0].textContent) : null,
                  status: cells[1] ? norm(cells[1].textContent) : null,
                  patientName,
                  nric,
                  payType: cells.find(c => /MHC|AIA|Cash|Insurance/i.test(norm(c.textContent))) ? norm(cells.find(c => /MHC|AIA|Cash|Insurance/i.test(norm(c.textContent))).textContent) : null,
                  visitType: null,
                  fee: null,
                  inTime: null,
                  outTime: null,
                  source: 'reports_queue_list',
                });
              }
            }
          }
        }

        return items;
      }).then((result) => {
        // Handle both old format (array) and new format (object with items and debug)
        if (Array.isArray(result)) {
          this._logStep('Extracted items (legacy format)', { count: result.length });
          return result;
        }
        if (result && result.items) {
          this._logStep('Extraction debug info', result.debug);
          this._logStep('Extracted items', { count: result.items.length });
          return result.items;
        }
        return [];
      });
    } catch (error) {
      this._logStep('Error extracting queue list results', { error: error.message });
      return [];
    }
  }

  /**
   * Search Queue List by date
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {Promise<boolean>} True if search successful
   */
  async searchQueueListByDate(date) {
    try {
      this._logStep('Searching Queue List by date', { date });

      // If the "Update User Info" modal is open, its "..._update" ids contain "date" and can confuse
      // date-input discovery (e.g., "txtUserID_update" includes "update" -> contains "date").
      await this._dismissUpdateUserInfoIfPresent().catch(() => false);

      const { root, kind } = await this._getQueueReportRoot();
      this._logStep('QueueReport search context', {
        kind,
        pageUrl: this.page.url(),
        frameUrl: kind === 'frame' ? root.url() : null,
      });

      const m = String(date || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) throw new Error(`Invalid date format (expected YYYY-MM-DD): ${date}`);
      const ddmmyyyy = `${m[3]}/${m[2]}/${m[1]}`;

      // Discover date inputs inside the Queue Report root.
      const dateFields = await root
        .evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="date"]'));
          const hasDate = (s) => {
            const t = (s || '').toLowerCase();
            if (t.includes('update')) return false;
            return t.includes('date');
          };
          const candidates = inputs
            .filter((el) => {
              const name = el.getAttribute('name') || '';
              const id = el.getAttribute('id') || '';
              const placeholder = el.getAttribute('placeholder') || '';
              return hasDate(name) || hasDate(id) || hasDate(placeholder);
            })
            .slice(0, 4)
            .map((el) => ({
              id: el.getAttribute('id') || '',
              name: el.getAttribute('name') || '',
              value: el.value || '',
              placeholder: el.getAttribute('placeholder') || '',
              readOnly: !!el.readOnly,
            }));
          return candidates;
        })
        .catch(() => []);

      this._logStep('QueueReport date field candidates', { count: dateFields.length, fields: dateFields });

      // Fill up to two date inputs (some reports have From/To).
      let dateFilled = false;
      for (let i = 0; i < Math.min(dateFields.length, 2); i++) {
        const f = dateFields[i];
        const selector = f.id
          ? `input[id="${f.id.replace(/"/g, '\\"')}"]`
          : f.name
            ? `input[name="${f.name.replace(/"/g, '\\"')}"]`
            : null;
        if (!selector) continue;

        const loc = root.locator(selector).first();
        if ((await loc.count().catch(() => 0)) === 0) continue;
        try {
          await loc.click({ force: true }).catch(() => {});
          await loc.fill(ddmmyyyy).catch(async () => {
            await loc.evaluate((el, v) => {
              el.value = v;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }, ddmmyyyy);
          });

          // If bootstrap-datepicker is used, set via API too (best-effort).
          await root
            .evaluate(({ selector, dd, mm, yyyy }) => {
              const el = document.querySelector(selector);
              if (!el) return;
              try {
                if (typeof jQuery !== 'undefined' && jQuery(el).datepicker) {
                  const d = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
                  jQuery(el).datepicker('setDate', d);
                }
              } catch {
                // ignore
              }
            }, { selector, dd: m[3], mm: m[2], yyyy: m[1] })
            .catch(() => {});

          const v = await loc.inputValue().catch(() => '');
          if (v) dateFilled = true;
          this._logStep('QueueReport date filled', { selector, value: v });
        } catch (e) {
          this._logStep('Failed to fill date field', { selector, error: e.message });
        }
      }

      // Click Generate (btnOK) inside the root.
      let searchClicked = false;
      try {
        const jsClick = await root.evaluate(() => {
          const btn = document.getElementById('btnOK');
          if (btn) {
            btn.click();
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return { found: true, via: 'btnOK' };
          }
          const any = document.querySelector('button:contains("Generate"), input[value*="Generate" i], button:has-text("Generate")');
          if (any) {
            any.click();
            return { found: true, via: 'generic' };
          }
          return { found: false };
        }).catch(() => ({ found: false }));
        if (jsClick.found) {
          searchClicked = true;
          this._logStep('QueueReport generate clicked via JS', jsClick);
        }
      } catch {
        // ignore
      }

      if (!searchClicked) {
        const btn = root.locator('#btnOK, button:has-text("Generate"), input[value*="Generate" i]').first();
        if ((await btn.count().catch(() => 0)) > 0) {
          await btn.click({ force: true }).catch(() => {});
          searchClicked = true;
          this._logStep('QueueReport generate clicked via locator');
        }
      }

      if (searchClicked) {
        // Give the report viewer time to render/export controls.
        await this.page.waitForTimeout(8000);
        await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list-results.png', fullPage: true }).catch(() => {});
      } else {
        await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list-no-button.png', fullPage: true }).catch(() => {});
      }

      return dateFilled || searchClicked;
    } catch (error) {
      this._logStep('Error searching queue list by date', { error: error.message });
      return false;
    }
  }

  /**
   * Helper: Get month name from month number
   */
  _getMonthName(monthNum) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[parseInt(monthNum) - 1] || 'Jan';
  }

  /**
   * Extract queue list results from the page
   * Can handle table, grid, list formats, or Excel/PDF exports
   * @returns {Promise<Array>} Array of queue items
   */
  async extractQueueListResults() {
    try {
      this._logStep('Extracting queue list results');
      
      // Take a screenshot for debugging
      await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list-extraction.png', fullPage: true }).catch(() => {});
      
      // Check for Excel/PDF export buttons - data might be shown as PDF or need Excel export
      // Also check in iframes that might contain PDF viewer or export controls
      // First check inside the ReportViewer iframe for export buttons
      let exportButtons = [];
      try {
        const outerFrame = rootFrameLocator('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');
        const iframeExportButtons = await outerFrame.locator('button, a, input[type="button"], [onclick]').all();
        
        for (const btn of iframeExportButtons) {
          try {
            const text = await btn.textContent().catch(() => '');
            const onclick = await btn.getAttribute('onclick').catch(() => '');
            const href = await btn.getAttribute('href').catch(() => '');
            const className = await btn.getAttribute('class').catch(() => '');
            const id = await btn.getAttribute('id').catch(() => '');
            const tag = await btn.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
            
            const lowerText = text.toLowerCase();
            const lowerOnclick = onclick.toLowerCase();
            const lowerHref = href.toLowerCase();
            
            if (lowerText.includes('excel') || lowerText.includes('export') || lowerText.includes('download') ||
                lowerText.includes('xls') || lowerOnclick.includes('excel') || lowerOnclick.includes('export') ||
                lowerHref.includes('.xlsx') || lowerHref.includes('.xls')) {
              exportButtons.push({
                text: text.trim(),
                href: href,
                onclick: onclick,
                className: className,
                id: id,
                tag: tag,
                location: 'iframe'
              });
            }
          } catch (e) {
            // Continue to next button
          }
        }
      } catch (e) {
        this._logStep('Error searching for export buttons in iframe', { error: e.message });
      }
      
      // Also check in the main page
      const mainPageButtons = await evalInRoot(() => {
        const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], span[onclick], div[onclick], img[alt], img[title]'));
        const results = buttons.map(btn => ({
          text: (btn.textContent || btn.value || btn.innerText || btn.alt || btn.title || '').trim(),
          href: btn.href || '',
          onclick: btn.getAttribute('onclick') || '',
          className: btn.className || '',
          id: btn.id || '',
          tag: btn.tagName.toLowerCase(),
          src: btn.src || '',
        })).filter(btn => {
          const text = btn.text.toLowerCase();
          const src = (btn.src || '').toLowerCase();
          return text.includes('excel') || text.includes('pdf') || text.includes('export') ||
                 text.includes('download') || text.includes('xls') || 
                 btn.href.includes('.xlsx') || btn.href.includes('.pdf') || btn.href.includes('.xls') ||
                 btn.onclick.toLowerCase().includes('excel') || btn.onclick.toLowerCase().includes('pdf') || 
                 btn.onclick.toLowerCase().includes('export') || btn.onclick.toLowerCase().includes('download') ||
                 src.includes('excel') || src.includes('export') || src.includes('download');
        });
        
        // Also check all buttons/links for any that might be export-related by position or context
        const allClickable = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [onclick]'));
        const potentialExports = allClickable
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0; // Visible
          })
          .slice(0, 20); // Limit to first 20 visible buttons to check
          
        return results;
      }).catch(() => []);
      
      // Wait a bit more and check again - buttons might appear after page fully loads
      if (exportButtons.length === 0) {
        await this.page.waitForTimeout(3000);
        const exportButtons2 = await evalInRoot(() => {
          const buttons = Array.from(document.querySelectorAll('*'));
          return buttons
            .filter(btn => {
              const text = (btn.textContent || btn.value || btn.innerText || btn.alt || btn.title || '').toLowerCase();
              const onclick = (btn.getAttribute('onclick') || '').toLowerCase();
              const href = (btn.href || '').toLowerCase();
              return (text.includes('excel') || text.includes('pdf') || text.includes('export') ||
                     onclick.includes('excel') || onclick.includes('pdf') || onclick.includes('export') ||
                     href.includes('.xls') || href.includes('.pdf')) &&
                     (btn.tagName.toLowerCase() === 'button' || btn.tagName.toLowerCase() === 'a' ||
                      btn.tagName.toLowerCase() === 'input' || btn.onclick || btn.href);
            })
            .slice(0, 10)
            .map(btn => ({
              text: (btn.textContent || btn.value || btn.innerText || btn.alt || btn.title || '').trim(),
              href: btn.href || '',
              onclick: btn.getAttribute('onclick') || '',
              className: btn.className || '',
              id: btn.id || '',
              tag: btn.tagName.toLowerCase(),
            }));
        }).catch(() => []);
        if (exportButtons2.length > 0) {
          exportButtons.push(...exportButtons2);
        }
      }
      
      this._logStep('Export buttons found', { count: exportButtons.length, buttons: exportButtons.map(b => ({ text: b.text, id: b.id, location: b.location })) });
      
      // PRIORITY 1: Try to export as Excel from nested iframe (more accurate than PDF parsing)
      try {
        this._logStep('Attempting to export as Excel from nested iframe (preferred method)');
        const outerFrame = rootFrameLocator('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');
        const nestedFrame = outerFrame.frameLocator('iframe').first();
        
        // Wait for nested iframe to be ready
        await nestedFrame.locator('body').waitFor({ timeout: 10000 }).catch(() => {});
        // Wait for report viewer controls to load. In some sessions the Crystal toolbar appears late.
        // Poll for up to ~30s for any export-related controls.
        const pollDeadline = Date.now() + 30000;
        while (Date.now() < pollDeadline) {
          const btnCount = await nestedFrame.locator('#Button2, #Button4').count().catch(() => 0);
          const excelTextCount = await nestedFrame
            .locator('input[value*="Excel" i], button:has-text("Excel"), a:has-text("Excel")')
            .count()
            .catch(() => 0);
          const selectCount = await nestedFrame.locator('select').count().catch(() => 0);
          const radioCount = await nestedFrame.locator('input[type="radio"]').count().catch(() => 0);
          if (btnCount > 0 || excelTextCount > 0 || selectCount > 0 || radioCount > 0) break;
          await this.page.waitForTimeout(1000);
        }
        await this.page.waitForTimeout(1000); // small settle after controls appear
        
        // Look for format selector (dropdown or radio buttons)
        // Crystal Reports viewer typically has a format selector
        const selectCount = await nestedFrame.locator('select').count();
        const radioCount = await nestedFrame.locator('input[type="radio"]').count();
        
        this._logStep('Checking for format selector', { selectCount, radioCount });
        
        // Try dropdown select first
        if (selectCount > 0) {
          const formatSelect = nestedFrame.locator('select').first();
          const options = await formatSelect.locator('option').allTextContents();
          this._logStep('Found format dropdown', { options });
          
          // Find Excel option
          const excelOption = options.find(opt => 
            opt.toLowerCase().includes('excel') || 
            opt.toLowerCase().includes('xls') ||
            opt.toLowerCase().includes('xlsx')
          );
          
          if (excelOption) {
            this._logStep('Selecting Excel format from dropdown', { option: excelOption });
            await formatSelect.selectOption({ label: excelOption });
            await this.page.waitForTimeout(2000);
            
            // Look for submit/apply/export button after selecting format
            const submitButtons = ['Submit', 'Apply', 'Export', 'View', 'Show', 'Generate', 'OK'];
            for (const btnText of submitButtons) {
              try {
                const btn = nestedFrame.locator(`button:has-text("${btnText}"), input[value*="${btnText}" i], a:has-text("${btnText}")`).first();
                if (await btn.count() > 0) {
                  this._logStep(`Clicking ${btnText} button to apply format selection`);
                  
                  // Set up download listener BEFORE clicking
                  const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
                  
                  await btn.click();
                  await this.page.waitForTimeout(3000);
                  
                  try {
                    const download = await downloadPromise;
                    const filename = download.suggestedFilename();
                    this._logStep('Excel file download started', { filename });
                    
                    const excelPath = path.join(process.cwd(), 'downloads', filename || `queue-report-${Date.now()}.xlsx`);
                    fs.mkdirSync(path.dirname(excelPath), { recursive: true });
                    await download.saveAs(excelPath);
                    this._logStep('Excel file downloaded', { path: excelPath });
                    
                    // Parse Excel file
                    const items = await this._parseExcelFile(excelPath);
                    if (items.length > 0) {
                      this._logStep('Extracted items from Excel file', { count: items.length });
                      return items;
                    }
                  } catch (downloadError) {
                    this._logStep('Download did not start, trying next button', { error: downloadError.message });
                  }
                }
              } catch (e) {
                // Continue to next button
              }
            }
          }
        }
        
        // Try radio buttons if no dropdown found
        if (radioCount > 0 && selectCount === 0) {
          this._logStep('Checking radio buttons for Excel format');
          const radios = await nestedFrame.locator('input[type="radio"]').all();
          
          for (const radio of radios) {
            try {
              const value = await radio.getAttribute('value');
              const name = await radio.getAttribute('name');
              const checked = await radio.isChecked();
              
              if (value && (value.toLowerCase().includes('excel') || value.toLowerCase().includes('xls'))) {
                this._logStep('Found Excel radio button', { value, name, checked });
                
                if (!checked) {
                  await radio.check();
                  await this.page.waitForTimeout(2000);
                }
                
                // Look for submit button
                const submitButtons = ['Submit', 'Apply', 'Export', 'View', 'Show'];
                for (const btnText of submitButtons) {
                  try {
                    const btn = nestedFrame.locator(`button:has-text("${btnText}"), input[value*="${btnText}" i], input[name*="${name}" i]`).first();
                    if (await btn.count() > 0) {
                      this._logStep(`Clicking ${btnText} button after selecting Excel radio`);
                      
                      const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 });
                      await btn.click();
                      await this.page.waitForTimeout(3000);
                      
                      try {
                        const download = await downloadPromise;
                        const filename = download.suggestedFilename();
                        const excelPath = path.join(process.cwd(), 'downloads', filename || `queue-report-${Date.now()}.xlsx`);
                        fs.mkdirSync(path.dirname(excelPath), { recursive: true });
                        await download.saveAs(excelPath);
                        this._logStep('Excel file downloaded via radio button', { path: excelPath });
                        
                        const items = await this._parseExcelFile(excelPath);
                        if (items.length > 0) {
                          this._logStep('Extracted items from Excel file', { count: items.length });
                          return items;
                        }
                      } catch (downloadError) {
                        // Continue
                      }
                    }
                  } catch (e) {
                    // Continue
                  }
                }
              }
            } catch (e) {
              // Continue to next radio
            }
          }
        }
        
        // Try direct Excel export buttons in nested iframe (these are input buttons with IDs)
        this._logStep('Looking for direct Excel export buttons in nested iframe');
        
        // Try Button2 ("Excel") first, then Button4 ("Excel (Data-Only)")
        const excelButtonIds = ['Button2', 'Button4']; // Button2 = "Excel", Button4 = "Excel (Data-Only)"
        
        for (const buttonId of excelButtonIds) {
          try {
            const excelButton = nestedFrame.locator(`#${buttonId}`).first();
            const buttonExists = await excelButton.count() > 0;
            
            if (buttonExists) {
              const buttonText = await excelButton.getAttribute('value').catch(() => '');
              this._logStep(`Found Excel export button: ${buttonId}`, { text: buttonText });
              
              // Set up download listener BEFORE clicking
              const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
              
              // Click the button
              await excelButton.click();
              await this.page.waitForTimeout(3000); // Wait for download to start
              
              try {
                const download = await downloadPromise;
                if (download) {
                  const filename = download.suggestedFilename();
                  this._logStep('Excel file download started', { filename, buttonId });
                  
                  const excelPath = path.join(process.cwd(), 'downloads', filename || `queue-report-${Date.now()}.xlsx`);
                  fs.mkdirSync(path.dirname(excelPath), { recursive: true });
                  await download.saveAs(excelPath);
                  this._logStep('Excel file downloaded successfully', { path: excelPath, size: fs.statSync(excelPath).size });
                  
                  // Parse Excel file
                  const items = await this._parseExcelFile(excelPath);
                  if (items.length > 0) {
                    this._logStep('Extracted items from Excel file', { count: items.length, buttonId });
                    return items;
                  } else {
                    this._logStep('Excel file parsed but no items extracted', { buttonId });
                  }
                } else {
                  this._logStep('Download did not start, trying next button', { buttonId });
                }
              } catch (downloadError) {
                this._logStep('Error downloading Excel file', { error: downloadError.message, buttonId });
                // Continue to next button
              }
            }
          } catch (e) {
            this._logStep(`Error accessing button ${buttonId}`, { error: e.message });
            // Continue to next button
          }
        }

        // If the expected IDs are missing, enumerate available "Button*" controls for debugging and
        // try clicking any button whose value looks like an Excel export.
        try {
          const availableButtons = await nestedFrame
            .locator('input[id^="Button"], button[id^="Button"]')
            .evaluateAll((els) =>
              els.slice(0, 20).map((el) => ({
                tag: el.tagName,
                id: el.id || null,
                value: (el.value || '').trim(),
                text: (el.textContent || '').trim().slice(0, 40),
              }))
            )
            .catch(() => []);
          if (availableButtons.length) {
            this._logStep('Nested iframe Button* controls (sample)', { availableButtons });
          }

          const excelLike = nestedFrame.locator('input[value*="Excel" i], button:has-text("Excel"), a:has-text("Excel")').first();
          if ((await excelLike.count().catch(() => 0)) > 0) {
            this._logStep('Found Excel-like export control (generic), attempting download');
            const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
            await excelLike.click().catch(async () => excelLike.click({ force: true }).catch(() => {}));
            await this.page.waitForTimeout(3000);
            const download = await downloadPromise;
            if (download) {
              const filename = download.suggestedFilename();
              const excelPath = path.join(process.cwd(), 'downloads', filename || `queue-report-${Date.now()}.xlsx`);
              fs.mkdirSync(path.dirname(excelPath), { recursive: true });
              await download.saveAs(excelPath);
              this._logStep('Excel file downloaded via generic export control', { path: excelPath });
              const items = await this._parseExcelFile(excelPath);
              if (items.length > 0) {
                this._logStep('Extracted items from Excel file', { count: items.length });
                return items;
              }
            }
          }
        } catch (e) {
          this._logStep('Error probing generic Excel export controls', { error: e.message });
        }
        
        // Fallback: Try to find Excel buttons by text/value
        try {
          const excelButtons = await nestedFrame
            .locator('input[type="button"][value*="Excel" i], input[type="submit"][value*="Excel" i], button:has-text("Excel")')
            .all();
          
          if (excelButtons.length > 0) {
            this._logStep(`Found ${excelButtons.length} Excel buttons by text filter`);
            for (const btn of excelButtons) {
              try {
                const valueAttr = await btn.getAttribute('value').catch(() => null);
                const text = valueAttr || (await btn.textContent().catch(() => ''));
                this._logStep('Trying Excel button by text', { text });
                
                const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
                await btn.click();
                await this.page.waitForTimeout(3000);
                
                const download = await downloadPromise;
                if (download) {
                  const filename = download.suggestedFilename();
                  const excelPath = path.join(process.cwd(), 'downloads', filename || `queue-report-${Date.now()}.xlsx`);
                  fs.mkdirSync(path.dirname(excelPath), { recursive: true });
                  await download.saveAs(excelPath);
                  this._logStep('Excel file downloaded via text filter', { path: excelPath });
                  
                  const items = await this._parseExcelFile(excelPath);
                  if (items.length > 0) {
                    this._logStep('Extracted items from Excel file', { count: items.length });
                    return items;
                  }
                  break;
                }
              } catch (e) {
                // Continue
              }
            }
          }
        } catch (e) {
          // Fallback failed
        }
      } catch (excelError) {
        this._logStep('Excel extraction failed, will try PDF as fallback', { error: excelError.message });
      }
      
      // PRIORITY 2: Try PDF extraction as fallback
      try {
        this._logStep('Attempting to extract PDF from nested iframe (fallback)');
        const outerFrame = rootFrameLocator('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');
        const nestedFrame = outerFrame.frameLocator('iframe').first();
        
        // Wait for nested iframe to be ready
        await nestedFrame.locator('body').waitFor({ timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(3000); // Additional wait for PDF to load
        
        // Try to get PDF URL directly from ReportViewer URL
        // The ReportViewer iframe URL contains parameters that might give us the PDF URL
        const reportViewerUrl = await evalInRoot(() => {
          const iframes = Array.from(document.querySelectorAll('iframe'));
          const reportIframe = iframes.find(f => 
            (f.src || '').toLowerCase().includes('reportviewer')
          );
          return reportIframe ? reportIframe.src : null;
        });
        
        if (reportViewerUrl) {
          this._logStep('Found ReportViewer URL', { url: reportViewerUrl });
          
          // Try to access the nested iframe URL which should contain the PDF
          try {
            const nestedUrl = await evalInRoot(() => {
              const iframes = Array.from(document.querySelectorAll('iframe'));
              const reportIframe = iframes.find(f => 
                (f.src || '').toLowerCase().includes('reportviewer')
              );
              
              if (reportIframe && reportIframe.contentDocument) {
                const nestedIframes = Array.from(reportIframe.contentDocument.querySelectorAll('iframe'));
                if (nestedIframes.length > 0) {
                  return nestedIframes[0].src || null;
                }
              }
              return null;
            }).catch(() => null);
            
            if (nestedUrl && (nestedUrl.includes('.pdf') || nestedUrl.includes('ReportViewer.aspx'))) {
              this._logStep('Found nested iframe URL', { nestedUrl });
              
              // Use APIRequestContext to download with authentication cookies
              try {
                // Get cookies from the page context
                const cookies = await this.page.context().cookies();
                const context = this.page.context().request;
                
                const response = await context.get(nestedUrl, {
                  timeout: 30000,
                  headers: {
                    'Cookie': cookies.map(c => `${c.name}=${c.value}`).join('; ')
                  }
                }).catch(() => null);
                
                if (response && response.ok()) {
                  const buffer = await response.body();
                  const contentType = response.headers()['content-type'] || '';
                  
                  // Check if it's a PDF (PDF files start with %PDF)
                  const isPDF = contentType.includes('pdf') || 
                                (buffer.length > 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46);
                  
                  if (isPDF) {
                    const pdfPath = path.join(process.cwd(), 'downloads', `queue-report-${Date.now()}.pdf`);
                    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
                    fs.writeFileSync(pdfPath, buffer);
                    this._logStep('PDF downloaded via APIRequestContext', { path: pdfPath, size: buffer.length });
                    
                    // Parse PDF using pdf-parse
                    try {
                      const parser = new PDFParse({ data: buffer });
                      const result = await parser.getText();
                      await parser.destroy();
                      
                      this._logStep('PDF parsed successfully', { 
                        textLength: result.text.length, 
                        pages: result.total 
                      });
                      
                      // Extract patient data from PDF text
                      const items = this._extractItemsFromPDFText(result.text);
                      if (items.length > 0) {
                        this._logStep('Extracted items from PDF', { count: items.length });
                        return items;
                      } else {
                        this._logStep('No items extracted from PDF text', { 
                          textPreview: result.text.substring(0, 500) 
                        });
                      }
                    } catch (parseError) {
                      this._logStep('Error parsing PDF', { error: parseError.message });
                    }
                  } else {
                    // Try to parse as HTML to see what we got
                    const text = buffer.toString('utf-8');
                    this._logStep('Response is not a PDF', { 
                      contentType, 
                      firstBytes: Array.from(buffer.slice(0, 20)),
                      textPreview: text.substring(0, 500)
                    });
                  }
                } else {
                  this._logStep('Failed to download PDF', { 
                    status: response?.status(), 
                    statusText: response?.statusText() 
                  });
                }
              } catch (reqError) {
                this._logStep('Error downloading via APIRequestContext', { error: reqError.message });
              }
            }
          } catch (e) {
            this._logStep('Error accessing nested iframe URL', { error: e.message });
          }
        }
        
        // Alternative: Try to find PDF viewer toolbar buttons and trigger download
        try {
          const downloadPromise = this.page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
          
          // Look for download/export buttons in nested iframe
          const pdfButtons = await nestedFrame.locator('a, button, input[type="button"]')
            .filter({ hasText: /download|export|save|pdf/i })
            .all();
          
          if (pdfButtons.length > 0) {
            this._logStep('Found PDF viewer buttons, attempting download', { count: pdfButtons.length });
            for (const btn of pdfButtons) {
              try {
                await btn.click();
                await this.page.waitForTimeout(2000);
                
                const download = await downloadPromise;
                if (download) {
                  const pdfPath = path.join(process.cwd(), 'downloads', download.suggestedFilename());
                  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
                  await download.saveAs(pdfPath);
                  this._logStep('PDF downloaded via button click', { path: pdfPath });
                  
                  // Parse the downloaded PDF
                  const buffer = fs.readFileSync(pdfPath);
                  const parser = new PDFParse({ data: buffer });
                  const result = await parser.getText();
                  await parser.destroy();
                  
                  const items = this._extractItemsFromPDFText(result.text);
                  if (items.length > 0) {
                    this._logStep('Extracted items from downloaded PDF', { count: items.length });
                    return items;
                  }
                  break;
                }
              } catch (e) {
                // Continue to next button
              }
            }
          }
        } catch (e) {
          this._logStep('Could not trigger PDF download via buttons', { error: e.message });
        }
      } catch (pdfError) {
        this._logStep('PDF extraction attempt failed', { error: pdfError.message });
      }
      
      // If Excel export button found, click it and wait for download
      if (exportButtons.length > 0) {
        const excelButton = exportButtons.find(b => 
          b.text.toLowerCase().includes('excel') || 
          b.onclick.toLowerCase().includes('excel') ||
          b.href.includes('.xlsx') || b.href.includes('.xls')
        );
        
        if (excelButton) {
          this._logStep('Found Excel export button, attempting to click and download', { 
            text: excelButton.text, 
            id: excelButton.id,
            location: excelButton.location
          });
          
          try {
            // Set up download listener
            const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
            
            // Click the export button
            if (excelButton.location === 'iframe') {
              const outerFrame = rootFrameLocator('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');
              if (excelButton.id) {
                await outerFrame.locator(`#${excelButton.id}`).click();
              } else if (excelButton.className) {
                await outerFrame.locator(`.${excelButton.className.split(' ')[0]}`).filter({ hasText: excelButton.text }).first().click();
              } else {
                await outerFrame.locator('button, a').filter({ hasText: /excel/i }).first().click();
              }
            } else {
              if (excelButton.id) {
                await locInRoot(`#${excelButton.id}`).click();
              } else if (excelButton.className) {
                await locInRoot(`.${excelButton.className.split(' ')[0]}`).filter({ hasText: excelButton.text }).first().click();
              } else {
                await locInRoot('button, a').filter({ hasText: /excel/i }).first().click();
              }
            }
            
            // Wait for download
            const download = await downloadPromise;
            if (download) {
              this._logStep('Excel file downloaded, saving and parsing', { filename: download.suggestedFilename() });
              const path = await download.path();
              // TODO: Parse Excel file and extract data
              // For now, log that we got the file
              this._logStep('Excel file saved', { path });
            }
          } catch (e) {
            this._logStep('Error clicking Excel export button', { error: e.message });
          }
        }
      }
      
      // Log all buttons/links on page for debugging
      if (exportButtons.length === 0) {
        const allButtons = await evalInRoot(() => {
          const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [onclick]'));
          return buttons
            .filter(btn => {
              const rect = btn.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0; // Visible
            })
            .slice(0, 30)
            .map(btn => ({
              text: (btn.textContent || btn.value || btn.innerText || '').trim().substring(0, 50),
              id: btn.id || '',
              className: (btn.className || '').substring(0, 50),
              tag: btn.tagName.toLowerCase(),
            }));
        }).catch(() => []);
        this._logStep('All visible buttons/links on page (for debugging)', { count: allButtons.length, buttons: allButtons });
      }
      
      // First, let's check what's actually on the page
      await this.page.waitForTimeout(3000); // Wait for iframe to load
      
      const pageInfo = await evalInRoot(() => {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        const reportViewerIframes = iframes.filter(f => {
          const src = (f.src || '').toLowerCase();
          return src.includes('reportviewer') || src.includes('queuelisting');
        });
        
        return {
          url: window.location.href,
          title: document.title,
          hasJqGrid: !!document.querySelector('#queueLogGrid'),
          jqGridRows: document.querySelectorAll('#queueLogGrid tr.jqgrow').length,
          hasTables: document.querySelectorAll('table').length,
          hasInputs: document.querySelectorAll('input').length,
          hasPDFViewer: !!document.querySelector('iframe[src*="pdf"], embed[type="application/pdf"], object[data*="pdf"]'),
          hasIframes: iframes.length,
          hasReportViewerIframes: reportViewerIframes.length,
          iframeSrcs: reportViewerIframes.map(f => f.src),
          bodyText: document.body?.innerText?.substring(0, 500) || '',
        };
      });
      
      this._logStep('Page info', pageInfo);
      
      // IMPORTANT: Try to extract from iframe FIRST - report is shown in iframe
      if (pageInfo.hasReportViewerIframes > 0) {
        this._logStep('ReportViewer iframe detected, attempting to extract data', { 
          iframeCount: pageInfo.hasReportViewerIframes, 
          srcs: pageInfo.iframeSrcs 
        });
        
        // Wait longer for iframe content to load - PDF reports can take time
        await this.page.waitForTimeout(10000);
        
        // Wait for nested iframe to load - the actual report is in the nested iframe
        // Check multiple times for nested iframe content
        let attempts = 0;
        let nestedIframeReady = false;
        let nestedContentData = null; // Store nested content for extraction - declared at function scope
        
        while (attempts < 6 && !nestedIframeReady) {
          await this.page.waitForTimeout(3000);
          attempts++;
          
          try {
            const nestedCheck = await evalInRoot(() => {
              const iframe = document.querySelector('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');
              if (!iframe) return { found: false };
              
              try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                if (iframeDoc) {
                  const nestedIframes = Array.from(iframeDoc.querySelectorAll('iframe, embed'));
                  if (nestedIframes.length > 0) {
                    const nestedIframe = nestedIframes[0];
                    try {
                      const nestedDoc = nestedIframe.contentDocument || nestedIframe.contentWindow?.document;
                      if (nestedDoc && nestedDoc.body) {
                        const bodyText = nestedDoc.body?.textContent || '';
                        const bodyInnerText = nestedDoc.body?.innerText || '';
                        const allText = bodyInnerText.length > bodyText.length ? bodyInnerText : bodyText;
                        const hasTables = nestedDoc.querySelectorAll('table').length > 0;
                        const hasRealContent = allText.length > 500 && 
                          !allText.includes('$(document).ready') && 
                          !allText.includes('__doPostBack');
                        
                        // Extract tables if available
                        const tables = Array.from(nestedDoc.querySelectorAll('table'));
                        const tableData = tables.map((table, idx) => {
                          const rows = Array.from(table.querySelectorAll('tr'));
                          const data = rows.map(row => {
                            const cells = Array.from(row.querySelectorAll('td, th'));
                            return cells.map(cell => (cell.textContent || '').trim());
                          });
                          return { index: idx, rows: data, rowCount: rows.length };
                        });
                        
                        return {
                          found: true,
                          nestedFound: true,
                          nestedAccessible: true,
                          bodyTextLength: allText.length,
                          bodyText: allText.substring(0, 50000), // Extract full text for processing
                          hasTables,
                          hasRealContent,
                          tables: tableData,
                          tableCount: tables.length,
                          preview: allText.substring(0, 300),
                        };
                      }
                    } catch (e) {
                      return { found: true, nestedFound: true, nestedAccessible: false, error: e.message };
                    }
                  }
                  
                  return { found: true, nestedFound: false };
                }
              } catch (e) {
                return { found: true, error: e.message };
              }
              
              return { found: true, noAccess: true };
            });
            
            if (nestedCheck.nestedFound && nestedCheck.nestedAccessible) {
              // Store nested content data for direct extraction
              if (nestedCheck.bodyText && nestedCheck.bodyText.length > 100) {
                nestedContentData = nestedCheck;
              }
              
              // Even if hasRealContent is false, we should still try to extract - the content might be there
              if (nestedCheck.hasRealContent) {
                nestedIframeReady = true;
                this._logStep('Nested iframe content loaded', { attempt: attempts, bodyTextLength: nestedCheck.bodyTextLength });
              } else if (nestedCheck.bodyTextLength > 100) {
                // If we have some text content (even if it looks like JS), still try to extract
                nestedIframeReady = true;
                this._logStep('Nested iframe accessible with content (may contain report)', { attempt: attempts, bodyTextLength: nestedCheck.bodyTextLength });
              } else {
                this._logStep('Nested iframe found but content not ready', { attempt: attempts, ...nestedCheck });
              }
            } else {
              this._logStep('Waiting for nested iframe to appear', { attempt: attempts, ...nestedCheck });
            }
          } catch (e) {
            this._logStep('Error checking nested iframe', { attempt: attempts, error: e.message });
          }
        }
        
        // Additional wait for nested iframe content to fully load
        if (nestedIframeReady) {
          await this.page.waitForTimeout(3000);
        }
        
        // Use Playwright's frameLocator() API for more reliable iframe access
        try {
          // Try to access outer iframe using frameLocator
          const outerFrame = rootFrameLocator('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');
          
          // Try to access nested iframe using chained frameLocator
          let nestedFrame = null;
          try {
            // Check if there's a nested iframe inside the outer iframe
            const nestedFrameCount = await outerFrame.frameLocator('iframe').first().locator('body').count().catch(() => 0);
            if (nestedFrameCount > 0) {
              nestedFrame = outerFrame.frameLocator('iframe').first();
              this._logStep('Found nested iframe via frameLocator', { nestedFrameAccessible: true });
            }
          } catch (e) {
            this._logStep('Could not access nested iframe via frameLocator', { error: e.message });
          }
          
          // Extract data from nested iframe using frameLocator (preferred method)
          if (nestedFrame) {
            try {
              // Extract text content from nested iframe
              const bodyText = await nestedFrame.locator('body').textContent().catch(() => '');
              const bodyInnerText = await nestedFrame.locator('body').innerText().catch(() => '');
              const allText = bodyInnerText.length > bodyText.length ? bodyInnerText : bodyText;
              
              // Extract tables from nested iframe
              const tableLocators = await nestedFrame.locator('table').all().catch(() => []);
              const tables = [];
              
              for (const tableLoc of tableLocators) {
                const rowLocators = await tableLoc.locator('tr').all().catch(() => []);
                const rows = [];
                
                for (const rowLoc of rowLocators) {
                  const cellLocators = await rowLoc.locator('td, th').all().catch(() => []);
                  const cells = [];
                  for (const cellLoc of cellLocators) {
                    const cellText = await cellLoc.textContent().catch(() => '');
                    cells.push((cellText || '').trim());
                  }
                  if (cells.length > 0) {
                    rows.push(cells);
                  }
                }
                
                // Filter out small/layout tables
                if (rows.length >= 2) {
                  const tableText = rows.map(r => r.join(' ')).join(' ');
                  if (tableText.length >= 100 && 
                      !tableText.includes('__doPostBack') && 
                      !tableText.includes('crv_config')) {
                    // Check for NRIC or patient data indicators
                    const hasNRIC = /[STFGM]\d{7}[A-Z]/i.test(tableText);
                    const hasPatientData = /\b(patient|name|nric|qno|queue)\b/i.test(tableText);
                    
                    if (hasNRIC || hasPatientData || rows.length > 5) {
                      tables.push({ rows, rowCount: rows.length });
                    }
                  }
                }
              }
              
              this._logStep('Extracted data from nested iframe via frameLocator', {
                textLength: allText.length,
                tableCount: tables.length,
                preview: allText.substring(0, 300)
              });
              
              // Extract items from tables
              if (tables.length > 0) {
                const items = [];
                for (const table of tables) {
                  for (const row of table.rows) {
                    if (row.length < 3) continue;
                    const rowText = row.join(' ').toLowerCase();
                    // Match NRIC patterns: S1234567A, S 1234 567 A, S1234567 A, etc.
                    const nricMatch = rowText.match(/[stfg]\s*\d{4}\s*\d{3}\s*[a-z]|[stfg]\d{7}[a-z]|[stfg]\d{4}\s*\d{3}\s*[a-z]/i);
                    
                    if (nricMatch) {
                      const nric = nricMatch[0].replace(/\s+/g, '').toUpperCase();
                      let patientName = null;
                      let qno = null;
                      let status = null;
                      
                      // Extract patient name and other fields from row
                      for (const cell of row) {
                        const cellText = (cell || '').trim();
                        if (cellText.length > 3 && 
                            !/^\d+$/.test(cellText) && 
                            !/[stfg]\d{7}[a-z]/i.test(cellText) &&
                            !cellText.includes('$') &&
                            !cellText.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
                          if (!patientName && /^[A-Za-z\s]+$/.test(cellText)) {
                            patientName = cellText;
                          }
                        }
                        // First column might be QNo
                        if (!qno && /^Q?\d+$/.test(cellText)) {
                          qno = cellText;
                        }
                      }
                      
                      // Get status from row (often near the end)
                      if (row.length > 1) {
                        const lastCells = row.slice(-3);
                        for (const cell of lastCells) {
                          const cellText = (cell || '').trim().toLowerCase();
                          if (['pending', 'completed', 'served', 'cancelled', 'waiting'].some(s => cellText.includes(s))) {
                            status = (cell || '').trim();
                            break;
                          }
                        }
                      }
                      
                      items.push({ 
                        nric, 
                        patientName,
                        qno,
                        status,
                        source: 'reports_queue_list_nested_iframe_frameLocator', 
                        rawRow: row 
                      });
                    }
                  }
                }
                
                if (items.length > 0) {
                  this._logStep('Extracted items from nested iframe tables (frameLocator)', { count: items.length });
                  return items;
                }
              }
              
              // If no tables but we have text content, extract from text
              if (allText.length > 500) {
                this._logStep('Extracting from nested iframe text via frameLocator', {
                  textLength: allText.length
                });
                
                const lines = allText.split(/[\n\r]+/);
                const items = [];
                
                for (const line of lines) {
                  const trimmedLine = line.trim();
                  if (trimmedLine.length < 5) continue;
                  
                  // Look for NRIC pattern
                  const nricMatch = trimmedLine.match(/[STFGM]\s*\d{4}\s*\d{3}\s*[A-Z]|[STFGM]\d{7}[A-Z]|[STFGM]\d{4}\s*\d{3}\s*[A-Z]/i);
                  if (nricMatch) {
                    const nric = nricMatch[0].replace(/\s+/g, '').toUpperCase();
                    const lineIndex = lines.indexOf(line);
                    let patientName = null;
                    
                    // Look for patient name in nearby lines
                    for (let i = Math.max(0, lineIndex - 3); i <= Math.min(lines.length - 1, lineIndex + 3); i++) {
                      const nearbyLine = lines[i].trim();
                      if (nearbyLine.length > 3 && 
                          nearbyLine.length < 50 &&
                          !nric.includes(nearbyLine) &&
                          !/^\d+$/.test(nearbyLine) &&
                          !nearbyLine.includes('$') &&
                          !nearbyLine.match(/^\d{1,2}\/\d{1,2}\/\d{4}/) &&
                          /^[A-Za-z\s,.'-]+$/.test(nearbyLine)) {
                        patientName = nearbyLine;
                        break;
                      }
                    }
                    
                    items.push({
                      nric,
                      patientName,
                      source: 'reports_queue_list_nested_iframe_text_frameLocator',
                      rawLine: trimmedLine,
                    });
                  }
                }
                
                if (items.length > 0) {
                  this._logStep('Extracted items from nested iframe text (frameLocator)', { count: items.length });
                  return items;
                }
              }
            } catch (e) {
              this._logStep('Error extracting from nested iframe via frameLocator', { error: e.message });
            }
          }
          
          // Fallback: Try to extract from outer iframe if nested extraction failed
          try {
            const outerText = await outerFrame.locator('body').textContent().catch(() => '');
            const outerTables = await outerFrame.locator('table').all().catch(() => []);
            
            if (outerTables.length > 0 || outerText.length > 100) {
              this._logStep('Trying to extract from outer iframe via frameLocator', {
                textLength: outerText.length,
                tableCount: outerTables.length
              });
              
              // Extract from outer iframe tables
              const items = [];
              for (const tableLoc of outerTables) {
                const rowLocators = await tableLoc.locator('tr').all().catch(() => []);
                for (const rowLoc of rowLocators) {
                  const cellLocators = await rowLoc.locator('td, th').all().catch(() => []);
                  const cells = [];
                  for (const cellLoc of cellLocators) {
                    const cellText = await cellLoc.textContent().catch(() => '');
                    cells.push((cellText || '').trim());
                  }
                  
                  if (cells.length >= 3) {
                    const rowText = cells.join(' ').toLowerCase();
                    const nricMatch = rowText.match(/[stfg]\d{7}[a-z]/i);
                    
                    if (nricMatch) {
                      const nric = nricMatch[0].toUpperCase();
                      let patientName = null;
                      
                      for (const cell of cells) {
                        const cellText = (cell || '').trim();
                        if (cellText.length > 3 && 
                            !/^\d+$/.test(cellText) && 
                            !/[stfg]\d{7}[a-z]/i.test(cellText) &&
                            !cellText.includes('$') &&
                            !cellText.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
                          patientName = cellText;
                          break;
                        }
                      }
                      
                      items.push({ nric, patientName, source: 'reports_queue_list_outer_iframe_frameLocator', rawRow: cells });
                    }
                  }
                }
              }
              
              if (items.length > 0) {
                this._logStep('Extracted items from outer iframe (frameLocator)', { count: items.length });
                return items;
              }
            }
          } catch (e) {
            this._logStep('Error extracting from outer iframe via frameLocator', { error: e.message });
          }
          
          // Fallback: Use evaluate method if frameLocator didn't extract items
          // This should only run if we didn't already return items from frameLocator
          this._logStep('frameLocator extraction completed but no items found, trying evaluate method');
          const iframeData = await evalInRoot(() => {
              const iframe = document.querySelector('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');
              if (!iframe) return { error: 'No iframe found' };
              
              try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
              if (!iframeDoc) return { error: 'Cannot access iframe document' };
              
              const bodyText = iframeDoc.body?.innerText || '';
              const tables = Array.from(iframeDoc.querySelectorAll('table'));
              
              const tableData = tables.map((table, idx) => {
                const rows = Array.from(table.querySelectorAll('tr'));
                const data = rows.map(row => {
                  const cells = Array.from(row.querySelectorAll('td, th'));
                  return cells.map(cell => (cell.textContent || '').trim());
                });
                return { index: idx, rows: data, rowCount: rows.length };
              });
              
              // Check for nested iframes (the actual report might be in a nested iframe)
              const nestedIframes = Array.from(iframeDoc.querySelectorAll('iframe, embed, object'));
              
              // Check for PDF viewer elements
              const pdfViewers = iframeDoc.querySelectorAll('embed[type*="pdf"], object[type*="pdf"], iframe[src*="pdf"]');
              
              // Check all text nodes for patient data
              const allText = iframeDoc.body?.textContent || '';
              
              // Get nested iframe info
              const nestedIframeInfo = nestedIframes.map(f => ({
                tag: f.tagName.toLowerCase(),
                src: f.src || f.data || '',
                id: f.id || '',
              }));
              
              // Try to access nested iframe if it exists - THIS IS WHERE THE ACTUAL REPORT IS
              let nestedContent = null;
              if (nestedIframes.length > 0) {
                try {
                  const nestedIframe = nestedIframes[0];
                  
                  // Wait a bit for iframe to load
                  if (!nestedIframe.contentDocument && !nestedIframe.contentWindow) {
                    // Iframe not loaded yet - skip for now
                  } else {
                    const nestedDoc = nestedIframe.contentDocument || nestedIframe.contentWindow?.document;
                    if (nestedDoc && nestedDoc.body) {
                      // Check for even deeper nested iframes (third level)
                      const deepNestedIframes = Array.from(nestedDoc.querySelectorAll('iframe, embed'));
                      
                      // Check for tables in nested iframe (or deep nested)
                      let targetDoc = nestedDoc;
                      if (deepNestedIframes.length > 0) {
                        try {
                          const deepNestedIframe = deepNestedIframes[0];
                          const deepDoc = deepNestedIframe.contentDocument || deepNestedIframe.contentWindow?.document;
                          if (deepDoc && deepDoc.body) {
                            targetDoc = deepDoc;
                          }
                        } catch (e) {
                          // Deep nested iframe might be cross-origin, use nested iframe instead
                        }
                      }
                      
                      const nestedTables = Array.from(targetDoc.querySelectorAll('table'));
                      
                      // Filter out tables that are just layout/wrapper tables
                      const dataTables = nestedTables.filter(table => {
                        const rows = table.querySelectorAll('tr');
                        if (rows.length < 2) return false; // Need at least header + data row
                        
                        // Check if table has actual data (not just JavaScript/HTML structure)
                        const tableText = table.textContent || '';
                        if (tableText.length < 100) return false; // Too small to be a report
                        if (tableText.includes('__doPostBack') || tableText.includes('crv_config')) return false;
                        
                        // Look for NRIC patterns or patient data indicators
                        const hasNRIC = /[STFGM]\d{7}[A-Z]/i.test(tableText);
                        const hasPatientData = tableText.match(/\b(patient|name|nric|qno|queue)\b/i);
                        
                        return hasNRIC || hasPatientData || rows.length > 5; // Likely has real data
                      });
                      
                      const nestedTableData = dataTables.map((table, idx) => {
                        const rows = Array.from(table.querySelectorAll('tr'));
                        const data = rows.map(row => {
                          const cells = Array.from(row.querySelectorAll('td, th'));
                          return cells.map(cell => (cell.textContent || '').trim());
                        });
                        return { index: idx, rows: data, rowCount: rows.length };
                      });
                      
                      // Extract all text - try multiple methods
                      const bodyInnerText = targetDoc.body?.innerText || '';
                      const bodyTextContent = targetDoc.body?.textContent || '';
                      const bodyInnerHTML = targetDoc.body?.innerHTML || '';
                      // Also try getting text from all elements
                      const allElementsText = Array.from(targetDoc.querySelectorAll('*'))
                        .map(el => el.textContent || '')
                        .filter(t => t.trim().length > 0)
                        .join('\n');
                      
                      // Use the longest text source available
                      const allText = [
                        bodyInnerText,
                        bodyTextContent,
                        allElementsText
                      ].reduce((a, b) => a.length > b.length ? a : b, '');
                      
                      nestedContent = {
                        bodyText: bodyInnerText,
                        allText: allText,
                        tables: nestedTableData,
                        tableCount: dataTables.length,
                        totalTableCount: nestedTables.length,
                        html: bodyInnerHTML.substring(0, 20000) || '',
                        hasDeepNested: deepNestedIframes.length > 0,
                      };
                    }
                  }
                } catch (e) {
                  // Nested iframe might be cross-origin - don't fail, just continue
                  // Return error only if this is critical
                }
              }
              
              const html = iframeDoc.body?.innerHTML || '';
              const hasContent = bodyText.length > 100 || tables.length > 0 || html.length > 1000 || (nestedContent && nestedContent.bodyText.length > 0);
              
              return {
                bodyText: bodyText.substring(0, 50000),
                allText: allText.substring(0, 50000),
                tableCount: tables.length,
                tables: tableData,
                hasContent,
                htmlLength: html.length,
                htmlPreview: html.substring(0, 500),
                pdfViewerCount: pdfViewers.length,
                nestedIframeCount: nestedIframes.length,
                nestedIframeInfo: nestedIframeInfo.slice(0, 3),
                nestedContent: nestedContent ? {
                  bodyText: nestedContent.bodyText.substring(0, 20000),
                  allText: nestedContent.allText.substring(0, 20000),
                  tables: nestedContent.tables,
                  tableCount: nestedContent.tableCount || 0,
                  totalTableCount: nestedContent.totalTableCount || 0,
                  html: nestedContent.html.substring(0, 10000),
                } : null,
                url: iframeDoc.location?.href || iframeDoc.URL || '',
              };
            } catch (e) {
              return { error: e.message };
            }
          }).catch((evalError) => {
            return { error: evalError.message };
          });
          
          // Process iframeData from evaluate fallback - all inside try block
          if (iframeData && !iframeData.error) {
            this._logStep('Successfully accessed iframe content via evaluate fallback', { 
              tableCount: iframeData.tableCount,
              bodyTextLength: iframeData.bodyText.length,
              allTextLength: iframeData.allText?.length || 0,
              htmlLength: iframeData.htmlLength || 0,
              hasContent: iframeData.hasContent,
              pdfViewerCount: iframeData.pdfViewerCount || 0,
              iframeUrl: iframeData.url,
              hasNestedContent: !!iframeData.nestedContent,
              nestedTableCount: iframeData.nestedContent?.tableCount || 0,
              nestedTotalTableCount: iframeData.nestedContent?.totalTableCount || 0,
              hasDeepNested: iframeData.nestedContent?.hasDeepNested || false,
            });
            
            // PRIORITY: Extract from nested iframe first (this is where the actual report data is)
            // Use nestedContentData from the check if available (more reliable than iframeData.nestedContent)
            const nestedContentToUse = nestedContentData && nestedContentData.bodyText 
              ? { 
                  bodyText: nestedContentData.bodyText,
                  allText: nestedContentData.bodyText,
                  tables: nestedContentData.tables || [],
                  tableCount: nestedContentData.tableCount || 0,
                }
              : iframeData.nestedContent;
            
            if (nestedContentToUse) {
              // Try tables first if available
              if (nestedContentToUse.tableCount > 0) {
                this._logStep('Extracting from nested iframe tables', {
                  tableCount: nestedContentToUse.tableCount,
                  source: nestedContentData ? 'nestedCheck' : 'iframeData',
                });
              
              const items = [];
              for (const table of nestedContentToUse.tables) {
                for (const row of table.rows) {
                  if (row.length < 3) continue;
                  const rowText = row.join(' ').toLowerCase();
                  // Match NRIC patterns: S1234567A, S 1234 567 A, S1234567 A, etc.
                  const nricMatch = rowText.match(/[stfg]\s*\d{4}\s*\d{3}\s*[a-z]|[stfg]\d{7}[a-z]|[stfg]\d{4}\s*\d{3}\s*[a-z]/i);
                  
                  if (nricMatch) {
                    const nric = nricMatch[0].replace(/\s+/g, '').toUpperCase();
                    let patientName = null;
                    let qno = null;
                    let status = null;
                    
                    // Extract patient name and other fields from row
                    for (const cell of row) {
                      const cellText = (cell || '').trim();
                      if (cellText.length > 3 && 
                          !/^\d+$/.test(cellText) && 
                          !/[stfg]\d{7}[a-z]/i.test(cellText) &&
                          !cellText.includes('$') &&
                          !cellText.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
                        if (!patientName && /^[A-Za-z\s]+$/.test(cellText)) {
                          patientName = cellText;
                        }
                      }
                      // First column might be QNo
                      if (!qno && /^Q?\d+$/.test(cellText)) {
                        qno = cellText;
                      }
                    }
                    
                    // Get status from row (often near the end)
                    if (row.length > 1) {
                      const lastCells = row.slice(-3);
                      for (const cell of lastCells) {
                        const cellText = (cell || '').trim().toLowerCase();
                        if (['pending', 'completed', 'served', 'cancelled', 'waiting'].some(s => cellText.includes(s))) {
                          status = (cell || '').trim();
                          break;
                        }
                      }
                    }
                    
                    items.push({ 
                      nric, 
                      patientName,
                      qno,
                      status,
                      source: 'reports_queue_list_nested_iframe', 
                      rawRow: row 
                    });
                  }
                }
              }
              
              if (items.length > 0) {
                this._logStep('Extracted items from nested iframe tables', { count: items.length });
                return items;
              }
              
              // If no tables but we have text content, extract from text
              const nestedText = nestedContentToUse.allText || nestedContentToUse.bodyText || '';
              if (nestedText.length > 500) {
                this._logStep('Extracting from nested iframe text (no tables found)', {
                  textLength: nestedText.length,
                  source: nestedContentData ? 'nestedCheck' : 'iframeData',
                });
                
                const lines = nestedText.split(/[\n\r]+/);
                const items = [];
                
                for (const line of lines) {
                  const trimmedLine = line.trim();
                  if (trimmedLine.length < 5) continue;
                  
                  // Look for NRIC pattern
                  const nricMatch = trimmedLine.match(/[STFGM]\s*\d{4}\s*\d{3}\s*[A-Z]|[STFGM]\d{7}[A-Z]|[STFGM]\d{4}\s*\d{3}\s*[A-Z]/i);
                  if (nricMatch) {
                    const nric = nricMatch[0].replace(/\s+/g, '').toUpperCase();
                    const lineIndex = lines.indexOf(line);
                    let patientName = null;
                    
                    // Look for patient name in nearby lines
                    for (let i = Math.max(0, lineIndex - 3); i <= Math.min(lines.length - 1, lineIndex + 3); i++) {
                      const nearbyLine = lines[i].trim();
                      if (nearbyLine.length > 3 && 
                          nearbyLine.length < 50 &&
                          !nric.includes(nearbyLine) &&
                          !/^\d+$/.test(nearbyLine) &&
                          !nearbyLine.includes('$') &&
                          !nearbyLine.match(/^\d{1,2}\/\d{1,2}\/\d{4}/) &&
                          /^[A-Za-z\s,.'-]+$/.test(nearbyLine)) {
                        patientName = nearbyLine;
                        break;
                      }
                    }
                    
                    items.push({
                      nric,
                      patientName,
                      source: 'reports_queue_list_nested_iframe_text',
                      rawLine: trimmedLine,
                    });
                  }
                }
                
                if (items.length > 0) {
                  this._logStep('Extracted items from nested iframe text', { count: items.length });
                  return items;
                }
              }
            } // End of if (nestedContentToUse) block
            
            // If nested content exists, use that; otherwise use iframe content  
            // Note: This code is still inside the if (iframeData && !iframeData.error) block
            const textToExtract = nestedContentToUse && nestedContentToUse.allText && nestedContentToUse.allText.length > 0
              ? nestedContentToUse.allText
              : (iframeData.allText && iframeData.allText.length > iframeData.bodyText.length 
                  ? iframeData.allText 
                  : iframeData.bodyText);
            
            // Extract from tables in main iframe (only if we didn't already extract from nested content)
            if (iframeData.tableCount > 0) {
              const items = [];
              for (const table of iframeData.tables) {
                for (const row of table.rows) {
                  if (row.length < 3) continue;
                  const rowText = row.join(' ').toLowerCase();
                  const nricMatch = rowText.match(/[stfg]\d{7}[a-z]/i);
                  
                  if (nricMatch) {
                    const nric = nricMatch[0].toUpperCase();
                    let patientName = null;
                    
                    for (const cell of row) {
                      const cellText = (cell || '').trim();
                      if (cellText.length > 3 && 
                          !/^\d+$/.test(cellText) && 
                          !/[stfg]\d{7}[a-z]/i.test(cellText) &&
                          !cellText.includes('$') &&
                          !cellText.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
                        patientName = cellText;
                        break;
                      }
                    }
                    
                    items.push({ nric, patientName, source: 'reports_queue_list_iframe', rawRow: row });
                  }
                }
              }
              
              if (items.length > 0) {
                this._logStep('Extracted items from iframe tables', { count: items.length });
                return items;
              }
            }
            
            // Extract from text if no tables (textToExtract already defined above)
            if (textToExtract && textToExtract.length > 0) {
              this._logStep('Extracting from iframe text content', { textLength: textToExtract.length });
              
              const lines = textToExtract.split(/[\n\r]+/);
              const items = [];
              
              this._logStep('Parsing lines from iframe text', { lineCount: lines.length, preview: textToExtract.substring(0, 500) });
              
              for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.length < 5) continue;
                
                // Look for NRIC pattern (various formats: S1234567A or S 1234 567 A)
                const nricMatch = trimmedLine.match(/[STFGM]\s*\d{4}\s*\d{3}\s*[A-Z]|[STFGM]\d{7}[A-Z]|[STFGM]\d{4}\s*\d{3}\s*[A-Z]/i);
                if (nricMatch) {
                  const nric = nricMatch[0].replace(/\s+/g, '').toUpperCase();
                  const lineIndex = lines.indexOf(line);
                  let patientName = null;
                  
                  // Look for patient name in nearby lines
                  for (let i = Math.max(0, lineIndex - 3); i <= Math.min(lines.length - 1, lineIndex + 3); i++) {
                    const nearbyLine = lines[i].trim();
                    if (nearbyLine.length > 3 && 
                        nearbyLine.length < 50 &&
                        !nric.includes(nearbyLine) &&
                        !/^\d+$/.test(nearbyLine) &&
                        !nearbyLine.includes('$') &&
                        !nearbyLine.match(/^\d{1,2}\/\d{1,2}\/\d{4}/) &&
                        !/[STFGM]\d{7}[A-Z]/i.test(nearbyLine) &&
                        /^[A-Za-z\s]+$/.test(nearbyLine)) {
                      patientName = nearbyLine;
                      break;
                    }
                  }
                  
                  items.push({ 
                    nric, 
                    patientName, 
                    source: 'reports_queue_list_iframe_text',
                    rawLine: trimmedLine.substring(0, 200),
                  });
                }
              }
              
              if (items.length > 0) {
                this._logStep('Extracted items from iframe text', { count: items.length, items: items.map(i => ({ nric: i.nric, name: i.patientName })) });
                return items;
              } else {
                this._logStep('No NRIC patterns found in iframe text', { textPreview: textToExtract.substring(0, 500) });
              }
            } // This closes if (textToExtract...) at 3836
          } // This closes if (nestedContentToUse) at 3669
          } // End of if (iframeData && !iframeData.error) - closes if at 3643
          
          // This should be at same level as the if above (inside try, outside the if block)
          if (iframeData && iframeData.error) {
            this._logStep('Error accessing iframe', { error: iframeData.error });
          }
        } catch (e) {
          this._logStep('Error extracting from iframe', { error: e.message });
        }
      } // End of if (pageInfo.hasReportViewerIframes > 0)
      
      // Scroll page to check if export buttons are below the fold
      await evalInRoot(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await this.page.waitForTimeout(1000);
      
      // Check again after scrolling
      const exportButtonsAfterScroll = await evalInRoot(() => {
        const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], span[onclick], div[onclick], img[onclick]'));
        return buttons
          .filter(btn => {
            const text = (btn.textContent || btn.value || btn.innerText || btn.alt || btn.title || '').toLowerCase();
            const onclick = (btn.getAttribute('onclick') || '').toLowerCase();
            const href = (btn.href || '').toLowerCase();
            return (text.includes('excel') || text.includes('pdf') || text.includes('export') ||
                   onclick.includes('excel') || onclick.includes('pdf') || onclick.includes('export') ||
                   href.includes('.xls') || href.includes('.pdf'));
          })
          .map(btn => ({
            text: (btn.textContent || btn.value || btn.innerText || btn.alt || btn.title || '').trim(),
            href: btn.href || '',
            onclick: btn.getAttribute('onclick') || '',
            className: btn.className || '',
            id: btn.id || '',
            tag: btn.tagName.toLowerCase(),
          }));
      }).catch(() => []);
      
      if (exportButtonsAfterScroll.length > 0) {
        exportButtons.push(...exportButtonsAfterScroll);
      }
      
      // If PDF viewer detected or export buttons found, click Excel button
      if (pageInfo.hasPDFViewer || exportButtons.length > 0) {
        // Prefer Excel over PDF (easier to parse)
        const excelBtn = exportButtons.find(b => 
          b.text.toLowerCase().includes('excel') || 
          b.href.includes('.xls') || 
          b.onclick.toLowerCase().includes('excel')
        );
        const exportBtn = excelBtn || exportButtons.find(b => b.text.toLowerCase().includes('pdf')) || exportButtons[0];
        
        if (exportBtn) {
          this._logStep('Clicking export button to download', { button: exportBtn.text || exportBtn.id });
          
          try {
            // Set up download listener before clicking
            const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
            
            // Click the export button
            let clicked = false;
            if (exportBtn.id) {
              const btn = locInRoot(`#${exportBtn.id}`).first();
              if (await btn.count().catch(() => 0) > 0) {
                await btn.click();
                clicked = true;
              }
            }
            if (!clicked && exportBtn.text) {
              const btn = locInRoot(`button:has-text("${exportBtn.text}"), a:has-text("${exportBtn.text}"), span:has-text("${exportBtn.text}"), div:has-text("${exportBtn.text}")`).first();
              if (await btn.count().catch(() => 0) > 0) {
                await btn.click();
                clicked = true;
              }
            }
            if (!clicked && exportBtn.href && !exportBtn.href.includes('javascript:')) {
              await this.page.goto(exportBtn.href, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
              clicked = true;
            }
            
            if (clicked) {
              await this.page.waitForTimeout(2000);
              const download = await downloadPromise;
              if (download) {
                const fileName = download.suggestedFilename() || `queue-report-${Date.now()}.${exportBtn.text.toLowerCase().includes('excel') || exportBtn.onclick.toLowerCase().includes('excel') ? 'xlsx' : 'pdf'}`;
                const filePath = `downloads/${fileName}`;
                await download.saveAs(filePath);
                this._logStep('Downloaded export file', { filePath, fileName });
                
                // TODO: Parse Excel/PDF file to extract queue items
                // For now, return empty - we'll implement parsing next
                return [];
              } else {
                this._logStep('No download event triggered, might be opening in new window/tab or direct navigation');
              }
            }
          } catch (e) {
            this._logStep('Error downloading export file', { error: e.message });
          }
        }
      }
      
      // If we're on QueueLog/Index and jqGrid exists but is empty, try to find and use date filter
      if (pageInfo.url.includes('/QueueLog') && pageInfo.hasJqGrid && pageInfo.jqGridRows === 0) {
        this._logStep('Queue page is empty, trying to find date filter');
        
        // Look for date filter inputs or buttons
        const dateFilterSelectors = [
          'input[type="date"]',
          'input[name*="date" i]',
          'input[id*="date" i]',
          'input[placeholder*="date" i]',
          'button:has-text("Filter")',
          'button:has-text("Search")',
          'a:has-text("Filter")',
        ];
        
        for (const selector of dateFilterSelectors) {
          const element = locInRoot(selector).first();
          if ((await element.count().catch(() => 0)) > 0) {
            this._logStep('Found potential date filter element', { selector });
            // Try clicking filter button or filling date
            try {
              if (selector.includes('button') || selector.includes('a')) {
                await element.click();
                await this.page.waitForTimeout(2000);
              }
            } catch (e) {
              // Continue
            }
            break;
          }
        }
      }
      
      return await evalInRoot(() => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const items = [];

        // Try jqGrid format first (same as queue page)
        const jqGrid = document.querySelector('#queueLogGrid');
        if (jqGrid) {
          const rows = jqGrid.querySelectorAll('tr.jqgrow');
          for (const row of rows) {
            const getCellValue = (ariaDesc) => {
              const cell = row.querySelector(`td[aria-describedby$="${ariaDesc}"]`);
              return cell ? norm(cell.textContent) : null;
            };

            const patientName = getCellValue('_PatientName');
            const nric = getCellValue('_NRIC');
            const qno = getCellValue('_QNo');
            const payType = getCellValue('_PayType');
            const visitType = getCellValue('_VisitType');
            const fee = getCellValue('_Fee');
            const inTime = getCellValue('_In');
            const outTime = getCellValue('_Out');
            const status = getCellValue('_Status');

            if (patientName || nric) {
              items.push({
                qno,
                status,
                patientName,
                nric,
                payType,
                visitType,
                fee,
                inTime,
                outTime,
                source: 'reports_queue_list',
              });
            }
          }
        } else {
          // Try regular table format
          const tables = Array.from(document.querySelectorAll('table'));
          for (const table of tables) {
            const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
            for (const row of rows) {
              const cells = Array.from(row.querySelectorAll('td'));
              if (cells.length < 5) continue;

              // Try to identify columns by header or content
              const rowText = norm(row.textContent);
              
              // Look for NRIC pattern
              const nricMatch = rowText.match(/[STFGM]\s*\d{4}\s*\d{3}\s*[A-Z]/i);
              const nric = nricMatch ? nricMatch[0].replace(/\s+/g, '').toUpperCase() : null;

              // Extract patient name (usually text before NRIC or in name column)
              let patientName = null;
              for (const cell of cells) {
                const text = norm(cell.textContent);
                if (text && text.length > 3 && !/^\d+$/.test(text) && !/^[STFGM]\d{7}[A-Z]$/i.test(text) && !text.includes('$')) {
                  patientName = text;
                  break;
                }
              }

              if (patientName || nric) {
                items.push({
                  qno: cells[0] ? norm(cells[0].textContent) : null,
                  status: cells[1] ? norm(cells[1].textContent) : null,
                  patientName,
                  nric,
                  payType: cells.find(c => /MHC|AIA|Cash|Insurance/i.test(norm(c.textContent))) ? norm(cells.find(c => /MHC|AIA|Cash|Insurance/i.test(norm(c.textContent))).textContent) : null,
                  visitType: null,
                  fee: null,
                  inTime: null,
                  outTime: null,
                  source: 'reports_queue_list',
                });
              }
            }
          }
        }

        return items;
      });
    } catch (error) {
      this._logStep('Error extracting queue list results', { error: error.message });
      // Try a more aggressive extraction - look for any patient-like data
      try {
        const fallbackItems = await evalInRoot(() => {
          const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
          const items = [];
          const bodyText = document.body?.innerText || '';
          
          // Look for NRIC patterns in the entire page
          const nricPattern = /([STFGM]\s*\d{4}\s*\d{3}\s*[A-Z])/gi;
          const nricMatches = [...bodyText.matchAll(nricPattern)];
          
          for (const match of nricMatches) {
            const nric = match[1].replace(/\s+/g, '').toUpperCase();
            // Try to find patient name near the NRIC (within 200 chars)
            const contextStart = Math.max(0, match.index - 100);
            const contextEnd = Math.min(bodyText.length, match.index + 100);
            const context = bodyText.substring(contextStart, contextEnd);
            
            // Look for name-like text (2-4 words, capitalized)
            const nameMatch = context.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/);
            const patientName = nameMatch ? nameMatch[1] : null;
            
            if (nric && !items.find(item => item.nric === nric)) {
              items.push({
                nric,
                patientName,
                source: 'reports_queue_list_fallback',
              });
            }
          }
          
          return items;
        });
        
        if (fallbackItems && fallbackItems.length > 0) {
          this._logStep('Fallback extraction found items', { count: fallbackItems.length });
          return fallbackItems;
        }
      } catch (fallbackError) {
        this._logStep('Fallback extraction also failed', { error: fallbackError.message });
      }
      
      return [];
    }
  }

  /**
   * Login to Clinic Assist
   */
  async login() {
    try {
      this._logStep('Login start', { url: this.config.url, clinicGroup: this.config.clinicGroup });
      logger.info(`Logging into ${this.config.name}...`);
      
      // Avoid 'networkidle' here; Clinic Assist keeps background connections open.
      await this.page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.page.waitForTimeout(2000); // Wait for page to fully render
      
      // Take initial screenshot
      await this.page.screenshot({ path: 'screenshots/clinic-assist-login-page.png', fullPage: true });
      
      // Use exact selectors found from browser inspection
      // Username field: input[name="txtLoginID"] or input[id="txtLoginID"]
      const usernameSelectors = [
        'input[placeholder="Enter Username"]',
        'input[name="txtLoginID"]',
        'input[id="txtLoginID"]',
        'input[placeholder*="Username" i]',
      ];

      const usernameLocator = await this._pickBestVisibleLocator(usernameSelectors);

      if (!usernameLocator) {
        throw new Error('Could not find username field');
      }

      // Fill username using locator (more reliable)
      await usernameLocator.fill(this.config.username);
      logger.info('Username filled');
      this._logStep('Username filled');

      // Password field: input[name="txtPassword"] or input[id="txtPassword"]
      const passwordSelectors = [
        'input[placeholder="Enter Password"]',
        'input[name="txtPassword"]',
        'input[id="txtPassword"]',
        'input[type="password"]',
      ];

      const passwordLocator = await this._pickBestVisibleLocator(passwordSelectors);

      if (!passwordLocator) {
        throw new Error('Could not find password field');
      }

      // Fill password using locator with force option (it has tabindex="-1" and sometimes reports weird visibility)
      try {
        await passwordLocator.fill(this.config.password, { force: true });
      } catch (e) {
        // Fallback: use evaluate to set value directly
        await this.page.evaluate(({ selector, value }) => {
          const field = document.querySelector(selector);
          if (field) {
            field.value = value;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, { selector: '#txtPassword', value: this.config.password });
      }
      logger.info('Password filled');
      this._logStep('Password filled');

      // Clinic Group field: input[name="txtClinic"] or input[id="txtClinic"] (TEXT INPUT, not select!)
      const clinicGroupSelectors = [
        'input[name="txtClinic"]',
        'input[id="txtClinic"]',
        'input[placeholder*="Clinic Group" i]',
      ];

      let clinicGroupLocator = null;
      for (const selector of clinicGroupSelectors) {
        try {
          const locator = this.page.locator(selector);
          if (await locator.count() > 0) {
            clinicGroupLocator = locator;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!clinicGroupLocator) {
        throw new Error('Could not find Clinic Group field');
      }

      // Fill Clinic Group as text input using locator with force option
      try {
        await clinicGroupLocator.fill(this.config.clinicGroup, { force: true });
      } catch (e) {
        // Fallback: use evaluate to set value directly
        await this.page.evaluate(({ selector, value }) => {
          const field = document.querySelector(selector);
          if (field) {
            field.value = value;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, { selector: 'input[name="txtClinic"]', value: this.config.clinicGroup });
      }
      logger.info(`Clinic Group filled: ${this.config.clinicGroup}`);
      this._logStep('Clinic Group filled', { clinicGroup: this.config.clinicGroup });

      // Login button: button with text "Login"
      const loginButtonSelectors = [
        'button:has-text("Login")',
        'button[type="submit"]',
        'button',
      ];

      let loginButton = null;
      for (const selector of loginButtonSelectors) {
        try {
          const buttons = await this.page.$$(selector);
          for (const btn of buttons) {
            const text = await btn.textContent();
            if (text && text.trim().toLowerCase().includes('login')) {
              loginButton = btn;
              break;
            }
          }
          if (loginButton) break;
        } catch (e) {
          continue;
        }
      }

      if (!loginButton) {
        // Try pressing Enter as fallback
        await passwordLocator.press('Enter');
        logger.info('Pressed Enter to submit');
      } else {
        await loginButton.scrollIntoViewIfNeeded();
        await loginButton.click();
        logger.info('Login button clicked');
      }
      this._logStep('Login submitted');

      // Wait for navigation or check for 2FA
      await this.page.waitForTimeout(3000);
      
      // Clinic Assist login page always shows a "2 Factor Authentication" section,
      // but the verification code inputs are disabled when 2FA is not required.
      // Only treat 2FA as required if those inputs become enabled.
      const twoFaHeaderPresent = (await this.page
        .locator('text=/2\\s*Factor\\s*Authentication/i')
        .count()
        .catch(() => 0)) > 0;
      if (twoFaHeaderPresent) {
        const enabledCodeInputs = await this.page
          .locator('text=/Enter Your Verification Code/i')
          .locator('..')
          .locator('input:not([disabled])')
          .count()
          .catch(() => 0);
        if (enabledCodeInputs > 0) {
          logger.warn('Clinic Assist 2FA required (verification inputs enabled) - manual intervention needed');
          await this.page.screenshot({ path: 'screenshots/clinic-assist-2fa.png', fullPage: true });
          const waitMs = process.env.CLINIC_ASSIST_2FA_WAIT_MS
            ? Number(process.env.CLINIC_ASSIST_2FA_WAIT_MS)
            : 90000;
          logger.warn(`Waiting up to ${waitMs}ms for Clinic Assist 2FA completion...`);
          await this.page.waitForTimeout(waitMs);
        } else {
          logger.info('Clinic Assist 2FA not required (verification inputs disabled)');
        }
      }
      
      // Wait for DOM to be ready (don't wait for networkidle - it's too slow)
      await this.page.waitForLoadState('domcontentloaded');
      
      // Take screenshot after login
      await this.page.screenshot({ path: 'screenshots/clinic-assist-after-login.png', fullPage: true }).catch(() => {});

      // Some accounts are forced to a profile update modal; dismiss so it doesn't break downstream extraction.
      await this._dismissUpdateUserInfoIfPresent().catch(() => false);
      
      logger.info(`Successfully logged into ${this.config.name}`);
      this._logStep('Login ok');
      return true;
    } catch (error) {
      logger.error(`Login failed for ${this.config.name}:`, error);
      await this.page.screenshot({ path: 'screenshots/clinic-assist-login-error.png', fullPage: true });
      throw error;
    }
  }

  /**
   * Navigate to Queue: Branch > Dept > Queue
   * @param {string} branchName - Branch name to select
   * @param {string} deptName - Department name to select
   */
  async navigateToQueue(branchName, deptName) {
    try {
      this._logStep('Navigate to Queue', { branchName, deptName });
      logger.info(`Navigating to Queue: Branch=${branchName}, Dept=${deptName}...`);
      
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(2000);
      
      // Step 1: Select Branch
      const branchSelectors = [
        `select:has-text("${branchName}")`,
        'select[name*="branch" i]',
        'select[id*="branch" i]',
        'select:first-of-type',
      ];
      
      let branchSelected = false;
      for (const selector of branchSelectors) {
        try {
          const branchSelect = this.page.locator(selector).first();
          if (await branchSelect.count() > 0) {
            if (!branchName || branchName === '__FIRST__') {
              branchSelected = await this._selectFirstNonEmptyOption(branchSelect);
            } else {
              await branchSelect.selectOption({ label: branchName });
              branchSelected = true;
            }
            await this.page.waitForTimeout(1000);
            logger.info(`Branch selected: ${branchName}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!branchSelected) {
        logger.warn('Could not find branch selector, trying alternative methods...');
        // Try clicking on branch link/button
        const branchLinks = await this.page.$$(`a:has-text("${branchName}"), button:has-text("${branchName}")`);
        if (branchLinks.length > 0) {
          await branchLinks[0].click();
          await this.page.waitForTimeout(1000);
          branchSelected = true;
        }
      }
      
      // Step 2: Select Department
      await this.page.waitForTimeout(1000);
      const deptSelectors = [
        `select:has-text("${deptName}")`,
        'select[name*="dept" i]',
        'select[name*="department" i]',
        'select[id*="dept" i]',
      ];
      
      let deptSelected = false;
      for (const selector of deptSelectors) {
        try {
          const deptSelect = this.page.locator(selector).first();
          if (await deptSelect.count() > 0) {
            if (!deptName || deptName === '__FIRST__') {
              deptSelected = await this._selectFirstNonEmptyOption(deptSelect);
            } else {
              await deptSelect.selectOption({ label: deptName });
              deptSelected = true;
            }
            await this.page.waitForTimeout(1000);
            logger.info(`Department selected: ${deptName}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      // Step 2b: If "deptName" is actually a Room (e.g. Reception), it may be a clickable tab/button instead of a <select>.
      // We'll try clicking it explicitly. Safe to do even if it doesn't exist.
      if (deptName && deptName !== '__FIRST__') {
        const roomClickSelectors = [
          `a:has-text("${deptName}")`,
          `button:has-text("${deptName}")`,
          `[role="tab"]:has-text("${deptName}")`,
          `[role="button"]:has-text("${deptName}")`,
          `div:has-text("${deptName}")`,
        ];
        for (const selector of roomClickSelectors) {
          try {
            const el = this.page.locator(selector).first();
            if ((await el.count()) > 0) {
              await el.click({ timeout: 3000 }).catch(() => {});
              await this.page.waitForTimeout(800);
              logger.info(`Room clicked (if applicable): ${deptName}`);
              break;
            }
          } catch {
            continue;
          }
        }
      }

      // After clicking room (Reception), wait for navigation into the room page (e.g. /Home/Reception)
      await this.page.waitForURL(/\/Home\//, { timeout: 15000 }).catch(() => {});
      
      // Step 3: Navigate to Queue immediately after room loads (reduced wait)
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(500); // Reduced from 1000ms to 500ms
      // Prefer the sidebar link "Queue" (this navigates to /QueueLog/Index).
      const queueSidebarLink = this.page.getByRole('link', { name: /^Queue$/i });
      if ((await queueSidebarLink.count().catch(() => 0)) > 0) {
        await queueSidebarLink.click().catch(async () => queueSidebarLink.click({ force: true }));
        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.page.waitForTimeout(1500);
        logger.info('Navigated to Queue');
        await this.page
          .screenshot({ path: 'screenshots/clinic-assist-queue.png', fullPage: true, timeout: 5000 })
          .catch(() => {});
        return true;
      }

      // If we are already within the app but the sidebar isn't accessible via role lookup,
      // directly navigate to the known Queue URL.
      try {
        const base = new URL(this.page.url());
        const directQueueUrl = new URL('/QueueLog/Index', base).toString();
        await this.page.goto(directQueueUrl, { waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(1500);
        logger.info(`Navigated to Queue (direct): ${directQueueUrl}`);
        await this.page
          .screenshot({ path: 'screenshots/clinic-assist-queue.png', fullPage: true, timeout: 5000 })
          .catch(() => {});
        return true;
      } catch {
        // ignore
      }

      // Fallback: generic selectors
      const queueSelectors = ['a:has-text("Queue")', 'button:has-text("Queue")', '[href*="Queue" i]'];
      for (const selector of queueSelectors) {
        try {
          const el = this.page.locator(selector).first();
          if ((await el.count()) > 0) {
            await el.click().catch(() => el.click({ force: true }));
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            await this.page.waitForTimeout(1500);
            logger.info('Navigated to Queue (fallback)');
            await this.page
              .screenshot({ path: 'screenshots/clinic-assist-queue.png', fullPage: true, timeout: 5000 })
              .catch(() => {});
            return true;
          }
        } catch {
          continue;
        }
      }
      
      logger.warn('Could not find Queue navigation');
      return false;
    } catch (error) {
      logger.error('Failed to navigate to Queue:', error);
      await this.page
        .screenshot({ path: 'screenshots/clinic-assist-queue-error.png', fullPage: true, timeout: 5000 })
        .catch(() => {});
      throw error;
    }
  }

  async _pickFirstQueueRowByKeywords(keywords) {
    return await this.page.evaluate((keywordsLower) => {
      const norm = (s) => (s || '').toLowerCase();
      const kw = keywordsLower.map((k) => k.toLowerCase());

      // Prefer table rows if present
      const rows = Array.from(document.querySelectorAll('table tr'));
      const candidates = rows.length ? rows : Array.from(document.querySelectorAll('tr, li, .row, .card, div'));
      for (const el of candidates) {
        const text = norm(el.textContent);
        if (!text || text.length < 5) continue;
        if (kw.some((k) => text.includes(k))) {
          // Return a minimal selector hint by index if possible
          return { text: el.textContent || '' };
        }
      }
      // fallback: first non-empty row-ish element
      for (const el of candidates) {
        const text = (el.textContent || '').trim();
        if (text.length > 10) return { text };
      }
      return null;
    }, keywords);
  }

  /**
   * Extract patient information from queue
   * @param {string} patientIdentifier - Patient name or identifier to search for
   * @returns {Object} Patient information including NRIC
   */
  async extractPatientFromQueue(patientIdentifier) {
    try {
      this._logStep('Extract patient from Queue', { patientIdentifier });
      logger.info(`Extracting patient information for: ${patientIdentifier}`);
      
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(2000);

      // Prefer extracting NRIC directly from the Queue row (NRIC column contains it, often with spaces).
      let nric = null;
      let patientName = null;
      let visitType = null;

      if (!patientIdentifier || patientIdentifier === '__AUTO_MHC_AIA__') {
        // Preferred: jqGrid table used by QueueLog
        const jqGrid = this.page.locator('#queueLogGrid');
        if ((await jqGrid.count().catch(() => 0)) > 0) {
          const jqRows = jqGrid.locator('tr.jqgrow');
          await jqRows.first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
          const mhcRow = jqGrid.locator('tr.jqgrow:has(td[aria-describedby$=\"_PayType\"]:has-text(\"MHC\"))').first();
          const aiaRow = jqGrid.locator('tr.jqgrow:has(td[aria-describedby$=\"_PayType\"]:has-text(\"AIA\"))').first();
          const row = (await mhcRow.count().catch(() => 0)) > 0 ? mhcRow : aiaRow;
          if ((await row.count().catch(() => 0)) > 0) {
            // Read NRIC and Patient Name from their columns
            const nricCellText = ((await row.locator('td[aria-describedby$="_NRIC"]').first().textContent().catch(() => '')) || '').trim();
            const nameCellText = ((await row.locator('td[aria-describedby$="_PatientName"]').first().textContent().catch(() => '')) || '').trim();
            const visitTypeText = ((await row.locator('td[aria-describedby$="_VisitType"]').first().textContent().catch(() => '')) || '').trim();
            const nricMatch = nricCellText.match(/[STFGM]\s*\d{4}\s*\d{3}\s*[A-Z]/i) || nricCellText.match(/[STFGM]\d{7}[A-Z]/i);
            if (nricMatch) nric = nricMatch[0].replace(/\s+/g, '').toUpperCase();
            if (nameCellText) patientName = nameCellText;
            if (visitTypeText) visitType = this._normalizeVisitType(visitTypeText);
          }
        }

        const roleRows = this.page.locator('[role="row"]');
        const roleRowCount = await roleRows.count().catch(() => 0);
        logger.info(`Queue debug: roleRowCount=${roleRowCount}`);
        const domDebug = await this.page
          .evaluate(() => {
            const bodyText = document.body?.innerText || '';
            return {
              bodyHasMHC: bodyText.includes('MHC'),
              bodyHasAIA: bodyText.includes('AIA'),
              queueLogGridExists: !!document.querySelector('#queueLogGrid'),
              roleRowCountDom: document.querySelectorAll('[role=\"row\"]').length,
              trCountDom: document.querySelectorAll('tr').length,
            };
          })
          .catch(() => null);
        if (domDebug) logger.info(`Queue debug: ${JSON.stringify(domDebug)}`);

        let row = null;
        if (roleRowCount > 1) {
          const dataRows = roleRows.filter({ hasText: /\b(Paid|Seen|New)\b/i });
          const mhcCount = await dataRows.filter({ hasText: /MHC/i }).count().catch(() => 0);
          const aiaCount = await dataRows.filter({ hasText: /AIA/i }).count().catch(() => 0);
          logger.info(`Queue debug: MHC rows=${mhcCount}, AIA rows=${aiaCount}`);
          row = dataRows.filter({ hasText: /(MHC|AIA|AIACLient)/i }).first();
        } else {
          const queueTable = this.page.locator('table:has(th:has-text("QNo"))').first();
          const rows = queueTable.locator('tbody tr');
          await rows.first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
          row = rows.filter({ hasText: /(MHC|AIA|AIACLient)/i }).first();
        }

        if ((await row.count().catch(() => 0)) > 0) {
          const rowText = (await row.textContent().catch(() => '')) || '';
          const nricMatch = rowText.match(/[STFGM]\s*\d{4}\s*\d{3}\s*[A-Z]/i);
          if (nricMatch) nric = nricMatch[0].replace(/\s+/g, '').toUpperCase();
          // Patient Name is uppercase in grid; best-effort extract
          const nameMatch = rowText.match(/[A-Z][A-Z ,.'-]{6,}/);
          if (nameMatch) patientName = nameMatch[0].trim();
        }
      }

      // Fallback: open the queued patient/visit first, then extract NRIC from the patient info screen.
      if (!nric) {
        this._logStep('Queue: NRIC not found in row; opening visit to extract NRIC from patient info');
        await this.openQueuedPatientForExtraction(patientIdentifier || '__AUTO_MHC_AIA__');
        nric = await this.extractPatientNricFromPatientInfo();
      }

      const patientInfo = {
        identifier: patientIdentifier,
        nric: nric,
        rawText: null,
        patientName,
        visitType,
      };
      
      logger.info(`Patient extracted: NRIC=${nric}`);
      this._logStep('Queue: patient info extracted', { nric, patientName, visitType });
      return patientInfo;
    } catch (error) {
      logger.error('Failed to extract patient information:', error);
      throw error;
    }
  }

  /**
   * Extract charge type and special remarks from patient record
   * @param {string} patientIdentifier - Patient identifier
   * @returns {Object} Charge type and special remarks
   */
  async extractChargeTypeAndRemarks(patientIdentifier) {
    try {
      this._logStep('Extract charge type + remarks (legacy)', { patientIdentifier });
      logger.info(`Extracting charge type and remarks for: ${patientIdentifier}`);
      
      // Click on patient to open their record
      const patientSelectors = [
        `tr:has-text("${patientIdentifier}")`,
        `div:has-text("${patientIdentifier}")`,
        `a:has-text("${patientIdentifier}")`,
      ];
      
      for (const selector of patientSelectors) {
        try {
          const patientLink = this.page.locator(selector).first();
          if (await patientLink.count() > 0) {
            await patientLink.click();
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      await this.page.screenshot({ path: 'screenshots/clinic-assist-patient-record.png', fullPage: true });
      
      // Extract charge type
      const chargeTypeSelectors = [
        'select[name*="charge" i]',
        'select[id*="charge" i]',
        'input[name*="charge" i]',
        '[data-charge-type]',
      ];
      
      let chargeType = null;
      for (const selector of chargeTypeSelectors) {
        try {
          const element = this.page.locator(selector).first();
          if (await element.count() > 0) {
            chargeType = await element.inputValue().catch(() => 
              element.evaluate(el => el.value || el.textContent)
            );
            if (chargeType) break;
          }
        } catch (e) {
          continue;
        }
      }
      
      // Extract special remarks
      const remarksSelectors = [
        'textarea[name*="remark" i]',
        'textarea[name*="note" i]',
        'textarea[id*="remark" i]',
        'div[class*="remark" i]',
        '[data-remarks]',
      ];
      
      let specialRemarks = null;
      for (const selector of remarksSelectors) {
        try {
          const element = this.page.locator(selector).first();
          if (await element.count() > 0) {
            specialRemarks = await element.inputValue().catch(() =>
              element.textContent()
            );
            if (specialRemarks) break;
          }
        } catch (e) {
          continue;
        }
      }
      
      const result = {
        chargeType: chargeType?.trim() || null,
        specialRemarks: specialRemarks?.trim() || null,
      };
      
      logger.info(`Charge type: ${chargeType}, Remarks: ${specialRemarks?.substring(0, 50)}...`);
      this._logStep('Extracted charge/remarks (legacy)', {
        chargeType: result.chargeType,
        remarksSample: (result.specialRemarks || '').slice(0, 80) || null,
      });
      return result;
    } catch (error) {
      logger.error('Failed to extract charge type and remarks:', error);
      throw error;
    }
  }

  /**
   * Extract medicine names from dispense and payment section
   * @returns {Array<string>} Array of medicine names
   */
  async extractMedicineNames() {
    try {
      this._logStep('Extract medicine names (legacy)');
      logger.info('Extracting medicine names from dispense and payment...');

      // Safety: the current extractor is heuristic and can pick up lots of non-medicine UI labels.
      // Only enable this when we're ready to refine selectors for the actual dispense table.
      const enabled =
        process.env.ENABLE_MEDICINE_EXTRACTION === 'true' || process.env.ENABLE_MEDICINE_EXTRACTION === '1';
      if (!enabled) {
        logger.warn('Medicine extraction disabled (set ENABLE_MEDICINE_EXTRACTION=1 to enable)');
        return [];
      }
      
      // Navigate to dispense and payment section
      const dispenseSelectors = [
        'a:has-text("Dispense")',
        'a:has-text("Payment")',
        'button:has-text("Dispense")',
        '[href*="dispense" i]',
        '[href*="payment" i]',
      ];
      
      for (const selector of dispenseSelectors) {
        try {
          const link = this.page.locator(selector).first();
          if (await link.count() > 0) {
            await link.click();
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      await this.page.screenshot({ path: 'screenshots/clinic-assist-medicines.png', fullPage: true });
      
      // Extract medicine names from table/list
      const medicineNames = await this.page.evaluate(() => {
        const medicines = [];
        // Look for medicine names in tables, lists, or specific elements
        const rows = document.querySelectorAll('tr, li, div[class*="medicine"], div[class*="drug"]');
        rows.forEach(row => {
          const text = row.textContent || '';
          // Common medicine name patterns (adjust based on actual UI)
          if (text.length > 3 && text.length < 100) {
            medicines.push(text.trim());
          }
        });
        return medicines.filter((m, i, arr) => arr.indexOf(m) === i); // Remove duplicates
      });
      
      logger.info(`Extracted ${medicineNames.length} medicines`);
      this._logStep('Medicines extracted (legacy)', { count: medicineNames.length });
      return medicineNames;
    } catch (error) {
      logger.error('Failed to extract medicine names:', error);
      return [];
    }
  }

  /**
   * Process a claim
   * @param {Object} claimData - Claim information
   */
  async processClaim(claimData) {
    try {
      logger.info(`Processing claim: ${JSON.stringify(claimData)}`);
      
      // Navigate to claims if not already there
      await this.navigateToClaims();
      
      // Wait a bit for page to load
      await this.page.waitForTimeout(2000);
      
      // Take screenshot
      await this.page.screenshot({ path: 'screenshots/clinic-assist-claims-page.png', fullPage: true });
      
      // TODO: Implement specific claim processing logic based on Clinic Assist UI
      // This will need to be customized based on the actual interface
      
      logger.info('Claim processing completed');
      return { success: true, claimData };
    } catch (error) {
      logger.error('Failed to process claim:', error);
      throw error;
    }
  }

  /**
   * Logout from Clinic Assist
   */
  async logout() {
    try {
      logger.info('Logging out...');
      
      const logoutSelectors = [
        'a:has-text("Logout")',
        'a:has-text("Log Out")',
        'button:has-text("Logout")',
        '[href*="logout" i]',
        '[onclick*="logout" i]',
      ];

      for (const selector of logoutSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            await element.click();
            await this.page.waitForLoadState('networkidle');
            logger.info('Logged out successfully');
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      logger.warn('Could not find logout button');
      return false;
    } catch (error) {
      logger.error('Failed to logout:', error);
      throw error;
    }
  }

  /**
   * Parse Excel file and extract patient items
   * @param {string} excelPath - Path to the Excel file
   * @returns {Promise<Array>} Array of patient items
   */
  async _parseExcelFile(excelPath) {
    const items = [];
    
    try {
      // Read Excel file using XLSX (supports both .xls and .xlsx)
      const workbook = XLSX.readFile(excelPath);
      
      // Get the first worksheet
      const sheetNames = workbook.SheetNames;
      if (sheetNames.length === 0) {
        this._logStep('No worksheets found in Excel file');
        return items;
      }
      
      const worksheetName = sheetNames[0];
      const worksheet = workbook.Sheets[worksheetName];
      
      // Convert worksheet to array of arrays (raw format) to handle files without proper headers
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null, raw: false });
      
      // Find header row - this report often has blank spacer rows, so scan a bit further.
      // We look for a row that contains at least: PCNO + NAME (+ INV or TIME/CASH).
      let headerRowIndex = -1;
      const scanMax = Math.min(80, rawData.length);
      for (let i = 0; i < scanMax; i++) {
        const row = rawData[i] || [];
        const rowText = row
          .map((c) => (c === null || c === undefined ? '' : String(c)))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        if (!rowText) continue;

        const hasPcno = rowText.includes('pcno');
        const hasName = rowText.includes('name');
        const hasInv = rowText.includes('inv');
        const hasTime = rowText.includes('time in') || rowText.includes('timeout') || rowText.includes('time');
        const hasCash = rowText.includes('cash trans') || rowText.includes('cash');
        const hasQno = rowText.includes('qno');

        if (hasPcno && hasName && (hasInv || hasTime || hasCash || hasQno)) {
          headerRowIndex = i;
          break;
        }
      }
      
      if (headerRowIndex < 0) {
        this._logStep('No header row found in Excel file');
        return items;
      }
      
      // Keep both:
      // - headerRowRaw: preserves original column positions (indices)
      // - headerRow: compacted for logging/display
      const headerRowRaw = (rawData[headerRowIndex] || []).map((h) =>
        h === null || h === undefined ? '' : String(h).trim()
      );
      const headerRow = headerRowRaw.filter((h) => h);
      this._logStep('Found header row', { rowIndex: headerRowIndex, headers: headerRow });

      const normHeader = (s) =>
        String(s || '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();

      const getColIndex = (row, predicate) => {
        for (let i = 0; i < row.length; i++) {
          const h = normHeader(row[i]);
          if (predicate(h)) return i;
        }
        return -1;
      };

      const qnoColPos = getColIndex(headerRowRaw, (h) => h.includes('qno'));
      const pcnoColPos = getColIndex(headerRowRaw, (h) => h.includes('pcno'));
      const nameColPos = getColIndex(headerRowRaw, (h) => h === 'name' || h.startsWith('name '));
      const sexColPos = getColIndex(headerRowRaw, (h) => h === 'sex' || h.includes('sex'));
      const spCodeColPos = getColIndex(headerRowRaw, (h) => h.includes('sp') && h.includes('code'));
      const timeInColPos = getColIndex(headerRowRaw, (h) => h.includes('time in'));
      const timeOutColPos = getColIndex(headerRowRaw, (h) => h.includes('timeout'));
      const invNoColPos = getColIndex(headerRowRaw, (h) => h.includes('inv'));
      const cashTransColPos = getColIndex(headerRowRaw, (h) => h.includes('cash') && h.includes('trans'));

      // CONTRACT is typically in the next header row (a separate line that only labels end columns).
      let contractColPos = -1;
      for (let i = headerRowIndex + 1; i < Math.min(headerRowIndex + 12, rawData.length); i++) {
        const row = rawData[i] || [];
        for (let j = 0; j < row.length; j++) {
          const cell = normHeader(row[j]);
          if (cell === 'contract' || cell.includes('contract')) {
            contractColPos = j;
            break;
          }
        }
        if (contractColPos >= 0) break;
      }

      this._logStep('Column positions detected', {
        qnoCol: qnoColPos,
        pcnoCol: pcnoColPos,
        nameCol: nameColPos,
        sexCol: sexColPos,
        spCodeCol: spCodeColPos,
        timeInCol: timeInColPos,
        timeOutCol: timeOutColPos,
        invNoCol: invNoColPos,
        cashTransCol: cashTransColPos,
        contractCol: contractColPos,
      });

      this._logStep('Parsing Excel file', {
        worksheetName,
        headerRowIndex,
        headerCount: headerRow.length,
      });

      const stopSectionMatchers = [/patient account payment/i, /account settlement/i, /patient account settlement/i];
      const knownContractsExact = new Set([
        'MHC',
        'FULLERT',
        'IHP',
        'ALL',
        'ALLIANZ',
        'AIA',
        'GE',
        'AIACLIENT',
        'AVIVA',
        'SINGLIFE',
        'PARKWAY',
      ]);

      // Iterate through data rows until we hit subsequent report sections (payments/settlements).
      for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i] || [];
        const rowText = row
          .map((c) => (c === null || c === undefined ? '' : String(c)))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (rowText && stopSectionMatchers.some((re) => re.test(rowText))) {
          this._logStep('Stopping Queue Listing parse at non-visit section', { rowIndex: i, rowText: rowText.slice(0, 120) });
          break;
        }

        const pcno = pcnoColPos >= 0 ? normalizePcno(row[pcnoColPos]) : null;
        const patientName = nameColPos >= 0 && row[nameColPos] ? String(row[nameColPos]).trim() : null;
        const invNoRaw = invNoColPos >= 0 && row[invNoColPos] ? String(row[invNoColPos]).trim() : '';

        // Only keep "visit" rows. This report can contain additional non-visit sections after the listing,
        // and those sections use different headers/columns.
        if (!pcno || !patientName) continue;
        if (invNoColPos >= 0 && !/^\d{5,}$/.test(invNoRaw)) continue;

        const qnoRaw = qnoColPos >= 0 && row[qnoColPos] ? String(row[qnoColPos]).trim() : null;
        const sexRaw = sexColPos >= 0 && row[sexColPos] ? String(row[sexColPos]).trim() : null;
        const spCodeRaw = spCodeColPos >= 0 && row[spCodeColPos] ? String(row[spCodeColPos]).trim() : null;
        const timeInRaw = timeInColPos >= 0 && row[timeInColPos] ? String(row[timeInColPos]).trim() : null;
        const timeOutRaw = timeOutColPos >= 0 && row[timeOutColPos] ? String(row[timeOutColPos]).trim() : null;

        const cashTransRaw = cashTransColPos >= 0 && row[cashTransColPos] ? String(row[cashTransColPos]).trim() : null;
        const fee = cashTransRaw ? String(cashTransRaw).replace(/[^0-9.]/g, '') || null : null;

        // Contract/pay type: prefer CONTRACT column if present; else scan row from the end.
        let payType = null;
        if (contractColPos >= 0 && row[contractColPos]) {
          const v = String(row[contractColPos]).replace(/\s+/g, ' ').trim();
          if (v) payType = v.toUpperCase();
        }
        if (!payType) {
          for (let j = row.length - 1; j >= 0; j--) {
            const cellStr = String(row[j] || '').replace(/\s+/g, ' ').trim().toUpperCase();
            if (!cellStr) continue;
            if (knownContractsExact.has(cellStr)) {
              payType = cellStr;
              break;
            }
            if (cellStr.includes('AVIVA') || cellStr.includes('SINGLIFE')) {
              payType = cellStr;
              break;
            }
          }
        }

        // Optional: search all cells for NRIC pattern (some exports include it)
        let nric = null;
        for (let j = 0; j < row.length; j++) {
          const value = row[j];
          if (!value) continue;
          const cellStr = String(value).trim();
          const nricPatterns = [
            /[STFGM]\s*\d{4}\s*\d{3}\s*[A-Z]/i,
            /[STFGM]\d{7}[A-Z]/i,
            /[STFGM]\d{4}\s*\d{3}[A-Z]/i,
            /[STFGM]\d{7}\s*[A-Z]/i,
            /[STFGM][\/\-]\d{7}[\/\-][A-Z]/i,
          ];
          for (const pattern of nricPatterns) {
            const m = cellStr.match(pattern);
            if (m) {
              nric = normalizeNric(m[0]) || m[0].replace(/[\s\/\-]+/g, '').toUpperCase();
              break;
            }
          }
          if (nric) break;
        }

        // In the Queue Listing Excel export, QNO is frequently exported as ".0" for all rows.
        // Use INV NO as the stable unique record number for deduplication/claim workflows.
        const visitRecordNo =
          invNoRaw ||
          (qnoRaw && qnoRaw !== '.0' && qnoRaw !== '0' ? qnoRaw : null);

        items.push({
          nric: nric || null,
          patientName,
          patientNameClean: normalizePatientNameForSearch(patientName),
          qno: visitRecordNo,
          pcno,
          status: null,
          fee,
          payType: payType || null,
          sex: sexRaw || null,
          spCode: spCodeRaw || null,
          timeIn: timeInRaw || null,
          timeOut: timeOutRaw || null,
          invNo: invNoRaw || null,
          source: 'reports_queue_list_excel_extraction',
          rawRow: row.filter((v) => v !== null && v !== undefined).map((v) => String(v)),
          rawRowIndex: i,
        });
      }
      
      this._logStep('Excel parsing complete', { itemsFound: items.length });
      
    } catch (error) {
      this._logStep('Error parsing Excel file', { error: error.message });
    }
    
    return items;
  }

  /**
   * Extract patient items from PDF text content
   * @param {string} text - Extracted text from PDF
   * @returns {Array} Array of patient items
   */
  _extractItemsFromPDFText(text) {
    const items = [];
    
    if (!text || text.length < 100) {
      return items;
    }
    
    // Split text into lines for processing
    const lines = text.split(/[\n\r]+/);
    
    // Look for NRIC patterns in the text
    const nricPattern = /[STFGM]\s*\d{4}\s*\d{3}\s*[A-Z]|[STFGM]\d{7}[A-Z]/gi;
    const nricMatches = [...text.matchAll(nricPattern)];
    
    for (const match of nricMatches) {
      const nric = match[0].replace(/\s+/g, '').toUpperCase();
      const matchIndex = match.index;
      
      // Extract context around the NRIC (200 chars before and after)
      const contextStart = Math.max(0, matchIndex - 200);
      const contextEnd = Math.min(text.length, matchIndex + 200);
      const context = text.substring(contextStart, contextEnd);
      
      // Extract patient name (typically appears before NRIC or on same line)
      let patientName = null;
      const namePatterns = [
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+[STFGM]\s*\d{4}\s*\d{3}\s*[A-Z]/i, // Name before NRIC
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/g, // Any capitalized name in context
      ];
      
      for (const pattern of namePatterns) {
        const nameMatch = context.match(pattern);
        if (nameMatch) {
          const candidate = nameMatch[1].trim();
          if (candidate.length > 2 && candidate.length < 50 && !candidate.includes(nric)) {
            patientName = candidate;
            break;
          }
        }
      }
      
      // Extract other fields from context (QNo, status, etc.)
      let qno = null;
      let status = null;
      let fee = null;
      
      // Look for queue number (Q followed by digits or just digits at start of line)
      const qnoMatch = context.match(/\bQ?\s*\d{1,4}\b/i);
      if (qnoMatch) {
        qno = qnoMatch[0].replace(/\s+/g, '');
      }
      
      // Look for status keywords
      const statusMatch = context.match(/\b(pending|completed|served|cancelled|waiting|active|done)\b/i);
      if (statusMatch) {
        status = statusMatch[1];
      }
      
      // Look for fee amounts ($XX.XX)
      const feeMatch = context.match(/\$\s*(\d+(?:\.\d{2})?)/);
      if (feeMatch) {
        fee = feeMatch[1];
      }
      
      // Avoid duplicates
      if (!items.find(item => item.nric === nric)) {
        items.push({
          nric,
          patientName,
          qno,
          status,
          fee,
          source: 'reports_queue_list_pdf_extraction',
          rawContext: context.substring(0, 200)
        });
      }
    }
    
    return items;
  }

  /**
   * Extract queue list results (root-aware: supports Reports iframe deployments).
   *
   * Preferred extraction path:
   * - Trigger/locate the Crystal ReportViewer export controls (Excel) and download the XLS/XLSX.
   * - Parse the exported file via _parseExcelFile() to get reliable PCNO + Contract/PayType.
   *
   * Fallbacks:
   * - Parse jqGrid/table data if present (rare; depends on deployment).
   */
  async extractQueueListResults() {
    try {
      this._logStep('Extracting queue list results (root-aware)');
      await this.page.screenshot({ path: 'screenshots/clinic-assist-queue-list-extraction.png', fullPage: true }).catch(() => {});

      const { root, kind } = await this._getQueueReportRoot();
      this._logStep('QueueReport extract context', {
        kind,
        pageUrl: this.page.url(),
        frameUrl: kind === 'frame' ? root.url() : null,
      });

      // Give the report viewer time to render after Generate.
      await this.page.waitForTimeout(6000);

      const reportIframe = root.locator('iframe[src*="ReportViewer"], iframe[src*="queueListing"]').first();
      const reportIframeCount = await reportIframe.count().catch(() => 0);

      const tryDownloadAndParse = async (frameLocator, label) => {
        // Wait for some content in the viewer.
        await frameLocator.locator('body').waitFor({ timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(800);

        const downloadAndParse = async (clickTarget, why) => {
          const downloadPromise = this.page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
          await clickTarget.click({ force: true }).catch(async () => clickTarget.click().catch(() => {}));
          await this.page.waitForTimeout(2500);
          const download = await downloadPromise;
          if (!download) return null;

          const filename = download.suggestedFilename();
          const excelPath = path.join(process.cwd(), 'downloads', filename || `queue-report-${Date.now()}.xlsx`);
          fs.mkdirSync(path.dirname(excelPath), { recursive: true });
          await download.saveAs(excelPath);
          this._logStep('Queue report Excel downloaded', { label, why, excelPath });

          const items = await this._parseExcelFile(excelPath);
          if (items.length > 0) {
            this._logStep('Queue report Excel parsed', { label, count: items.length });
            return items;
          }
          return null;
        };

        // 1) Known Crystal "Excel" buttons.
        const buttonIds = ['#Button4', '#Button2'];
        for (const id of buttonIds) {
          const btn = frameLocator.locator(id).first();
          if ((await btn.count().catch(() => 0)) === 0) continue;
          const items = await downloadAndParse(btn, `click ${id}`).catch(() => null);
          if (items && items.length) return items;
        }

        // 2) Generic Excel-like controls.
        const excelLike = frameLocator.locator('input[value*="Excel" i], button:has-text("Excel"), a:has-text("Excel")').first();
        if ((await excelLike.count().catch(() => 0)) > 0) {
          const items = await downloadAndParse(excelLike, 'click excel-like control').catch(() => null);
          if (items && items.length) return items;
        }

        // 3) Format dropdown (choose Excel) + confirm/export.
        const select = frameLocator.locator('select').first();
        if ((await select.count().catch(() => 0)) > 0) {
          const opts = await select.locator('option').allTextContents().catch(() => []);
          const excelOpt = opts.find((o) => /excel|xls/i.test(o));
          if (excelOpt) {
            await select.selectOption({ label: excelOpt }).catch(() => {});
            await this.page.waitForTimeout(500);
            const okBtn = frameLocator.locator('input[value*="Export" i], input[value*="OK" i], input[value*="Submit" i], button:has-text("Export"), button:has-text("OK"), button:has-text("Submit")').first();
            if ((await okBtn.count().catch(() => 0)) > 0) {
              const items = await downloadAndParse(okBtn, `select(${excelOpt}) + confirm`).catch(() => null);
              if (items && items.length) return items;
            }
          }
        }

        return null;
      };

      if (reportIframeCount > 0) {
        const outer = root.frameLocator('iframe[src*="ReportViewer"], iframe[src*="queueListing"]');

        // Some viewers nest the real controls/content one iframe deeper.
        const nested = outer.frameLocator('iframe').first();
        const itemsFromNested = await tryDownloadAndParse(nested, 'nested').catch(() => null);
        if (itemsFromNested && itemsFromNested.length) return itemsFromNested;

        const itemsFromOuter = await tryDownloadAndParse(outer, 'outer').catch(() => null);
        if (itemsFromOuter && itemsFromOuter.length) return itemsFromOuter;

        this._logStep('Excel export not available or produced no items; falling back to DOM table parsing');
      } else {
        this._logStep('ReportViewer iframe not found; falling back to DOM table parsing');
      }

      // Fallback: parse jqGrid/table on the current root (may not exist for Crystal viewer).
      const fallbackItems = await root
        .evaluate(() => {
          const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
          const items = [];
          const jqGrid = document.querySelector('#queueLogGrid');
          if (jqGrid) {
            const rows = jqGrid.querySelectorAll('tr.jqgrow');
            for (const row of rows) {
              const getCellValue = (ariaDesc) => {
                const cell = row.querySelector(`td[aria-describedby$="${ariaDesc}"]`);
                return cell ? norm(cell.textContent) : null;
              };
              const patientName = getCellValue('_PatientName');
              const nric = getCellValue('_NRIC');
              const qno = getCellValue('_QNo');
              const payType = getCellValue('_PayType');
              const visitType = getCellValue('_VisitType');
              const fee = getCellValue('_Fee');
              const inTime = getCellValue('_In');
              const outTime = getCellValue('_Out');
              if (patientName || nric) {
                items.push({ qno, patientName, nric, payType, visitType, fee, inTime, outTime, source: 'reports_queue_list_dom' });
              }
            }
          }
          return items;
        })
        .catch(() => []);

      this._logStep('Fallback DOM extraction result', { count: fallbackItems.length });
      return fallbackItems;
    } catch (error) {
      this._logStep('Error extracting queue list results (root-aware)', { error: error.message });
      return [];
    }
  }

  /**
   * Navigate to Patient Page/Search
   * Goes directly to /Patient/PatientSearch URL
   * @returns {Promise<boolean>} Success status
   */
  /**
   * Navigate to Patient Page
   * 
   * RULE: NEVER use direct URL navigation (page.goto) for Patient page.
   * Must always use UI clicks to navigate. Direct URLs cause access denied errors.
   */
	  async navigateToPatientPage() {
	    try {
	      const navStart = Date.now();
	      this._logStep('Navigate to Patient Page - START');
	      
	      let currentUrl = this.page.url();
	      this._logStep('Current URL before navigation', { url: currentUrl });

      // Recover from Authenticate/Error pages by re-logging in.
      if (/\/Authenticate\//i.test(currentUrl) || /ErrorPage/i.test(currentUrl)) {
        this._logStep('Detected Authenticate/Error page, re-logging in');
        await this.login();
        currentUrl = this.page.url();
        this._logStep('URL after re-login', { url: currentUrl });
      }

	      // If we're already on the Patient Search page, we're done.
	      if (/\/Patient\/PatientSearch/i.test(currentUrl)) {
	        this._logStep('Already on PatientSearch', { currentUrl });
	        this._logStep('Navigate to Patient Page - COMPLETE', { totalTime: Date.now() - navStart });
	        return true;
	      }

	      // If we're on QueueLog/PatientVisit pages, Home -> Patient is the most reliable path.
	      // Trying to click a "Patient" link inside the QueueLog nav sometimes doesn't transition.
	      if (/\/QueueLog\//i.test(currentUrl)) {
	        try {
	          const homeLink = this.page
	            .locator(
	              [
	                'a:has-text("Home")',
	                '[role="link"]:has-text("Home")',
	                'a[href*="/Home/" i]',
	                'a[href*="Home/Reception" i]',
	                'a[href*="Home" i]',
	              ].join(', ')
	            )
	            .first();
	          if ((await homeLink.count().catch(() => 0)) > 0 && (await homeLink.isVisible().catch(() => false))) {
	            await homeLink.click({ timeout: 3000 }).catch(async () => homeLink.click({ timeout: 3000, force: true }));
	            await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
	            await this.page.waitForTimeout(300);
	            currentUrl = this.page.url();
	            this._logStep('QueueLog: navigated Home before Patient search', { currentUrl });
	          }
	        } catch (e) {
	          this._logStep('QueueLog: Home click failed', { error: e.message });
	        }
	      }

	      // NOTE: Direct navigation to PatientSearch is not stable from QueueLog/PatientVisit pages
	      // (it can bounce to Authenticate/ErrorPage). We rely on UI navigation (Home -> Patient) below.
	      
	      // STEP 1: Ensure we're in a room (click Reception) IF we are on the room-selection page.
	      // Do not attempt room selection clicks while already inside QueueLog/PatientVisit pages.
	      const isRoomSelectionPage = await this.page
	        .locator('text=/\\bRooms\\b/i')
	        .count()
	        .then((c) => c > 0)
	        .catch(() => false);

      if (
        isRoomSelectionPage &&
        !currentUrl.includes('/Home/Reception') &&
        !currentUrl.includes('/Home/Patient')
      ) {
        const receptionStart = Date.now();
        this._logStep('Need to select Reception/room first before accessing Patient Page');
        
        // Wait 50ms before attempting to click Reception room
        await this.page.waitForTimeout(50);

        // Prefer clicking a room item scoped under the Rooms list to avoid sidebar/header matches.
        const roomListClick = await this.page
          .evaluate(() => {
            const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();
            const label = Array.from(document.querySelectorAll('*')).find((el) => /\bRooms\b/i.test(norm(el.textContent)));
            const container =
              label?.closest('section, div, td, th, form') ||
              label?.parentElement ||
              document.body;
            if (!container) return false;
            const candidates = Array.from(container.querySelectorAll('li, [role="option"], tr, div, button, a'))
              .map((el) => ({ el, text: norm(el.textContent || '') }))
              .filter((x) => x.text && !/^(rooms|branch|back)$/i.test(x.text));
            const prefer = candidates.find((c) => /reception/i.test(c.text)) || candidates.find((c) => /rm|room/i.test(c.text)) || candidates[0];
            if (!prefer?.el) return false;
            try {
              prefer.el.scrollIntoView({ block: 'center' });
              prefer.el.click();
              return true;
            } catch {
              return false;
            }
          })
          .catch(() => false);

        if (roomListClick) {
          await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          await this.page.waitForTimeout(500);
          const newUrl = this.page.url();
          const hasPatientNav =
            (await this.page.locator('a[href*="/Patient/PatientSearch" i], a:has-text("Patient")').count().catch(() => 0)) > 0;
          if (newUrl.includes('/Home/') || hasPatientNav) {
            this._logStep('Entered room via Rooms list click', { newUrl, timeTaken: Date.now() - receptionStart });
            // Skip the generic selector loop if we already entered a room.
            currentUrl = newUrl;
          }
        }
        
        // Look for Reception room. Clinic Assist often shows a "Rooms" list (no buttons), so
        // prefer exact row/list-item matches over generic "div contains Reception".
        const roomSelectors = [
          // Rooms list variants (best).
          'li:has-text("RECEPTION")',
          'li:has-text("Reception")',
          'tr:has-text("RECEPTION")',
          'tr:has-text("Reception")',
          '[role="listitem"]:has-text("RECEPTION")',
          '[role="listitem"]:has-text("Reception")',
          '[role="option"]:has-text("RECEPTION")',
          '[role="option"]:has-text("Reception")',
          // Button/link variants (sometimes used).
          'button:has-text("Reception")',
          'a:has-text("Reception")',
          '[role="button"]:has-text("Reception")',
          '[role="tab"]:has-text("Reception")',
          'a[href*="Reception"]',
          'a[href*="reception" i]',
          // Very last resort: any clickable element with exact text.
          'text=/^\\s*RECEPTION\\s*$/i',
          // Fallbacks: any room-like option (RM/ROOM).
          '[role="option"]:has-text("RM")',
          'li:has-text("RM")',
          'tr:has-text("RM")',
          '[role="listitem"]:has-text("RM")',
        ];
	        
	        let receptionClicked = false;
	        for (const selector of roomSelectors) {
	          try {
	            // Prefer clicking an element that is actually clickable.
	            const roomLink = this.page.locator(selector).first();
	            const count = await roomLink.count().catch(() => 0);
	            if (count > 0) {
	              const isVisible = await roomLink.isVisible().catch(() => false);
	              if (isVisible) {
	                this._logStep('Clicking Reception/room to access system', { selector });
                
                // Dismiss any dialogs that might appear
                this.page.on('dialog', async (dialog) => {
                  this._logStep('Dialog appeared, dismissing', { type: dialog.type(), message: dialog.message() });
                  await dialog.dismiss().catch(() => dialog.accept()).catch(() => {});
                });
                
                // Wait a moment before clicking for stability
	                await this.page.waitForTimeout(50);
	                // Some rooms are list rows; force-click helps.
	                await roomLink.click({ timeout: 3000 }).catch(async () => roomLink.click({ timeout: 3000, force: true }));
	                
	                // Use auto wait - let Playwright handle the page load
	                await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
	                await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
	                await this.page.waitForTimeout(500);
                
                const newUrl = this.page.url();
                this._logStep('Reception clicked, checking URL', { newUrl, timeTaken: Date.now() - receptionStart });
                
                // Success if URL transitions into Home/* or Patient nav becomes available.
                const hasPatientNav =
                  (await this.page.locator('a[href*="/Patient/PatientSearch" i], a:has-text("Patient")').count().catch(() => 0)) > 0;
                if (newUrl.includes('/Home/') || hasPatientNav) {
                  this._logStep('Successfully entered Reception room', { newUrl, timeTaken: Date.now() - receptionStart });
                  receptionClicked = true;
                  break;
                }
              }
            }
          } catch (e) {
            this._logStep('Error trying Reception selector', { selector, error: e.message });
            continue;
          }
        }
        
        if (!receptionClicked) {
          // DOM-based fallback: click the first visible room item under the Rooms section.
          const domFallback = await this.page.evaluate(() => {
            const norm = (s) => (s || '').toString().replace(/\\s+/g, ' ').trim();
            const label = Array.from(document.querySelectorAll('*')).find((el) => /\\bRooms\\b/i.test(norm(el.textContent)));
            const container =
              label?.closest('section, div, td, th') ||
              label?.parentElement ||
              document.body;
            const candidates = Array.from(container.querySelectorAll('li, [role=\"option\"], tr, div, button, a'))
              .map((el) => ({ el, text: norm(el.textContent || '') }))
              .filter((x) => x.text && !/^rooms$/i.test(x.text) && !/^branch$/i.test(x.text));
            const prefer = candidates.find((c) => /reception/i.test(c.text)) || candidates.find((c) => /rm|room/i.test(c.text)) || candidates[0];
            if (!prefer?.el) return false;
            try {
              prefer.el.click();
              return true;
            } catch {
              return false;
            }
          }).catch(() => false);

          if (domFallback) {
            await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
            await this.page.waitForTimeout(500);
            const newUrl = this.page.url();
            const hasPatientNav =
              (await this.page.locator('a[href*=\"/Patient/PatientSearch\" i], a:has-text(\"Patient\")').count().catch(() => 0)) > 0;
            if (newUrl.includes('/Home/') || hasPatientNav) {
              this._logStep('Entered room via DOM fallback', { newUrl, timeTaken: Date.now() - receptionStart });
              receptionClicked = true;
            }
          }
        }

        if (!receptionClicked) {
          this._logStep('Could not click Reception/room, continuing anyway', { timeTaken: Date.now() - receptionStart });
        }
      } else {
        this._logStep('Already in Reception or Patient page, proceeding', { currentUrl });
      }
      
	      // STEP 2: Click Patient sidebar link - UI NAVIGATION ONLY, NO DIRECT URLS
	      const patientNavStart = Date.now();
	      this._logStep('Looking for sidebar/hamburger menu');
      
      // Open sidebar/hamburger menu if it exists
      const menuSelectors = [
        '[class*="nav-toggle"]',
        '[class*="hamburger"]',
        '[class*="menu-toggle"]',
        'button[class*="sidebar"]',
        '.sidebar-toggle',
      ];
      
      for (const selector of menuSelectors) {
        try {
          const menuBtn = this.page.locator(selector).first();
          const count = await menuBtn.count().catch(() => 0);
          if (count > 0) {
            const isVisible = await menuBtn.isVisible().catch(() => false);
            if (isVisible) {
              this._logStep('Found menu toggle, clicking', { selector });
              await menuBtn.click({ force: true }).catch(() => {});
              await this.page.waitForTimeout(200);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
	      // Find and click Patient sidebar link - MUST USE UI CLICKS, NEVER DIRECT URL
	      this._logStep('Looking for Patient sidebar link');
	      const patientLinkSelectors = [
	        'a[href*="/Patient/PatientSearch" i]',
	        'a[href*="PatientSearch" i]',
	        // Icon-only sidebar items frequently have no text but do have an href with "Patient".
	        'a[href*="/Patient/" i]',
	        'a[href*="Patient" i]',
	        '[href*="/Patient/" i]',
	        '[href*="Patient" i]',
	        'a:has-text("Patient")',
	        '[role="link"]:has-text("Patient")',
	        'nav a:has-text("Patient")',
	        '.menu a:has-text("Patient")',
	      ];
      
      let patientClicked = false;
	      for (const selector of patientLinkSelectors) {
	        try {
	          const clickStart = Date.now();
	          const link = this.page.locator(selector).first();
          const count = await link.count().catch(() => 0);
          if (count > 0) {
            const isVisible = await link.isVisible().catch(() => false);
            this._logStep('Patient link status', { selector, count, isVisible });
            
	            if (isVisible) {
	              this._logStep('Clicking Patient sidebar link via UI', { selector });
              
              // Try multiple click methods - UI navigation only
              let clicked = false;
              
              // Method 1: Playwright click
              try {
                await link.click({ timeout: 3000 });
                clicked = true;
                this._logStep('Patient link clicked via Playwright', { timeTaken: Date.now() - clickStart });
              } catch (e) {
                this._logStep('Playwright click failed, trying JavaScript click', { error: e.message });
              }
              
              // Method 2: JavaScript click if Playwright failed
              if (!clicked) {
                clicked = await link.evaluate(el => {
                  try {
                    el.click();
                    return true;
                  } catch (e) {
                    return false;
                  }
                }).catch(() => false);
                
                if (clicked) {
                  this._logStep('Patient link clicked via JavaScript', { timeTaken: Date.now() - clickStart });
                }
              }
              
              // Method 3: Force click if both failed
              if (!clicked) {
                try {
                  await link.click({ force: true, timeout: 3000 });
                  clicked = true;
                  this._logStep('Patient link clicked via force click', { timeTaken: Date.now() - clickStart });
                } catch (e) {
                  this._logStep('Force click also failed', { error: e.message });
                }
              }
              
	              if (clicked) {
	                // Some Clinic Assist navigations are async and can take a few seconds; wait for URL.
	                await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
	                await this.page
	                  .waitForURL(/\/Patient\/PatientSearch/i, { timeout: 8000 })
	                  .catch(() => {});
	                await this.page.waitForTimeout(300);

	                const finalUrl = this.page.url();
	                this._logStep('After Patient click, checking URL', { finalUrl, totalTime: Date.now() - patientNavStart });

	                if (/\/Patient\/PatientSearch/i.test(finalUrl)) {
	                  this._logStep('Successfully navigated to Patient Page via UI click', { finalUrl, totalTime: Date.now() - navStart });
	                  patientClicked = true;
	                  break;
	                } else {
	                  await this.page
	                    .screenshot({ path: 'screenshots/clinic-assist-patient-nav-unexpected-url.png', fullPage: true })
	                    .catch(() => {});
	                  this._logStep('Click succeeded but URL not as expected, retrying', { finalUrl });
	                  // Wait longer and also wait for URL (some pages are slow to transition)
	                  await this.page
	                    .waitForURL(/\/Patient\/PatientSearch/i, { timeout: 6000 })
	                    .catch(() => {});
                  const retryUrl = this.page.url();
                  if (/\/Patient\/PatientSearch/i.test(retryUrl)) {
                    this._logStep('Successfully navigated to Patient Page after retry', { retryUrl, totalTime: Date.now() - navStart });
                    patientClicked = true;
                    break;
                  }
                }
              }
            }
          }
        } catch (e) {
          this._logStep('Error trying Patient selector', { selector, error: e.message });
          continue;
        }
      }
      
	      if (!patientClicked) {
	        this._logStep('Could not click Patient link via UI; trying Home -> Patient fallback', { totalTime: Date.now() - navStart });
	        await this.page
	          .screenshot({ path: 'screenshots/clinic-assist-patient-nav-missing.png', fullPage: true })
	          .catch(() => {});

        // Some pages (notably QueueLog/PatientVisit) sometimes ignore the Patient click.
        // A reliable workaround is to go back to Home first, then click Patient again.
        try {
          const homeLink = this.page
            .locator(
              [
                'a:has-text("Home")',
                '[role="link"]:has-text("Home")',
                'a[href*="/Home/" i]',
                'a[href*="Home/Reception" i]',
                'a[href*="Home" i]',
              ].join(', ')
            )
            .first();
          if ((await homeLink.count().catch(() => 0)) > 0 && (await homeLink.isVisible().catch(() => false))) {
            await homeLink.click({ timeout: 3000 }).catch(async () => homeLink.click({ timeout: 3000, force: true }));
            await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
            await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
            await this.page.waitForTimeout(300);
          }

          // Re-open sidebar and retry Patient click once.
          for (const selector of menuSelectors) {
            try {
              const menuBtn = this.page.locator(selector).first();
              const count = await menuBtn.count().catch(() => 0);
              if (count > 0) {
                const isVisible = await menuBtn.isVisible().catch(() => false);
                if (isVisible) {
                  await menuBtn.click({ force: true }).catch(() => {});
                  await this.page.waitForTimeout(200);
                  break;
                }
              }
            } catch {
              // ignore
            }
          }

          const retryPatient = this.page.locator('a[href*="PatientSearch" i], a:has-text("Patient")').first();
          if ((await retryPatient.count().catch(() => 0)) > 0 && (await retryPatient.isVisible().catch(() => false))) {
            await retryPatient.click({ timeout: 3000 }).catch(async () => retryPatient.click({ timeout: 3000, force: true }));
            await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
            await this.page
              .waitForURL(/\/Patient\/PatientSearch/i, { timeout: 8000 })
              .catch(() => {});
            await this.page.waitForTimeout(300);
            const finalUrl = this.page.url();
            this._logStep('Home->Patient retry URL', { finalUrl });
            if (/\/Patient\/PatientSearch/i.test(finalUrl)) {
              this._logStep('Navigate to Patient Page - COMPLETE', { totalTime: Date.now() - navStart });
              return true;
            }
          }
        } catch (e) {
          this._logStep('Home->Patient fallback failed', { error: e.message });
        }

        // Project rule: no direct URL navigation in Clinic Assist.
        this._logStep('Could not click Patient link via UI - direct URL navigation disabled by rule', { totalTime: Date.now() - navStart });
        return false;
      }
      
      this._logStep('Navigate to Patient Page - COMPLETE', { totalTime: Date.now() - navStart });
      return true;
    } catch (error) {
      logger.error('Failed to navigate to Patient Page:', error);
      this._logStep('Exception in navigateToPatientPage', { error: error.message, stack: error.stack });
      return false;
    }
  }

  /**
   * Search for patient by name
   * @param {string} patientName - Patient name to search
   * @returns {Promise<boolean>} Success status
   */
  async searchPatientByName(patientName) {
    try {
      this._logStep('Search patient by name', { patientName });
      
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(1000);

      // Find search input field
      const searchSelectors = [
        'input[name*="search" i]',
        'input[id*="search" i]',
        'input[placeholder*="name" i]',
        'input[placeholder*="patient" i]',
        'input[placeholder*="search" i]',
        'input[type="text"]',
      ];

      let searchInput = null;
      for (const selector of searchSelectors) {
        try {
          const input = this.page.locator(selector).first();
          if ((await input.count().catch(() => 0)) > 0) {
            searchInput = input;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!searchInput) {
        throw new Error('Could not find search input field');
      }

      // Clear and fill search field
      await searchInput.click();
      await searchInput.fill(patientName);
      await this.page.waitForTimeout(500);

      // Find and click search button
      const searchButtonSelectors = [
        'button:has-text("Search")',
        'input[type="submit"][value*="Search" i]',
        'button[type="submit"]',
        'a:has-text("Search")',
      ];

      for (const selector of searchButtonSelectors) {
        try {
          const button = this.page.locator(selector).first();
          if ((await button.count().catch(() => 0)) > 0) {
            await button.click();
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            await this.page.waitForTimeout(2000);
            this._logStep('Patient search executed', { patientName });
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      // Try pressing Enter if no search button found
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(2000);
      this._logStep('Patient search executed (Enter key)', { patientName });
      return true;
    } catch (error) {
      logger.error(`Failed to search patient by name: ${patientName}`, error);
      throw error;
    }
  }

  /**
   * Search patient by patient number (PCNO - 5 digit number)
   * @param {string} patientNumber - Patient number (PCNO) - 5 digits
   * @returns {Promise<boolean>} True if search successful
   */
  async searchPatientByNumber(patientNumber) {
    try {
      this._logStep('Search patient by number', { patientNumber });
      
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(200);

      // Find search input field
      const searchSelectors = [
        'input[name*="search" i]',
        'input[id*="search" i]',
        'input[placeholder*="number" i]',
        'input[placeholder*="patient" i]',
        'input[placeholder*="pcno" i]',
        'input[placeholder*="search" i]',
        'input[type="text"]',
      ];

      let searchInput = null;
      for (const selector of searchSelectors) {
        try {
          const input = this.page.locator(selector).first();
          if ((await input.count().catch(() => 0)) > 0) {
            searchInput = input;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!searchInput) {
        throw new Error('Could not find search input field');
      }

      // Wait for search field to be visible and enabled
      await searchInput.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
        this._logStep('Search field not immediately visible, trying to make it visible');
      });

      // Try to fill the search field - use JS fallback if normal method fails
      try {
        await searchInput.click({ timeout: 5000 });
        await searchInput.fill(patientNumber);
      } catch (error) {
        // Fallback: Use JavaScript to set value directly
        this._logStep('Normal fill failed, using JavaScript fallback');
        await this.page.evaluate((number) => {
          const input = document.querySelector('input[id*="search" i]') || 
                       document.querySelector('#txtMainSearchPatient');
          if (input) {
            input.value = number;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, patientNumber);
      }
      await this.page.waitForTimeout(500);

      // Find and click search button
      const searchButtonSelectors = [
        'button:has-text("Search")',
        'input[type="submit"][value*="Search" i]',
        'button[type="submit"]',
        'a:has-text("Search")',
      ];

      for (const selector of searchButtonSelectors) {
        try {
          const button = this.page.locator(selector).first();
          if ((await button.count().catch(() => 0)) > 0) {
            await button.click();
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            await this.page.waitForTimeout(500);
            this._logStep('Patient search executed by number', { patientNumber });
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      // Try pressing Enter if no search button found
      // Press Enter twice to handle potential dialog + search
      this._logStep('Pressing Enter to execute search (may need to dismiss dialog first)');
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(300);
      
      // Press Enter again to ensure search executes (in case first Enter dismissed a dialog)
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(300);
      
      // Wait for search results to load
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(500);
      this._logStep('Patient search executed by number (Enter key x2)', { patientNumber });
      return true;
    } catch (error) {
      logger.error(`Failed to search patient by number: ${patientNumber}`, error);
      throw error;
    }
  }

  /**
   * Click on patient from search results to open patient record
   * @param {string} patientName - Patient name to click
   * @returns {Promise<boolean>} Success status
   */
  async openPatientFromSearchResults(patientName) {
    try {
      this._logStep('Open patient from search results', { patientName });
      await this.page.waitForTimeout(300);

      // Find patient row/link in search results
      const patientSelectors = [
        `tr:has-text("${patientName}")`,
        `a:has-text("${patientName}")`,
        `div:has-text("${patientName}"):has(a)`,
        `[role="row"]:has-text("${patientName}")`,
      ];

      for (const selector of patientSelectors) {
        try {
          const element = this.page.locator(selector).first();
          if ((await element.count().catch(() => 0)) > 0) {
            // Try to find a link within the element first
            const link = element.locator('a').first();
            if ((await link.count().catch(() => 0)) > 0) {
              await link.click();
            } else {
              await element.click();
            }
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            await this.page.waitForTimeout(2000);
            this._logStep('Patient opened from search results');
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      throw new Error(`Could not find patient "${patientName}" in search results`);
    } catch (error) {
      logger.error(`Failed to open patient from search results: ${patientName}`, error);
      throw error;
    }
  }

  /**
   * Click on patient from search results by patient number (PCNO)
   * @param {string} patientNumber - Patient number (PCNO) - 5 digits
   * @returns {Promise<boolean>} Success status
   */
  async openPatientFromSearchResultsByNumber(patientNumber) {
    try {
      this._logStep('Open patient from search results by number', { patientNumber });
      await this.page.waitForTimeout(2000); // Wait longer for search results to load

      // Method 1: Use page.evaluate to find the cell with patient number, then click the row directly
      const rowInfo = await this.page.evaluate((pNumber) => {
        // Normalize patient number (handle zero-padding)
        const normalized = String(pNumber).trim();
        const normalizedZeroPad = normalized.padStart(5, '0');
        
        // Find all table cells
        const allCells = Array.from(document.querySelectorAll('td, th'));
        
        // Find cells that match the patient number (exact match)
        const matchingCells = allCells.filter(cell => {
          const cellText = (cell.textContent || '').trim();
          return cellText === normalized || 
                 cellText === normalizedZeroPad ||
                 cellText === `0${normalized}`; // Handle zero-padding
        });

        if (matchingCells.length === 0) {
          return null;
        }

        // Get the row containing the matching cell
        const matchingCell = matchingCells[0];
        const row = matchingCell.closest('tr');
        
        if (!row) {
          return null;
        }

        // Check if row has a link
        const link = row.querySelector('a');
        const hasLink = !!link;

        // Get unique identifier for the row (use row index or data attributes)
        const parent = row.parentElement;
        const siblings = parent ? Array.from(parent.children) : [];
        const rowIndex = siblings.indexOf(row);

        return {
          hasLink: hasLink,
          rowIndex: rowIndex,
          rowText: (row.textContent || '').trim().substring(0, 100), // For logging
        };
      }, String(patientNumber).trim()).catch(() => null);

      if (rowInfo) {
        this._logStep('Found patient row by number', { rowIndex: rowInfo.rowIndex, hasLink: rowInfo.hasLink });

        // Wait for table to be visible
        await this.page.waitForSelector('tr, [role="row"]', { timeout: 5000 }).catch(() => {});

        // Try multiple approaches to click the row
        let clicked = false;

        // Approach 1: Use filter to find row containing the patient number
        try {
          const rowByFilter = this.page.locator('tr').filter({ hasText: new RegExp(`^.*${patientNumber}.*$`, 'i') }).first();
          if ((await rowByFilter.count().catch(() => 0)) > 0) {
            const isVisible = await rowByFilter.isVisible().catch(() => false);
            if (isVisible) {
              // Try clicking link first
              const linkInRow = rowByFilter.locator('a').first();
              if ((await linkInRow.count().catch(() => 0)) > 0) {
                await linkInRow.click({ timeout: 5000 });
                clicked = true;
                this._logStep('Clicked patient link via filter method');
              } else {
                // Click row directly
                await rowByFilter.click({ timeout: 5000 });
                clicked = true;
                this._logStep('Clicked patient row via filter method');
              }
            }
          }
        } catch (e) {
          this._logStep('Filter method failed', { error: e.message });
        }

        // Approach 2: Direct row index click (if filter didn't work)
        if (!clicked && rowInfo.rowIndex >= 0) {
          try {
            // Get all rows (skip header rows if present)
            const allRows = this.page.locator('tr:not([role="columnheader"]):not(thead tr)');
            const rowCount = await allRows.count().catch(() => 0);
            
            if (rowInfo.rowIndex < rowCount) {
              const targetRow = allRows.nth(rowInfo.rowIndex);
              const isVisible = await targetRow.isVisible().catch(() => false);
              
              if (isVisible) {
                // Try link first
                if (rowInfo.hasLink) {
                  const link = targetRow.locator('a').first();
                  if ((await link.count().catch(() => 0)) > 0) {
                    await link.click({ timeout: 5000 });
                    clicked = true;
                    this._logStep('Clicked patient link via row index');
                  }
                }
                
                // If no link or link click failed, click row
                if (!clicked) {
                  await targetRow.click({ timeout: 5000 });
                  clicked = true;
                  this._logStep('Clicked patient row via row index');
                }
              }
            }
          } catch (e) {
            this._logStep('Row index method failed', { error: e.message });
          }
        }

        // Approach 3: Direct DOM manipulation (last resort)
        if (!clicked) {
          try {
            await this.page.evaluate((pNumber) => {
              const normalized = String(pNumber).trim();
              const allCells = Array.from(document.querySelectorAll('td'));
              const matchingCell = allCells.find(cell => {
                const cellText = (cell.textContent || '').trim();
                return cellText === normalized || cellText === normalized.padStart(5, '0');
              });
              
              if (matchingCell) {
                const row = matchingCell.closest('tr');
                if (row) {
                  const link = row.querySelector('a');
                  if (link) {
                    link.click();
                  } else {
                    row.click();
                  }
                  return true;
                }
              }
              return false;
            }, String(patientNumber).trim());
            
            clicked = true;
            this._logStep('Clicked patient via DOM manipulation');
          } catch (e) {
            this._logStep('DOM manipulation method failed', { error: e.message });
          }
        }

        if (clicked) {
          await this.page.waitForLoadState('domcontentloaded').catch(() => {});
          await this.page.waitForTimeout(2000);
          this._logStep('Patient opened from search results by number');
          return true;
        }
      }

      // Fallback: Try simple text-based search (similar to name-based search)
      try {
        const rowByText = this.page.locator('tr').filter({ hasText: patientNumber }).first();
        if ((await rowByText.count().catch(() => 0)) > 0) {
          const link = rowByText.locator('a').first();
          if ((await link.count().catch(() => 0)) > 0) {
            await link.click({ timeout: 5000 });
          } else {
            await rowByText.click({ timeout: 5000 });
          }
          await this.page.waitForLoadState('domcontentloaded').catch(() => {});
          await this.page.waitForTimeout(2000);
          this._logStep('Patient opened from search results by number (text fallback)');
          return true;
        }
      } catch (e) {
        // Continue to error
      }

      throw new Error(`Could not find patient with number "${patientNumber}" in search results`);
    } catch (error) {
      logger.error(`Failed to open patient from search results by number: ${patientNumber}`, error);
      throw error;
    }
  }

  /**
   * Navigate to TX History (Treatment History)
   * @returns {Promise<boolean>} Success status
   */
  async navigateToTXHistory() {
    try {
      this._logStep('Navigate to TX History');
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(1000);

      // Try multiple selectors for TX History/Treatment History
      const txHistorySelectors = [
        'a:has-text("TX History")',
        'a:has-text("Treatment History")',
        'a:has-text("Tx History")',
        'a[href*="TXHistory" i]',
        'a[href*="TreatmentHistory" i]',
        'button:has-text("TX History")',
        'button:has-text("Treatment History")',
        '[role="tab"]:has-text("TX History")',
        '[role="tab"]:has-text("Treatment History")',
        'a:has-text("History")',
      ];

      for (const selector of txHistorySelectors) {
        try {
          const link = this.page.locator(selector).first();
          if ((await link.count().catch(() => 0)) > 0) {
            const isVisible = await link.isVisible().catch(() => false);
            if (isVisible) {
              await link.click();
              await this.page.waitForLoadState('domcontentloaded').catch(() => {});
              await this.page.waitForTimeout(2000);
              this._logStep('Navigated to TX History');
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }

      throw new Error('Could not find TX History link/tab');
    } catch (error) {
      logger.error('Failed to navigate to TX History:', error);
      throw error;
    }
  }

  /**
   * Open Diagnosis Tab within TX History
   * @returns {Promise<boolean>} Success status
   */
  async openDiagnosisTab() {
    try {
      this._logStep('Open Diagnosis Tab');
      await this.page.waitForTimeout(1000);

      // Try multiple selectors for Diagnosis tab
      const diagnosisTabSelectors = [
        '[role="tab"]:has-text("Diagnosis")',
        'a:has-text("Diagnosis")',
        'button:has-text("Diagnosis")',
        'li:has-text("Diagnosis")',
        '.tab:has-text("Diagnosis")',
        '[class*="tab"]:has-text("Diagnosis")',
      ];

      for (const selector of diagnosisTabSelectors) {
        try {
          const tab = this.page.locator(selector).first();
          if ((await tab.count().catch(() => 0)) > 0) {
            const isVisible = await tab.isVisible().catch(() => false);
            if (isVisible) {
              await tab.click();
              await this.page.waitForLoadState('domcontentloaded').catch(() => {});
              await this.page.waitForTimeout(1000);

              // Many Clinic Assist grids only populate after clicking "Show".
              // This is safe to do even if the grid already has data.
              try {
                const showBtn = this.page
                  .locator(
                    [
                      'button:has-text("Show")',
                      'input[type="button"][value="Show"]',
                      'input[type="submit"][value="Show"]',
                      'a:has-text("Show")',
                    ].join(', ')
                  )
                  .first();
                if ((await showBtn.count().catch(() => 0)) > 0 && (await showBtn.isVisible().catch(() => false))) {
                  await showBtn.click().catch(() => {});
                  await this.page.waitForTimeout(1500);
                }
              } catch {
                // ignore
              }

              // The Diagnosis tab often loads asynchronously. Wait for some evidence of
              // diagnosis rows (tables with Date/Code/Description, or any date-like row)
              // before attempting extraction.
              await this.page
                .waitForFunction(
                  () => {
                    const roots = [document];
                    for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
                      try {
                        const doc = iframe.contentDocument || iframe.contentWindow?.document;
                        if (doc) roots.push(doc);
                      } catch {
                        // ignore
                      }
                    }

                    const hasDiagnosisTable = (root) => {
                      const tables = Array.from(root.querySelectorAll('table'));
                      for (const table of tables) {
                        const rows = Array.from(table.querySelectorAll('tr'));
                        if (rows.length < 2) continue;
                        const header = rows[0].textContent || '';
                        const h = header.toLowerCase();
                        if (!h.includes('date')) continue;
                        if (!(h.includes('code') || h.includes('description') || h.includes('diagnosis'))) continue;

                        // Require at least one data row with a date-like token.
                        for (const r of rows.slice(1, 6)) {
                          const t = r.textContent || '';
                          if (/\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/.test(t)) return true;
                        }
                      }
                      return false;
                    };

                    if (roots.some(hasDiagnosisTable)) return true;

                    // Fallback: any row-like element containing a date token.
                    const rowLikeSelectors = ['table tr', '[role="row"]', 'tbody tr'];
                    for (const root of roots) {
                      for (const sel of rowLikeSelectors) {
                        const nodes = Array.from(root.querySelectorAll(sel));
                        for (const n of nodes.slice(0, 50)) {
                          const t = n.textContent || '';
                          if (/\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/.test(t)) return true;
                        }
                      }
                    }

                    return false;
                  },
                  {},
                  { timeout: 10000 }
                )
                .catch(() => {});

              await this.page.waitForTimeout(1000);
              this._logStep('Diagnosis Tab opened');
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }

      throw new Error('Could not find Diagnosis Tab');
    } catch (error) {
      logger.error('Failed to open Diagnosis Tab:', error);
      throw error;
    }
  }

  /**
   * Open Visit Tab within TX History
   * Some deployments store diagnosis/assessment in the Visit tab instead of the Diagnosis tab.
   */
  async openVisitTab() {
    try {
      this._logStep('Open Visit Tab');
      await this.page.waitForTimeout(800);

      const visitTabSelectors = [
        '[role="tab"]:has-text("Visit")',
        'a:has-text("Visit")',
        'button:has-text("Visit")',
        'li:has-text("Visit")',
        '.tab:has-text("Visit")',
        '[class*="tab"]:has-text("Visit")',
      ];

      for (const selector of visitTabSelectors) {
        try {
          const tab = this.page.locator(selector).first();
          if ((await tab.count().catch(() => 0)) === 0) continue;
          const isVisible = await tab.isVisible().catch(() => false);
          if (!isVisible) continue;

          await tab.click();
          await this.page.waitForLoadState('domcontentloaded').catch(() => {});
          await this.page.waitForTimeout(800);

          // Many grids only populate after clicking "Show".
          try {
            const showBtn = this.page
              .locator(
                [
                  'button:has-text("Show")',
                  'input[type="button"][value="Show"]',
                  'input[type="submit"][value="Show"]',
                  'a:has-text("Show")',
                ].join(', ')
              )
              .first();
            if ((await showBtn.count().catch(() => 0)) > 0 && (await showBtn.isVisible().catch(() => false))) {
              await showBtn.click().catch(() => {});
              await this.page.waitForTimeout(1500);
            }
          } catch {
            // ignore
          }

          this._logStep('Visit Tab opened');
          return true;
        } catch {
          continue;
        }
      }

      throw new Error('Could not find Visit tab');
    } catch (error) {
      logger.error('Failed to open Visit Tab:', error);
      throw error;
    }
  }

  /**
   * Extract diagnosis-like text from TX History Visit tab.
   * @param {string} visitDate - Visit date in YYYY-MM-DD format
   * @returns {Promise<Object|null>} { code, description, date }
   */
  async extractDiagnosisFromVisitTab(visitDate) {
    try {
      this._logStep('Extract diagnosis from Visit Tab', { visitDate });
      await this.openVisitTab().catch(() => false);
      await this.page.waitForTimeout(800);

      const record = await this.page.evaluate((targetDateStr) => {
        const parseDate = (dateStr) => {
          if (!dateStr) return null;
          const patterns = [
            /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
            /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
          ];
          for (const pattern of patterns) {
            const match = String(dateStr).match(pattern);
            if (match) {
              if (match[1].length === 4) return new Date(match[1], match[2] - 1, match[3]);
              return new Date(match[3], match[2] - 1, match[1]);
            }
          }
          return null;
        };

        const sameDay = (a, b) =>
          !!a &&
          !!b &&
          a.getFullYear() === b.getFullYear() &&
          a.getMonth() === b.getMonth() &&
          a.getDate() === b.getDate();

        const targetDate = parseDate(targetDateStr);
        const roots = [document];
        for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
          try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc) roots.push(doc);
          } catch {
            // ignore
          }
        }

        const isLikelyDiagnosisText = (text) => {
          const t = String(text || '').trim();
          if (t.length < 5) return false;
          const lower = t.toLowerCase();
          if (lower.includes('unfit for duty')) return false;
          if (lower.includes('medical certificate') || /\bmc\b/.test(lower)) return false;
          if (lower.includes('consultation') || lower.includes('physiotherapy')) return false;
          // Medicine-like patterns (avoid misclassifying drug names as diagnosis).
          if (/\b\d+\s*(?:mg|mcg|g|ml|iu)\b/i.test(t)) return false;
          if (/\(\s*\d+\s*(?:mg|mcg|g|ml|iu)\s*\)/i.test(t)) return false;
          if (/^\$?\s*\d+(?:\.\d+)?\s*(?:sgd)?\s*$/i.test(t)) return false;
          return true;
        };

        const conditionKeywords = /(pain|sprain|strain|fracture|injur|infection|fever|cough|cold|headache|migraine|asthma|diabetes|hypertension|arthritis|osteoarthritis|tendinitis|tendinopathy|bursitis|synovitis|dislocation|contusion|laceration|wound|ulcer|eczema|allergy|syndrome|influenza|tonsillitis|otitis|conjunctivitis|pneumonia|bronch|respiratory|gastro|dermat|sinus)/i;
        const procedureKeywords = /(physiotherapy|x[- ]?ray|ultrasound|mri|ct|consultation|therapy|injection|radiolog|procedure|rehab|exercise|follow\s*up|brace|splint|cast|wrap|orthosis|support|sling|crutch|bandage|tape|\bpack\b|hot\s*\/\s*cold|cold\s*pack|hot\s*pack)/i;

        const rowsToRecords = (table) => {
          const rows = Array.from(table.querySelectorAll('tr'));
          if (rows.length < 2) return [];

          const headerCells = Array.from(rows[0].querySelectorAll('th, td')).map((c) => (c.textContent || '').trim().toLowerCase());
          const dateCol = headerCells.findIndex((h) => h.includes('date'));
          const diagCol = headerCells.findIndex((h) => h.includes('diagnosis') || h.includes('diag') || h.includes('assessment') || h.includes('complaint'));

          const out = [];
          for (const r of rows.slice(1)) {
            const cells = Array.from(r.querySelectorAll('td, th'));
            if (cells.length < 2) continue;

            let dateStr = '';
            if (dateCol >= 0 && dateCol < cells.length) dateStr = (cells[dateCol].textContent || '').trim();
            if (!dateStr) {
              for (const c of cells) {
                const txt = (c.textContent || '').trim();
                if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(txt) || /\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(txt)) {
                  dateStr = txt;
                  break;
                }
              }
            }
            const dateObj = parseDate(dateStr);
            if (!dateObj) continue;

            // ICD-ish code (best-effort)
            let code = null;
            for (const c of cells) {
              const txt = (c.textContent || '').trim();
              if (/^[A-Z]\d{2,3}(?:\.\d+)?$/i.test(txt) || /^\d{6,10}$/.test(txt)) {
                code = txt;
                break;
              }
            }

            // Description: prefer diagnosis column when present; else pick the longest diagnosis-like cell.
            let desc = '';
            if (diagCol >= 0 && diagCol < cells.length) {
              desc = (cells[diagCol].textContent || '').trim();
            }
            if (!isLikelyDiagnosisText(desc)) {
              for (const c of cells) {
                const txt = (c.textContent || '').trim();
                if (!isLikelyDiagnosisText(txt)) continue;
                if (txt.length > desc.length) desc = txt;
              }
            }
            if (!isLikelyDiagnosisText(desc)) continue;

            // Heuristic filter: only accept if we see either a diagnosis/ICD code, or a condition keyword.
            // This avoids misclassifying medicines/services as diagnosis.
            const lower = desc.toLowerCase();
            const ok = Boolean(code) || (conditionKeywords.test(lower) && !procedureKeywords.test(lower));
            if (!ok) continue;

            out.push({ date: dateStr, dateObj, code, description: desc });
          }
          return out;
        };

        const records = [];
        for (const root of roots) {
          const tables = Array.from(root.querySelectorAll('table'));
          for (const table of tables) {
            records.push(...rowsToRecords(table));
          }
        }

        if (!records.length) return null;
        records.sort((a, b) => b.dateObj - a.dateObj);

        if (targetDate) {
          const exact = records.filter((r) => sameDay(r.dateObj, targetDate));
          if (exact.length) return exact[0];

          const targetTs = new Date(targetDate).setHours(0, 0, 0, 0);
          const onOrBefore = records.find((r) => new Date(r.dateObj).setHours(0, 0, 0, 0) <= targetTs);
          if (onOrBefore) return onOrBefore;
        }

        return records[0];
      }, visitDate);

      if (record && record.description) {
        this._logStep('Diagnosis extracted from Visit tab', {
          date: record.date,
          code: record.code,
          description: String(record.description).substring(0, 80),
        });
        return { code: record.code || null, description: record.description, date: record.date || null };
      }

      this._logStep('No diagnosis found in Visit tab');
      return null;
    } catch (error) {
      logger.error('Failed to extract diagnosis from Visit Tab:', error);
      return null;
    }
  }

  /**
   * Extract diagnosis from TX History Diagnosis Tab
   * @returns {Promise<string|null>} Diagnosis text or null if not found
   */
  /**
   * Extract diagnosis code and description from TX History Diagnosis Tab
   * Returns an object with both code and description
   * @returns {Promise<Object|null>} { code: string, description: string } or null
   */
  async extractDiagnosisFromTXHistory() {
    try {
      this._logStep('Extract diagnosis from TX History');
      await this.page.waitForTimeout(1000);

      // Try multiple selectors for diagnosis content
      const diagnosisSelectors = [
        'textarea[name*="diagnosis" i]',
        'textarea[id*="diagnosis" i]',
        'div[class*="diagnosis" i]',
        'div[id*="diagnosis" i]',
        '[data-diagnosis]',
        'td:has-text("Diagnosis") + td',
        'th:has-text("Diagnosis") + td',
        '.diagnosis',
        '#diagnosis',
      ];

      let rawDiagnosisText = null;

      for (const selector of diagnosisSelectors) {
        try {
          const element = this.page.locator(selector).first();
          if ((await element.count().catch(() => 0)) > 0) {
            const text = await element.inputValue().catch(() => 
              element.textContent().catch(() => '')
            );
            if (text && text.trim()) {
              rawDiagnosisText = text.trim();
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Also try extracting from diagnosis table if present
      // The diagnosis tab often shows a table with columns: Date, State, Code, Description, Branch
      // Try this even if we have rawDiagnosisText, as table extraction is more reliable
      try {
        // Extract table data - look for any table with Code/Description columns
        const tableData = await this.page.evaluate(() => {
          const tables = Array.from(document.querySelectorAll('table'));
          for (const table of tables) {
            const rows = Array.from(table.querySelectorAll('tr'));
            if (rows.length < 2) continue; // Need at least header + data row
            
            // Check if this looks like a diagnosis table (has Code and Description columns)
            const headerRow = rows[0];
            if (headerRow) {
              const headerCells = Array.from(headerRow.querySelectorAll('td, th'));
              const headerText = headerCells.map(c => (c.textContent || '').toLowerCase().trim()).join(' ');
              
              // Check if table has Code and Description columns
              const hasCode = headerText.includes('code');
              const hasDescription = headerText.includes('description') || headerText.includes('diagnosis');
              
              if (hasCode && hasDescription) {
                // Extract data rows (skip header)
                const dataRows = rows.slice(1).map(row => {
                  const cells = Array.from(row.querySelectorAll('td, th'));
                  return cells.map(cell => (cell.textContent || '').trim());
                }).filter(row => row.length > 0 && row.some(cell => cell.length > 0));
                
                if (dataRows.length > 0) {
                  return { 
                    headers: headerCells.map(c => (c.textContent || '').trim()), 
                    dataRows 
                  };
                }
              }
            }
          }
          return null;
        }).catch(() => null);

        if (tableData && tableData.dataRows && tableData.dataRows.length > 0) {
          // Find Code and Description column indices
          const codeColIdx = tableData.headers.findIndex(h => 
            /code/i.test(h)
          );
          const descColIdx = tableData.headers.findIndex(h => 
            /description/i.test(h) || /diagnosis/i.test(h)
          );

          // Get the most recent diagnosis (last row typically has the latest)
          // Also check for rows with actual code/description values
          let dataRow = tableData.dataRows.find(row => {
            if (codeColIdx >= 0 && row[codeColIdx] && row[codeColIdx].trim().length > 0) return true;
            if (descColIdx >= 0 && row[descColIdx] && row[descColIdx].trim().length > 0) return true;
            return false;
          });

          // If no row with code/description found, use the last row
          if (!dataRow && tableData.dataRows.length > 0) {
            dataRow = tableData.dataRows[tableData.dataRows.length - 1];
          }

          if (dataRow) {
            const code = (codeColIdx >= 0 && dataRow[codeColIdx]) ? dataRow[codeColIdx].trim() : null;
            const description = (descColIdx >= 0 && dataRow[descColIdx]) ? dataRow[descColIdx].trim() : null;
            
            if (code || description) {
              this._logStep('Diagnosis extracted from TX History table', { 
                code,
                description: description?.substring(0, 100),
                tableRowCount: tableData.dataRows.length
              });
              return { code: code || null, description: description || null };
            }
          }
        }
      } catch (e) {
        this._logStep('Error extracting from diagnosis table', { error: e.message });
      }

      // If we have raw text, try to parse code and description from it
      if (rawDiagnosisText) {
        let code = null;
        let description = null;

        // Try multiple code patterns - find ALL codes, then take the most recent/last one
        // 1. ICD-10 codes: S83.6, G93.9, A00-B99 format (letter + 2-3 digits + optional decimal + digits)
        // Note: Use non-word-boundary patterns because codes can be attached to text (e.g., "S83.6Sprain")
        const icd10Pattern = /([A-Z]\d{2,3}(?:\.\d+)?)/g;
        const icd10Matches = [...rawDiagnosisText.matchAll(icd10Pattern)];
        
        // 2. SNOMED or numeric codes: 128196005, 3723001 (6+ digit numbers, not dates)
        // Exclude numbers that look like dates (YYYYMMDD format like 20260114)
        const numericCodePattern = /(\d{6,})(?=[A-Z][a-z]|\s|SSOC|Branch|HQ|$)/g;
        const numericMatches = [...rawDiagnosisText.matchAll(numericCodePattern)]
          .filter(m => {
            const num = m[1];
            // Exclude dates: YYYYMMDD format (starts with 19 or 20, 8 digits)
            if (num.length === 8 && /^(19|20)\d{6}$/.test(num)) return false;
            // Exclude dates in other formats that might be 6 digits
            return true;
          });

        // Collect all code matches with their positions
        const allCodes = [];
        
        // Add ICD-10 codes
        icd10Matches.forEach(match => {
          // Verify it's not part of a date or other text
          const before = rawDiagnosisText.substring(Math.max(0, match.index - 10), match.index);
          const after = rawDiagnosisText.substring(match.index + match[0].length, Math.min(rawDiagnosisText.length, match.index + match[0].length + 10));
          
          // Exclude false positives:
          // - Not part of "Date", "State", "Code", "Description", "Branch" headers
          // - Not preceded by date (YYYY format)
          // - Not part of "HQ23" or similar (check if followed by "/" which indicates date)
          // - Should be followed by text starting with capital letter (diagnosis description)
          const isFalsePositive = 
            /Date|State|Code|Description|Branch/i.test(before) || // Part of header
            /^\d{4}/.test(before) || // Preceded by year
            /HQ\d{2}$/.test(before) || // Part of "HQ23" pattern
            (match[0].length <= 4 && /\/\d{2}\/\d{4}$/.test(after)); // Short code followed by date pattern
          
          // Valid code should be followed by text (capital letter) or space
          const isValidCode = /^[A-Z][a-z]/.test(after) || /^ /.test(after) || /^SSOC/i.test(after) || /^Branch/i.test(after);
          
          if (!isFalsePositive && isValidCode) {
            allCodes.push({
              code: match[1],
              index: match.index,
              type: 'icd10'
            });
          }
        });
        
        // Add numeric codes
        numericMatches.forEach(match => {
          allCodes.push({
            code: match[1],
            index: match.index,
            type: 'numeric'
          });
        });

        // Sort by position (most recent/last code in text)
        allCodes.sort((a, b) => b.index - a.index);
        
        // Take the most recent code, prioritizing ICD-10 over numeric if both exist at similar positions
        if (allCodes.length > 0) {
          // If we have multiple codes, prefer ICD-10 codes
          const icd10Codes = allCodes.filter(c => c.type === 'icd10');
          if (icd10Codes.length > 0) {
            code = icd10Codes[0].code; // Most recent ICD-10 code
          } else {
            code = allCodes[0].code; // Most recent numeric code
          }
        }

        // Extract description by cleaning up the text
        // Remove common prefixes and suffixes
        description = rawDiagnosisText
          .replace(/Loading\.\.\./g, '')
          .replace(/Date\s+State\s+Code\s+Description\s+Branch/g, '')
          .replace(/Date|State|Code|Description|Branch/gi, '') // Remove individual header words
          .replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, '') // Remove dates (DD/MM/YYYY format)
          .replace(/\d{4}\/\d{2}\/\d{2}/g, '') // Remove dates (YYYY/MM/DD format)
          .replace(/Final|Provisional/gi, '')
          .replace(/SSOC|Branch|HQ/gi, '')
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim();

        // Remove the code from description if found
        if (code) {
          // Remove the code pattern from description (escape special regex chars in code)
          const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // Create regex patterns for code removal
          const icd10Pattern = /([A-Z]\d{2,3}(?:\.\d+)?)/g;
          const numericCodePattern = /(\d{6,})(?=[A-Z][a-z]|\s|SSOC|Branch|HQ|$)/g;
          
          description = description
            .replace(new RegExp(escapedCode, 'gi'), '')
            .replace(icd10Pattern, '')
            .replace(numericCodePattern, '')
            .trim();
        }

        // Clean up description: remove multiple spaces, clean up common artifacts
        description = description
          .replace(/\s+/g, ' ')
          .replace(/^\d+\s*/, '') // Remove leading numbers that might be codes
          .replace(/\s*SSOC\s*/gi, ' ')
          .replace(/\s*Branch\s*/gi, ' ')
          .trim();

        // If description looks like it contains multiple diagnoses, try to extract the first/most relevant one
        // Common format: "CodeDescriptionCodeDescription" or "Code Description Code Description"
        if (description && (description.length > 100 || /\d{6,}/.test(description))) {
          // Try to split on common patterns
          const parts = description.split(/(?=\d{6,})|(?=[A-Z]\d{2,3}\.)/);
          if (parts.length > 1) {
            // Take the first meaningful part
            description = parts[0].trim();
            // If first part is too short, try second part
            if (description.length < 10 && parts.length > 1) {
              description = parts[1].trim();
            }
          }
        }

        // Extract the actual diagnosis text (remove codes, dates, etc.)
        // Look for words that look like medical terms (typically start with capital, have multiple words)
        if (description) {
          // Try to find the actual description part (skip numeric codes, dates, etc.)
          const words = description.split(/\s+/).filter(w => {
            const word = w.trim();
            return word.length > 2 && 
                   !/^\d+$/.test(word) && // Not just numbers
                   !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(word) && // Not dates
                   !/^\d{4}\/\d{2}\/\d{2}$/.test(word) && // Not YYYY/MM/DD dates
                   !/^[A-Z]\d{2,3}\.?\d*$/.test(word) && // Not ICD codes
                   !/^\d{6,}$/.test(word); // Not numeric codes
          });
          
          description = words.join(' ').trim();
          
          // If we have multiple diagnoses concatenated, try to extract the first/latest one
          // Common pattern: "CodeDescriptionCodeDescription" or repeated text
          if (description.length > 150) {
            // Try splitting on code patterns to get individual diagnoses
            const parts = description.split(/(?=[A-Z]\d{2,3}\.)|(?=\d{6,})/);
            if (parts.length > 1) {
              // Take the last part (most recent diagnosis)
              const lastPart = parts[parts.length - 1].trim();
              if (lastPart.length > 10) {
                description = lastPart;
              } else {
                // If last part is short, try second to last
                const secondLast = parts[parts.length - 2]?.trim();
                if (secondLast && secondLast.length > 10) {
                  description = secondLast;
                }
              }
            }
          }
          
          // Final cleanup: remove repeated phrases
          // Check if description has repeated phrases (e.g., "Pain joint shoulder regionHQ" repeated)
          const sentences = description.split(/HQ|SSOC|Branch/i);
          if (sentences.length > 1) {
            // Take unique sentences
            const uniqueSentences = [...new Set(sentences.map(s => s.trim()).filter(s => s.length > 5))];
            if (uniqueSentences.length > 0) {
              description = uniqueSentences[0]; // Take first unique diagnosis
            }
          }
          
          description = description.trim();
        }

        // If we still have a code but no clean description, try to extract from original text
        if (code && (!description || description.length < 5)) {
          // Try extracting text after the code
          const afterCode = rawDiagnosisText.split(code)[1];
          if (afterCode) {
            const cleanAfterCode = afterCode
              .replace(/SSOC|Branch|Final|Provisional/gi, '')
              .replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, '')
              .replace(/\d{6,}/g, '')
              .replace(/\s+/g, ' ')
              .trim();
            if (cleanAfterCode.length > 5) {
              description = cleanAfterCode.substring(0, 200); // Limit length
            }
          }
        }

        // Final validation
        if (description && description.length > 0) {
          this._logStep('Diagnosis extracted from TX History', { 
            code,
            description: description.substring(0, 100),
            rawText: rawDiagnosisText.substring(0, 150)
          });
          return { code: code || null, description: description || null };
        }
      }

      // If no diagnosis found, return null (will be marked as "Missing diagnosis")
      this._logStep('No diagnosis found in TX History');
      return null;
    } catch (error) {
      logger.error('Failed to extract diagnosis from TX History:', error);
      return null;
    }
  }

  /**
   * Extract medicines from TX History Medicine Tab for a specific visit date
   * This should be called after navigating to TX History
   * @param {string} visitDate - Visit date in YYYY-MM-DD format  
   * @returns {Promise<Array>} Array of medicine objects with name and quantity
   */
  async extractMedicinesFromTXHistory(visitDate) {
    try {
      this._logStep('Extracting medicines for visit date', { visitDate });
      
      // Open Medicine tab
      await this.openMedicineTab();
      
      // Extract medicines filtered by date
      const medicines = await this.extractMedicinesForDate(visitDate);
      
      return medicines;
    } catch (error) {
      logger.error('Failed to extract medicines from TX History:', error);
      return [];
    }
  }

  /**
   * Extract diagnosis from TX History filtered by visit date
   * Falls back to most recent diagnosis if not found for specific date
   * @param {string} visitDate - Visit date in YYYY-MM-DD format
   * @returns {Promise<Object>} Diagnosis object with code and description
   */
  async extractDiagnosisForDate(visitDate) {
    try {
      this._logStep('Extract diagnosis for visit date', { visitDate });
      await this.page.waitForTimeout(1000);
      
      // Extract all diagnoses with dates (support same-origin iframes)
      const diagnoses = await this.page.evaluate((targetDateStr) => {
        const results = [];
        const tableRoots = [document];
        const iframes = Array.from(document.querySelectorAll('iframe'));
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc) tableRoots.push(doc);
          } catch {
            // Cross-origin or inaccessible iframe; ignore.
          }
        }
        
        // Helper to parse dates
        const parseDate = (dateStr) => {
          if (!dateStr) return null;
          const patterns = [
            /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,  // DD/MM/YYYY or DD-MM-YYYY
            /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,  // YYYY-MM-DD
          ];
          
          for (const pattern of patterns) {
            const match = dateStr.match(pattern);
            if (match) {
              if (match[1].length === 4) {
                return new Date(match[1], match[2] - 1, match[3]);
              } else {
                return new Date(match[3], match[2] - 1, match[1]);
              }
            }
          }
          return null;
        };
        
        const targetDate = parseDate(targetDateStr);
        
        // Look for diagnosis tables in all accessible roots
        tableRoots.forEach((root) => {
          const tables = Array.from(root.querySelectorAll('table'));
          tables.forEach(table => {
            const rows = Array.from(table.querySelectorAll('tbody tr, tr'));
            
            // Prefer tables that have a header row with Date/Code/Description.
            let headerCells = [];
            const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
            if (headerRow) {
              headerCells = Array.from(headerRow.querySelectorAll('th, td')).map((c) => (c.textContent || '').trim().toLowerCase());
            }

            const dateIdx = headerCells.findIndex((h) => h === 'date' || h.includes('date'));
            const codeIdx = headerCells.findIndex((h) => h === 'code' || h.includes('code'));
            const descIdx = headerCells.findIndex((h) => h.includes('description') || h.includes('diagnosis'));

            const looksLikeDiagnosisTable = dateIdx >= 0 && (codeIdx >= 0 || descIdx >= 0);
            const dataRows = looksLikeDiagnosisTable ? rows.slice(1) : rows;

            dataRows.forEach(row => {
              const cells = Array.from(row.querySelectorAll('td, th'));
              if (cells.length < 2) return;

              let dateStr = '';
              let diagnosisCode = '';
              let diagnosisDesc = '';

              if (looksLikeDiagnosisTable) {
                if (dateIdx >= 0 && dateIdx < cells.length) dateStr = (cells[dateIdx].textContent || '').trim();
                if (codeIdx >= 0 && codeIdx < cells.length) diagnosisCode = (cells[codeIdx].textContent || '').trim();
                if (descIdx >= 0 && descIdx < cells.length) diagnosisDesc = (cells[descIdx].textContent || '').trim();
              }

              // Fallback: guess based on content (for non-standard tables)
              if (!dateStr || !diagnosisDesc) {
                // Some Clinic Assist tables push date/code further right; scan a bit wider.
                for (let i = 0; i < Math.min(cells.length, 12); i++) {
                  const text = (cells[i].textContent || '').trim();

                  if (!dateStr && /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(text)) dateStr = text;
                  if (!diagnosisCode && (/^[A-Z]\d{2,3}(?:\.\d+)?$/.test(text) || /^\d{6,8}$/.test(text))) diagnosisCode = text;
                  if (text.length > diagnosisDesc.length &&
                      !/loading/i.test(text) &&
                      !/date|state|branch/i.test(text) &&
                      !/^\d+$/.test(text) &&
                      !/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(text)) {
                    diagnosisDesc = text;
                  }
                }
              }

              if (!dateStr || !diagnosisDesc || diagnosisDesc.length < 3) return;

              const recordDate = parseDate(dateStr);
              if (!recordDate) return;

              // Normalize diagnosis code: sometimes code is embedded in a longer string, or in the description.
              const pickCode = (s) => {
                const m = String(s || '').toUpperCase().match(/([A-Z]\d{2,3}(?:\.\d+)?|\d{6,10})/);
                return m ? m[1] : null;
              };
              let normalizedCode = pickCode(diagnosisCode) || pickCode(diagnosisDesc);
              if (normalizedCode) diagnosisCode = normalizedCode;

              // If description starts with the code, strip it to keep clean diagnosis text.
              if (normalizedCode && diagnosisDesc) {
                const upper = diagnosisDesc.toUpperCase();
                if (upper.startsWith(normalizedCode)) {
                  diagnosisDesc = diagnosisDesc.slice(normalizedCode.length).replace(/^\s*[-–:]\s*/, '').trim();
                }
              }

              const descLower = (diagnosisDesc || '').toLowerCase();
              if (descLower.includes('unfit for duty')) return;
              if (descLower.includes('medical certificate') || /\bmc\b/.test(descLower)) return;

              // Require a *condition* signal (not just a body-part signal) unless a code is present.
              // This avoids treating devices/procedures like "GEL WRAP SHOULDER BREG" as diagnosis.
              const conditionKeywords = /(pain|sprain|strain|fracture|injur|infection|fever|cough|cold|headache|migraine|asthma|diabetes|hypertension|arthritis|osteoarthritis|tendinitis|tendinopathy|tendinosis|bursitis|synovitis|dislocation|contusion|laceration|wound|ulcer|eczema|allergy|syndrome|influenza|tonsillitis|otitis|conjunctivitis|pneumonia|bronch|respiratory|gastro|dermat|sinus|chondromalacia|radiculopathy|spondylosis|cervicalgia|lumbago|myalgia|neuralgia|neuropathy|meniscus|ligament|fasciitis|impingement|capsulitis)/i;
              const procedureKeywords = /(physiotherapy|x[- ]?ray|ultrasound|mri|ct|consultation|therapy|injection|radiolog|procedure|rehab|exercise|clinic|treatment|follow\s*up|brace|splint|cast|wrap|orthosis|support|sling|crutch|bandage|tape|pack|heat|cold|hot|breg)/i;
              const descHasCondition = conditionKeywords.test(descLower);
              const descLooksLikeProcedure = procedureKeywords.test(descLower);

              // Diagnosis tab entries often have a diagnosis code, but some rows only have text.
              const codeOk = diagnosisCode && (
                /^\d{6,10}$/.test(diagnosisCode) || // SNOMED-ish numeric
                /^[A-Z]\d{2,3}(?:\.\d+)?$/.test(diagnosisCode) // ICD-10-ish
              );
              const descOk = !!diagnosisDesc && diagnosisDesc.trim().length >= 5 && descHasCondition && !descLooksLikeProcedure;
              if (!codeOk && !descOk) return;

              results.push({
                date: dateStr,
                dateIso: recordDate ? recordDate.toISOString().slice(0, 10) : null,
                dateObj: recordDate,
                code: codeOk ? diagnosisCode : null,
                description: diagnosisDesc || null,
                isTargetDate: recordDate && targetDate &&
                  recordDate.getDate() === targetDate.getDate() &&
                  recordDate.getMonth() === targetDate.getMonth() &&
                  recordDate.getFullYear() === targetDate.getFullYear()
              });
            });
          });
        });
        
        return results;
      }, visitDate);
      
      if (!diagnoses || diagnoses.length === 0) {
        this._logStep('No diagnosis rows found in Diagnosis tab tables');
        return null;
      }

      // Sort diagnoses by date desc (most recent first).
      diagnoses.sort((a, b) => {
        const ta = a?.dateObj ? new Date(a.dateObj).getTime() : 0;
        const tb = b?.dateObj ? new Date(b.dateObj).getTime() : 0;
        return tb - ta;
      });

      // Try to find diagnosis for exact date
      let matchingDiagnosis = diagnoses.find(d => d.isTargetDate);
      
      if (matchingDiagnosis) {
        this._logStep('Found diagnosis for visit date', { 
          date: matchingDiagnosis.date,
          code: matchingDiagnosis.code,
          description: matchingDiagnosis.description.substring(0, 60)
        });
        
        return {
          code: matchingDiagnosis.code,
          description: matchingDiagnosis.description,
          date: matchingDiagnosis.date
        };
      }
      
      // Fallback: pick the most recent diagnosis on/before the visit date.
      // This avoids accidentally using a later diagnosis (future visit) for an earlier claim date.
      if (diagnoses.length > 0) {
        const targetTs = new Date(visitDate).setHours(0, 0, 0, 0);
        const onOrBefore = diagnoses.find((d) => {
          if (!d?.dateObj) return false;
          const ts = new Date(d.dateObj).setHours(0, 0, 0, 0);
          return Number.isFinite(ts) && ts <= targetTs;
        });

        const chosen = onOrBefore || diagnoses[0]; // diagnoses[0] is most recent overall (date desc)
        this._logStep(onOrBefore ? 'No exact diagnosis date match; using most recent on/before visit date' : 'No diagnosis on/before visit date; using most recent overall', {
          date: chosen.date,
          code: chosen.code,
          description: chosen.description.substring(0, 60),
          visitDate
        });

        return {
          code: chosen.code,
          description: chosen.description,
          date: chosen.date
        };
      }
      
      // No diagnosis found at all
      this._logStep('No diagnosis found in TX History');
      return null;
      
    } catch (error) {
      logger.error('Failed to extract diagnosis for date:', error);
      return null;
    }
  }

  /**
   * Extract the LATEST diagnosis from Diagnosis tab (most recent date)
   * @returns {Promise<Object|null>} Latest diagnosis: { code, description, date }
   */
  async extractLatestDiagnosis() {
    try {
      this._logStep('Extract latest diagnosis from Diagnosis tab');
      await this.page.waitForTimeout(1000);
      
      // Extract all diagnoses with dates (support same-origin iframes)
      const diagnoses = await this.page.evaluate(() => {
        const results = [];
        const tableRoots = [document];
        const iframes = Array.from(document.querySelectorAll('iframe'));
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc) tableRoots.push(doc);
          } catch {
            // Cross-origin or inaccessible iframe; ignore.
          }
        }
        
        // Helper to parse dates
        const parseDate = (dateStr) => {
          if (!dateStr) return null;
          const patterns = [
            /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,  // DD/MM/YYYY or DD-MM-YYYY
            /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,  // YYYY-MM-DD
          ];
          
          for (const pattern of patterns) {
            const match = dateStr.match(pattern);
            if (match) {
              if (match[1].length === 4) {
                return new Date(match[1], match[2] - 1, match[3]);
              } else {
                return new Date(match[3], match[2] - 1, match[1]);
              }
            }
          }
          return null;
        };
        
        // Look for diagnosis tables in all accessible roots
        tableRoots.forEach((root) => {
          const tables = Array.from(root.querySelectorAll('table'));
          tables.forEach(table => {
            const rows = Array.from(table.querySelectorAll('tbody tr, tr'));
            
            rows.forEach(row => {
              const cells = Array.from(row.querySelectorAll('td, th'));
              if (cells.length < 2) return;
              
              // Extract date (usually first column)
              let dateStr = '';
              let diagnosisCode = '';
              let diagnosisDesc = '';
              
              for (let i = 0; i < Math.min(cells.length, 5); i++) {
                const text = cells[i].textContent.trim();
                
                // Check for date (first column usually)
                if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(text) && !dateStr) {
                  dateStr = text;
                }
                
                // Check for diagnosis code (short alphanumeric, usually 6-8 digits)
                if (/^\d{6,8}$/.test(text) || /^[A-Z]\d{2}\.?\d*$/.test(text)) {
                  diagnosisCode = text;
                }
                
                // Description is usually the longest text that's not a date or code
                if (text.length > diagnosisDesc.length && 
                    !/loading/i.test(text) && 
                    !/date/i.test(text) &&
                    !/^\d+$/.test(text) &&
                    !/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(text)) {
                  diagnosisDesc = text;
                }
              }
              
              if (dateStr && diagnosisDesc.length > 5) {
                const recordDate = parseDate(dateStr);
                const descLower = (diagnosisDesc || '').toLowerCase();
                if (descLower.includes('unfit for duty')) return;
                if (descLower.includes('medical certificate') || /\bmc\b/.test(descLower)) return;

                const conditionKeywords = /(pain|sprain|strain|fracture|injur|infection|fever|cough|cold|headache|migraine|asthma|diabetes|hypertension|arthritis|osteoarthritis|tendinitis|tendinopathy|bursitis|synovitis|dislocation|contusion|laceration|wound|ulcer|eczema|allergy|syndrome|influenza|tonsillitis|otitis|conjunctivitis|pneumonia|bronch|respiratory|gastro|dermat|sinus)/i;
                const procedureKeywords = /(physiotherapy|x[- ]?ray|ultrasound|mri|ct|consultation|therapy|injection|radiolog|procedure|rehab|exercise|clinic|treatment|follow\s*up|brace|splint|cast|wrap|orthosis|support|sling|crutch|bandage|tape|pack|heat|cold|hot|breg)/i;
                const descHasCondition = conditionKeywords.test(descLower);
                const descLooksLikeProcedure = procedureKeywords.test(descLower);

                // Allow ICD codes or numeric codes; if missing, accept diagnosis text as a fallback.
                const codeOk = diagnosisCode && (
                  /^\d{6,10}$/.test(diagnosisCode) ||
                  /^[A-Z]\d{2,3}(?:\.\d+)?$/.test(diagnosisCode)
                );
                const descOk = diagnosisDesc && diagnosisDesc.trim().length >= 5 && descHasCondition && !descLooksLikeProcedure;
                if (!codeOk && !descOk) return;

                results.push({
                  date: dateStr,
                  dateObj: recordDate,
                  code: codeOk ? diagnosisCode : null,
                  description: diagnosisDesc
                });
              }
            });
          });
        });
        
        // Sort by date descending (most recent first)
        results.sort((a, b) => {
          if (!a.dateObj && !b.dateObj) return 0;
          if (!a.dateObj) return 1;
          if (!b.dateObj) return -1;
          return b.dateObj - a.dateObj;
        });
        
        return results;
      });
      
      // Get the latest (first) diagnosis
      if (diagnoses.length > 0) {
        const latest = diagnoses[0];
        this._logStep('Found latest diagnosis', { 
          date: latest.date,
          code: latest.code,
          description: latest.description.substring(0, 60)
        });
        
        return {
          code: latest.code,
          description: latest.description,
          date: latest.date
        };
      }
      
      // No diagnosis found
      this._logStep('No diagnosis found in Diagnosis tab');
      return null;
      
    } catch (error) {
      logger.error('Failed to extract latest diagnosis:', error);
      return null;
    }
  }

  /**
   * Open "All" tab within TX History
   * @returns {Promise<boolean>} Success status
   */
  async openAllTab() {
    try {
      this._logStep('Open All Tab in TX History');
      await this.page.waitForTimeout(1000);

      // IMPORTANT: There are many "All" strings on the page.
      // We must click the Tx History sub-tab pill "All" (next to Medicine/Investigation/Procedure/Diagnosis/M.C/Visit).
      // Do this via Playwright locators first (more reliable than page.evaluate for framework handlers),
      // then fallback to page.evaluate heuristics.

      const tabStripBase = this.page.locator('ul, nav, [role="tablist"], .nav-tabs, .nav-pills, .tabs, .tab-strip, div');
      const tabStripCandidates = tabStripBase
        .filter({ hasText: 'Medicine' })
        .filter({ hasText: 'Procedure' })
        .filter({ hasText: 'Diagnosis' })
        .filter({ hasText: 'Visit' });

      let clicked = false;
      try {
        const n = await tabStripCandidates.count().catch(() => 0);
        if (n > 0) {
          // Pick the smallest candidate (least text) to avoid grabbing the whole page container.
          const bestIdx = await tabStripCandidates.evaluateAll((els) => {
            const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
            let best = -1;
            let bestLen = Infinity;
            for (let i = 0; i < els.length; i++) {
              const el = els[i];
              const t = norm(el.textContent);
              // Must contain our pill labels; otherwise it's too broad.
              if (!t.includes('Medicine') || !t.includes('Diagnosis') || !t.includes('Visit') || !t.includes('Procedure')) continue;
              if (t.length < bestLen) {
                bestLen = t.length;
                best = i;
              }
            }
            return best;
          });

          const strip = bestIdx >= 0 ? tabStripCandidates.nth(bestIdx) : tabStripCandidates.first();
          const allPill = strip.locator('a, button, li, [role="tab"], span, div').filter({ hasText: /^All$/ }).first();

          if ((await allPill.count().catch(() => 0)) > 0 && (await allPill.isVisible().catch(() => false))) {
            await allPill.click({ timeout: 5000 }).catch(async () => {
              await allPill.click({ timeout: 5000, force: true });
            });
            clicked = true;

            // Best-effort verify: active tab text becomes "All" (common patterns).
            await this.page
              .waitForFunction(() => {
                const active = document.querySelector('.nav .active, .nav-tabs .active, .nav-pills .active, [role="tab"][aria-selected="true"]');
                const t = (active?.textContent || '').replace(/\s+/g, ' ').trim();
                return t === 'All';
              })
              .catch(() => {});
          }
        }
      } catch {
        // ignore and fallback
      }

      if (!clicked) {
        clicked = await this.page
          .evaluate(() => {
            const TAB_LABELS = ['All', 'Medicine', 'Investigation', 'Procedure', 'Diagnosis', 'Visit'];

            const textEq = (el, s) => (el?.textContent || '').replace(/\s+/g, ' ').trim() === s;
            const containsAll = (el, labels) => {
              const t = (el?.textContent || '').replace(/\s+/g, ' ').trim();
              return labels.every((l) => t.includes(l));
            };

            const clickWithin = (container) => {
              if (!container) return false;
              const clickables = Array.from(container.querySelectorAll('a, button, li, span, div, [role="tab"]'));
              const all = clickables.find((el) => textEq(el, 'All'));
              if (!all) return false;
              const r = all.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return false;
              all.scrollIntoView({ block: 'center', inline: 'center' });
              all.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              all.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
              all.click();
              return true;
            };

            const candidates = Array.from(document.querySelectorAll('ul, nav, [role="tablist"], .nav-tabs, .nav-pills, div'))
              .filter((el) => containsAll(el, ['Medicine', 'Diagnosis', 'Visit', 'Procedure', 'All']))
              .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
            for (const c of candidates.slice(0, 10)) {
              if (clickWithin(c)) return true;
            }

            const allEls = Array.from(document.querySelectorAll('a, button, li, span, div, [role="tab"]')).filter((el) => textEq(el, 'All'));
            for (const el of allEls) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              let p = el.parentElement;
              for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
                if (containsAll(p, ['Medicine', 'Diagnosis', 'Visit', 'Procedure'])) {
                  el.scrollIntoView({ block: 'center', inline: 'center' });
                  el.click();
                  return true;
                }
              }
            }

            return false;
          })
          .catch(() => false);
      }

      if (!clicked) {
        // If "All" tab not found, it might be the default view.
        this._logStep('All Tab not found/clickable; assuming default view');
        return true;
      }

      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(1200);

      // Many grids only populate after clicking "Show".
      try {
        const showBtn = this.page
          .locator(
            [
              'button:has-text("Show")',
              'input[type="button"][value="Show"]',
              'input[type="submit"][value="Show"]',
              'a:has-text("Show")',
            ].join(', ')
          )
          .first();
        if ((await showBtn.count().catch(() => 0)) > 0 && (await showBtn.isVisible().catch(() => false))) {
          await showBtn.click().catch(() => {});
          await this.page.waitForTimeout(1500);
        }
      } catch {
        // ignore
      }

      // Wait briefly for rows to appear (best effort).
      await this.page
        .waitForFunction(() => {
          const roots = [document];
          for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
            try {
              const doc = iframe.contentDocument || iframe.contentWindow?.document;
              if (doc) roots.push(doc);
            } catch {
              // ignore
            }
          }
          for (const root of roots) {
            const rows = Array.from(root.querySelectorAll('table tr, [role="row"], tbody tr'));
            for (const r of rows.slice(0, 80)) {
              const t = r.textContent || '';
              if (/\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/.test(t) || /\d{4}[\/-]\d{1,2}[\/-]\d{1,2}/.test(t)) return true;
            }
          }
          return false;
        }, { timeout: 5000 })
        .catch(() => {});

      this._logStep('All Tab opened');
      return true;

    } catch (error) {
      logger.error('Failed to open All Tab:', error);
      return false;
    }
  }

  /**
   * Extract diagnosis from TX History All tab for a specific visit date
   * @param {string} visitDate - Visit date in YYYY-MM-DD format
   * @returns {Promise<Object|null>} { code: string|null, description: string, date: string } or null
   */
  async extractDiagnosisFromAllTab(visitDate) {
    try {
      this._logStep('Extract diagnosis from All tab', { visitDate });
      await this.navigateToTXHistory().catch(() => {});
      await this.openAllTab();
      await this.page.waitForTimeout(1500);

      const result = await this.page.evaluate((targetDateStr) => {
        const parseDate = (dateStr) => {
          if (!dateStr) return null;
          const patterns = [
            /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,  // DD/MM/YYYY or DD-MM-YYYY
            /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,  // YYYY-MM-DD
          ];
          for (const pattern of patterns) {
            const match = dateStr.match(pattern);
            if (match) {
              if (match[1].length === 4) {
                return new Date(match[1], match[2] - 1, match[3]);
              }
              return new Date(match[3], match[2] - 1, match[1]);
            }
          }
          return null;
        };

        const sameDay = (a, b) =>
          !!a &&
          !!b &&
          a.getFullYear() === b.getFullYear() &&
          a.getMonth() === b.getMonth() &&
          a.getDate() === b.getDate();

        const targetDate = parseDate(targetDateStr);
        const diagnosisKeywords = /(pain|sprain|strain|fracture|injur|infection|fever|cough|cold|headache|migraine|asthma|diabetes|hypertension|arthritis|osteoarthritis|tendinitis|tendinopathy|tendinosis|bursitis|synovitis|dislocation|contusion|laceration|wound|ulcer|eczema|allergy|syndrome|influenza|tonsillitis|otitis|conjunctivitis|pneumonia|bronch|respiratory|gastro|dermat|sinus|chondromalacia|radiculopathy|spondylosis|cervicalgia|lumbago|myalgia|neuralgia|neuropathy|meniscus|ligament|fasciitis|impingement|capsulitis)/i;
        const procedureKeywords = /(physiotherapy|x[- ]?ray|ultrasound|mri|ct|consultation|therapy|injection|radiolog|procedure|rehab|exercise|clinic|treatment|follow\s*up|brace|splint|cast|wrap|orthosis|support|sling|crutch|bandage|tape|pack|heat|cold|hot|breg)/i;
        const icdPattern = /([A-Z]\d{2,3}(?:\.\d+)?)/;
        const numericPattern = /(\d{6,10})/;

        const candidates = [];
        const tables = Array.from(document.querySelectorAll('table'));

        const cleanText = (text, code) => {
          let desc = String(text || '');
          // Remove dates and amounts
          desc = desc
            .replace(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/g, ' ')
            .replace(/\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/g, ' ')
            .replace(/\$?\s?\d+(?:\.\d{1,2})?/g, ' ')
            .replace(/(?:Final|Provisional|SSOC|Branch|HQ|Clinic Assist)/gi, ' ')
            .replace(/(?:dx|diagnosis|impression|assessment)\s*[:\-]?\s*/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (code) {
            const esc = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            desc = desc.replace(new RegExp(esc, 'gi'), ' ').replace(/\s+/g, ' ').trim();
          }
          return desc;
        };

        const considerRow = (rowText, rowDateObj, rowDateStr) => {
          const text = String(rowText || '').trim();
          if (!text) return;
          const lower = text.toLowerCase();
          if (lower.includes('unfit for duty') || lower.includes('medical certificate') || /\bmc\b/.test(lower)) return;

          let code = null;
          const icdMatch = text.match(icdPattern);
          const numMatch = text.match(numericPattern);
          if (icdMatch) code = icdMatch[1];
          else if (numMatch) code = numMatch[1];

          const desc = cleanText(text, code);
          const descLower = desc.toLowerCase();
          const looksLikeDiagnosis = diagnosisKeywords.test(descLower);
          const looksLikeProcedure = procedureKeywords.test(descLower);
          const hasDxLabel = /\bdiagnos(?:is|es)?\b|\bdx\b|\bicd\b/i.test(text);
          const looksLikeMedicine = /\bmed\b|\bmedicine\b|\bdrug\b|\bpharmacy\b/i.test(text);
          const hasStrongDx = !!code || hasDxLabel;

          // Require some diagnosis signal.
          if (!hasStrongDx && !looksLikeDiagnosis) return;

          // Exclude medicine/procedure rows unless there's a strong diagnosis signal.
          if (looksLikeMedicine && !hasStrongDx) return;
          if (looksLikeProcedure && !hasStrongDx) return;
          if (looksLikeProcedure && !looksLikeDiagnosis && !hasDxLabel) return;
          if (!desc || desc.length < 5) return;

          let score = 0;
          if (code) score += 5;
          if (looksLikeDiagnosis) score += 3;
          if (looksLikeProcedure) score -= 4;
          if (desc.length > 15) score += 1;

          candidates.push({
            code: code || null,
            description: desc,
            dateObj: rowDateObj,
            date: rowDateStr,
            score
          });
        };

        tables.forEach((table) => {
          const rows = Array.from(table.querySelectorAll('tbody tr, tr'));
          if (!rows.length) return;

          rows.forEach((row) => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            if (cells.length < 2) return;
            const rowText = row.textContent || '';

            // Find a date for the row
            let dateStr = '';
            for (const cell of cells) {
              const text = (cell.textContent || '').trim();
              if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(text) || /\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(text)) {
                dateStr = text;
                break;
              }
            }
            if (!dateStr) {
              const m = rowText.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/);
              if (m) dateStr = m[1];
            }
            const dateObj = parseDate(dateStr);
            if (!dateObj) return;

            considerRow(rowText, dateObj, dateStr);
          });
        });

        if (!candidates.length) return null;

        // Prefer exact date; else most recent on/before target date.
        const sorted = candidates.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return b.dateObj - a.dateObj;
        });

        let chosen = null;
        if (targetDate) {
          const exact = sorted.filter((c) => sameDay(c.dateObj, targetDate));
          if (exact.length) {
            chosen = exact.sort((a, b) => b.score - a.score)[0];
          } else {
            const targetTs = new Date(targetDate).setHours(0, 0, 0, 0);
            const onOrBefore = sorted.find((c) => new Date(c.dateObj).setHours(0, 0, 0, 0) <= targetTs);
            chosen = onOrBefore || sorted[0];
          }
        } else {
          chosen = sorted[0];
        }

        return chosen ? { code: chosen.code, description: chosen.description, date: chosen.date } : null;
      }, visitDate);

      if (result && result.description) {
        this._logStep('Diagnosis extracted from All tab', {
          code: result.code,
          description: result.description.substring(0, 100),
          date: result.date
        });
        return result;
      }

      this._logStep('No diagnosis found in All tab');
      return null;
    } catch (error) {
      logger.error('Failed to extract diagnosis from All tab:', error);
      return null;
    }
  }

  /**
   * Check if there's a "First Consult" entry on the visit date in TX History All tab
   * @param {string} visitDate - Visit date in YYYY-MM-DD format
   * @returns {Promise<boolean>} True if First Consult found on visit date
   */
  async hasFirstConsultOnDate(visitDate) {
    try {
      this._logStep('Check for First Consult on visit date', { visitDate });
      
      // Navigate to TX History if not already there
      await this.navigateToTXHistory().catch(() => {});
      await this.openAllTab();
      await this.page.waitForTimeout(2000);

      // Parse target date
      const targetDate = new Date(visitDate);
      const targetDateStr = targetDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }); // DD/MM/YYYY
      const targetDateStrAlt = targetDate.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }); // MM/DD/YYYY

      const found = await this.page.evaluate(({ targetDateStr, targetDateStrAlt }) => {
        // Look for tables with visit history
        const tables = Array.from(document.querySelectorAll('table'));
        
        for (const table of tables) {
          const rows = Array.from(table.querySelectorAll('tbody tr, tr'));
          
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td, th'));
            if (cells.length < 2) continue;
            
            const rowText = row.textContent || '';
            
            // Check if row contains the target date
            const hasTargetDate = rowText.includes(targetDateStr) || rowText.includes(targetDateStrAlt);
            
            // Check if row contains "First Consult" or similar
            const hasFirstConsult = /first\s+consult|first\s+visit|new\s+visit|initial\s+consult/i.test(rowText);
            
            if (hasTargetDate && hasFirstConsult) {
              return true;
            }
          }
        }
        
        // Also check for text content that might contain the date and "First Consult"
        const bodyText = document.body.textContent || '';
        const datePattern = new RegExp(`(${targetDateStr}|${targetDateStrAlt})`, 'i');
        if (datePattern.test(bodyText)) {
          const dateMatch = bodyText.match(datePattern);
          if (dateMatch) {
            const context = bodyText.substring(
              Math.max(0, bodyText.indexOf(dateMatch[0]) - 100),
              Math.min(bodyText.length, bodyText.indexOf(dateMatch[0]) + 200)
            );
            if (/first\s+consult|first\s+visit|new\s+visit|initial\s+consult/i.test(context)) {
              return true;
            }
          }
        }
        
        return false;
      }, { targetDateStr, targetDateStrAlt });

      this._logStep('First Consult check result', { visitDate, found });
      return found;
    } catch (error) {
      logger.error('Failed to check First Consult:', error);
      return false; // Default to false (Follow Up) if check fails
    }
  }

  /**
   * Open Past Notes tab
   * @returns {Promise<boolean>} Success status
   */
  async openPastNotesTab() {
    try {
      this._logStep('Open Past Notes Tab');
      await this.page.waitForTimeout(1000);

      const pastNotesSelectors = [
        '[role="tab"]:has-text("Past Notes")',
        'a:has-text("Past Notes")',
        'button:has-text("Past Notes")',
        'li:has-text("Past Notes")',
        '.tab:has-text("Past Notes")',
        '[class*="tab"]:has-text("Past Notes")',
        'a:has-text("Notes")',
        '[role="tab"]:has-text("Notes")',
      ];

      for (const selector of pastNotesSelectors) {
        try {
          const tab = this.page.locator(selector).first();
          if ((await tab.count().catch(() => 0)) > 0) {
            const isVisible = await tab.isVisible().catch(() => false);
            if (isVisible) {
              await tab.click();
              await this.page.waitForLoadState('domcontentloaded').catch(() => {});
              await this.page.waitForTimeout(2000);
              this._logStep('Past Notes Tab opened');
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }

      throw new Error('Could not find Past Notes Tab');
    } catch (error) {
      logger.error('Failed to open Past Notes Tab:', error);
      return false;
    }
  }

  /**
   * Extract diagnosis from Past Notes tab for a specific visit date
   * @param {string} visitDate - Visit date in YYYY-MM-DD format
   * @returns {Promise<Object|null>} { code: string, description: string } or null
   */
  async extractDiagnosisFromPastNotes(visitDate) {
    try {
      this._logStep('Extract diagnosis from Past Notes', { visitDate });
      
      // Navigate to TX History and open Past Notes tab
      await this.navigateToTXHistory().catch(() => {});
      await this.openPastNotesTab();
      await this.page.waitForTimeout(2000);

      // Parse target date
      const targetDate = new Date(visitDate);
      const targetDateStr = targetDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }); // DD/MM/YYYY
      const targetDateStrAlt = targetDate.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }); // MM/DD/YYYY

      const result = await this.page.evaluate(({ targetDateStr, targetDateStrAlt }) => {
        // Look for notes/entries matching the visit date
        const tables = Array.from(document.querySelectorAll('table'));
        const textAreas = Array.from(document.querySelectorAll('textarea, div[contenteditable]'));
        const noteDivs = Array.from(document.querySelectorAll('div[class*="note"], div[class*="entry"]'));
        
        // Combine all potential note containers
        const allContainers = [...tables, ...textAreas, ...noteDivs];
        
        for (const container of allContainers) {
          const text = container.textContent || '';
          
          // Check if this container has the target date
          if (text.includes(targetDateStr) || text.includes(targetDateStrAlt)) {
            // Look for diagnosis patterns in the text
            const diagnosisPatterns = [
              /diagnosis[:\s]+([^\n\r;]{10,200})/i,
              /dx[:\s]+([^\n\r;]{10,200})/i,
              /impression[:\s]+([^\n\r;]{10,200})/i,
              /assessment[:\s]+([^\n\r;]{10,200})/i,
            ];
            
            for (const pattern of diagnosisPatterns) {
              const match = text.match(pattern);
              if (match && match[1]) {
                const diagnosisText = match[1].trim();
                if (diagnosisText.length > 5) {
                  // Try to extract ICD code if present
                  const codeMatch = diagnosisText.match(/\b([A-Z]\d{2,3}(?:\.\d+)?)\b/);
                  const code = codeMatch ? codeMatch[1] : null;
                  const description = diagnosisText.replace(codeMatch ? codeMatch[0] : '', '').trim();
                  
                  return { code, description: description || diagnosisText };
                }
              }
            }
            
            // If no explicit diagnosis pattern, try to extract meaningful medical text
            const sentences = text.split(/[.\n\r]/).filter(s => s.trim().length > 10);
            for (const sentence of sentences) {
              if (sentence.length > 20 && sentence.length < 200) {
                // Check if it looks like a diagnosis (contains medical keywords)
                if (/pain|ache|infection|injury|sprain|strain|fracture|disorder|disease|syndrome|chondromalacia|radiculopathy|spondylosis|myalgia|neuralgia|neuropathy|fasciitis|impingement|capsulitis/i.test(sentence)) {
                  return { code: null, description: sentence.trim() };
                }
              }
            }
          }
        }
        
        return null;
      }, { targetDateStr, targetDateStrAlt });

      if (result) {
        this._logStep('Diagnosis extracted from Past Notes', { 
          code: result.code,
          description: result.description?.substring(0, 100)
        });
        return result;
      }

      this._logStep('No diagnosis found in Past Notes for visit date');
      return null;
    } catch (error) {
      logger.error('Failed to extract diagnosis from Past Notes:', error);
      return null;
    }
  }

  /**
   * Extract a diagnosis intent from Past Notes to enrich weak/generic diagnoses.
   * Attempts to find body part + laterality + condition.
   * @param {string} visitDate - Visit date in YYYY-MM-DD format
   * @param {string} baseDescription - Existing diagnosis description (optional)
   * @returns {Promise<{description: string, side: string|null, bodyPart: string|null, condition: string|null}|null>}
   */
  async extractDiagnosisIntentFromPastNotes(visitDate, baseDescription = '') {
    try {
      this._logStep('Extract diagnosis intent from Past Notes', { visitDate });

      await this.navigateToTXHistory().catch(() => {});
      await this.openPastNotesTab();
      await this.page.waitForTimeout(1500);

      const targetDate = new Date(visitDate);
      const targetDateStr = targetDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const targetDateStrAlt = targetDate.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });

      const intent = await this.page.evaluate(({ targetDateStr, targetDateStrAlt, baseDescription }) => {
        const norm = (s) => String(s || '').toLowerCase();
        const base = norm(baseDescription);
        const bodyParts = [
          'shoulder',
          'knee',
          'ankle',
          'wrist',
          'elbow',
          'hip',
          'back',
          'neck',
          'foot',
          'hand',
          'finger',
          'toe',
          'leg',
          'arm',
          'thigh',
          'calf',
          'forearm',
          'spine',
          'lumbar',
          'cervical',
          'thoracic',
          'rib',
          'chest',
          'abdomen',
          'stomach',
          'head',
          'eye',
          'ear',
          'nose',
          'throat',
        ];

        const conditions = [
          'pain',
          'sprain',
          'strain',
          'tendinitis',
          'tendinopathy',
          'bursitis',
          'fracture',
          'contusion',
          'dislocation',
          'laceration',
          'wound',
          'swelling',
          'infection',
          'inflammation',
          'arthritis',
          'osteoarthritis',
          'capsulitis',
          'impingement',
          'tear',
          'rupture',
        ];

        const detectBodyPart = (text) => bodyParts.find((bp) => text.includes(bp)) || null;
        const detectCondition = (text) => conditions.find((c) => text.includes(c)) || null;
        const detectSide = (text) => {
          if (/\b(right|rt)\b/i.test(text)) return 'right';
          if (/\b(left|lt)\b/i.test(text)) return 'left';
          if (/\b(r)\b/i.test(text) && text.includes('shoulder')) return 'right';
          if (/\b(l)\b/i.test(text) && text.includes('shoulder')) return 'left';
          return null;
        };

        const parseDate = (text) => {
          const m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
          if (!m) return null;
          const a = parseInt(m[1], 10);
          const b = parseInt(m[2], 10);
          const y = parseInt(m[3], 10);
          // Prefer DD/MM/YYYY when ambiguous
          const day = a > 12 ? a : b;
          const month = a > 12 ? b : a;
          if (!day || !month || !y) return null;
          return new Date(y, month - 1, day);
        };

        const targetDate = parseDate(targetDateStr) || parseDate(targetDateStrAlt);

        const best = { score: 0, bodyPart: null, condition: null, side: null, sentence: null };

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
          if (base && bp && base.includes(bp)) score += 1;
          return { score, bp, cond, side, sentence: sentence.trim() };
        };

        const containers = [
          ...Array.from(document.querySelectorAll('table')),
          ...Array.from(document.querySelectorAll('textarea, div[contenteditable]')),
          ...Array.from(document.querySelectorAll('div[class*="note"], div[class*="entry"]')),
        ];

        const pickText = (c) => norm(c.textContent || '');
        const candidates = containers.filter((c) => {
          const text = pickText(c);
          return text.includes(targetDateStr.toLowerCase()) || text.includes(targetDateStrAlt.toLowerCase());
        });
        const pool = candidates.length ? candidates : containers;

        const splitSentences = (text) =>
          text
            .split(/[.\n\r]/)
            .map((s) => s.trim())
            .filter((s) => s.length > 5);

        // First pass: structured Past Notes tables with Date/Notes columns.
        const tables = Array.from(document.querySelectorAll('table'));
        let bestRowText = null;
        let bestRowDate = null;
        for (const table of tables) {
          const header = Array.from(table.querySelectorAll('th, td')).map((c) => norm(c.textContent || ''));
          if (!header.some((h) => h.includes('date'))) continue;
          if (!header.some((h) => h.includes('note'))) continue;
          const rows = Array.from(table.querySelectorAll('tbody tr, tr'));
          for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td, th'));
            if (cells.length < 2) continue;
            const rowText = norm(row.textContent || '');
            const rowDate = parseDate(rowText);
            if (!rowDate) continue;
            if (targetDate && rowDate.getTime() > targetDate.getTime()) continue;
            if (!bestRowDate || rowDate.getTime() > bestRowDate.getTime()) {
              bestRowDate = rowDate;
              bestRowText = rowText;
            }
          }
        }

        if (bestRowText) {
          const sentences = splitSentences(bestRowText);
          for (const sentence of sentences) {
            const scored = scoreSentence(sentence);
            if (scored && scored.score > best.score) {
              best.score = scored.score;
              best.bodyPart = scored.bp;
              best.condition = scored.cond;
              best.side = scored.side;
              best.sentence = scored.sentence;
            }
          }
        }

        // Second pass: scan all containers.
        for (const container of pool) {
          const text = pickText(container);
          const sentences = splitSentences(text);
          for (const sentence of sentences) {
            const scored = scoreSentence(sentence);
            if (scored && scored.score > best.score) {
              best.score = scored.score;
              best.bodyPart = scored.bp;
              best.condition = scored.cond;
              best.side = scored.side;
              best.sentence = scored.sentence;
            }
          }
        }

        // If no structured match, return null.
        if (!best.bodyPart) return null;

        const baseCond = detectCondition(base);
        const condition = best.condition || baseCond || null;
        const side = best.side || null;
        const bodyPart = best.bodyPart;

        const isPain = condition && /pain|ache|soreness/.test(condition);
        let description = null;
        if (condition && bodyPart) {
          if (isPain) {
            description = `Pain in ${side ? `${side} ` : ''}${bodyPart}`.trim();
          } else {
            description = `${condition} of ${side ? `${side} ` : ''}${bodyPart}`.trim();
          }
        } else if (best.sentence && best.sentence.length <= 160) {
          description = best.sentence;
        }

        return description
          ? { description, side, bodyPart, condition }
          : null;
      }, { targetDateStr, targetDateStrAlt, baseDescription });

      if (intent?.description) {
        this._logStep('Diagnosis intent extracted from Past Notes', {
          description: intent.description?.slice(0, 100),
          side: intent.side,
          bodyPart: intent.bodyPart,
          condition: intent.condition,
        });
        return intent;
      }

      this._logStep('No diagnosis intent found in Past Notes');
      return null;
    } catch (error) {
      logger.error('Failed to extract diagnosis intent from Past Notes:', error);
      return null;
    }
  }

  _isDiagnosisGeneric(description) {
    const d = String(description || '').trim().toLowerCase();
    if (!d) return true;
    if (d.length < 6) return true;
    const hasBodyPart = /(shoulder|knee|ankle|wrist|elbow|hip|back|neck|foot|hand|finger|toe|leg|arm|thigh|calf|forearm|spine|lumbar|cervical|thoracic|rib|chest|abdomen|stomach|head|eye|ear|nose|throat)/i.test(d);
    if (!hasBodyPart) return true;
    // Generic/ambiguous phrases
    if (/unspecified|region|joint|site|part|other|oth|unsp/i.test(d) && !/(left|right|lt|rt)\b/i.test(d)) {
      return true;
    }
    return false;
  }

  /**
   * Get charge type (First Consult vs Follow Up) and diagnosis for a visit date
   * @param {string} visitDate - Visit date in YYYY-MM-DD format
   * @returns {Promise<Object>} { chargeType: 'first'|'follow', diagnosis: {code, description}|null }
   */
  async getChargeTypeAndDiagnosis(visitDate) {
    try {
      this._logStep('Get charge type, diagnosis, and MC data for visit date', { visitDate });
      
      // Step 1: Check charge type from TX History All tab
      const hasFirstConsult = await this.hasFirstConsultOnDate(visitDate);
      const chargeType = hasFirstConsult ? 'first' : 'follow';
      
      this._logStep('Charge type determined', { visitDate, chargeType, hasFirstConsult });
      
      // Step 2: Navigate to TX History and extract MC days from All tab
      let mcDays = 0;
      let mcStartDate = null;
      try {
        await this.navigateToTXHistory().catch(() => {});
        // Ensure we're on the All tab (default tab)
        await this.page.waitForTimeout(1000);
        
        // Extract MC days and MC start date from All tab
        // Look for rows like: "23/01/2026	MC	Unfit for Duty	1.00 day	$0.00	SSOC"
        const mcData = await this.page.evaluate((targetDate) => {
          // Try multiple date formats
          const dateFormats = [
            targetDate.replace(/-/g, '/'),  // 2026-01-23 -> 2026/01/23
            targetDate.split('-').reverse().join('/'),  // 2026-01-23 -> 23/01/2026
            targetDate.split('-').reverse().join('-'),  // 2026-01-23 -> 23-01-2026
          ];
          
          const rows = Array.from(document.querySelectorAll('table tr, [role="row"], tbody tr'));
          for (const row of rows) {
            const text = row.textContent || '';
            
            // Check if row contains "MC" and any of the date formats
            const hasMC = /MC/i.test(text);
            const hasDate = dateFormats.some(format => text.includes(format));
            
            if (hasMC && hasDate) {
              // Extract MC days - look for patterns like "1.00 day", "1 day", "2 days", etc.
              const mcMatch = text.match(/(\d+(?:\.\d+)?)\s*day/i);
              if (mcMatch) {
                // Try to extract the date from the row
                let extractedDate = null;
                for (const format of dateFormats) {
                  if (text.includes(format)) {
                    extractedDate = format;
                    break;
                  }
                }
                return {
                  mcDays: parseInt(parseFloat(mcMatch[1])), // Handle "1.00" -> 1
                  mcStartDate: extractedDate || dateFormats[1] // Default to DD/MM/YYYY format
                };
              }
            }
          }
          return { mcDays: 0, mcStartDate: null };
        }, visitDate);
        
        mcDays = mcData.mcDays;
        mcStartDate = mcData.mcStartDate;
        this._logStep('MC data extracted from All tab', { mcDays, mcStartDate, visitDate });
      } catch (e) {
        this._logStep('Could not extract MC data, using defaults', { error: e.message });
      }
      
      // Step 3: Diagnosis (prefer matching the visit date; fallback to latest)
      let diagnosisSource = null;
      const diagnosisAttempts = [];
      const markAttempt = (source, found) => {
        diagnosisAttempts.push({ source, found: !!found });
      };

      await this.openDiagnosisTab();
      let diagnosis = await this.extractDiagnosisForDate(visitDate);
      markAttempt('diagnosis_tab', !!(diagnosis && diagnosis.description));
      if (diagnosis && diagnosis.description) diagnosisSource = 'diagnosis_tab';
      if (!diagnosis || !diagnosis.description) {
        diagnosis = await this.extractLatestDiagnosis();
        markAttempt('diagnosis_tab_latest', !!(diagnosis && diagnosis.description));
        if (diagnosis && diagnosis.description) diagnosisSource = 'diagnosis_tab_latest';
      }
      if (!diagnosis || !diagnosis.description) {
        this._logStep('Diagnosis not found in Diagnosis tab, trying raw Diagnosis extraction');
        const rawDiagnosis = await this.extractDiagnosisFromTXHistory();
        if (rawDiagnosis && rawDiagnosis.description) {
          diagnosis = {
            code: rawDiagnosis.code || null,
            description: rawDiagnosis.description,
            date: rawDiagnosis.date || null
          };
        }
        markAttempt('diagnosis_tab_raw', !!(diagnosis && diagnosis.description));
        if (diagnosis && diagnosis.description) diagnosisSource = 'diagnosis_tab_raw';
      }
      // Step 4: If not found, try All tab
      if (!diagnosis || !diagnosis.description) {
        this._logStep('Diagnosis not found in Diagnosis tab, trying All tab');
        diagnosis = await this.extractDiagnosisFromAllTab(visitDate);
        markAttempt('all_tab', !!(diagnosis && diagnosis.description));
        if (diagnosis && diagnosis.description) diagnosisSource = 'all_tab';
      }

      // Step 5: If not found, try Visit tab (some deployments store diagnosis/assessment there)
      if (!diagnosis || !diagnosis.description) {
        this._logStep('Diagnosis not found in All tab, trying Visit tab');
        diagnosis = await this.extractDiagnosisFromVisitTab(visitDate);
        markAttempt('visit_tab', !!(diagnosis && diagnosis.description));
        if (diagnosis && diagnosis.description) diagnosisSource = 'visit_tab';
      }

      // Step 6: If not found, try Past Notes tab
      if (!diagnosis || !diagnosis.description) {
        this._logStep('Diagnosis not found in Visit tab, trying Past Notes');
        diagnosis = await this.extractDiagnosisFromPastNotes(visitDate);
        markAttempt('past_notes', !!(diagnosis && diagnosis.description));
        if (diagnosis && diagnosis.description) diagnosisSource = 'past_notes';
      }

      // Step 6b: If diagnosis is generic/ambiguous, try to enrich from Past Notes.
      if (diagnosis && diagnosis.description && this._isDiagnosisGeneric(diagnosis.description)) {
        const intent = await this.extractDiagnosisIntentFromPastNotes(visitDate, diagnosis.description);
        if (intent?.description) {
          diagnosis = { ...diagnosis, description: intent.description };
          diagnosisSource = diagnosisSource || 'past_notes_intent';
          this._logStep('Diagnosis enriched from Past Notes', {
            description: diagnosis.description?.slice(0, 80),
          });
        }
      }

      // Step 7: Medicines (prefer Medicine tab; fallback to empty list)
      let medicines = [];
      try {
        // We should still be in TX History context; if not, navigate again.
        if (!/TXHistory/i.test(this.page.url())) {
          await this.navigateToTXHistory().catch(() => {});
          await this.page.waitForTimeout(500);
        }
        medicines = await this.extractMedicinesFromTXHistory(visitDate);
      } catch (e) {
        this._logStep('Could not extract medicines from TX History (non-fatal)', { error: e.message });
      }

      // Clean up common junk/instruction lines that sometimes leak into Medicine exports.
      const isJunkMedicineName = (name) => {
        const n = String(name || '').trim();
        if (!n) return true;
        const lower = n.toLowerCase();
        if (lower === 'medicine') return true;
        if (lower.startsWith('unfit for ')) return true;
        if (lower.startsWith('take ') || lower.startsWith('apply ') || lower.startsWith('use ')) return true;
        if (lower.startsWith('for ')) return true;
        if (lower.startsWith('after food ') || lower.includes(' after food ')) return true;
        if (lower.includes('when required')) return true;
        if (lower.includes('maximum') || lower.includes('max ')) return true;
        if (lower.includes('do not drive') || lower.includes('operate machinery')) return true;
        if (lower.includes('for pain relieve') || lower.includes('for pain relief')) return true;
        if (lower.includes('for nerve regeneration')) return true;
        if (lower.includes('may cause')) return true;
        if (lower.includes('complete the whole course') || lower.includes('complete whole course')) return true;
        if (lower.includes('course of medicine') || lower.includes('course of med')) return true;
        if (/^[\d.,]+$/.test(lower)) return true;
        if (/^\$?\s*\d+(?:\.\d+)?\s*(?:sgd)?\s*$/i.test(n)) return true;
        if (/^\d+(?:\.\d+)?\s*(?:tabs?|tab|caps?|cap|pcs?|pc|sachets?|pkt|packs?|vials?|ampoules?)\b/i.test(lower))
          return true;
        if (/^\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|iu)\b/i.test(lower)) return true;
        if (/(tab\/s|tablet|capsule|cap\/s)\b/i.test(n) && /(daily|once|twice|bd|tds|after\s+food|before\s+food)\b/i.test(n))
          return true;
        if (/^to be taken\b/i.test(lower) || /\bto be taken\b/i.test(lower)) return true;
        return false;
      };

      const medicinesBeforeFilter = Array.isArray(medicines) ? medicines.length : 0;
      const seenMed = new Set();
      medicines = (Array.isArray(medicines) ? medicines : [])
        .map((m) => {
          if (!m) return null;
          if (typeof m === 'string') return { name: m, quantity: null };
          const name = String(m.name || m.description || '').trim().replace(/\s+/g, ' ');
          if (!name) return null;
          const quantity = m.quantity ?? null;
          return { ...m, name, quantity };
        })
        .filter(Boolean)
        .filter((m) => !isJunkMedicineName(m.name))
        .filter((m) => {
          const key = String(m.name || '').toUpperCase();
          if (!key) return false;
          if (seenMed.has(key)) return false;
          seenMed.add(key);
          return true;
        });
      const medicinesAfterFilter = medicines.length;
      const medicinesFilteredOut = Math.max(0, medicinesBeforeFilter - medicinesAfterFilter);

      this._logStep('TX History: extracted medicines summary', {
        count: medicinesAfterFilter,
        filteredOut: medicinesFilteredOut,
        sample: (medicines || []).slice(0, 5).map((m) => ({ name: String(m?.name || '').slice(0, 60), quantity: m?.quantity })),
      });

      let diagnosisMissingReason = null;
      if (!diagnosis || !diagnosis.description) {
        diagnosisSource = 'missing';
        diagnosisMissingReason = 'not_found_in_diagnosis_all_visit_pastnotes';
      }
      
      return {
        chargeType,
        diagnosis,
        mcDays,
        mcStartDate,
        medicines,
        diagnosisSource,
        diagnosisMissingReason,
        diagnosisAttempts,
        medicineFilterStats: {
          before: medicinesBeforeFilter,
          after: medicinesAfterFilter,
          filteredOut: medicinesFilteredOut,
        },
      };
    } catch (error) {
      logger.error('Failed to get charge type and diagnosis:', error);
      return {
        chargeType: 'follow', // Default to follow-up if error
        diagnosis: null,
        mcDays: 0,
        mcStartDate: null,
        medicines: [],
        diagnosisSource: 'error',
        diagnosisMissingReason: error?.message || 'unknown_error',
        diagnosisAttempts: [],
        medicineFilterStats: {
          before: 0,
          after: 0,
          filteredOut: 0,
        },
      };
    }
  }

  /**
   * Open Medicine Tab within TX History
   * @returns {Promise<boolean>} Success status
   */
  async openMedicineTab() {
    try {
      this._logStep('Open Medicine Tab');
      await this.page.waitForTimeout(1000);

      // Try multiple selectors for Medicine tab
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

      for (const selector of medicineTabSelectors) {
        try {
          const tab = this.page.locator(selector).first();
          if ((await tab.count().catch(() => 0)) > 0) {
            const isVisible = await tab.isVisible().catch(() => false);
            if (isVisible) {
              await tab.click();
              await this.page.waitForLoadState('domcontentloaded').catch(() => {});
              await this.page.waitForTimeout(1500);

              // Many Clinic Assist grids only populate after clicking "Show".
              try {
                const showBtn = this.page
                  .locator(
                    [
                      'button:has-text("Show")',
                      'input[type="button"][value="Show"]',
                      'input[type="submit"][value="Show"]',
                      'a:has-text("Show")',
                    ].join(', ')
                  )
                  .first();
                if ((await showBtn.count().catch(() => 0)) > 0 && (await showBtn.isVisible().catch(() => false))) {
                  await showBtn.click().catch(() => {});
                  await this.page.waitForTimeout(1500);
                }
              } catch {
                // ignore
              }

              this._logStep('Medicine Tab opened');
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }

      throw new Error('Could not find Medicine Tab');
    } catch (error) {
      logger.error('Failed to open Medicine Tab:', error);
      throw error;
    }
  }

  /**
   * Extract medicines from TX History Medicine Tab, filtered by visit date
   * @param {string} visitDate - Visit date in YYYY-MM-DD format
   * @returns {Promise<Array>} Array of medicine objects: [{ name, quantity, date }]
   */
  async extractMedicinesForDate(visitDate) {
    try {
      this._logStep('Extract medicines from Medicine Tab', { visitDate });
      await this.page.waitForTimeout(1000);

      // Extract medicine records from table; prefer exact date match, else most recent on/before visitDate.
      const extraction = await this.page.evaluate((targetDateStr) => {
        const records = [];
        const tables = Array.from(document.querySelectorAll('table'));

        const parseDate = (dateStr) => {
          if (!dateStr) return null;
          const patterns = [
            /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/, // DD/MM/YYYY or DD-MM-YYYY
            /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/, // YYYY-MM-DD
          ];
          for (const pattern of patterns) {
            const match = dateStr.match(pattern);
            if (match) {
              if (match[1].length === 4) return new Date(match[1], match[2] - 1, match[3]); // YYYY-MM-DD
              return new Date(match[3], match[2] - 1, match[1]); // DD/MM/YYYY
            }
          }
          return null;
        };

        const sameDay = (a, b) =>
          !!a &&
          !!b &&
          a.getFullYear() === b.getFullYear() &&
          a.getMonth() === b.getMonth() &&
          a.getDate() === b.getDate();

        const targetDate = parseDate(targetDateStr);

        const extractRow = (cells, { dateCol, nameCol, qtyCol }) => {
          if (!cells || cells.length === 0) return null;

          // Date
          let dateStr = '';
          if (dateCol >= 0 && dateCol < cells.length) {
            dateStr = (cells[dateCol].textContent || '').trim();
          } else {
            for (const cell of cells) {
              const text = (cell.textContent || '').trim();
              if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(text) || /\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(text)) {
                dateStr = text;
                break;
              }
            }
          }
          const dateObj = parseDate(dateStr);
          if (!dateObj) return null;

          // Name
          let name = '';
          if (nameCol >= 0 && nameCol < cells.length) {
            name = (cells[nameCol].textContent || '').trim();
          } else {
            for (const cell of cells) {
              const text = (cell.textContent || '').trim();
              if (!text) continue;
              if (/^\d+$/.test(text)) continue;
              if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(text) || /\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(text))
                continue;
              if (text.length > name.length) name = text;
            }
          }
          if (!name || name.length < 2) return null;

          // Quantity (best-effort)
          let quantity = 1;
          if (qtyCol >= 0 && qtyCol < cells.length) {
            const qtyText = (cells[qtyCol].textContent || '').trim();
            const qtyNum = parseInt(qtyText, 10);
            if (!isNaN(qtyNum) && qtyNum > 0 && qtyNum < 1000) quantity = qtyNum;
          } else {
            for (const cell of cells) {
              const text = (cell.textContent || '').trim();
              if (/^\d+$/.test(text)) {
                const num = parseInt(text, 10);
                if (num > 0 && num < 1000) {
                  quantity = num;
                  break;
                }
              }
            }
          }

          return { name, quantity, date: dateStr, dateObj };
        };

        tables.forEach((table) => {
          const rows = Array.from(table.querySelectorAll('tbody tr, tr'));
          if (rows.length === 0) return;

          const headerRow = table.querySelector('thead tr') || rows[0];
          const headers = headerRow
            ? Array.from(headerRow.querySelectorAll('th, td')).map((h) => (h.textContent || '').trim().toLowerCase())
            : [];

          const dateCol = headers.findIndex((h) => h.includes('date') || h.includes('visit'));
          const nameCol = headers.findIndex((h) => h.includes('medicine') || h.includes('drug') || h.includes('item') || h.includes('description'));
          const qtyCol = headers.findIndex((h) => h.includes('qty') || h.includes('quantity') || h.includes('amount'));

          // If we used rows[0] as headerRow, skip it for data when headers exist.
          const dataRows = headers.length ? rows.slice(1) : rows;

          dataRows.forEach((row) => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            const rec = extractRow(cells, { dateCol, nameCol, qtyCol });
            if (rec) records.push(rec);
          });
        });

        // Choose which date bucket to return.
        const sorted = records
          .filter((r) => r?.dateObj)
          .sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());

        let chosenDateObj = null;
        let chosen = [];

        if (targetDate) {
          const exact = sorted.filter((r) => sameDay(r.dateObj, targetDate));
          if (exact.length) {
            chosenDateObj = targetDate;
            chosen = exact;
          } else {
            // Most recent on/before visit date.
            const targetTs = new Date(targetDate).setHours(0, 0, 0, 0);
            const onOrBefore = sorted.find((r) => new Date(r.dateObj).setHours(0, 0, 0, 0) <= targetTs);
            if (onOrBefore) {
              chosenDateObj = onOrBefore.dateObj;
              chosen = sorted.filter((r) => sameDay(r.dateObj, chosenDateObj));
            } else if (sorted.length) {
              // Unusual: no records on/before target; fall back to most recent overall.
              chosenDateObj = sorted[0].dateObj;
              chosen = sorted.filter((r) => sameDay(r.dateObj, chosenDateObj));
            }
          }
        } else if (sorted.length) {
          chosenDateObj = sorted[0].dateObj;
          chosen = sorted.filter((r) => sameDay(r.dateObj, chosenDateObj));
        }

        const toLocalIsoDate = (d) => {
          if (!d) return null;
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        };

        return {
          // Use local date components; toISOString() would shift the day in SGT.
          chosenDateIso: chosenDateObj ? toLocalIsoDate(chosenDateObj) : null,
          totalRecords: sorted.length,
          medicines: chosen.map((r) => ({ name: r.name, quantity: r.quantity, date: r.date })),
        };
      }, visitDate);

      let medicines = Array.isArray(extraction?.medicines) ? extraction.medicines : [];
      // Post-filter: remove obvious instruction/placeholder rows that are not billable items.
      // These frequently appear in TX History -> Medicine as free-text directions.
	      const isJunkMedicineName = (name) => {
	        const n = String(name || '').trim();
	        if (!n) return true;
	        const lower = n.toLowerCase();
	        if (lower === 'medicine') return true;
        // Price/quantity-only lines commonly appear and should never be treated as a billable item name.
        if (/^[\d.,]+$/.test(lower)) return true;
        if (/^\$?\s*\d+(?:\.\d+)?\s*(?:sgd)?\s*$/i.test(n)) return true;
        if (/^\d+(?:\.\d+)?\s*(?:tabs?|tab|caps?|cap|pcs?|pc|sachets?|pkt|packs?|vials?|ampoules?)\b/i.test(lower)) return true;
        if (/^\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|iu)\b/i.test(lower)) return true;
	        if (lower.startsWith('unfit for ')) return true;
	        // Common instruction lines that leak into Medicine tab exports.
	        if (lower.startsWith('for ')) return true;
	        if (lower.startsWith('after food ') || lower.includes(' after food ')) return true;
	        if (lower.includes('when required')) return true;
	        if (lower.includes('maximum') || lower.includes('max ')) return true;
	        if (lower.includes('do not drive') || lower.includes('operate machinery')) return true;
	        if (lower.includes('for pain relieve') || lower.includes('for pain relief')) return true;
	        if (lower.includes('for nerve regeneration')) return true;
	        if (lower.includes('may cause')) return true;
	        if (lower.includes('complete whole course')) return true;
	        if (lower.includes('complete the whole course')) return true;
	        if (lower.includes('course of medicine') || lower.includes('course of med')) return true;
	        if (lower.startsWith('take ') || lower.startsWith('apply ') || lower.startsWith('use ')) return true;
	        if (/(tab\/s|tablet|capsule|cap\/s)\b/i.test(n) && /(daily|once|twice|bd|tds|after\s+food|before\s+food)\b/i.test(n)) return true;
	        if (/^to be taken\b/i.test(lower) || /\bto be taken\b/i.test(lower)) return true;
	        return false;
	      };
      // De-dupe by name (case-insensitive) to avoid filling the same service repeatedly.
      const seen = new Set();
      medicines = medicines
        .map((m) => ({ ...m, name: String(m?.name || '').trim().replace(/\s+/g, ' ') }))
        .filter((m) => !isJunkMedicineName(m.name))
        .filter((m) => {
          const key = String(m.name || '').toUpperCase();
          if (!key) return false;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

      this._logStep('Medicines extracted from Medicine Tab', {
        count: medicines.length,
        visitDate,
        chosenDateIso: extraction?.chosenDateIso || null,
        totalRecords: extraction?.totalRecords ?? null,
        medicines: medicines.slice(0, 5).map((m) => ({ name: String(m.name || '').substring(0, 50), quantity: m.quantity })),
      });

      return medicines;
    } catch (error) {
      logger.error('Failed to extract medicines from Medicine Tab:', error);
      return [];
    }
  }
}
