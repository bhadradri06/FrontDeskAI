import type { DatabaseSync } from 'node:sqlite';
import { getClinicSettings, recordAuditLog } from './kb.ts';
import {
  calculateWorkingMinutesElapsed,
  formatCalendarAge,
  formatIstDateTime,
  getNow,
  getNowIso,
  isTicketOverdue,
} from './time.ts';
import type {
  TicketCategory,
  TicketPriority,
  TicketRecord,
  TicketStatus,
} from './types.ts';

function generateNextTicketCode(db: DatabaseSync): string {
  const row = db.prepare('SELECT MAX(id) AS max_id FROM tickets').get() as { max_id: number | null };
  const nextNum = 1001 + Number(row.max_id ?? 0);
  return `FD-${nextNum}`;
}

export function createTicket(
  db: DatabaseSync,
  params: {
    patientId: number;
    conversationId: number;
    originalQuestion: string;
    category: TicketCategory;
    status: TicketStatus;
    priority: TicketPriority;
    appointmentDate?: string | null;
    appointmentTime?: string | null;
  }
): TicketRecord {
  const now = getNowIso();
  const code = generateNextTicketCode(db);

  const info = db.prepare(`
    INSERT INTO tickets (
      ticket_code, patient_id, conversation_id, original_question,
      category, status, priority, appointment_date, appointment_time,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    code,
    params.patientId,
    params.conversationId,
    params.originalQuestion,
    params.category,
    params.status,
    params.priority,
    params.appointmentDate ?? null,
    params.appointmentTime ?? null,
    now,
    now
  );

  if (params.status === 'URGENT' || params.status === 'NEEDS_HUMAN') {
    db.prepare('UPDATE conversations SET handover_active = 1, updated_at = ? WHERE id = ?').run(
      now,
      params.conversationId
    );
  }

  return getTicketById(db, Number(info.lastInsertRowid))!;
}

function mapTicketRow(db: DatabaseSync, row: Record<string, unknown>): TicketRecord {
  const settings = getClinicSettings(db);
  const now = getNow();
  const createdAt = String(row.created_at);
  const updatedAt = String(row.updated_at);
  const status = String(row.status) as TicketStatus;
  const workingMinutesElapsed = calculateWorkingMinutesElapsed(createdAt, settings, now);

  return {
    id: Number(row.id),
    ticket_code: String(row.ticket_code),
    patient_id: Number(row.patient_id),
    patient_name: String(row.patient_name || 'Guest Patient'),
    patient_phone: row.patient_phone ? String(row.patient_phone) : null,
    conversation_id: Number(row.conversation_id),
    original_question: String(row.original_question),
    category: String(row.category) as TicketCategory,
    status,
    priority: String(row.priority) as TicketPriority,
    assigned_staff_id: row.assigned_staff_id === null ? null : Number(row.assigned_staff_id),
    assigned_staff_name: row.assigned_staff_name ? String(row.assigned_staff_name) : null,
    appointment_date: row.appointment_date ? String(row.appointment_date) : null,
    appointment_time: row.appointment_time ? String(row.appointment_time) : null,
    staff_response: row.staff_response ? String(row.staff_response) : null,
    resolution_notes: row.resolution_notes ? String(row.resolution_notes) : null,
    created_at: createdAt,
    updated_at: updatedAt,
    created_at_ist: formatIstDateTime(createdAt),
    updated_at_ist: formatIstDateTime(updatedAt),
    age_label: formatCalendarAge(createdAt, now),
    working_minutes_elapsed: workingMinutesElapsed,
    is_overdue: isTicketOverdue(status, workingMinutesElapsed, 120),
  };
}

export function getTicketById(db: DatabaseSync, ticketId: number): TicketRecord | null {
  const row = db
    .prepare(`
      SELECT t.*, p.name AS patient_name, p.phone AS patient_phone
      FROM tickets t
      JOIN patients p ON p.id = t.patient_id
      WHERE t.id = ?
    `)
    .get(ticketId) as Record<string, unknown> | undefined;
  return row ? mapTicketRow(db, row) : null;
}

export function listTickets(
  db: DatabaseSync,
  filters?: {
    filter?: string;
    search?: string;
  }
): {
  tickets: TicketRecord[];
  stats: {
    total: number;
    open: number;
    urgent: number;
    needsHuman: number;
    inProgress: number;
    resolved: number;
    overdue: number;
  };
} {
  const rows = db
    .prepare(`
      SELECT t.*, p.name AS patient_name, p.phone AS patient_phone
      FROM tickets t
      JOIN patients p ON p.id = t.patient_id
      ORDER BY
        CASE t.priority
          WHEN 'URGENT' THEN 1
          WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3
          ELSE 4
        END ASC,
        t.created_at DESC
    `)
    .all() as Array<Record<string, unknown>>;

  const allTickets = rows.map((r) => mapTicketRow(db, r));

  const stats = {
    total: allTickets.length,
    open: allTickets.filter((t) => t.status === 'OPEN').length,
    urgent: allTickets.filter((t) => t.status === 'URGENT' || t.priority === 'URGENT').length,
    needsHuman: allTickets.filter((t) => t.status === 'NEEDS_HUMAN').length,
    inProgress: allTickets.filter((t) => t.status === 'IN_PROGRESS').length,
    resolved: allTickets.filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED').length,
    overdue: allTickets.filter((t) => t.is_overdue).length,
  };

  let filtered = allTickets;
  const f = (filters?.filter || 'all').toLowerCase();
  if (f === 'urgent') {
    filtered = filtered.filter((t) => t.status === 'URGENT' || t.priority === 'URGENT');
  } else if (f === 'needs_human') {
    filtered = filtered.filter((t) => t.status === 'NEEDS_HUMAN');
  } else if (f === 'appointments') {
    filtered = filtered.filter((t) => t.category === 'Appointment request');
  } else if (f === 'open') {
    filtered = filtered.filter((t) => t.status === 'OPEN');
  } else if (f === 'in_progress') {
    filtered = filtered.filter((t) => t.status === 'IN_PROGRESS');
  } else if (f === 'resolved') {
    filtered = filtered.filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED');
  } else if (f === 'overdue') {
    filtered = filtered.filter((t) => t.is_overdue);
  }

  const q = (filters?.search || '').trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (t) =>
        t.ticket_code.toLowerCase().includes(q) ||
        t.patient_name.toLowerCase().includes(q) ||
        (t.patient_phone && t.patient_phone.toLowerCase().includes(q)) ||
        t.original_question.toLowerCase().includes(q)
    );
  }

  return { tickets: filtered, stats };
}

export function addStaffReplyToTicket(
  db: DatabaseSync,
  params: {
    ticketId: number;
    staffId: number;
    staffName: string;
    messageBody: string;
    newStatus?: TicketStatus;
  }
) {
  const ticket = getTicketById(db, params.ticketId);
  if (!ticket) {
    throw new Error('Ticket not found');
  }
  const now = getNowIso();
  const convRow = db.prepare('SELECT language FROM conversations WHERE id = ?').get(ticket.conversation_id) as
    | { language: string }
    | undefined;
  const lang = convRow?.language || 'en';
  const kbVersion = getClinicSettings(db).kb_version;

  const insertMsg = db.prepare(`
    INSERT INTO messages (
      conversation_id, sender_type, sender_name, body, language, source_label, is_emergency, kb_version, created_at
    ) VALUES (?, 'staff', ?, ?, ?, 'Reply from clinic staff', 0, ?, ?)
  `);
  const msgInfo = insertMsg.run(
    ticket.conversation_id,
    params.staffName,
    params.messageBody,
    lang,
    kbVersion,
    now
  );

  const nextStatus: TicketStatus =
    params.newStatus ||
    (ticket.status === 'OPEN' || ticket.status === 'NEEDS_HUMAN' || ticket.status === 'URGENT'
      ? 'IN_PROGRESS'
      : ticket.status);

  db.prepare(`
    UPDATE tickets
    SET staff_response = ?,
        status = ?,
        assigned_staff_id = COALESCE(assigned_staff_id, ?),
        assigned_staff_name = COALESCE(assigned_staff_name, ?),
        updated_at = ?
    WHERE id = ?
  `).run(params.messageBody, nextStatus, params.staffId, params.staffName, now, params.ticketId);

  db.prepare('UPDATE conversations SET handover_active = 1, updated_at = ? WHERE id = ?').run(
    now,
    ticket.conversation_id
  );

  recordAuditLog(db, {
    staffId: params.staffId,
    staffName: params.staffName,
    action: 'STAFF_REPLY',
    entityType: 'ticket',
    entityId: ticket.ticket_code,
    newValue: { message: params.messageBody, status: nextStatus },
  });

  const savedMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(msgInfo.lastInsertRowid)) as Record<
    string,
    unknown
  >;

  return {
    ticket: getTicketById(db, params.ticketId)!,
    message: {
      id: Number(savedMsg.id),
      conversation_id: Number(savedMsg.conversation_id),
      sender_type: String(savedMsg.sender_type),
      sender_name: savedMsg.sender_name ? String(savedMsg.sender_name) : null,
      body: String(savedMsg.body),
      language: String(savedMsg.language),
      source_label: savedMsg.source_label ? String(savedMsg.source_label) : null,
      is_emergency: Boolean(savedMsg.is_emergency),
      kb_version: Number(savedMsg.kb_version),
      created_at: String(savedMsg.created_at),
      created_at_ist: formatIstDateTime(String(savedMsg.created_at)),
    },
  };
}

export function updateTicketMetadata(
  db: DatabaseSync,
  params: {
    ticketId: number;
    staffId: number;
    staffName: string;
    status?: TicketStatus;
    assignedStaffId?: number | null;
    assignedStaffName?: string | null;
    resolutionNotes?: string | null;
  }
): TicketRecord {
  const existing = getTicketById(db, params.ticketId);
  if (!existing) {
    throw new Error('Ticket not found');
  }
  const now = getNowIso();
  const nextStatus = params.status ?? existing.status;
  const nextAssignedId =
    params.assignedStaffId !== undefined ? params.assignedStaffId : existing.assigned_staff_id;
  const nextAssignedName =
    params.assignedStaffName !== undefined ? params.assignedStaffName : existing.assigned_staff_name;
  const nextNotes =
    params.resolutionNotes !== undefined ? params.resolutionNotes : existing.resolution_notes;

  db.prepare(`
    UPDATE tickets
    SET status = ?,
        assigned_staff_id = ?,
        assigned_staff_name = ?,
        resolution_notes = ?,
        updated_at = ?
    WHERE id = ?
  `).run(nextStatus, nextAssignedId, nextAssignedName, nextNotes, now, params.ticketId);

  recordAuditLog(db, {
    staffId: params.staffId,
    staffName: params.staffName,
    action: 'UPDATE_TICKET',
    entityType: 'ticket',
    entityId: existing.ticket_code,
    oldValue: {
      status: existing.status,
      assigned_staff_name: existing.assigned_staff_name,
      resolution_notes: existing.resolution_notes,
    },
    newValue: {
      status: nextStatus,
      assigned_staff_name: nextAssignedName,
      resolution_notes: nextNotes,
    },
  });

  return getTicketById(db, params.ticketId)!;
}
