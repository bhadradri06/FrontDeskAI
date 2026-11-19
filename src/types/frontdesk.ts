export type SupportedLanguage = 'en' | 'hi' | 'te';

export type TicketStatus =
  | 'OPEN'
  | 'NEEDS_HUMAN'
  | 'URGENT'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED';

export type TicketPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface PublicClinicInfo {
  clinic_name: string;
  has_verified_name: boolean;
  address: string | null;
  maps_link: string | null;
  phone: string | null;
  whatsapp: string | null;
  emergency_phone: string | null;
  opening_time: string | null;
  closing_time: string | null;
  working_days: string[];
  doctors: Array<{ id: number; name: string; specialisation: string | null }>;
  services: string[];
  kb_version: number;
}

export interface ChatMessageDto {
  id: number;
  conversation_id: number;
  sender_type: 'patient' | 'ai' | 'fallback' | 'staff' | 'system';
  sender_name: string | null;
  body: string;
  language: SupportedLanguage;
  source_label: string | null;
  is_emergency: boolean;
  kb_version: number;
  created_at: string;
  created_at_ist?: string;
}

export interface TicketDto {
  id: number;
  ticket_code: string;
  patient_id: number;
  patient_name: string;
  patient_phone: string | null;
  conversation_id: number;
  original_question: string;
  category: string;
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

export interface TicketStatsDto {
  total: number;
  open: number;
  urgent: number;
  needsHuman: number;
  inProgress: number;
  resolved: number;
  overdue: number;
}

export interface StaffUserDto {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: 'admin' | 'receptionist';
  is_active: boolean;
  created_at: string;
}

export interface ClinicSettingsDto {
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

export interface DoctorDto {
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

export interface PricingDto {
  id: number;
  service_id: number | null;
  service_name: string;
  consultation_fee: string;
  treatment_price_range: string;
  additional_charges: string;
  last_updated: string;
  updated_by: string;
}

export interface InsuranceDto {
  id: number;
  provider_name: string;
  cashless_available: boolean;
  reimbursement_policy: string;
  required_documents: string;
  is_active: boolean;
  updated_at: string;
}

export interface PolicyDto {
  id: number;
  policy_type: string;
  title: string;
  content: string;
  updated_by: string;
  updated_at: string;
}

export interface FullKnowledgeBaseDto {
  settings: ClinicSettingsDto;
  doctors: DoctorDto[];
  services: Array<{ id: number; name: string; category: string; description: string; is_active: boolean }>;
  pricing: PricingDto[];
  insurance: InsuranceDto[];
  policies: PolicyDto[];
  missingChecklist: Array<{ section: string; field: string; currentValue: string }>;
}

export interface AuditLogDto {
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
