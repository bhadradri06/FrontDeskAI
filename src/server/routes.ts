import express, { type Request, type Response, type NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { getConversationMessages, processPatientMessage, submitAppointmentRequest } from './chatProcessor.ts';
import {
  getApprovedKnowledgeBase,
  getClinicSettings,
  getFullKnowledgeBaseRaw,
  invalidateKbCache,
  isFilled,
  recordAuditLog,
} from './kb.ts';
import { createRateLimiter, generateSessionToken, sanitizeText, verifyPassword } from './security.ts';
import {
  addStaffReplyToTicket,
  getTicketById,
  listTickets,
  updateTicketMetadata,
} from './tickets.ts';
import { formatIstDateTime, getNow, getNowIso } from './time.ts';
import type { StaffUser, TicketStatus } from './types.ts';
import { realtimeHub } from './ws.ts';

interface StaffRequest extends Request {
  staffUser?: StaffUser;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return out;
}

function extractSessionToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies.fd_session || null;
}

export function createApiRouter(db: DatabaseSync) {
  const router = express.Router();

  const chatLimiter = createRateLimiter(60_000, 45);
  const loginLimiter = createRateLimiter(60_000, 15);

  function requireStaff(req: StaffRequest, res: Response, next: NextFunction) {
    const token = extractSessionToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const row = db
      .prepare(`
        SELECT s.token, s.expires_at, u.id, u.username, u.email, u.full_name, u.role, u.is_active, u.created_at
        FROM staff_sessions s
        JOIN staff_users u ON u.id = s.staff_id
        WHERE s.token = ?
      `)
      .get(token) as Record<string, unknown> | undefined;

    if (!row || !row.is_active) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    if (new Date(String(row.expires_at)).getTime() <= getNow().getTime()) {
      db.prepare('DELETE FROM staff_sessions WHERE token = ?').run(token);
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }

    req.staffUser = {
      id: Number(row.id),
      username: String(row.username),
      email: String(row.email),
      full_name: String(row.full_name),
      role: String(row.role) as StaffUser['role'],
      is_active: Boolean(row.is_active),
      created_at: String(row.created_at),
    };
    return next();
  }

  function requireAdmin(req: StaffRequest, res: Response, next: NextFunction) {
    if (!req.staffUser || req.staffUser.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator permission required' });
    }
    return next();
  }

  // ---- PUBLIC PATIENT ROUTES ----

  router.get('/clinic/public', (_req, res) => {
    const kb = getApprovedKnowledgeBase(db);
    const s = kb.settings;
    res.json({
      clinic_name: s.clinic_name,
      has_verified_name: isFilled(s.clinic_name),
      address: isFilled(s.address) ? s.address : null,
      maps_link: isFilled(s.maps_link) ? s.maps_link : null,
      phone: isFilled(s.phone) ? s.phone : null,
      whatsapp: isFilled(s.whatsapp) ? s.whatsapp : null,
      emergency_phone: isFilled(s.emergency_phone) ? s.emergency_phone : null,
      opening_time: isFilled(s.opening_time) ? s.opening_time : null,
      closing_time: isFilled(s.closing_time) ? s.closing_time : null,
      working_days: s.working_days,
      doctors: kb.doctors.map((d) => ({
        id: d.id,
        name: d.name,
        specialisation: isFilled(d.specialisation) ? d.specialisation : null,
      })),
      services: kb.services.map((sv) => sv.name),
      kb_version: s.kb_version,
    });
  });

  router.post('/chat', chatLimiter, async (req, res) => {
    try {
      const { conversationId, patientName, patientPhone, message, preferredLanguage } = req.body || {};
      const result = await processPatientMessage(db, {
        conversationId: typeof conversationId === 'number' ? conversationId : null,
        channel: 'web',
        patientName,
        patientPhone,
        message,
        preferredLanguage,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to process message';
      res.status(400).json({ error: msg });
    }
  });

  router.get('/conversations/:id/messages', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid conversation ID' });
    }
    const data = getConversationMessages(db, id);
    if (!data.conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    return res.json(data);
  });

  router.post('/appointments/request', chatLimiter, (req, res) => {
    try {
      const {
        conversationId,
        patientName,
        patientPhone,
        preferredDoctor,
        preferredDate,
        preferredTime,
        reason,
        language,
      } = req.body || {};
      const result = submitAppointmentRequest(db, {
        conversationId: typeof conversationId === 'number' ? conversationId : null,
        patientName,
        patientPhone,
        preferredDoctor,
        preferredDate,
        preferredTime,
        reason,
        language,
      });
      res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to submit appointment request';
      res.status(400).json({ error: msg });
    }
  });

  // WhatsApp-ready webhook endpoint (reuses central chatProcessor)
  router.post('/webhooks/whatsapp', chatLimiter, async (req, res) => {
    try {
      const { fromPhone, profileName, messageBody, messageId } = req.body || {};
      if (!fromPhone || !messageBody) {
        return res.status(400).json({ error: 'fromPhone and messageBody are required' });
      }
      const result = await processPatientMessage(db, {
        channel: 'whatsapp',
        externalId: `wa:${String(fromPhone)}`,
        patientName: sanitizeText(profileName || 'WhatsApp Patient', 80),
        patientPhone: String(fromPhone),
        message: String(messageBody),
      });
      res.json({
        whatsappConfigured: Boolean(process.env.WHATSAPP_CLOUD_API_TOKEN),
        inboundMessageId: messageId || null,
        conversationId: result.conversationId,
        replyText: result.replyMessage.body,
        ticketCode: result.ticket?.ticket_code || null,
        handoverActive: result.handoverActive,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Webhook processing error';
      res.status(400).json({ error: msg });
    }
  });

  // ---- STAFF AUTH ROUTES ----

  router.post('/staff/login', loginLimiter, (req, res) => {
    const identifier = sanitizeText(req.body?.username || req.body?.email || '', 120).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Username/email and password are required.' });
    }

    const userRow = db
      .prepare('SELECT * FROM staff_users WHERE (LOWER(username) = ? OR LOWER(email) = ?) AND is_active = 1')
      .get(identifier, identifier) as Record<string, unknown> | undefined;

    if (!userRow || !verifyPassword(password, String(userRow.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = generateSessionToken();
    const now = getNow();
    const expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO staff_sessions (token, staff_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
      token,
      Number(userRow.id),
      expiresAt,
      now.toISOString()
    );

    const staffUser: StaffUser = {
      id: Number(userRow.id),
      username: String(userRow.username),
      email: String(userRow.email),
      full_name: String(userRow.full_name),
      role: String(userRow.role) as StaffUser['role'],
      is_active: Boolean(userRow.is_active),
      created_at: String(userRow.created_at),
    };

    recordAuditLog(db, {
      staffId: staffUser.id,
      staffName: staffUser.full_name,
      action: 'STAFF_LOGIN',
      entityType: 'staff_user',
      entityId: staffUser.username,
    });

    res.setHeader('Set-Cookie', `fd_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`);
    return res.json({ token, user: staffUser });
  });

  router.post('/staff/logout', (req, res) => {
    const token = extractSessionToken(req);
    if (token) {
      db.prepare('DELETE FROM staff_sessions WHERE token = ?').run(token);
    }
    res.setHeader('Set-Cookie', 'fd_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  });

  router.get('/staff/me', requireStaff, (req: StaffRequest, res) => {
    res.json({ user: req.staffUser });
  });

  // ---- PROTECTED STAFF TICKET ROUTES ----

  router.get('/staff/users', requireStaff, (_req, res) => {
    const rows = db
      .prepare('SELECT id, username, email, full_name, role, is_active, created_at FROM staff_users WHERE is_active = 1')
      .all();
    res.json({ users: rows });
  });

  router.get('/staff/tickets', requireStaff, (req, res) => {
    const filter = typeof req.query.filter === 'string' ? req.query.filter : 'all';
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    res.json(listTickets(db, { filter, search }));
  });

  router.get('/staff/tickets/:id', requireStaff, (req, res) => {
    const ticketId = Number(req.params.id);
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      return res.status(400).json({ error: 'Invalid ticket ID' });
    }
    const ticket = getTicketById(db, ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    const conversation = getConversationMessages(db, ticket.conversation_id);
    const appointment = db
      .prepare('SELECT * FROM appointments WHERE ticket_id = ? ORDER BY id DESC LIMIT 1')
      .get(ticket.id);
    return res.json({ ticket, messages: conversation.messages, appointment: appointment || null });
  });

  router.post('/staff/tickets/:id/reply', requireStaff, (req: StaffRequest, res) => {
    const ticketId = Number(req.params.id);
    const body = sanitizeText(req.body?.message, 2000);
    const newStatus = req.body?.status as TicketStatus | undefined;
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      return res.status(400).json({ error: 'Invalid ticket ID' });
    }
    if (!body) {
      return res.status(400).json({ error: 'Reply message cannot be empty.' });
    }

    try {
      const result = addStaffReplyToTicket(db, {
        ticketId,
        staffId: req.staffUser!.id,
        staffName: req.staffUser!.full_name,
        messageBody: body,
        newStatus,
      });
      realtimeHub.broadcastTicketUpdate(result.ticket);
      return res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save reply';
      return res.status(404).json({ error: msg });
    }
  });

  router.patch('/staff/tickets/:id', requireStaff, (req: StaffRequest, res) => {
    const ticketId = Number(req.params.id);
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      return res.status(400).json({ error: 'Invalid ticket ID' });
    }
    const { status, assignedStaffId, resolutionNotes } = req.body || {};

    let assignedStaffName: string | null | undefined = undefined;
    if (assignedStaffId !== undefined) {
      if (assignedStaffId === null) {
        assignedStaffName = null;
      } else {
        const staffRow = db
          .prepare('SELECT full_name FROM staff_users WHERE id = ?')
          .get(Number(assignedStaffId)) as { full_name: string } | undefined;
        assignedStaffName = staffRow ? staffRow.full_name : null;
      }
    }

    try {
      const updated = updateTicketMetadata(db, {
        ticketId,
        staffId: req.staffUser!.id,
        staffName: req.staffUser!.full_name,
        status: status as TicketStatus | undefined,
        assignedStaffId: assignedStaffId !== undefined ? (assignedStaffId === null ? null : Number(assignedStaffId)) : undefined,
        assignedStaffName,
        resolutionNotes: resolutionNotes !== undefined ? sanitizeText(resolutionNotes, 2000) : undefined,
      });
      realtimeHub.broadcastTicketUpdate(updated);
      return res.json({ ticket: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to update ticket';
      return res.status(404).json({ error: msg });
    }
  });

  // ---- ADMIN CLINIC KNOWLEDGE BASE MANAGEMENT ROUTES ----

  router.get('/admin/clinic', requireStaff, requireAdmin, (_req, res) => {
    const raw = getFullKnowledgeBaseRaw(db);
    const auditLogs = (
      db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50').all() as Array<Record<string, unknown>>
    ).map((r) => ({
      id: Number(r.id),
      staff_id: r.staff_id === null ? null : Number(r.staff_id),
      staff_name: String(r.staff_name),
      action: String(r.action),
      entity_type: String(r.entity_type),
      entity_id: String(r.entity_id),
      old_value_json: r.old_value_json ? String(r.old_value_json) : null,
      new_value_json: r.new_value_json ? String(r.new_value_json) : null,
      created_at: String(r.created_at),
      created_at_ist: formatIstDateTime(String(r.created_at)),
    }));
    res.json({ kb: raw, auditLogs });
  });

  router.put('/admin/clinic/settings', requireStaff, requireAdmin, (req: StaffRequest, res) => {
    const oldSettings = getClinicSettings(db);
    const b = req.body || {};
    const clinic_name = sanitizeText(b.clinic_name ?? oldSettings.clinic_name, 140);
    const address = sanitizeText(b.address ?? oldSettings.address, 300);
    const maps_link = sanitizeText(b.maps_link ?? oldSettings.maps_link, 300);
    const phone = sanitizeText(b.phone ?? oldSettings.phone, 40);
    const whatsapp = sanitizeText(b.whatsapp ?? oldSettings.whatsapp, 40);
    const email = sanitizeText(b.email ?? oldSettings.email, 120);
    const emergency_phone = sanitizeText(b.emergency_phone ?? oldSettings.emergency_phone, 40);
    const working_days = Array.isArray(b.working_days) ? b.working_days.map((d: unknown) => sanitizeText(d, 20)) : oldSettings.working_days;
    const opening_time = sanitizeText(b.opening_time ?? oldSettings.opening_time, 30);
    const closing_time = sanitizeText(b.closing_time ?? oldSettings.closing_time, 30);
    const holidays = Array.isArray(b.holidays) ? b.holidays.map((h: unknown) => sanitizeText(h, 20)).filter(Boolean) : oldSettings.holidays;
    const retention_days = Math.max(7, Math.min(3650, Number(b.retention_days ?? oldSettings.retention_days) || 90));

    if (!clinic_name) {
      return res.status(400).json({ error: 'Clinic name cannot be empty.' });
    }

    const now = getNowIso();
    db.prepare(`
      UPDATE clinic_settings
      SET clinic_name = ?, address = ?, maps_link = ?, phone = ?, whatsapp = ?, email = ?, emergency_phone = ?,
          working_days_json = ?, opening_time = ?, closing_time = ?, holidays_json = ?, retention_days = ?,
          updated_by = ?, updated_at = ?
      WHERE id = 1
    `).run(
      clinic_name,
      address,
      maps_link,
      phone,
      whatsapp,
      email,
      emergency_phone,
      JSON.stringify(working_days),
      opening_time,
      closing_time,
      JSON.stringify(holidays),
      retention_days,
      req.staffUser!.full_name,
      now
    );

    const newVersion = invalidateKbCache(db, req.staffUser!.full_name);
    const updated = getClinicSettings(db);

    recordAuditLog(db, {
      staffId: req.staffUser!.id,
      staffName: req.staffUser!.full_name,
      action: 'UPDATE_CLINIC_SETTINGS',
      entityType: 'clinic_settings',
      entityId: '1',
      oldValue: oldSettings,
      newValue: updated,
    });

    res.json({ settings: updated, kb_version: newVersion });
  });

  // Doctors CRUD
  router.post('/admin/clinic/doctors', requireStaff, requireAdmin, (req: StaffRequest, res) => {
    const b = req.body || {};
    const name = sanitizeText(b.name, 100);
    if (!name) return res.status(400).json({ error: 'Doctor name is required.' });
    const now = getNowIso();
    const info = db
      .prepare(`
        INSERT INTO doctors (name, qualifications, specialisation, experience, available_days, consultation_hours, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `)
      .run(
        name,
        sanitizeText(b.qualifications || 'FILL IN', 120),
        sanitizeText(b.specialisation || 'FILL IN', 120),
        sanitizeText(b.experience || 'FILL IN', 60),
        sanitizeText(b.available_days || 'FILL IN', 120),
        sanitizeText(b.consultation_hours || 'FILL IN', 120),
        now
      );
    const kbVersion = invalidateKbCache(db, req.staffUser!.full_name);
    recordAuditLog(db, {
      staffId: req.staffUser!.id,
      staffName: req.staffUser!.full_name,
      action: 'ADD_DOCTOR',
      entityType: 'doctor',
      entityId: String(info.lastInsertRowid),
      newValue: b,
    });
    res.status(201).json({ id: Number(info.lastInsertRowid), kb_version: kbVersion });
  });

  router.put('/admin/clinic/doctors/:id', requireStaff, requireAdmin, (req: StaffRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM doctors WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Doctor not found.' });
    const b = req.body || {};
    const name = sanitizeText(b.name, 100);
    if (!name) return res.status(400).json({ error: 'Doctor name is required.' });

    db.prepare(`
      UPDATE doctors
      SET name = ?, qualifications = ?, specialisation = ?, experience = ?, available_days = ?, consultation_hours = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      sanitizeText(b.qualifications ?? 'FILL IN', 120),
      sanitizeText(b.specialisation ?? 'FILL IN', 120),
      sanitizeText(b.experience ?? 'FILL IN', 60),
      sanitizeText(b.available_days ?? 'FILL IN', 120),
      sanitizeText(b.consultation_hours ?? 'FILL IN', 120),
      b.is_active === false ? 0 : 1,
      getNowIso(),
      id
    );
    const kbVersion = invalidateKbCache(db, req.staffUser!.full_name);
    recordAuditLog(db, {
      staffId: req.staffUser!.id,
      staffName: req.staffUser!.full_name,
      action: 'UPDATE_DOCTOR',
      entityType: 'doctor',
      entityId: String(id),
      oldValue: existing,
      newValue: b,
    });
    res.json({ ok: true, kb_version: kbVersion });
  });

  router.delete('/admin/clinic/doctors/:id', requireStaff, requireAdmin, (req: StaffRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM doctors WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Doctor not found.' });
    db.prepare('DELETE FROM doctors WHERE id = ?').run(id);
    const kbVersion = invalidateKbCache(db, req.staffUser!.full_name);
    recordAuditLog(db, {
      staffId: req.staffUser!.id,
      staffName: req.staffUser!.full_name,
      action: 'DELETE_DOCTOR',
      entityType: 'doctor',
      entityId: String(id),
      oldValue: existing,
    });
    res.json({ ok: true, kb_version: kbVersion });
  });

  // Pricing & Services updates
  router.put('/admin/clinic/pricing/:id', requireStaff, requireAdmin, (req: StaffRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM pricing WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Pricing entry not found.' });
    const b = req.body || {};
    const now = getNowIso();
    db.prepare(`
      UPDATE pricing
      SET consultation_fee = ?, treatment_price_range = ?, additional_charges = ?, last_updated = ?, updated_by = ?
      WHERE id = ?
    `).run(
      sanitizeText(b.consultation_fee ?? 'FILL IN', 80),
      sanitizeText(b.treatment_price_range ?? 'FILL IN', 120),
      sanitizeText(b.additional_charges ?? 'FILL IN', 120),
      now,
      req.staffUser!.full_name,
      id
    );
    const kbVersion = invalidateKbCache(db, req.staffUser!.full_name);
    recordAuditLog(db, {
      staffId: req.staffUser!.id,
      staffName: req.staffUser!.full_name,
      action: 'UPDATE_PRICING',
      entityType: 'pricing',
      entityId: String(id),
      oldValue: existing,
      newValue: b,
    });
    res.json({ ok: true, kb_version: kbVersion });
  });

  router.post('/admin/clinic/services', requireStaff, requireAdmin, (req: StaffRequest, res) => {
    const b = req.body || {};
    const name = sanitizeText(b.name, 100);
    if (!name) return res.status(400).json({ error: 'Service name is required.' });
    const now = getNowIso();
    const info = db
      .prepare('INSERT INTO services (name, category, description, is_active, updated_at) VALUES (?, ?, ?, 1, ?)')
      .run(name, sanitizeText(b.category || 'General Dentistry', 60), sanitizeText(b.description || '', 240), now);
    const serviceId = Number(info.lastInsertRowid);
    db.prepare(`
      INSERT INTO pricing (service_id, service_name, consultation_fee, treatment_price_range, additional_charges, last_updated, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      serviceId,
      name,
      sanitizeText(b.consultation_fee || 'FILL IN', 80),
      sanitizeText(b.treatment_price_range || 'FILL IN', 120),
      sanitizeText(b.additional_charges || 'FILL IN', 120),
      now,
      req.staffUser!.full_name
    );
    const kbVersion = invalidateKbCache(db, req.staffUser!.full_name);
    recordAuditLog(db, {
      staffId: req.staffUser!.id,
      staffName: req.staffUser!.full_name,
      action: 'ADD_SERVICE',
      entityType: 'service',
      entityId: String(serviceId),
      newValue: b,
    });
    res.status(201).json({ id: serviceId, kb_version: kbVersion });
  });

  // Insurance CRUD
  router.post('/admin/clinic/insurance', requireStaff, requireAdmin, (req: StaffRequest, res) => {
    const b = req.body || {};
    const provider_name = sanitizeText(b.provider_name, 120);
    if (!provider_name) return res.status(400).json({ error: 'Provider name is required.' });
    const info = db
      .prepare(`
        INSERT INTO insurance_providers (provider_name, cashless_available, reimbursement_policy, required_documents, is_active, updated_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `)
      .run(
        provider_name,
        b.cashless_available ? 1 : 0,
        sanitizeText(b.reimbursement_policy || 'FILL IN', 300),
        sanitizeText(b.required_documents || 'FILL IN', 300),
        getNowIso()
      );
    const kbVersion = invalidateKbCache(db, req.staffUser!.full_name);
    recordAuditLog(db, {
      staffId: req.staffUser!.id,
      staffName: req.staffUser!.full_name,
      action: 'ADD_INSURANCE',
      entityType: 'insurance',
      entityId: String(info.lastInsertRowid),
      newValue: b,
    });
    res.status(201).json({ id: Number(info.lastInsertRowid), kb_version: kbVersion });
  });

  router.put('/admin/clinic/insurance/:id', requireStaff, requireAdmin, (req: StaffRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM insurance_providers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Insurance provider not found.' });
    const b = req.body || {};
    db.prepare(`
      UPDATE insurance_providers
      SET provider_name = ?, cashless_available = ?, reimbursement_policy = ?, required_documents = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      sanitizeText(b.provider_name, 120),
      b.cashless_available ? 1 : 0,
      sanitizeText(b.reimbursement_policy || 'FILL IN', 300),
      sanitizeText(b.required_documents || 'FILL IN', 300),
      b.is_active === false ? 0 : 1,
      getNowIso(),
      id
    );
    const kbVersion = invalidateKbCache(db, req.staffUser!.full_name);
    recordAuditLog(db, {
      staffId: req.staffUser!.id,
      staffName: req.staffUser!.full_name,
      action: 'UPDATE_INSURANCE',
      entityType: 'insurance',
      entityId: String(id),
      oldValue: existing,
      newValue: b,
    });
    res.json({ ok: true, kb_version: kbVersion });
  });

  router.delete('/admin/clinic/insurance/:id', requireStaff, requireAdmin, (req: StaffRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM insurance_providers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Insurance provider not found.' });
    db.prepare('DELETE FROM insurance_providers WHERE id = ?').run(id);
    const kbVersion = invalidateKbCache(db, req.staffUser!.full_name);
    recordAuditLog(db, {
      staffId: req.staffUser!.id,
      staffName: req.staffUser!.full_name,
      action: 'DELETE_INSURANCE',
      entityType: 'insurance',
      entityId: String(id),
      oldValue: existing,
    });
    res.json({ ok: true, kb_version: kbVersion });
  });

  // Policies update
  router.put('/admin/clinic/policies/:id', requireStaff, requireAdmin, (req: StaffRequest, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM clinic_policies WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Policy not found.' });
    const b = req.body || {};
    db.prepare('UPDATE clinic_policies SET title = ?, content = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(
      sanitizeText(b.title ?? String((existing as Record<string, unknown>).title), 140),
      sanitizeText(b.content ?? 'FILL IN', 1000),
      req.staffUser!.full_name,
      getNowIso(),
      id
    );
    const kbVersion = invalidateKbCache(db, req.staffUser!.full_name);
    recordAuditLog(db, {
      staffId: req.staffUser!.id,
      staffName: req.staffUser!.full_name,
      action: 'UPDATE_POLICY',
      entityType: 'clinic_policy',
      entityId: String(id),
      oldValue: existing,
      newValue: b,
    });
    res.json({ ok: true, kb_version: kbVersion });
  });

  // Retention purge
  router.post('/admin/retention/purge', requireStaff, requireAdmin, (req: StaffRequest, res) => {
    const settings = getClinicSettings(db);
    const cutoff = new Date(getNow().getTime() - settings.retention_days * 24 * 60 * 60 * 1000).toISOString();
    const info = db
      .prepare("DELETE FROM conversations WHERE updated_at < ? AND id NOT IN (SELECT conversation_id FROM tickets WHERE status NOT IN ('RESOLVED', 'CLOSED'))")
      .run(cutoff);
    recordAuditLog(db, {
      staffId: req.staffUser!.id,
      staffName: req.staffUser!.full_name,
      action: 'RETENTION_PURGE',
      entityType: 'conversations',
      entityId: cutoff,
      newValue: { deletedConversations: Number(info.changes) },
    });
    res.json({ deletedConversations: Number(info.changes), retentionDays: settings.retention_days });
  });

  return router;
}
