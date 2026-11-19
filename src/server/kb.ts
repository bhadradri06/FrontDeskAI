import type { DatabaseSync } from 'node:sqlite';
import type {
  ApprovedKnowledgeBase,
  ClinicPolicy,
  ClinicSettings,
  DentalService,
  Doctor,
  InsuranceProvider,
  ServicePricing,
} from './types.ts';
import { getNowIso } from './time.ts';

export function isFilled(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const upper = trimmed.toUpperCase();
  if (upper === 'FILL IN' || upper.startsWith('FILL IN,') || upper.startsWith('FILL IN ')) {
    // Special case: "FILL IN Dental Clinic" or "FILL IN, Banjara Hills, Hyderabad" are placeholders
    return false;
  }
  return true;
}

export function getClinicSettings(db: DatabaseSync): ClinicSettings {
  const row = db.prepare('SELECT * FROM clinic_settings WHERE id = 1').get() as Record<string, unknown>;
  return {
    id: Number(row.id),
    clinic_name: String(row.clinic_name),
    address: String(row.address),
    maps_link: String(row.maps_link),
    phone: String(row.phone),
    whatsapp: String(row.whatsapp),
    email: String(row.email),
    emergency_phone: String(row.emergency_phone),
    working_days: JSON.parse(String(row.working_days_json || '[]')) as string[],
    opening_time: String(row.opening_time),
    closing_time: String(row.closing_time),
    holidays: JSON.parse(String(row.holidays_json || '[]')) as string[],
    retention_days: Number(row.retention_days ?? 90),
    kb_version: Number(row.kb_version ?? 1),
    updated_by: String(row.updated_by ?? 'System'),
    updated_at: String(row.updated_at),
  };
}

export function getFullKnowledgeBaseRaw(db: DatabaseSync): ApprovedKnowledgeBase {
  const settings = getClinicSettings(db);

  const doctors = (db.prepare('SELECT * FROM doctors ORDER BY id ASC').all() as Array<Record<string, unknown>>).map(
    (r): Doctor => ({
      id: Number(r.id),
      name: String(r.name),
      qualifications: String(r.qualifications),
      specialisation: String(r.specialisation),
      experience: String(r.experience),
      available_days: String(r.available_days),
      consultation_hours: String(r.consultation_hours),
      is_active: Boolean(r.is_active),
      updated_at: String(r.updated_at),
    })
  );

  const services = (db.prepare('SELECT * FROM services ORDER BY id ASC').all() as Array<Record<string, unknown>>).map(
    (r): DentalService => ({
      id: Number(r.id),
      name: String(r.name),
      category: String(r.category),
      description: String(r.description),
      duration_mins: r.duration_mins === null ? null : Number(r.duration_mins),
      is_active: Boolean(r.is_active),
      updated_at: String(r.updated_at),
    })
  );

  const pricing = (db.prepare('SELECT * FROM pricing ORDER BY id ASC').all() as Array<Record<string, unknown>>).map(
    (r): ServicePricing => ({
      id: Number(r.id),
      service_id: r.service_id === null ? null : Number(r.service_id),
      service_name: String(r.service_name),
      consultation_fee: String(r.consultation_fee),
      treatment_price_range: String(r.treatment_price_range),
      additional_charges: String(r.additional_charges),
      last_updated: String(r.last_updated),
      updated_by: String(r.updated_by),
    })
  );

  const insurance = (
    db.prepare('SELECT * FROM insurance_providers ORDER BY id ASC').all() as Array<Record<string, unknown>>
  ).map(
    (r): InsuranceProvider => ({
      id: Number(r.id),
      provider_name: String(r.provider_name),
      cashless_available: Boolean(r.cashless_available),
      reimbursement_policy: String(r.reimbursement_policy),
      required_documents: String(r.required_documents),
      is_active: Boolean(r.is_active),
      updated_at: String(r.updated_at),
    })
  );

  const policies = (
    db.prepare('SELECT * FROM clinic_policies ORDER BY id ASC').all() as Array<Record<string, unknown>>
  ).map(
    (r): ClinicPolicy => ({
      id: Number(r.id),
      policy_type: String(r.policy_type),
      title: String(r.title),
      content: String(r.content),
      updated_by: String(r.updated_by),
      updated_at: String(r.updated_at),
    })
  );

  const missingChecklist: Array<{ section: string; field: string; currentValue: string }> = [];

  const checkSetting = (field: string, value: string) => {
    if (!isFilled(value)) {
      missingChecklist.push({ section: 'Clinic Information', field, currentValue: value });
    }
  };
  checkSetting('Clinic Name', settings.clinic_name);
  checkSetting('Full Address', settings.address);
  checkSetting('Google Maps Link', settings.maps_link);
  checkSetting('Phone Number', settings.phone);
  checkSetting('WhatsApp Number', settings.whatsapp);
  checkSetting('Email Address', settings.email);
  checkSetting('Emergency Contact Phone', settings.emergency_phone);
  checkSetting('Opening Time', settings.opening_time);
  checkSetting('Closing Time', settings.closing_time);

  if (doctors.filter((d) => d.is_active && isFilled(d.name)).length === 0) {
    missingChecklist.push({
      section: 'Doctors',
      field: 'Active clinic doctors list',
      currentValue: 'No approved doctors added yet',
    });
  }

  for (const p of pricing) {
    if (!isFilled(p.consultation_fee) && !isFilled(p.treatment_price_range)) {
      missingChecklist.push({
        section: 'Pricing',
        field: `${p.service_name} fee / price range`,
        currentValue: 'FILL IN',
      });
    }
  }

  if (insurance.filter((i) => i.is_active && isFilled(i.provider_name)).length === 0) {
    missingChecklist.push({
      section: 'Insurance',
      field: 'Accepted insurance providers',
      currentValue: 'No approved insurance providers added yet',
    });
  }

  for (const pol of policies) {
    if (!isFilled(pol.content)) {
      missingChecklist.push({
        section: 'Clinic Policies',
        field: pol.title,
        currentValue: pol.content,
      });
    }
  }

  return { settings, doctors, services, pricing, insurance, policies, missingChecklist };
}

/**
 * Returns ONLY verified, non-placeholder clinic knowledge for the AI & Fallback engines.
 */
export function getApprovedKnowledgeBase(db: DatabaseSync): ApprovedKnowledgeBase {
  const raw = getFullKnowledgeBaseRaw(db);
  return {
    settings: raw.settings,
    doctors: raw.doctors.filter((d) => d.is_active && isFilled(d.name)),
    services: raw.services.filter((s) => s.is_active && isFilled(s.name)),
    pricing: raw.pricing.filter(
      (p) => isFilled(p.consultation_fee) || isFilled(p.treatment_price_range) || isFilled(p.additional_charges)
    ),
    insurance: raw.insurance.filter((i) => i.is_active && isFilled(i.provider_name)),
    policies: raw.policies.filter((p) => isFilled(p.content)),
    missingChecklist: raw.missingChecklist,
  };
}

export function invalidateKbCache(db: DatabaseSync, updatedBy: string): number {
  const now = getNowIso();
  db.prepare('UPDATE clinic_settings SET kb_version = kb_version + 1, updated_by = ?, updated_at = ? WHERE id = 1').run(
    updatedBy,
    now
  );
  db.prepare('DELETE FROM response_cache').run();
  const row = db.prepare('SELECT kb_version FROM clinic_settings WHERE id = 1').get() as { kb_version: number };
  return Number(row.kb_version);
}

export function recordAuditLog(
  db: DatabaseSync,
  params: {
    staffId: number | null;
    staffName: string;
    action: string;
    entityType: string;
    entityId: string;
    oldValue?: unknown;
    newValue?: unknown;
  }
): void {
  db.prepare(`
    INSERT INTO audit_logs (staff_id, staff_name, action, entity_type, entity_id, old_value_json, new_value_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.staffId,
    params.staffName,
    params.action,
    params.entityType,
    params.entityId,
    params.oldValue !== undefined ? JSON.stringify(params.oldValue) : null,
    params.newValue !== undefined ? JSON.stringify(params.newValue) : null,
    getNowIso()
  );
}
