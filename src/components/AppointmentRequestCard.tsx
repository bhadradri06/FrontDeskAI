import { useState, type FormEvent } from 'react';
import { Calendar, X } from 'lucide-react';
import { api } from '../lib/api';
import type { ChatMessageDto, PublicClinicInfo, SupportedLanguage, TicketDto } from '../types/frontdesk';

interface AppointmentRequestCardProps {
  conversationId: number | null;
  language: SupportedLanguage;
  clinicInfo: PublicClinicInfo | null;
  onSuccess: (res: {
    conversationId: number;
    ticket: TicketDto;
    confirmationMessage: ChatMessageDto;
  }) => void;
  onCancel: () => void;
}

function getLocalTodayYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function AppointmentRequestCard({
  conversationId,
  language,
  clinicInfo,
  onSuccess,
  onCancel,
}: AppointmentRequestCardProps) {
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [preferredDoctor, setPreferredDoctor] = useState('Any Available Dentist');
  const [preferredDate, setPreferredDate] = useState(getLocalTodayYmd());
  const [preferredTime, setPreferredTime] = useState('11:00 AM');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.submitAppointmentRequest({
        conversationId,
        patientName,
        patientPhone,
        preferredDoctor,
        preferredDate,
        preferredTime,
        reason,
        language,
      });
      onSuccess(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit booking request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 my-2">
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Calendar className="w-4 h-4 text-blue-700 shrink-0" />
          <span>Request an Appointment</span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close appointment form"
          className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-lg"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="appt-name" className="block text-xs font-medium text-slate-700 mb-1">
              Patient Name *
            </label>
            <input
              id="appt-name"
              type="text"
              required
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="e.g. Aarav Sharma"
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label htmlFor="appt-phone" className="block text-xs font-medium text-slate-700 mb-1">
              Mobile Number (India) *
            </label>
            <input
              id="appt-phone"
              type="tel"
              required
              value={patientPhone}
              onChange={(e) => setPatientPhone(e.target.value)}
              placeholder="e.g. 98490 12345"
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 tabular-nums"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="appt-doctor" className="block text-xs font-medium text-slate-700 mb-1">
              Preferred Doctor
            </label>
            <select
              id="appt-doctor"
              value={preferredDoctor}
              onChange={(e) => setPreferredDoctor(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="Any Available Dentist">Any Available Dentist</option>
              {clinicInfo?.doctors.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="appt-date" className="block text-xs font-medium text-slate-700 mb-1">
              Preferred Date *
            </label>
            <input
              id="appt-date"
              type="date"
              required
              min={getLocalTodayYmd()}
              value={preferredDate}
              onChange={(e) => setPreferredDate(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 tabular-nums"
            />
          </div>
          <div>
            <label htmlFor="appt-time" className="block text-xs font-medium text-slate-700 mb-1">
              Preferred Time *
            </label>
            <select
              id="appt-time"
              value={preferredTime}
              onChange={(e) => setPreferredTime(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="10:00 AM">10:00 AM</option>
              <option value="11:00 AM">11:00 AM</option>
              <option value="12:30 PM">12:30 PM</option>
              <option value="02:30 PM">02:30 PM</option>
              <option value="04:30 PM">04:30 PM</option>
              <option value="06:00 PM">06:00 PM</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="appt-reason" className="block text-xs font-medium text-slate-700 mb-1">
            Reason for Visit *
          </label>
          <input
            id="appt-reason"
            type="text"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Routine dental check-up / Tooth sensitivity"
            className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-slate-500">
            Slot confirmation will be sent by our reception team.
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="min-h-[44px] px-5 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </form>
    </div>
  );
}
