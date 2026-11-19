import type {
  AuditLogDto,
  ChatMessageDto,
  FullKnowledgeBaseDto,
  PublicClinicInfo,
  StaffUserDto,
  SupportedLanguage,
  TicketDto,
  TicketStatsDto,
  TicketStatus,
} from '../types/frontdesk';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem('fd_staff_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getPublicClinic(): Promise<PublicClinicInfo> {
    return request('/api/clinic/public');
  },

  sendChatMessage(payload: {
    conversationId?: number | null;
    patientName?: string;
    patientPhone?: string;
    message: string;
    preferredLanguage?: SupportedLanguage;
  }): Promise<{
    conversationId: number;
    patientId: number;
    language: SupportedLanguage;
    userMessage: ChatMessageDto;
    replyMessage: ChatMessageDto;
    ticket: TicketDto | null;
    handoverActive: boolean;
    isEmergency: boolean;
    offerBookingForm: boolean;
    offerHumanHandover: boolean;
  }> {
    return request('/api/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getConversationMessages(conversationId: number): Promise<{
    conversation: { id: number; handover_active: boolean; language: SupportedLanguage; patient_name: string };
    messages: ChatMessageDto[];
  }> {
    return request(`/api/conversations/${conversationId}/messages`);
  },

  submitAppointmentRequest(payload: {
    conversationId?: number | null;
    patientName: string;
    patientPhone: string;
    preferredDoctor?: string;
    preferredDate: string;
    preferredTime: string;
    reason: string;
    language?: SupportedLanguage;
  }): Promise<{
    conversationId: number;
    ticket: TicketDto;
    appointmentId: number;
    confirmationMessage: ChatMessageDto;
  }> {
    return request('/api/appointments/request', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  staffLogin(username: string, password: string): Promise<{ token: string; user: StaffUserDto }> {
    return request('/api/staff/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  staffLogout(): Promise<{ ok: boolean }> {
    return request('/api/staff/logout', { method: 'POST' });
  },

  getStaffMe(): Promise<{ user: StaffUserDto }> {
    return request('/api/staff/me');
  },

  getStaffUsers(): Promise<{ users: StaffUserDto[] }> {
    return request('/api/staff/users');
  },

  getTickets(filter: string, search: string): Promise<{ tickets: TicketDto[]; stats: TicketStatsDto }> {
    const params = new URLSearchParams();
    if (filter) params.set('filter', filter);
    if (search) params.set('search', search);
    return request(`/api/staff/tickets?${params.toString()}`);
  },

  getTicketDetail(id: number): Promise<{
    ticket: TicketDto;
    messages: ChatMessageDto[];
    appointment: {
      id: number;
      doctor_name: string;
      preferred_date: string;
      preferred_time: string;
      reason: string;
      status: string;
    } | null;
  }> {
    return request(`/api/staff/tickets/${id}`);
  },

  sendStaffReply(id: number, message: string, status?: TicketStatus): Promise<{ ticket: TicketDto; message: ChatMessageDto }> {
    return request(`/api/staff/tickets/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message, status }),
    });
  },

  updateTicket(
    id: number,
    payload: { status?: TicketStatus; assignedStaffId?: number | null; resolutionNotes?: string | null }
  ): Promise<{ ticket: TicketDto }> {
    return request(`/api/staff/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  getAdminClinic(): Promise<{ kb: FullKnowledgeBaseDto; auditLogs: AuditLogDto[] }> {
    return request('/api/admin/clinic');
  },

  updateClinicSettings(payload: Record<string, unknown>): Promise<{ settings: unknown; kb_version: number }> {
    return request('/api/admin/clinic/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  addDoctor(payload: Record<string, unknown>): Promise<{ id: number; kb_version: number }> {
    return request('/api/admin/clinic/doctors', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateDoctor(id: number, payload: Record<string, unknown>): Promise<{ ok: boolean; kb_version: number }> {
    return request(`/api/admin/clinic/doctors/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteDoctor(id: number): Promise<{ ok: boolean; kb_version: number }> {
    return request(`/api/admin/clinic/doctors/${id}`, { method: 'DELETE' });
  },

  updatePricing(id: number, payload: Record<string, unknown>): Promise<{ ok: boolean; kb_version: number }> {
    return request(`/api/admin/clinic/pricing/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  addService(payload: Record<string, unknown>): Promise<{ id: number; kb_version: number }> {
    return request('/api/admin/clinic/services', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  addInsurance(payload: Record<string, unknown>): Promise<{ id: number; kb_version: number }> {
    return request('/api/admin/clinic/insurance', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateInsurance(id: number, payload: Record<string, unknown>): Promise<{ ok: boolean; kb_version: number }> {
    return request(`/api/admin/clinic/insurance/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteInsurance(id: number): Promise<{ ok: boolean; kb_version: number }> {
    return request(`/api/admin/clinic/insurance/${id}`, { method: 'DELETE' });
  },

  updatePolicy(id: number, payload: Record<string, unknown>): Promise<{ ok: boolean; kb_version: number }> {
    return request(`/api/admin/clinic/policies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  purgeRetention(): Promise<{ deletedConversations: number; retentionDays: number }> {
    return request('/api/admin/retention/purge', { method: 'POST' });
  },
};
