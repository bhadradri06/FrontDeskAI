import type { DatabaseSync } from 'node:sqlite';
import { generateGroundedResponse, type AiEngineOptions } from './aiEngine.ts';
import { runInTransaction } from './db.ts';
import { getApprovedKnowledgeBase } from './kb.ts';
import {
  detectDiscountRequest,
  detectEmergency,
  detectLanguage,
  detectMedicalSymptoms,
  detectPromptInjection,
  getBookingConfirmedMessage,
  getDiscountMessage,
  getEmergencyMessage,
  getNeedsHumanMessage,
  getPromptInjectionRejectionMessage,
  getSymptomsMessage,
} from './safety.ts';
import { normalizeIndianPhone, sanitizeText, validateFutureIstDate } from './security.ts';
import { createTicket } from './tickets.ts';
import { formatIstDateTime, getNowIso } from './time.ts';
import type { ChatMessage, SupportedLanguage, TicketRecord } from './types.ts';
import { realtimeHub } from './ws.ts';

export interface ProcessChatInput {
  conversationId?: number | null;
  channel?: 'web' | 'whatsapp';
  externalId?: string | null;
  patientName?: string;
  patientPhone?: string;
  message: string;
  preferredLanguage?: SupportedLanguage;
  aiOptions?: AiEngineOptions;
}

export interface ProcessChatResult {
  conversationId: number;
  patientId: number;
  language: SupportedLanguage;
  userMessage: ChatMessage;
  replyMessage: ChatMessage;
  ticket: TicketRecord | null;
  handoverActive: boolean;
  isEmergency: boolean;
  offerBookingForm: boolean;
  offerHumanHandover: boolean;
}

export interface BookingRequestInput {
  conversationId?: number | null;
  patientName: string;
  patientPhone: string;
  preferredDoctor?: string;
  preferredDate: string;
  preferredTime: string;
  reason: string;
  language?: SupportedLanguage;
}

function getOrCreateConversation(
  db: DatabaseSync,
  input: {
    conversationId?: number | null;
    channel: 'web' | 'whatsapp';
    externalId?: string | null;
    patientName?: string;
    patientPhone?: string;
    language: SupportedLanguage;
  }
): { conversationId: number; patientId: number; handoverActive: boolean } {
  const now = getNowIso();

  if (input.conversationId) {
    const existing = db
      .prepare('SELECT id, patient_id, handover_active FROM conversations WHERE id = ?')
      .get(input.conversationId) as
      | { id: number; patient_id: number; handover_active: number }
      | undefined;
    if (existing) {
      if (input.patientName || input.patientPhone) {
        const cleanPhone = input.patientPhone ? normalizeIndianPhone(input.patientPhone) || input.patientPhone : null;
        db.prepare(`
          UPDATE patients
          SET name = COALESCE(NULLIF(?, ''), name),
              phone = COALESCE(NULLIF(?, ''), phone),
              updated_at = ?
          WHERE id = ?
        `).run(input.patientName || '', cleanPhone || '', now, existing.patient_id);
      }
      db.prepare('UPDATE conversations SET language = ?, updated_at = ? WHERE id = ?').run(
        input.language,
        now,
        existing.id
      );
      return {
        conversationId: Number(existing.id),
        patientId: Number(existing.patient_id),
        handoverActive: Boolean(existing.handover_active),
      };
    }
  }

  if (input.externalId) {
    const existingExt = db
      .prepare('SELECT id, patient_id, handover_active FROM conversations WHERE external_id = ?')
      .get(input.externalId) as
      | { id: number; patient_id: number; handover_active: number }
      | undefined;
    if (existingExt) {
      return {
        conversationId: Number(existingExt.id),
        patientId: Number(existingExt.patient_id),
        handoverActive: Boolean(existingExt.handover_active),
      };
    }
  }

  const cleanPhone = input.patientPhone ? normalizeIndianPhone(input.patientPhone) || input.patientPhone : null;
  const patientName = sanitizeText(input.patientName || '', 80) || 'Guest Patient';

  const patientInfo = db
    .prepare(`
      INSERT INTO patients (name, phone, preferred_language, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(patientName, cleanPhone, input.language, now, now);
  const patientId = Number(patientInfo.lastInsertRowid);

  const convInfo = db
    .prepare(`
      INSERT INTO conversations (patient_id, channel, external_id, language, handover_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `)
    .run(patientId, input.channel, input.externalId ?? null, input.language, now, now);

  return {
    conversationId: Number(convInfo.lastInsertRowid),
    patientId,
    handoverActive: false,
  };
}

function saveMessage(
  db: DatabaseSync,
  params: {
    conversationId: number;
    senderType: ChatMessage['sender_type'];
    senderName: string | null;
    body: string;
    language: SupportedLanguage;
    sourceLabel: string | null;
    isEmergency: boolean;
    kbVersion: number;
  }
): ChatMessage {
  const now = getNowIso();
  const info = db
    .prepare(`
      INSERT INTO messages (
        conversation_id, sender_type, sender_name, body, language, source_label, is_emergency, kb_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      params.conversationId,
      params.senderType,
      params.senderName,
      params.body,
      params.language,
      params.sourceLabel,
      params.isEmergency ? 1 : 0,
      params.kbVersion,
      now
    );

  const msg: ChatMessage = {
    id: Number(info.lastInsertRowid),
    conversation_id: params.conversationId,
    sender_type: params.senderType,
    sender_name: params.senderName,
    body: params.body,
    language: params.language,
    source_label: params.sourceLabel,
    is_emergency: params.isEmergency,
    kb_version: params.kbVersion,
    created_at: now,
    created_at_ist: formatIstDateTime(now),
  };

  realtimeHub.broadcastConversationMessage(params.conversationId, msg);
  return msg;
}

function detectAppointmentIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\b(book|schedule|make|request)\s+(an?\s+)?appointment\b/i.test(lower) ||
    /\bappointment\b/i.test(lower) ||
    /\bbook\s+(a\s+)?(slot|visit|consultation)\b/i.test(lower) ||
    /अपॉइंटमेंट|बुकिंग|समय\s*बुक/.test(text) ||
    /అపాయింట్‌మెంట్|అపాయింట్మెంట్|బుక్\s*చేయ|appointment kavali/i.test(text)
  );
}

export async function processPatientMessage(
  db: DatabaseSync,
  input: ProcessChatInput
): Promise<ProcessChatResult> {
  // STEP 1: Receive & sanitize message
  const cleanMessage = sanitizeText(input.message, 1500);
  if (!cleanMessage) {
    throw new Error('Message cannot be empty.');
  }

  // STEP 2: Identify language (English, Hindi, Telugu)
  const lang = detectLanguage(cleanMessage, input.preferredLanguage);
  const kb = getApprovedKnowledgeBase(db);
  const kbVersion = kb.settings.kb_version;

  const conv = getOrCreateConversation(db, {
    conversationId: input.conversationId,
    channel: input.channel || 'web',
    externalId: input.externalId,
    patientName: input.patientName,
    patientPhone: input.patientPhone,
    language: lang,
  });

  const userMessage = saveMessage(db, {
    conversationId: conv.conversationId,
    senderType: 'patient',
    senderName: input.patientName || 'Patient',
    body: cleanMessage,
    language: lang,
    sourceLabel: null,
    isEmergency: false,
    kbVersion,
  });

  // STEP 3: Check for emergency-related language (NEVER wait for AI)
  if (detectEmergency(cleanMessage)) {
    const emergencyText = getEmergencyMessage(lang, kb);
    const ticket = createTicket(db, {
      patientId: conv.patientId,
      conversationId: conv.conversationId,
      originalQuestion: cleanMessage,
      category: 'Emergency',
      status: 'URGENT',
      priority: 'URGENT',
    });
    realtimeHub.broadcastTicketUpdate(ticket);

    const replyMessage = saveMessage(db, {
      conversationId: conv.conversationId,
      senderType: 'system',
      senderName: 'Emergency Safety Layer',
      body: emergencyText,
      language: lang,
      sourceLabel: 'Emergency triage protocol',
      isEmergency: true,
      kbVersion,
    });

    return {
      conversationId: conv.conversationId,
      patientId: conv.patientId,
      language: lang,
      userMessage,
      replyMessage,
      ticket,
      handoverActive: true,
      isEmergency: true,
      offerBookingForm: false,
      offerHumanHandover: true,
    };
  }

  // Check Rule 5 (Prompt Injection) & Rule 4 (Discounts) BEFORE AI
  if (detectPromptInjection(cleanMessage)) {
    // Also check if they tried to sneak a discount request inside a prompt injection
    const replyBody = detectDiscountRequest(cleanMessage)
      ? getDiscountMessage(lang)
      : getPromptInjectionRejectionMessage(lang);
    const replyMessage = saveMessage(db, {
      conversationId: conv.conversationId,
      senderType: 'system',
      senderName: 'FrontDesk AI',
      body: replyBody,
      language: lang,
      sourceLabel: null,
      isEmergency: false,
      kbVersion,
    });
    return {
      conversationId: conv.conversationId,
      patientId: conv.patientId,
      language: lang,
      userMessage,
      replyMessage,
      ticket: null,
      handoverActive: conv.handoverActive,
      isEmergency: false,
      offerBookingForm: false,
      offerHumanHandover: false,
    };
  }

  if (detectDiscountRequest(cleanMessage)) {
    const replyMessage = saveMessage(db, {
      conversationId: conv.conversationId,
      senderType: 'system',
      senderName: 'FrontDesk AI',
      body: getDiscountMessage(lang),
      language: lang,
      sourceLabel: null,
      isEmergency: false,
      kbVersion,
    });
    return {
      conversationId: conv.conversationId,
      patientId: conv.patientId,
      language: lang,
      userMessage,
      replyMessage,
      ticket: null,
      handoverActive: conv.handoverActive,
      isEmergency: false,
      offerBookingForm: false,
      offerHumanHandover: false,
    };
  }

  // STEP 4: Check whether patient is describing pain or symptoms
  if (detectMedicalSymptoms(cleanMessage)) {
    const symptomText = getSymptomsMessage(lang);
    const ticket = createTicket(db, {
      patientId: conv.patientId,
      conversationId: conv.conversationId,
      originalQuestion: cleanMessage,
      category: 'Medical symptoms',
      status: 'NEEDS_HUMAN',
      priority: 'HIGH',
    });
    realtimeHub.broadcastTicketUpdate(ticket);

    const replyMessage = saveMessage(db, {
      conversationId: conv.conversationId,
      senderType: 'system',
      senderName: 'FrontDesk AI',
      body: symptomText,
      language: lang,
      sourceLabel: null,
      isEmergency: false,
      kbVersion,
    });

    return {
      conversationId: conv.conversationId,
      patientId: conv.patientId,
      language: lang,
      userMessage,
      replyMessage,
      ticket,
      handoverActive: true,
      isEmergency: false,
      offerBookingForm: true,
      offerHumanHandover: true,
    };
  }

  // STEP 5: Check whether patient is asking for an appointment
  if (detectAppointmentIntent(cleanMessage)) {
    const promptBody =
      lang === 'hi'
        ? 'मैं आपके अपॉइंटमेंट अनुरोध में खुशी से मदद करूँगा। कृपया नीचे दिए गए अपॉइंटमेंट फॉर्म में अपना नाम, मोबाइल नंबर, पसंदीदा डॉक्टर (यदि कोई हो), पसंदीदा तारीख, समय और कारण भरें। हमारी रिसेप्शन टीम उपलब्ध स्लॉट की पुष्टि करेगी।'
        : lang === 'te'
          ? 'మీ అపాయింట్‌మెంట్ అభ్యర్థనలో నేను సహాయం చేయగలను. దయచేసి దిగువ ఫారమ్‌లో మీ పేరు, మొబైల్ నంబర్, కోరుకున్న డాక్టర్, తేదీ, సమయం మరియు కారణాన్ని నమోదు చేయండి. మా రిసెప్షన్ బృందం అందుబాటులో ఉన్న స్లాట్‌ను నిర్ధారిస్తుంది.'
          : 'I can help you submit an appointment request. Please share your name, mobile number, preferred doctor (if any), preferred date, preferred time, and reason for visit in the booking form below. Our reception team will confirm the available slot.';

    const replyMessage = saveMessage(db, {
      conversationId: conv.conversationId,
      senderType: 'system',
      senderName: 'FrontDesk AI',
      body: promptBody,
      language: lang,
      sourceLabel: null,
      isEmergency: false,
      kbVersion,
    });

    return {
      conversationId: conv.conversationId,
      patientId: conv.patientId,
      language: lang,
      userMessage,
      replyMessage,
      ticket: null,
      handoverActive: conv.handoverActive,
      isEmergency: false,
      offerBookingForm: true,
      offerHumanHandover: false,
    };
  }

  // STEP 6, 7, 8: Search approved KB, generate AI response (or fallback), validate
  const engineResult = await generateGroundedResponse(db, cleanMessage, lang, kb, input.aiOptions);

  let ticket: TicketRecord | null = null;
  let finalBody = engineResult.reply;
  let handoverActive = conv.handoverActive;

  if (engineResult.needsHuman) {
    if (!finalBody) {
      finalBody = getNeedsHumanMessage(lang);
    }
    ticket = createTicket(db, {
      patientId: conv.patientId,
      conversationId: conv.conversationId,
      originalQuestion: cleanMessage,
      category: engineResult.ticketCategory,
      status: 'NEEDS_HUMAN',
      priority: 'MEDIUM',
    });
    handoverActive = true;
    realtimeHub.broadcastTicketUpdate(ticket);
  }

  // STEP 9: Save and return response
  const replyMessage = saveMessage(db, {
    conversationId: conv.conversationId,
    senderType: engineResult.senderType,
    senderName: engineResult.senderType === 'fallback' ? 'Clinic File Assistant' : 'FrontDesk AI',
    body: finalBody,
    language: lang,
    sourceLabel: engineResult.sourceLabel,
    isEmergency: false,
    kbVersion,
  });

  return {
    conversationId: conv.conversationId,
    patientId: conv.patientId,
    language: lang,
    userMessage,
    replyMessage,
    ticket,
    handoverActive,
    isEmergency: false,
    offerBookingForm: false,
    offerHumanHandover: handoverActive,
  };
}

export function submitAppointmentRequest(
  db: DatabaseSync,
  input: BookingRequestInput
): {
  conversationId: number;
  ticket: TicketRecord;
  appointmentId: number;
  confirmationMessage: ChatMessage;
} {
  const name = sanitizeText(input.patientName, 80);
  if (name.length < 2) {
    throw new Error('Please enter your full name.');
  }

  const normalizedPhone = normalizeIndianPhone(input.patientPhone);
  if (!normalizedPhone) {
    throw new Error('Please enter a valid 10-digit Indian mobile number (starting with 6-9).');
  }

  const dateCheck = validateFutureIstDate(input.preferredDate);
  if (!dateCheck.valid) {
    throw new Error(dateCheck.reason || 'Invalid preferred date.');
  }

  const preferredTime = sanitizeText(input.preferredTime, 40);
  if (!preferredTime) {
    throw new Error('Please enter a preferred time.');
  }

  const reason = sanitizeText(input.reason, 400);
  if (!reason) {
    throw new Error('Please mention your reason for visit.');
  }

  const preferredDoctor = sanitizeText(input.preferredDoctor || '', 80) || 'Any Available Dentist';
  const lang: SupportedLanguage = input.language || 'en';
  const kbVersion = getApprovedKnowledgeBase(db).settings.kb_version;

  return runInTransaction(db, () => {
    const conv = getOrCreateConversation(db, {
      conversationId: input.conversationId,
      channel: 'web',
      patientName: name,
      patientPhone: normalizedPhone,
      language: lang,
    });

    const summaryText = `Appointment request: ${name} (${normalizedPhone}) · Doctor: ${preferredDoctor} · Date: ${input.preferredDate} at ${preferredTime} · Reason: ${reason}`;

    saveMessage(db, {
      conversationId: conv.conversationId,
      senderType: 'patient',
      senderName: name,
      body: summaryText,
      language: lang,
      sourceLabel: null,
      isEmergency: false,
      kbVersion,
    });

    const ticket = createTicket(db, {
      patientId: conv.patientId,
      conversationId: conv.conversationId,
      originalQuestion: summaryText,
      category: 'Appointment request',
      status: 'NEEDS_HUMAN',
      priority: 'MEDIUM',
      appointmentDate: input.preferredDate,
      appointmentTime: preferredTime,
    });

    const now = getNowIso();
    const apptInfo = db
      .prepare(`
        INSERT INTO appointments (
          patient_id, ticket_id, doctor_name, preferred_date, preferred_time, reason, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?)
      `)
      .run(conv.patientId, ticket.id, preferredDoctor, input.preferredDate, preferredTime, reason, now, now);

    const confirmationBody = getBookingConfirmedMessage(lang);
    const confirmationMessage = saveMessage(db, {
      conversationId: conv.conversationId,
      senderType: 'system',
      senderName: 'FrontDesk AI',
      body: confirmationBody,
      language: lang,
      sourceLabel: null,
      isEmergency: false,
      kbVersion,
    });

    realtimeHub.broadcastTicketUpdate(ticket);

    return {
      conversationId: conv.conversationId,
      ticket,
      appointmentId: Number(apptInfo.lastInsertRowid),
      confirmationMessage,
    };
  });
}

export function getConversationMessages(
  db: DatabaseSync,
  conversationId: number
): {
  conversation: {
    id: number;
    handover_active: boolean;
    language: SupportedLanguage;
    patient_name: string;
  } | null;
  messages: ChatMessage[];
} {
  const convRow = db
    .prepare(`
      SELECT c.id, c.handover_active, c.language, p.name AS patient_name
      FROM conversations c
      JOIN patients p ON p.id = c.patient_id
      WHERE c.id = ?
    `)
    .get(conversationId) as
    | { id: number; handover_active: number; language: string; patient_name: string }
    | undefined;

  if (!convRow) {
    return { conversation: null, messages: [] };
  }

  const rows = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC')
    .all(conversationId) as Array<Record<string, unknown>>;

  const messages: ChatMessage[] = rows.map((r) => ({
    id: Number(r.id),
    conversation_id: Number(r.conversation_id),
    sender_type: String(r.sender_type) as ChatMessage['sender_type'],
    sender_name: r.sender_name ? String(r.sender_name) : null,
    body: String(r.body),
    language: String(r.language) as SupportedLanguage,
    source_label: r.source_label ? String(r.source_label) : null,
    is_emergency: Boolean(r.is_emergency),
    kb_version: Number(r.kb_version),
    created_at: String(r.created_at),
    created_at_ist: formatIstDateTime(String(r.created_at)),
  }));

  return {
    conversation: {
      id: Number(convRow.id),
      handover_active: Boolean(convRow.handover_active),
      language: String(convRow.language) as SupportedLanguage,
      patient_name: String(convRow.patient_name),
    },
    messages,
  };
}
