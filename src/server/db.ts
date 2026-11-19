import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './security.ts';
import { getNowIso } from './time.ts';

let singletonDb: DatabaseSync | null = null;

interface SampleClinicJson {
  clinic: {
    name: string;
    address: string;
    landmark: string;
    phone: string;
    emergency_phone: string;
    whatsapp: string;
    parking: string;
  };
  hours: {
    monday_to_saturday: string;
    sunday: string;
    lunch_break: string;
    public_holidays: string;
  };
  doctors: Array<{ name: string; role: string; days: string }>;
  services: Array<{ name: string; price: string; note?: string; duration?: string }>;
  policies: Record<string, string>;
}

function loadSampleClinicJson(): SampleClinicJson | null {
  try {
    const filePath = path.resolve(process.cwd(), 'public/assets/aistudio/clinic-data_0a03ecbd.json');
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SampleClinicJson;
    }
  } catch {
    // ignore if unavailable
  }
  return null;
}

export function createDatabase(dbPath: string = process.env.DB_PATH || './frontdesk.db'): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  initSchema(db);
  seedDefaults(db);
  return db;
}

export function getDb(): DatabaseSync {
  if (!singletonDb) {
    singletonDb = createDatabase();
  }
  return singletonDb;
}

export function setDbForTesting(db: DatabaseSync | null): void {
  singletonDb = db;
}

export function runInTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clinic_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      clinic_name TEXT NOT NULL DEFAULT 'FILL IN Dental Clinic',
      address TEXT NOT NULL DEFAULT 'FILL IN, Banjara Hills, Hyderabad',
      landmark TEXT NOT NULL DEFAULT 'FILL IN',
      maps_link TEXT NOT NULL DEFAULT 'FILL IN',
      phone TEXT NOT NULL DEFAULT 'FILL IN',
      whatsapp TEXT NOT NULL DEFAULT 'FILL IN',
      email TEXT NOT NULL DEFAULT 'FILL IN',
      emergency_phone TEXT NOT NULL DEFAULT 'FILL IN',
      parking TEXT NOT NULL DEFAULT 'FILL IN',
      working_days_json TEXT NOT NULL DEFAULT '["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]',
      opening_time TEXT NOT NULL DEFAULT 'FILL IN',
      closing_time TEXT NOT NULL DEFAULT 'FILL IN',
      sunday_hours TEXT NOT NULL DEFAULT 'FILL IN',
      lunch_break TEXT NOT NULL DEFAULT 'FILL IN',
      public_holiday_note TEXT NOT NULL DEFAULT 'FILL IN',
      holidays_json TEXT NOT NULL DEFAULT '[]',
      retention_days INTEGER NOT NULL DEFAULT 90,
      kb_version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT NOT NULL DEFAULT 'System',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      qualifications TEXT NOT NULL DEFAULT 'FILL IN',
      specialisation TEXT NOT NULL DEFAULT 'FILL IN',
      experience TEXT NOT NULL DEFAULT 'FILL IN',
      available_days TEXT NOT NULL DEFAULT 'FILL IN',
      consultation_hours TEXT NOT NULL DEFAULT 'FILL IN',
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'General Dentistry',
      description TEXT NOT NULL DEFAULT 'FILL IN',
      duration_mins INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      service_name TEXT NOT NULL UNIQUE,
      consultation_fee TEXT NOT NULL DEFAULT 'FILL IN',
      treatment_price_range TEXT NOT NULL DEFAULT 'FILL IN',
      additional_charges TEXT NOT NULL DEFAULT 'FILL IN',
      last_updated TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT 'System'
    );

    CREATE TABLE IF NOT EXISTS insurance_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_name TEXT NOT NULL UNIQUE,
      cashless_available INTEGER NOT NULL DEFAULT 0,
      reimbursement_policy TEXT NOT NULL DEFAULT 'FILL IN',
      required_documents TEXT NOT NULL DEFAULT 'FILL IN',
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clinic_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_type TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT 'FILL IN',
      updated_by TEXT NOT NULL DEFAULT 'System',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'Guest Patient',
      phone TEXT,
      preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'hi', 'te')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      channel TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'whatsapp')),
      external_id TEXT,
      language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi', 'te')),
      handover_active INTEGER NOT NULL DEFAULT 0,
      booking_state_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('patient', 'ai', 'fallback', 'staff', 'system')),
      sender_name TEXT,
      body TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi', 'te')),
      source_label TEXT,
      is_emergency INTEGER NOT NULL DEFAULT 0,
      kb_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staff_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'receptionist')),
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staff_sessions (
      token TEXT PRIMARY KEY,
      staff_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_code TEXT NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      original_question TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN (
        'Missing clinic information',
        'Pricing enquiry',
        'Doctor enquiry',
        'Appointment request',
        'Medical symptoms',
        'Emergency',
        'Insurance enquiry',
        'Other'
      )),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
        'OPEN',
        'NEEDS_HUMAN',
        'URGENT',
        'IN_PROGRESS',
        'RESOLVED',
        'CLOSED'
      )),
      priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('URGENT', 'HIGH', 'MEDIUM', 'LOW')),
      assigned_staff_id INTEGER REFERENCES staff_users(id) ON DELETE SET NULL,
      assigned_staff_name TEXT,
      appointment_date TEXT,
      appointment_time TEXT,
      staff_response TEXT,
      resolution_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
      doctor_name TEXT NOT NULL DEFAULT 'Any Available Dentist',
      preferred_date TEXT NOT NULL,
      preferred_time TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'CONFIRMED', 'CANCELLED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER REFERENCES staff_users(id) ON DELETE SET NULL,
      staff_name TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      old_value_json TEXT,
      new_value_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS response_cache (
      cache_key TEXT PRIMARY KEY,
      kb_version INTEGER NOT NULL,
      language TEXT NOT NULL,
      response_body TEXT NOT NULL,
      source_label TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_conversation ON tickets(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
    CREATE INDEX IF NOT EXISTS idx_conversations_external ON conversations(external_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id, preferred_date);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, created_at);
  `);

  // Safe migrations for pre-existing local SQLite databases
  ensureColumn(db, 'clinic_settings', 'landmark', "TEXT NOT NULL DEFAULT 'FILL IN'");
  ensureColumn(db, 'clinic_settings', 'parking', "TEXT NOT NULL DEFAULT 'FILL IN'");
  ensureColumn(db, 'clinic_settings', 'sunday_hours', "TEXT NOT NULL DEFAULT 'FILL IN'");
  ensureColumn(db, 'clinic_settings', 'lunch_break', "TEXT NOT NULL DEFAULT 'FILL IN'");
  ensureColumn(db, 'clinic_settings', 'public_holiday_note', "TEXT NOT NULL DEFAULT 'FILL IN'");
}

export function applySampleClinicData(db: DatabaseSync, updatedBy = 'Sample Data Import'): void {
  const sample = loadSampleClinicJson();
  if (!sample) return;
  const now = getNowIso();

  runInTransaction(db, () => {
    db.prepare(`
      UPDATE clinic_settings
      SET clinic_name = ?,
          address = ?,
          landmark = ?,
          phone = ?,
          whatsapp = ?,
          emergency_phone = ?,
          parking = ?,
          working_days_json = '["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]',
          opening_time = '9:00 am',
          closing_time = '8:00 pm',
          sunday_hours = ?,
          lunch_break = ?,
          public_holiday_note = ?,
          kb_version = kb_version + 1,
          updated_by = ?,
          updated_at = ?
      WHERE id = 1
    `).run(
      sample.clinic.name,
      sample.clinic.address,
      sample.clinic.landmark,
      sample.clinic.phone,
      sample.clinic.whatsapp,
      sample.clinic.emergency_phone,
      sample.clinic.parking,
      sample.hours.sunday,
      sample.hours.lunch_break,
      sample.hours.public_holidays,
      updatedBy,
      now
    );

    db.prepare('DELETE FROM doctors').run();
    const insertDoc = db.prepare(`
      INSERT INTO doctors (name, qualifications, specialisation, experience, available_days, consultation_hours, is_active, updated_at)
      VALUES (?, 'FILL IN', ?, 'FILL IN', ?, '9:00 am - 8:00 pm', 1, ?)
    `);
    for (const d of sample.doctors) {
      insertDoc.run(d.name, d.role, d.days, now);
    }

    db.prepare('DELETE FROM pricing').run();
    db.prepare('DELETE FROM services').run();
    const insertService = db.prepare(
      'INSERT INTO services (name, category, description, duration_mins, is_active, updated_at) VALUES (?, ?, ?, ?, 1, ?)'
    );
    const insertPricing = db.prepare(`
      INSERT INTO pricing (service_id, service_name, consultation_fee, treatment_price_range, additional_charges, last_updated, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const s of sample.services) {
      const durationMatch = s.duration ? s.duration.match(/(\d+)/) : null;
      const durationMins = durationMatch ? Number(durationMatch[1]) : null;
      const desc = [s.note, s.duration ? `Duration: ${s.duration}` : null].filter(Boolean).join(' · ') || 'Clinic dental service';
      const sInfo = insertService.run(s.name, 'Dental Care', desc, durationMins, now);
      const isConsult = s.name.toLowerCase() === 'consultation';
      insertPricing.run(
        Number(sInfo.lastInsertRowid),
        s.name,
        isConsult ? s.price : 'FILL IN',
        isConsult ? 'FILL IN' : s.price,
        s.note || (s.duration ? `Duration: ${s.duration}` : 'FILL IN'),
        now,
        updatedBy
      );
    }

    db.prepare('DELETE FROM insurance_providers').run();
    const insertIns = db.prepare(`
      INSERT INTO insurance_providers (provider_name, cashless_available, reimbursement_policy, required_documents, is_active, updated_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `);
    insertIns.run('Star Health', 1, 'Cashless facility available; for non-network plans a claimable bill is provided.', 'Insurance card and government photo ID', now);
    insertIns.run('Niva Bupa', 1, 'Cashless facility available; for non-network plans a claimable bill is provided.', 'Insurance card and government photo ID', now);

    db.prepare('DELETE FROM clinic_policies').run();
    const policyTitles: Record<string, string> = {
      appointments: 'Appointments, Cancellation & Rescheduling',
      walk_ins: 'Walk-in Policy',
      payment: 'Accepted Payment Methods',
      emi: 'EMI Facility',
      insurance: 'Insurance & Claim Billing',
      children: 'Paediatric Care Policy',
      first_visit: 'First Visit Checklist',
      sterilisation: 'Sterilisation & Safety',
    };
    const insertPol = db.prepare(
      'INSERT INTO clinic_policies (policy_type, title, content, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const [key, value] of Object.entries(sample.policies)) {
      insertPol.run(key, policyTitles[key] || key, value, updatedBy, now);
    }

    db.prepare('DELETE FROM response_cache').run();
  });
}

export function seedDefaults(db: DatabaseSync): void {
  const now = getNowIso();

  const existingSettings = db.prepare('SELECT id, clinic_name, opening_time, updated_by, kb_version FROM clinic_settings WHERE id = 1').get() as
    | { id: number; clinic_name: string; opening_time: string; updated_by: string; kb_version: number }
    | undefined;

  if (!existingSettings) {
    db.prepare(`
      INSERT INTO clinic_settings (
        id, clinic_name, address, landmark, maps_link, phone, whatsapp, email, emergency_phone, parking,
        working_days_json, opening_time, closing_time, sunday_hours, lunch_break, public_holiday_note,
        holidays_json, retention_days, kb_version, updated_by, updated_at
      ) VALUES (
        1, 'FILL IN Dental Clinic', 'FILL IN, Banjara Hills, Hyderabad', 'FILL IN', 'FILL IN',
        'FILL IN', 'FILL IN', 'FILL IN', 'FILL IN', 'FILL IN',
        '["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]',
        'FILL IN', 'FILL IN', 'FILL IN', 'FILL IN', 'FILL IN',
        '[]', 90, 1, 'System', ?
      )
    `).run(now);
    applySampleClinicData(db, 'Bright Roots Dental Sample');
  } else if (
    (existingSettings.clinic_name === 'FILL IN Dental Clinic' && existingSettings.kb_version === 1) ||
    (existingSettings.updated_by === 'Bright Roots Dental Sample' && existingSettings.opening_time === '09:00 AM')
  ) {
    // Upgrade untouched placeholder/sample DB to match exact sample formatting
    applySampleClinicData(db, 'Bright Roots Dental Sample');
  }

  const staffCount = db.prepare('SELECT COUNT(*) AS cnt FROM staff_users').get() as { cnt: number };
  if (staffCount.cnt === 0) {
    const adminPass = process.env.DEFAULT_ADMIN_PASSWORD || 'ClinicAdmin@2026';
    const recepPass = process.env.DEFAULT_RECEP_PASSWORD || 'FrontDesk@2026';
    const insertStaff = db.prepare(`
      INSERT INTO staff_users (username, email, full_name, role, password_hash, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    insertStaff.run('admin', 'admin@frontdesk-clinic.in', 'Clinic Administrator', 'admin', hashPassword(adminPass), now);
    insertStaff.run('reception', 'reception@frontdesk-clinic.in', 'Front Desk Receptionist', 'receptionist', hashPassword(recepPass), now);
  }
}
