import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Clock,
  Lock,
  LogOut,
  Search,
  Send,
  Settings,
  User,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  ChatMessageDto,
  StaffUserDto,
  TicketDto,
  TicketStatsDto,
  TicketStatus,
} from '../types/frontdesk';

interface StaffDashboardPageProps {
  onNavigate: (path: string) => void;
}

const FILTER_TABS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All tickets' },
  { id: 'urgent', label: 'Urgent' },
  { id: 'needs_human', label: 'Needs human' },
  { id: 'appointments', label: 'Appointment requests' },
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'overdue', label: 'Overdue' },
];

const STATUS_STYLE: Record<TicketStatus, string> = {
  URGENT: 'text-red-700 font-semibold',
  NEEDS_HUMAN: 'text-amber-700 font-semibold',
  OPEN: 'text-blue-700 font-medium',
  IN_PROGRESS: 'text-teal-700 font-medium',
  RESOLVED: 'text-emerald-700 font-medium',
  CLOSED: 'text-slate-500 font-medium',
};

const PRIORITY_STYLE: Record<string, string> = {
  URGENT: 'text-red-700 font-semibold',
  HIGH: 'text-amber-700 font-medium',
  MEDIUM: 'text-slate-700',
  LOW: 'text-slate-500',
};

export function StaffDashboardPage({ onNavigate }: StaffDashboardPageProps) {
  const [staffUser, setStaffUser] = useState<StaffUserDto | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [tickets, setTickets] = useState<TicketDto[]>([]);
  const [stats, setStats] = useState<TicketStatsDto>({
    total: 0,
    open: 0,
    urgent: 0,
    needsHuman: 0,
    inProgress: 0,
    resolved: 0,
    overdue: 0,
  });
  const [staffList, setStaffList] = useState<StaffUserDto[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loadingTickets, setLoadingTickets] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<{
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
  } | null>(null);

  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    setAuthChecking(true);
    try {
      const me = await api.getStaffMe();
      setStaffUser(me.user);
    } catch {
      setStaffUser(null);
    } finally {
      setAuthChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const loadTickets = useCallback(async () => {
    if (!staffUser) return;
    setLoadingTickets(true);
    try {
      const [res, usersRes] = await Promise.all([
        api.getTickets(filter, search),
        api.getStaffUsers(),
      ]);
      setTickets(res.tickets);
      setStats(res.stats);
      setStaffList(usersRes.users);
    } catch {
      // handled gracefully
    } finally {
      setLoadingTickets(false);
    }
  }, [staffUser, filter, search]);

  const loadTicketDetail = useCallback(async (ticketId: number) => {
    try {
      const detail = await api.getTicketDetail(ticketId);
      setSelectedDetail(detail);
      setNotesDraft(detail.ticket.resolution_notes || '');
    } catch {
      setSelectedDetail(null);
    }
  }, []);

  useEffect(() => {
    if (staffUser) {
      void loadTickets();
    }
  }, [staffUser, loadTickets]);

  useEffect(() => {
    if (selectedId && staffUser) {
      void loadTicketDetail(selectedId);
    }
  }, [selectedId, staffUser, loadTicketDetail]);

  // WebSocket live updates for staff dashboard
  useEffect(() => {
    if (!staffUser) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?role=staff`);
    ws.onmessage = (event) => {
      try {
        const packet = JSON.parse(String(event.data)) as { event?: string; conversationId?: number };
        if (packet.event === 'ticket:updated' || packet.event === 'message:created') {
          void loadTickets();
          if (selectedId) {
            void loadTicketDetail(selectedId);
          }
        }
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, [staffUser, selectedId, loadTickets, loadTicketDetail]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoggingIn(true);
    try {
      const res = await api.staffLogin(username, password);
      sessionStorage.setItem('fd_staff_token', res.token);
      setStaffUser(res.user);
      setPassword('');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await api.staffLogout().catch(() => undefined);
    sessionStorage.removeItem('fd_staff_token');
    setStaffUser(null);
    setSelectedId(null);
    setSelectedDetail(null);
  };

  const handleSendReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedDetail || !replyText.trim() || sendingReply) return;
    setSendingReply(true);
    setActionBanner(null);
    try {
      const res = await api.sendStaffReply(selectedDetail.ticket.id, replyText.trim());
      setReplyText('');
      setActionBanner(`Reply sent to patient conversation (${res.ticket.ticket_code}).`);
      await Promise.all([loadTicketDetail(selectedDetail.ticket.id), loadTickets()]);
    } catch (err) {
      setActionBanner(err instanceof Error ? err.message : 'Failed to send reply.');
    } finally {
      setSendingReply(false);
    }
  };

  const handleMetaUpdate = async (patch: {
    status?: TicketStatus;
    assignedStaffId?: number | null;
    resolutionNotes?: string | null;
  }) => {
    if (!selectedDetail) return;
    setSavingMeta(true);
    setActionBanner(null);
    try {
      await api.updateTicket(selectedDetail.ticket.id, patch);
      setActionBanner('Ticket updated.');
      await Promise.all([loadTicketDetail(selectedDetail.ticket.id), loadTickets()]);
    } catch (err) {
      setActionBanner(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setSavingMeta(false);
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-slate-600">Verifying staff session...</p>
      </div>
    );
  }

  if (!staffUser) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
          <div className="flex items-center gap-2.5 text-slate-900">
            <Lock className="w-5 h-5 text-blue-700" />
            <h1 className="text-xl font-bold">Staff Reception Desk Sign In</h1>
          </div>
          <p className="text-sm text-slate-600 mt-1.5">
            Restricted to authorised dental clinic receptionists and administrators.
          </p>

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label htmlFor="staff-username" className="block text-xs font-medium text-slate-700 mb-1">
                Username or Email
              </label>
              <input
                id="staff-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin or reception"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label htmlFor="staff-password" className="block text-xs font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                id="staff-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter staff password"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {loginError && (
              <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {loginError}
              </p>
            )}

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full min-h-[44px] px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors"
            >
              {loggingIn ? 'Signing in...' : 'Sign In to Staff Desk'}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-500 space-y-1">
            <p className="font-medium text-slate-700">Clinic Demo Credentials</p>
            <p className="font-mono">Admin: admin / ClinicAdmin@2026</p>
            <p className="font-mono">Receptionist: reception / FrontDesk@2026</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50 px-3 sm:px-6 py-5">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Staff Header Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Reception Ticket Queue</h1>
            <div className="text-xs text-slate-600 flex items-center gap-2 mt-0.5">
              <span>{staffUser.full_name}</span>
              <span aria-hidden="true">·</span>
              <span className="capitalize">{staffUser.role}</span>
              <span aria-hidden="true">·</span>
              <span>Callback SLA: 2 working hours (IST)</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {staffUser.role === 'admin' && (
              <button
                type="button"
                onClick={() => onNavigate('/staff/settings/clinic')}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
              >
                <Settings className="w-4 h-4" />
                <span>Clinic Data</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* KPI Metric Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: 'Total Tickets', val: stats.total, tone: 'text-slate-900' },
            { label: 'Urgent', val: stats.urgent, tone: stats.urgent > 0 ? 'text-red-700' : 'text-slate-900' },
            { label: 'Needs Human', val: stats.needsHuman, tone: 'text-amber-700' },
            { label: 'Open', val: stats.open, tone: 'text-blue-700' },
            { label: 'In Progress', val: stats.inProgress, tone: 'text-teal-700' },
            { label: 'Resolved', val: stats.resolved, tone: 'text-emerald-700' },
            { label: 'Overdue (>2h)', val: stats.overdue, tone: stats.overdue > 0 ? 'text-red-700' : 'text-slate-900' },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <p className="text-xs text-slate-500 truncate">{kpi.label}</p>
              <p className={`text-2xl font-bold tabular-nums mt-1 ${kpi.tone}`}>{kpi.val}</p>
            </div>
          ))}
        </div>

        {/* Filter Bar & Search */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  filter === tab.id
                    ? 'bg-blue-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full lg:w-72 shrink-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, or FD-1001"
              className="w-full min-h-[40px] pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>

        {/* Main Split: Ticket List + Detail Drawer */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Ticket Listing */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            {loadingTickets && tickets.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">Loading tickets...</div>
            ) : tickets.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <p className="text-sm font-medium text-slate-800">No tickets match the current view.</p>
                <p className="text-xs text-slate-500">
                  Incoming emergencies, missing clinic queries, and appointment requests will appear here automatically.
                </p>
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                        <th className="py-2.5 px-3">Ticket</th>
                        <th className="py-2.5 px-3">Patient</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Age / SLA</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {tickets.map((t) => {
                        const active = selectedId === t.id;
                        return (
                          <tr
                            key={t.id}
                            onClick={() => setSelectedId(t.id)}
                            className={`cursor-pointer transition-colors ${
                              active ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="py-3 px-3 align-top">
                              <div className="font-mono font-semibold text-slate-900 tabular-nums">
                                {t.ticket_code}
                              </div>
                              <div className={`mt-0.5 ${PRIORITY_STYLE[t.priority] || ''}`}>{t.priority}</div>
                            </td>
                            <td className="py-3 px-3 align-top">
                              <div className="font-medium text-slate-900">{t.patient_name}</div>
                              <div className="text-slate-500 tabular-nums mt-0.5">
                                {t.patient_phone || 'Phone not provided'}
                              </div>
                              {t.appointment_date && (
                                <div className="text-blue-700 mt-0.5 tabular-nums">
                                  Appt: {t.appointment_date} {t.appointment_time}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 align-top text-slate-700">
                              <div>{t.category}</div>
                              <div className="text-slate-500 truncate max-w-[180px] mt-0.5">{t.original_question}</div>
                            </td>
                            <td className="py-3 px-3 align-top">
                              <div className={STATUS_STYLE[t.status]}>{t.status.replace('_', ' ')}</div>
                              <div className="text-slate-400 mt-0.5 tabular-nums">{t.created_at_ist}</div>
                            </td>
                            <td className="py-3 px-3 align-top text-right tabular-nums">
                              <div className="text-slate-800">{t.age_label}</div>
                              {t.is_overdue && (
                                <div className="text-red-700 font-semibold mt-0.5">OVERDUE</div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Tap Rows */}
                <div className="md:hidden divide-y divide-slate-200">
                  {tickets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={`w-full text-left p-4 space-y-1.5 transition-colors ${
                        selectedId === t.id ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {t.ticket_code} · {t.priority}
                        </span>
                        <span className={STATUS_STYLE[t.status]}>{t.status.replace('_', ' ')}</span>
                      </div>
                      <div className="text-sm font-medium text-slate-900">{t.patient_name}</div>
                      <div className="text-xs text-slate-600 line-clamp-2">{t.original_question}</div>
                      <div className="text-[11px] text-slate-500 flex items-center justify-between pt-1">
                        <span>{t.category}</span>
                        <span className={t.is_overdue ? 'text-red-700 font-semibold' : ''}>
                          {t.age_label} {t.is_overdue ? '· OVERDUE' : ''}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Ticket Detail & Human Handover Conversation Panel */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
            {!selectedDetail ? (
              <div className="py-12 text-center text-sm text-slate-500">
                Select a ticket from the queue to inspect the full patient conversation and send a staff reply.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Detail Header */}
                <div className="pb-3 border-b border-slate-200 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {selectedDetail.ticket.ticket_code}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{selectedDetail.ticket.category}</span>
                      {selectedDetail.ticket.is_overdue && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-red-700 font-semibold">OVERDUE</span>
                        </>
                      )}
                    </div>
                    <h2 className="text-base font-bold text-slate-900 mt-1">
                      {selectedDetail.ticket.patient_name}
                    </h2>
                    <div className="text-xs text-slate-600 mt-0.5 flex flex-wrap items-center gap-2">
                      <span className="tabular-nums">
                        {selectedDetail.ticket.patient_phone || 'No mobile number'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">Created {selectedDetail.ticket.created_at_ist}</span>
                    </div>
                  </div>
                </div>

                {/* Appointment Details if present */}
                {selectedDetail.appointment && (
                  <div className="bg-blue-50/60 border border-blue-200 rounded-lg p-3 text-xs text-slate-800 space-y-1">
                    <p className="font-semibold text-blue-900">Appointment Request Details</p>
                    <p>
                      Doctor: {selectedDetail.appointment.doctor_name} · Date:{' '}
                      <span className="font-mono tabular-nums">{selectedDetail.appointment.preferred_date}</span> at{' '}
                      <span className="font-mono tabular-nums">{selectedDetail.appointment.preferred_time}</span>
                    </p>
                    <p>Reason: {selectedDetail.appointment.reason}</p>
                  </div>
                )}

                {/* Ticket Controls (Status & Assignment) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="ticket-status" className="block text-xs font-medium text-slate-700 mb-1">
                      Status
                    </label>
                    <select
                      id="ticket-status"
                      value={selectedDetail.ticket.status}
                      disabled={savingMeta}
                      onChange={(e) => void handleMetaUpdate({ status: e.target.value as TicketStatus })}
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="OPEN">OPEN</option>
                      <option value="NEEDS_HUMAN">NEEDS HUMAN</option>
                      <option value="URGENT">URGENT</option>
                      <option value="IN_PROGRESS">IN PROGRESS</option>
                      <option value="RESOLVED">RESOLVED</option>
                      <option value="CLOSED">CLOSED</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ticket-assignee" className="block text-xs font-medium text-slate-700 mb-1">
                      Assigned Staff
                    </label>
                    <select
                      id="ticket-assignee"
                      value={selectedDetail.ticket.assigned_staff_id ?? ''}
                      disabled={savingMeta}
                      onChange={(e) =>
                        void handleMetaUpdate({
                          assignedStaffId: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="w-full min-h-[40px] px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="">Unassigned</option>
                      {staffList.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name} ({u.role})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Full Conversation Thread */}
                <div>
                  <p className="text-xs font-semibold text-slate-700 mb-2">Patient Conversation</p>
                  <div className="max-h-72 overflow-y-auto space-y-2.5 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    {selectedDetail.messages.map((m) => (
                      <div key={m.id} className="text-xs space-y-0.5">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span className="font-semibold text-slate-700 inline-flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {m.sender_type === 'patient'
                              ? selectedDetail.ticket.patient_name
                              : m.sender_type === 'staff'
                                ? `Clinic Staff (${m.sender_name || 'Staff'})`
                                : m.sender_name || 'FrontDesk AI'}
                          </span>
                          <span className="tabular-nums">{m.created_at_ist}</span>
                        </div>
                        <p
                          className={`p-2.5 rounded-lg whitespace-pre-line ${
                            m.sender_type === 'patient'
                              ? 'bg-white border border-slate-200 text-slate-900'
                              : m.sender_type === 'staff'
                                ? 'bg-teal-50 border border-teal-200 text-slate-900'
                                : m.is_emergency
                                  ? 'bg-red-50 border border-red-200 text-red-950'
                                  : 'bg-blue-50/70 border border-blue-100 text-slate-800'
                          }`}
                        >
                          {m.body}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Human Reply Form (appears immediately in Patient Chat) */}
                <form onSubmit={handleSendReply} className="space-y-2">
                  <label htmlFor="staff-reply-input" className="block text-xs font-semibold text-slate-700">
                    Send Reply to Patient Chat
                  </label>
                  <textarea
                    id="staff-reply-input"
                    rows={3}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type a verified response for the patient..."
                    className="w-full p-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500">
                      Labeled as "Reply from clinic staff" in patient chat
                    </span>
                    <button
                      type="submit"
                      disabled={sendingReply || !replyText.trim()}
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{sendingReply ? 'Sending...' : 'Send Reply'}</span>
                    </button>
                  </div>
                </form>

                {/* Private Internal Resolution Notes */}
                <div className="pt-3 border-t border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="internal-notes" className="text-xs font-semibold text-slate-700">
                      Internal Resolution Notes
                    </label>
                    <span className="text-[11px] text-amber-700 font-medium">
                      Staff only · Never shown to patients
                    </span>
                  </div>
                  <textarea
                    id="internal-notes"
                    rows={2}
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="Add internal handover or follow-up notes..."
                    className="w-full p-2.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-slate-500 flex items-center gap-1 tabular-nums">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Working SLA elapsed: {selectedDetail.ticket.working_minutes_elapsed} mins</span>
                    </div>
                    <button
                      type="button"
                      disabled={savingMeta}
                      onClick={() => void handleMetaUpdate({ resolutionNotes: notesDraft })}
                      className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      Save Notes
                    </button>
                  </div>
                </div>

                {actionBanner && (
                  <p className="text-xs text-teal-800 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{actionBanner}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
