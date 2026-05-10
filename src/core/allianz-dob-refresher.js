import { logger } from '../utils/logger.js';
import { ClinicAssistAutomation } from '../automations/clinic-assist.js';

function normalizeDob(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const yyyy = Number(iso[1]);
    const mm = Number(iso[2]);
    const dd = Number(iso[3]);
    if (yyyy >= 1900 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
  }

  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    const yyyy = Number(dmy[3]);
    if (yyyy >= 1900 && yyyy <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${String(yyyy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
  }

  return '';
}

function pickExistingDob(visit) {
  const md = visit?.extraction_metadata || {};
  const candidates = [
    visit?.dob,
    visit?.date_of_birth,
    visit?.patient_dob,
    md?.dob,
    md?.date_of_birth,
    md?.dateOfBirth,
    md?.patientDob,
    md?.patient_dob,
    md?.flow1?.dob,
    md?.flow1?.dateOfBirth,
    md?.flow1?.patientDob,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeDob(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function pickPcno(visit) {
  const md = visit?.extraction_metadata || {};
  const value =
    md?.pcno ||
    md?.flow1?.pcno ||
    md?.patientNumber ||
    md?.patient_number ||
    visit?.pcno ||
    visit?.patient_number;
  const pcno = String(value || '').trim();
  return /^\d{4,6}$/.test(pcno) ? pcno : '';
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

export class AllianzDobRefresher {
  constructor({ clinicAssistPage = null, clinicAssist = null, supabase = null } = {}) {
    this.clinicAssist =
      clinicAssist || (clinicAssistPage ? new ClinicAssistAutomation(clinicAssistPage) : null);
    this.supabase = supabase;
    this._loggedIn = false;
  }

  async _ensureLoggedIn() {
    if (this._loggedIn) return;
    if (!this.clinicAssist?.login) {
      throw new Error('Clinic Assist automation is not available for Allianz DOB refresh');
    }
    await this.clinicAssist.login();
    this._loggedIn = true;
  }

  async _openPatient(visit) {
    const pcno = pickPcno(visit);
    const patientName = normalizeName(visit?.patient_name || visit?.patientName);

    const openedPatientPage = await this.clinicAssist.navigateToPatientPage();
    if (!openedPatientPage) {
      throw new Error('Failed to navigate to Clinic Assist patient page');
    }

    if (pcno) {
      await this.clinicAssist.searchPatientByNumber(pcno);
      await this.clinicAssist.openPatientFromSearchResultsByNumber(pcno);
      return { by: 'pcno', value: pcno };
    }

    if (patientName) {
      await this.clinicAssist.searchPatientByName(patientName);
      await this.clinicAssist.openPatientFromSearchResults(patientName);
      return { by: 'patient_name', value: patientName };
    }

    return null;
  }

  async _persistDob(visit, dobInfo) {
    if (!this.supabase || !visit?.id) return;

    let currentMetadata = visit?.extraction_metadata || {};
    const { data: current, error: fetchError } = await this.supabase
      .from('visits')
      .select('extraction_metadata')
      .eq('id', visit.id)
      .single();
    if (fetchError) {
      logger.warn('[ALLIANZ DOB] Failed to read current metadata before DOB patch', {
        visitId: visit.id,
        error: fetchError.message,
      });
    } else if (current?.extraction_metadata && typeof current.extraction_metadata === 'object') {
      currentMetadata = current.extraction_metadata;
    }

    const nextMetadata = {
      ...currentMetadata,
      dob: dobInfo.iso,
      dobSource: dobInfo.source || 'clinic_assist_patient_info',
      allianzDobRefreshAt: new Date().toISOString(),
      flow1: {
        ...(currentMetadata.flow1 || {}),
        dob: dobInfo.iso,
        dobRaw: dobInfo.raw || null,
        dobSource: dobInfo.source || 'clinic_assist_patient_info',
      },
    };

    const { error } = await this.supabase
      .from('visits')
      .update({ extraction_metadata: nextMetadata })
      .eq('id', visit.id);

    if (error) {
      throw new Error(`Failed to persist refreshed DOB for visit ${visit.id}: ${error.message}`);
    }

    return nextMetadata;
  }

  async refreshVisitDob(visit) {
    const existingDob = pickExistingDob(visit);
    if (existingDob) {
      return {
        status: 'already_present',
        dob: existingDob,
        visit: { ...visit, dob: existingDob },
      };
    }

    const hasIdentifier = Boolean(pickPcno(visit) || normalizeName(visit?.patient_name));
    if (!hasIdentifier) {
      return { status: 'skipped', reason: 'missing_patient_identifier', dob: null, visit };
    }

    await this._ensureLoggedIn();

    const opened = await this._openPatient(visit);
    if (!opened) {
      return { status: 'skipped', reason: 'missing_patient_identifier', dob: null, visit };
    }

    const dobInfo =
      typeof this.clinicAssist.getPatientDOB === 'function'
        ? await this.clinicAssist.getPatientDOB()
        : await this.clinicAssist.extractPatientDobFromPatientInfo();
    if (!dobInfo?.iso) {
      logger.warn('[ALLIANZ DOB] Clinic Assist patient page did not expose DOB', {
        visitId: visit?.id || null,
        openedBy: opened.by,
      });
      return {
        status: 'not_found',
        reason: 'clinic_assist_dob_not_found',
        dob: null,
        visit,
      };
    }

    const persistedMetadata = await this._persistDob(visit, dobInfo);
    const refreshedMetadata = persistedMetadata || {
      ...(visit?.extraction_metadata || {}),
      dob: dobInfo.iso,
      dobSource: dobInfo.source || 'clinic_assist_patient_info',
      allianzDobRefreshAt: new Date().toISOString(),
      flow1: {
        ...(visit?.extraction_metadata?.flow1 || {}),
        dob: dobInfo.iso,
        dobRaw: dobInfo.raw || null,
        dobSource: dobInfo.source || 'clinic_assist_patient_info',
      },
    };
    const refreshedVisit = {
      ...visit,
      dob: dobInfo.iso,
      extraction_metadata: refreshedMetadata,
    };

    logger.info('[ALLIANZ DOB] Refreshed visit DOB from Clinic Assist', {
      visitId: visit?.id || null,
      source: dobInfo.source || null,
      openedBy: opened.by,
    });

    return {
      status: 'refreshed',
      dob: dobInfo.iso,
      source: dobInfo.source || null,
      visit: refreshedVisit,
    };
  }
}

export { normalizeDob as normalizeAllianzDob, pickExistingDob as pickExistingAllianzDob };
