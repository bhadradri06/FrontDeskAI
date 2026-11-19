import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Calendar,
  Clock,
  Globe,
  MapPin,
  Phone,
  RotateCcw,
  Send,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { AppointmentRequestCard } from '../components/AppointmentRequestCard';
import { api } from '../lib/api';
import type { ChatMessageDto, PublicClinicInfo, SupportedLanguage } from '../types/frontdesk';

const LOGO_URL = '/src/assets/images/clinic_logo_1795111407116.jpg';

const QUICK_REPLIES: Array<{ label: string; question: string; isBooking?: boolean }> = [
  { label: 'Clinic timings', question: 'What are your clinic timings?' },
  { label: 'Consultation fees', question: 'What are your consultation fees?' },
  { label: 'Our doctors', question: 'Who are your doctors?' },
  { label: 'Book an appointment', question: 'I would like to book an appointment.', isBooking: true },
  { label: 'Clinic location', question: 'What is your clinic location and address?' },
  { label: 'Insurance information', question: 'What insurance information and policies do you have?' },
  { label: 'Talk to receptionist', question: 'I would like to talk to a receptionist.' },
];

function formatClientIstTime(isoString?: string): string {
  const date = isoString ? new Date(isoString) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function PatientChatPage() {
  const [clinicInfo, setClinicInfo] = useState<PublicClinicInfo | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(() => {
    const saved = localStorage.getItem('fd_patient_conv_id');
    const parsed = saved ? Number(saved) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  });
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [language, setLanguage] = useState<SupportedLanguage>('en');
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [handoverActive, setHandoverActive] = useState(false);
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadClinicInfo = useCallback(async () => {
    try {
      const info = await api.getPublicClinic();
      setClinicInfo(info);
    } catch {
      // silent fallback
    }
  }, []);

  const loadConversation = useCallback(async (convId: number) => {
    try {
      const data = await api.getConversationMessages(convId);
      setMessages(data.messages);
      setHandoverActive(data.conversation.handover_active);
      setLanguage(data.conversation.language);
      if (data.messages.some((m) => m.is_emergency)) {
        setEmergencyActive(true);
      }
    } catch {
      // Stale conversation id; reset cleanly
      localStorage.removeItem('fd_patient_conv_id');
      setConversationId(null);
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    void loadClinicInfo();
    if (conversationId) {
      void loadConversation(conversationId);
    }
  }, [conversationId, loadClinicInfo, loadConversation]);

  // Real-time WebSocket connection for instant staff replies
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?role=patient${
      conversationId ? `&conversationId=${conversationId}` : ''
    }`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);
    ws.onmessage = (event) => {
      try {
        const packet = JSON.parse(String(event.data)) as {
          event: string;
          conversationId?: number;
          payload?: ChatMessageDto;
        };
        if (
          packet.event === 'message:created' &&
          packet.payload &&
          conversationId &&
          packet.conversationId === conversationId
        ) {
          const incoming = packet.payload;
          setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
          if (incoming.sender_type === 'staff') {
            setHandoverActive(true);
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    return () => {
      ws.close();
    };
  }, [conversationId]);

  // Reliable polling fallback when human handover is active or WebSocket is disconnected
  useEffect(() => {
    if (!conversationId || (!handoverActive && wsConnected)) return;
    const timer = window.setInterval(() => {
      void loadConversation(conversationId);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [conversationId, handoverActive, wsConnected, loadConversation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending, showBookingForm]);

  const sendMessage = async (textToSend: string, openBookingOnReply = false) => {
    const trimmed = textToSend.trim();
    if (!trimmed || sending) return;
    setErrorBanner(null);
    setSending(true);
    setInputText('');

    const optimisticId = -Date.now();
    const optimisticMsg: ChatMessageDto = {
      id: optimisticId,
      conversation_id: conversationId || 0,
      sender_type: 'patient',
      sender_name: 'You',
      body: trimmed,
      language,
      source_label: null,
      is_emergency: false,
      kb_version: clinicInfo?.kb_version || 1,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const res = await api.sendChatMessage({
        conversationId,
        message: trimmed,
        preferredLanguage: language,
      });
      setConversationId(res.conversationId);
      localStorage.setItem('fd_patient_conv_id', String(res.conversationId));
      setLanguage(res.language);
      setHandoverActive(res.handoverActive);
      if (res.isEmergency) setEmergencyActive(true);
      if (res.offerBookingForm || openBookingOnReply) {
        setShowBookingForm(true);
      }

      setMessages((prev) => {
        const withoutOptimistic = prev.filter((m) => m.id !== optimisticId);
        const next = [...withoutOptimistic];
        if (!next.some((m) => m.id === res.userMessage.id)) next.push(res.userMessage);
        if (!next.some((m) => m.id === res.replyMessage.id)) next.push(res.replyMessage);
        return next;
      });
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setErrorBanner(err instanceof Error ? err.message : 'Could not send message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendMessage(inputText);
  };

  const handleResetChat = () => {
    localStorage.removeItem('fd_patient_conv_id');
    setConversationId(null);
    setMessages([]);
    setHandoverActive(false);
    setEmergencyActive(false);
    setShowBookingForm(false);
    setErrorBanner(null);
  };

  const clinicDisplayName = clinicInfo?.clinic_name || 'FILL IN Dental Clinic';
  const welcomeMessage = `Namaste! Welcome to ${clinicDisplayName}, Banjara Hills, Hyderabad.\n\nI'm your virtual receptionist. I can help you with clinic timings, doctors, consultation fees, appointments, insurance and general clinic information.\n\nHow can I help you today?`;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50 flex flex-col">
      <div className="w-full max-w-6xl mx-auto flex-1 flex flex-col lg:flex-row gap-6 px-3 sm:px-6 py-4 sm:py-6">
        {/* Main Chat Reception Area */}
        <section
          aria-label="Patient reception chat"
          className="flex-1 flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden min-h-[calc(100vh-6rem)] lg:min-h-[680px] lg:max-h-[calc(100vh-6rem)]"
        >
          {/* Clinic Identity & Live Connection Header */}
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 bg-white">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl border border-slate-200 bg-white overflow-hidden flex items-center justify-center shrink-0">
                {!logoError ? (
                  <img
                    src={LOGO_URL}
                    alt={`${clinicDisplayName} logo`}
                    referrerPolicy="no-referrer"
                    onError={() => setLogoError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <svg viewBox="0 0 24 24" className="w-6 h-6 text-blue-700" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M7 4c-2.5 0-4 2-4 4.5 0 2.7 1.4 5.2 2.2 8.2.5 1.8 1.2 3.3 2.3 3.3 1 0 1.4-1.4 2-3 .5-1.4 1.2-2 2.5-2s2 .6 2.5 2c.6 1.6 1 3 2 3 1.1 0 1.8-1.5 2.3-3.3.8-3 2.2-5.5 2.2-8.2C21 6 19.5 4 17 4c-1.8 0-3 .9-5 .9S8.8 4 7 4z" />
                  </svg>
                )}
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-base font-semibold text-slate-900 truncate">
                  {clinicDisplayName}
                </h1>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Banjara Hills, Hyderabad</span>
                  <span aria-hidden="true">·</span>
                  <span className={wsConnected ? 'text-teal-700 font-medium' : 'text-slate-500'}>
                    {wsConnected ? 'Online receptionist' : 'Reconnecting'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <label htmlFor="lang-select" className="sr-only">
                Language
              </label>
              <div className="relative flex items-center">
                <Globe className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 pointer-events-none" />
                <select
                  id="lang-select"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
                  className="min-h-[38px] pl-8 pr-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="en">English</option>
                  <option value="hi">हिन्दी</option>
                  <option value="te">తెలుగు</option>
                </select>
              </div>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={handleResetChat}
                  title="Start new conversation"
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Emergency High-Contrast Strip */}
          {emergencyActive && (
            <div
              role="alert"
              className="px-4 py-3 bg-red-50 border-b border-red-200 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5 text-xs sm:text-sm text-red-900">
                <ShieldAlert className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Immediate Medical Emergency Guidance</p>
                  <p className="text-red-800">
                    Call 112 in India or visit the nearest emergency department immediately.
                    {clinicInfo?.emergency_phone ? ` Clinic emergency line: ${clinicInfo.emergency_phone}` : ''}
                  </p>
                </div>
              </div>
              <a
                href="tel:112"
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-red-700 hover:bg-red-800 rounded-lg shrink-0"
              >
                <Phone className="w-4 h-4" />
                <span>Call 112</span>
              </a>
            </div>
          )}

          {/* Human Handover Active Strip */}
          {handoverActive && !emergencyActive && (
            <div className="px-4 py-2.5 bg-teal-50 border-b border-teal-200 flex items-center gap-2 text-xs text-teal-900">
              <UserCheck className="w-4 h-4 text-teal-700 shrink-0" />
              <span>
                Human handover active · Our clinic receptionist has received your conversation and will reply here shortly.
              </span>
            </div>
          )}

          {/* Scrollable Messages Area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-slate-50/40">
            {/* Initial Welcome Bubble */}
            <div className="flex flex-col items-start max-w-[90%] sm:max-w-[80%]">
              <div className="bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-line">
                {welcomeMessage}
              </div>
              <div className="mt-1 px-1 text-[11px] text-slate-500 flex items-center gap-1.5">
                <span>Virtual Receptionist</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formatClientIstTime()} IST</span>
              </div>
            </div>

            {/* Dynamic Conversation Messages */}
            {messages.map((msg) => {
              const isPatient = msg.sender_type === 'patient';
              const isStaff = msg.sender_type === 'staff';
              const isEmergencyMsg = msg.is_emergency;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isPatient ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[90%] sm:max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line break-words ${
                      isPatient
                        ? 'bg-blue-700 text-white rounded-tr-sm'
                        : isEmergencyMsg
                          ? 'bg-red-50 border border-red-300 text-red-950 rounded-tl-sm'
                          : isStaff
                            ? 'bg-teal-50 border border-teal-200 text-slate-900 rounded-tl-sm'
                            : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                    }`}
                  >
                    {msg.body}
                  </div>

                  <div className="mt-1 px-1 text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5">
                    {isStaff && (
                      <>
                        <span className="font-semibold text-teal-800">
                          Reply from clinic staff ({msg.sender_name || 'Receptionist'})
                        </span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    {!isPatient && !isStaff && msg.source_label && (
                      <>
                        <span className="font-medium text-blue-700">{msg.source_label}</span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span className="tabular-nums">
                      {msg.created_at_ist || `${formatClientIstTime(msg.created_at)} IST`}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Typing Indicator */}
            {sending && (
              <div className="flex items-start">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 text-xs text-slate-500">
                  Receptionist is checking clinic records...
                </div>
              </div>
            )}

            {/* Inline Appointment Request Card */}
            {showBookingForm && (
              <AppointmentRequestCard
                conversationId={conversationId}
                language={language}
                clinicInfo={clinicInfo}
                onCancel={() => setShowBookingForm(false)}
                onSuccess={(res) => {
                  setShowBookingForm(false);
                  setConversationId(res.conversationId);
                  localStorage.setItem('fd_patient_conv_id', String(res.conversationId));
                  setHandoverActive(true);
                  void loadConversation(res.conversationId);
                }}
              />
            )}

            <div ref={bottomRef} />
          </div>

          {/* Quick-Reply Action Buttons */}
          <div className="px-3 sm:px-4 py-2.5 bg-white border-t border-slate-100">
            <div className="flex flex-wrap gap-2">
              {QUICK_REPLIES.map((qr) => (
                <button
                  key={qr.label}
                  type="button"
                  disabled={sending}
                  onClick={() => {
                    if (qr.isBooking) {
                      void sendMessage(qr.question, true);
                    } else {
                      void sendMessage(qr.question);
                    }
                  }}
                  className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-blue-800 bg-blue-50/70 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  {qr.label}
                </button>
              ))}
            </div>
          </div>

          {/* Error Notice */}
          {errorBanner && (
            <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorBanner}</span>
            </div>
          )}

          {/* Message Input Composer */}
          <form onSubmit={handleSubmit} className="p-3 sm:p-4 bg-white border-t border-slate-200 flex items-center gap-2">
            <label htmlFor="patient-message-input" className="sr-only">
              Type your question in English, Hindi, or Telugu
            </label>
            <input
              id="patient-message-input"
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask in English, हिन्दी, or తెలుగు..."
              disabled={sending}
              className="flex-1 min-w-0 min-h-[44px] px-3.5 py-2 text-sm text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
            <button
              type="submit"
              disabled={sending || !inputText.trim()}
              aria-label="Send message"
              className="min-h-[44px] min-w-[44px] px-4 py-2 inline-flex items-center justify-center gap-1.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-xl transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
        </section>

        {/* Desktop Clinic Details Sidebar (Hidden on narrow mobile so chat has full screen) */}
        <aside className="hidden lg:flex w-80 shrink-0 flex-col gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Clinic Reference</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Answers are grounded exclusively in verified clinic records.
              </p>
            </div>

            <div className="space-y-3 pt-2 border-t border-slate-100 text-xs text-slate-700">
              <div className="flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-900">Clinic Timings</p>
                  <p className="text-slate-600 mt-0.5">
                    {clinicInfo?.opening_time && clinicInfo?.closing_time
                      ? `${clinicInfo.working_days.join(', ')} · ${clinicInfo.opening_time} – ${clinicInfo.closing_time}`
                      : 'Pending clinic verification (ask reception)'}
                  </p>
                  {clinicInfo?.sunday_hours && (
                    <p className="text-slate-500 mt-0.5">Sun: {clinicInfo.sunday_hours}</p>
                  )}
                  {clinicInfo?.lunch_break && (
                    <p className="text-slate-500 mt-0.5">Lunch: {clinicInfo.lunch_break}</p>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-900">Location & Parking</p>
                  <p className="text-slate-600 mt-0.5">
                    {clinicInfo?.address || 'Banjara Hills, Hyderabad (exact address pending)'}
                  </p>
                  {clinicInfo?.landmark && (
                    <p className="text-slate-500 mt-0.5">{clinicInfo.landmark}</p>
                  )}
                  {clinicInfo?.parking && (
                    <p className="text-slate-500 mt-0.5">{clinicInfo.parking}</p>
                  )}
                  {clinicInfo?.maps_link && (
                    <a
                      href={clinicInfo.maps_link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block mt-1 text-blue-700 hover:underline font-medium"
                    >
                      Open in Google Maps
                    </a>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Phone className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-slate-900">Contact & Emergency</p>
                  <p className="text-slate-600 mt-0.5 tabular-nums">
                    {clinicInfo?.phone ? `Desk: ${clinicInfo.phone}` : 'Phone pending verification'}
                  </p>
                  {clinicInfo?.whatsapp && (
                    <p className="text-slate-600 mt-0.5 tabular-nums">WhatsApp: {clinicInfo.whatsapp}</p>
                  )}
                  {clinicInfo?.emergency_phone && (
                    <p className="text-red-700 font-medium mt-0.5 tabular-nums">
                      Emergency: {clinicInfo.emergency_phone}
                    </p>
                  )}
                  <p className="text-slate-500 mt-1">Medical emergency in India: Dial 112</p>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowBookingForm(true)}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-xl transition-colors"
              >
                <Calendar className="w-4 h-4" />
                <span>Request Appointment</span>
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 text-xs text-slate-600 space-y-2">
            <p className="font-semibold text-slate-900">Patient Privacy & Safety</p>
            <p>
              Virtual reception cannot diagnose dental conditions or prescribe medication. Unconfirmed enquiries are routed to our clinic team with a 2-working-hour callback target.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
