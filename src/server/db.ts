import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './security.ts';
import { getNowIso } from './time.ts';

let singletonDb: DatabaseSync | null = null;

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

export function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clinic_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      clinic_name TEXT NOT NULL DEFAULT 'FILL IN Dental Clinic',
      address TEXT NOT NULL DEFAULT 'FILL IN, Banjara Hills, Hyderabad',
      maps_link TEXT NOT NULL DEFAULT 'FILL IN',
      phone TEXT NOT NULL DEFAULT 'FILL IN',
      whatsapp TEXT NOT NULL DEFAULT 'FILL IN',
      email TEXT NOT NULL DEFAULT 'FILL IN',
      emergency_phone TEXT NOT NULL DEFAULT 'FILL IN',
      working_days_json TEXT NOT NULL DEFAULT '["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]',
      opening_time TEXT NOT NULL DEFAULT 'FILL IN',
      closing_time TEXT NOT NULL DEFAULT 'FILL IN',
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
}

export function seedDefaults(db: DatabaseSync): void {
  const now = getNowIso();

  const existingSettings = db.prepare('SELECT id FROM clinic_settings WHERE id = 1').get();
  if (!existingSettings) {
    db.prepare(`
      INSERT INTO clinic_settings (
        id, clinic_name, address, maps_link, phone, whatsapp, email, emergency_phone,
        working_days_json, opening_time, closing_time, holidays_json, retention_days, kb_version, updated_by, updated_at
      ) VALUES (
        1, 'FILL IN Dental Clinic', 'FILL IN, Banjara Hills, Hyderabad', 'FILL IN',
        'FILL IN', 'FILL IN', 'FILL IN', 'FILL IN',
        '["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]',
        'FILL IN', 'FILL IN', '[]', 90, 1, 'System', ?
      )
    `).run(now);
  }

  const serviceCount = db.prepare('SELECT COUNT(*) AS cnt FROM services').get() as { cnt: number };
  if (serviceCount.cnt === 0) {
    const defaultServices: Array<[string, string, string]> = [
      ['Dental consultation', 'Consultation', 'Comprehensive oral check-up and treatment planning'],
      ['Teeth cleaning', 'Preventive', 'Ultrasonic scaling and polishing'],
      ['Root canal treatment', 'Endodontics', 'Root canal therapy for infected or damaged teeth'],
      ['Dental implants', 'Implantology', 'Tooth replacement with dental implants'],
      ['Teeth whitening', 'Cosmetic', 'In-clinic or guided teeth brightening'],
      ['Braces', 'Orthodontics', 'Orthodontic alignment and braces'],
      ['Tooth extraction', 'Oral Surgery', 'Simple and surgical tooth removal'],
      ['Other treatments', 'General Dentistry', 'Additional dental care procedures'],
    ];
    const insertService = db.prepare(
      'INSERT INTO services (name, category, description, is_active, updated_at) VALUES (?, ?, ?, 1, ?)'
    );
    const insertPricing = db.prepare(`
      INSERT INTO pricing (service_id, service_name, consultation_fee, treatment_price_range, additional_charges, last_updated, updated_by)
      VALUES (?, ?, 'FILL IN', 'FILL IN', 'FILL IN', ?, 'System')
    `);
    for (const [name, category, desc] of defaultServices) {
      const info = insertService.run(name, category, desc, now);
      insertPricing.run(Number(info.lastInsertRowid), name, now);
    }
  }

  const policyCount = db.prepare('SELECT COUNT(*) AS cnt FROM clinic_policies').get() as { cnt: number };
  if (policyCount.cnt === 0) {
    const policies: Array<[string, string, string]> = [
      ['appointment_cancellation', 'Appointment Cancellation Policy', 'FILL IN'],
      ['rescheduling', 'Appointment Rescheduling Policy', 'FILL IN'],
      ['late_arrival', 'Late Arrival Policy', 'FILL IN'],
      ['payment_methods', 'Accepted Payment Methods', 'FILL IN'],
      ['refund_policy', 'Refund Policy', 'FILL IN'],
      ['follow_up_consultation', 'Follow-up Consultation Policy', 'FILL IN'],
    ];
    const insertPolicy = db.prepare(
      'INSERT INTO clinic_policies (policy_type, title, content, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const [type, title, content] of policies) {
      insertPolicy.run(type, title, content, 'System', now);
    }
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
