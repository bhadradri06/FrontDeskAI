export type SupportedLanguage = 'en' | 'hi' | 'te';

export type TicketStatus =
  | 'OPEN'
  | 'NEEDS_HUMAN'
  | 'URGENT'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED';

export type TicketPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';

export type TicketCategory =
  | 'Missing clinic information'
  | 'Pricing enquiry'
  | 'Doctor enquiry'
  | 'Appointment request'
  | 'Medical symptoms'
  | 'Emergency'
  | 'Insurance enquiry'
  | 'Other';

export type SenderType = 'patient' | 'ai' | 'fallback' | 'staff' | 'system';

export type StaffRole = 'admin' | 'receptionist';

export interface ClinicSettings {
  id: number;
  clinic_name: string;
  address: string;
  maps_link: string;
  phone: string;
  whatsapp: string;
  email: string;
  emergency_phone: string;
  working_days: string[];
  opening_time: string;
  closing_time: string;
  holidays: string[];
  retention_days: number;
  kb_version: number;
  updated_by: string;
  updated_at: string;
}

export interface Doctor {
  id: number;
  name: string;
  qualifications: string;
  specialisation: string;
  experience: string;
  available_days: string;
  consultation_hours: string;
  is_active: boolean;
  updated_at: string;
}

export interface DentalService {
  id: number;
  name: string;
  category: string;
  description: string;
  duration_mins: number | null;
  is_active: boolean;
  updated_at: string;
}

export interface ServicePricing {
  id: number;
  service_id: number | null;
  service_name: string;
  consultation_fee: string;
  treatment_price_range: string;
  additional_charges: string;
  last_updated: string;
  updated_by: string;
}

export interface InsuranceProvider {
  id: number;
  provider_name: string;
  cashless_available: boolean;
  reimbursement_policy: string;
  required_documents: string;
  is_active: boolean;
  updated_at: string;
}

export interface ClinicPolicy {
  id: number;
  policy_type: string;
  title: string;
  content: string;
  updated_by: string;
  updated_at: string;
}

export interface ApprovedKnowledgeBase {
  settings: ClinicSettings;
  doctors: Doctor[];
  services: DentalService[];
  pricing: ServicePricing[];
  insurance: InsuranceProvider[];
  policies: ClinicPolicy[];
  missingChecklist: Array<{ section: string; field: string; currentValue: string }>;
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  sender_type: SenderType;
  sender_name: string | null;
  body: string;
  language: SupportedLanguage;
  source_label: string | null;
  is_emergency: boolean;
  kb_version: number;
  created_at: string;
  created_at_ist?: string;
}

export interface TicketRecord {
  id: number;
  ticket_code: string;
  patient_id: number;
  patient_name: string;
  patient_phone: string | null;
  conversation_id: number;
  original_question: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_staff_id: number | null;
  assigned_staff_name: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  staff_response: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
  created_at_ist: string;
  updated_at_ist: string;
  age_label: string;
  working_minutes_elapsed: number;
  is_overdue: boolean;
}

export interface StaffUser {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: StaffRole;
  is_active: boolean;
  created_at: string;
}

export interface AuditLogRecord {
  id: number;
  staff_id: number | null;
  staff_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value_json: string | null;
  new_value_json: string | null;
  created_at: string;
  created_at_ist: string;
}
