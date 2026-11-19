import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type {
  AuditLogDto,
  FullKnowledgeBaseDto,
  StaffUserDto,
} from '../types/frontdesk';

interface ClinicSettingsPageProps {
  onNavigate: (path: string) => void;
}

type SettingsTab = 'clinic' | 'doctors' | 'pricing' | 'insurance' | 'policies' | 'audit';

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function ClinicSettingsPage({ onNavigate }: ClinicSettingsPageProps) {
  const [user, setUser] = useState<StaffUserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [kb, setKb] = useState<FullKnowledgeBaseDto | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogDto[]>([]);
  const [activeTab, setActiveTab] = useState<SettingsTab>('clinic');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Editable clinic settings form state
  const [settingsForm, setSettingsForm] = useState<FullKnowledgeBaseDto['settings'] | null>(null);
  const [holidayInput, setHolidayInput] = useState('');

  // New doctor form
  const [newDoctor, setNewDoctor] = useState({
    name: '',
    qualifications: '',
    specialisation: '',
    experience: '',
    available_days: '',
    consultation_hours: '',
  });

  // New service form
  const [newService, setNewService] = useState({
    name: '',
    category: 'General Dentistry',
    consultation_fee: 'FILL IN',
    treatment_price_range: 'FILL IN',
    additional_charges: 'FILL IN',
  });

  // New insurance form
  const [newInsurance, setNewInsurance] = useState({
    provider_name: '',
    cashless_available: false,
    reimbursement_policy: '',
    required_documents: '',
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    try {
      const me = await api.getStaffMe();
      setUser(me.user);
      if (me.user.role !== 'admin') {
        setAuthError('Administrator role is required to edit clinic knowledge base records.');
        return;
      }
      const data = await api.getAdminClinic();
      setKb(data.kb);
      setSettingsForm(data.kb.settings);
      setAuditLogs(data.auditLogs);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Please sign in at /staff as an administrator.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const showSuccess = (msg: string) => {
    setErrorMessage(null);
    setStatusMessage(msg);
  };

  const showError = (err: unknown) => {
    setStatusMessage(null);
    setErrorMessage(err instanceof Error ? err.message : 'Save failed.');
  };

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!settingsForm) return;
    try {
      const res = await api.updateClinicSettings(settingsForm as unknown as Record<string, unknown>);
      showSuccess(`Clinic information saved. Knowledge Base updated to v${res.kb_version} and cached answers cleared.`);
      await loadAll();
    } catch (err) {
      showError(err);
    }
  };

  const handleCancelSettings = () => {
    if (kb) {
      setSettingsForm(kb.settings);
      setStatusMessage('Unsaved clinic setting edits discarded.');
      setErrorMessage(null);
    }
  };

  const handleAddDoctor = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.addDoctor(newDoctor);
      setNewDoctor({
        name: '',
        qualifications: '',
        specialisation: '',
        experience: '',
        available_days: '',
        consultation_hours: '',
      });
      showSuccess(`Doctor added. Knowledge Base updated to v${res.kb_version}.`);
      await loadAll();
    } catch (err) {
      showError(err);
    }
  };

  const handleAddService = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.addService(newService);
      setNewService({
        name: '',
        category: 'General Dentistry',
        consultation_fee: 'FILL IN',
        treatment_price_range: 'FILL IN',
        additional_charges: 'FILL IN',
      });
      showSuccess(`Service & pricing added (KB v${res.kb_version}).`);
      await loadAll();
    } catch (err) {
      showError(err);
    }
  };

  const handleAddInsurance = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.addInsurance(newInsurance);
      setNewInsurance({
        provider_name: '',
        cashless_available: false,
        reimbursement_policy: '',
        required_documents: '',
      });
      showSuccess(`Insurance provider saved (KB v${res.kb_version}).`);
      await loadAll();
    } catch (err) {
      showError(err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50 flex items-center justify-center p-6">
        <p className="text-sm text-slate-600">Loading clinic knowledge base...</p>
      </div>
    );
  }

  if (authError || !kb || !settingsForm) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <h1 className="text-lg font-bold text-slate-900">Administrator Access Required</h1>
          <p className="text-sm text-slate-600">{authError || 'Please sign in as a clinic administrator.'}</p>
          <button
            type="button"
            onClick={() => onNavigate('/staff')}
            className="min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
          >
            Go to Staff Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50 px-3 sm:px-6 py-5">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Top Context Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => onNavigate('/staff')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:underline mb-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Reception Ticket Queue</span>
            </button>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Clinic Knowledge Base Management</h1>
            <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2 mt-0.5 tabular-nums">
              <span>KB v{kb.settings.kb_version}</span>
              <span aria-hidden="true">·</span>
              <span>Last updated by {kb.settings.updated_by}</span>
              <span aria-hidden="true">·</span>
              <span>{kb.settings.updated_at.slice(0, 16).replace('T', ' ')} UTC</span>
              <span aria-hidden="true">·</span>
              <span>Signed in: {user?.full_name}</span>
            </div>
          </div>
        </div>

        {/* Feedback Banners */}
        {statusMessage && (
          <div role="status" className="bg-teal-50 border border-teal-200 text-teal-900 rounded-xl px-4 py-3 text-xs sm:text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}
        {errorMessage && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-900 rounded-xl px-4 py-3 text-xs sm:text-sm">
            {errorMessage}
          </div>
        )}

        {/* Section Tabs */}
        <div className="flex flex-wrap gap-1.5 bg-white border border-slate-200 rounded-xl p-2">
          {(
            [
              ['clinic', 'Clinic & Timings'],
              ['doctors', `Doctors (${kb.doctors.length})`],
              ['pricing', `Services & Pricing (${kb.pricing.length})`],
              ['insurance', `Insurance (${kb.insurance.length})`],
              ['policies', `Policies (${kb.policies.length})`],
              ['audit', `Owner Checklist (${kb.missingChecklist.length}) & Audit`],
            ] as Array<[SettingsTab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`min-h-[40px] px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === id ? 'bg-blue-700 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* TAB 1: CLINIC INFO & TIMINGS */}
        {activeTab === 'clinic' && (
          <form onSubmit={handleSaveSettings} className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Clinic Name *</label>
                <input
                  type="text"
                  required
                  value={settingsForm.clinic_name}
                  onChange={(e) => setSettingsForm({ ...settingsForm, clinic_name: e.target.value })}
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full Address</label>
                <input
                  type="text"
                  value={settingsForm.address}
                  onChange={(e) => setSettingsForm({ ...settingsForm, address: e.target.value })}
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Google Maps Link</label>
                <input
                  type="text"
                  value={settingsForm.maps_link}
                  onChange={(e) => setSettingsForm({ ...settingsForm, maps_link: e.target.value })}
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Clinic Phone</label>
                <input
                  type="text"
                  value={settingsForm.phone}
                  onChange={(e) => setSettingsForm({ ...settingsForm, phone: e.target.value })}
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">WhatsApp Number</label>
                <input
                  type="text"
                  value={settingsForm.whatsapp}
                  onChange={(e) => setSettingsForm({ ...settingsForm, whatsapp: e.target.value })}
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Clinic Email</label>
                <input
                  type="text"
                  value={settingsForm.email}
                  onChange={(e) => setSettingsForm({ ...settingsForm, email: e.target.value })}
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Verified Emergency Contact Phone</label>
                <input
                  type="text"
                  value={settingsForm.emergency_phone}
                  onChange={(e) => setSettingsForm({ ...settingsForm, emergency_phone: e.target.value })}
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Patient Data Retention (Days)</label>
                <input
                  type="number"
                  min={7}
                  max={3650}
                  value={settingsForm.retention_days}
                  onChange={(e) => setSettingsForm({ ...settingsForm, retention_days: Number(e.target.value) })}
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Opening Time (e.g. 10:00 AM)</label>
                <input
                  type="text"
                  value={settingsForm.opening_time}
                  onChange={(e) => setSettingsForm({ ...settingsForm, opening_time: e.target.value })}
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Closing Time (e.g. 07:00 PM)</label>
                <input
                  type="text"
                  value={settingsForm.closing_time}
                  onChange={(e) => setSettingsForm({ ...settingsForm, closing_time: e.target.value })}
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {/* Working Days */}
            <div>
              <p className="text-xs font-medium text-slate-700 mb-2">Working Days (used for 2-working-hour SLA)</p>
              <div className="flex flex-wrap gap-2">
                {ALL_DAYS.map((day) => {
                  const checked = settingsForm.working_days.includes(day);
                  return (
                    <label
                      key={day}
                      className={`inline-flex items-center gap-2 min-h-[40px] px-3 py-1.5 text-xs font-medium border rounded-lg cursor-pointer ${
                        checked ? 'bg-blue-50 border-blue-300 text-blue-900' : 'bg-white border-slate-300 text-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...settingsForm.working_days, day]
                            : settingsForm.working_days.filter((d) => d !== day);
                          setSettingsForm({ ...settingsForm, working_days: next });
                        }}
                      />
                      <span>{day}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Holidays */}
            <div>
              <p className="text-xs font-medium text-slate-700 mb-2">Clinic Holidays (YYYY-MM-DD excluded from SLA)</p>
              <div className="flex items-center gap-2 max-w-sm">
                <input
                  type="date"
                  value={holidayInput}
                  onChange={(e) => setHolidayInput(e.target.value)}
                  className="flex-1 min-h-[40px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (holidayInput && !settingsForm.holidays.includes(holidayInput)) {
                      setSettingsForm({ ...settingsForm, holidays: [...settingsForm.holidays, holidayInput] });
                      setHolidayInput('');
                    }
                  }}
                  className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-lg"
                >
                  Add Holiday
                </button>
              </div>
              {settingsForm.holidays.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {settingsForm.holidays.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() =>
                        setSettingsForm({
                          ...settingsForm,
                          holidays: settingsForm.holidays.filter((x) => x !== h),
                        })
                      }
                      className="text-xs font-mono px-2.5 py-1 bg-slate-100 hover:bg-red-50 hover:text-red-700 rounded-md"
                    >
                      {h} ×
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={handleCancelSettings}
                className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
              >
                Save Clinic Details
              </button>
            </div>
          </form>
        )}

        {/* TAB 2: DOCTORS */}
        {activeTab === 'doctors' && (
          <div className="space-y-5">
            <form onSubmit={handleAddDoctor} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">Add Approved Doctor</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Doctor Name *"
                  value={newDoctor.name}
                  onChange={(e) => setNewDoctor({ ...newDoctor, name: e.target.value })}
                  className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Qualifications (e.g. MDS, BDS)"
                  value={newDoctor.qualifications}
                  onChange={(e) => setNewDoctor({ ...newDoctor, qualifications: e.target.value })}
                  className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Specialisation"
                  value={newDoctor.specialisation}
                  onChange={(e) => setNewDoctor({ ...newDoctor, specialisation: e.target.value })}
                  className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Experience (e.g. 10 years)"
                  value={newDoctor.experience}
                  onChange={(e) => setNewDoctor({ ...newDoctor, experience: e.target.value })}
                  className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Available Days (e.g. Mon-Sat)"
                  value={newDoctor.available_days}
                  onChange={(e) => setNewDoctor({ ...newDoctor, available_days: e.target.value })}
                  className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Consultation Hours"
                  value={newDoctor.consultation_hours}
                  onChange={(e) => setNewDoctor({ ...newDoctor, consultation_hours: e.target.value })}
                  className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="submit"
                className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
              >
                <Plus className="w-4 h-4" />
                <span>Add Doctor</span>
              </button>
            </form>

            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
              {kb.doctors.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No doctors added yet.</p>
              ) : (
                kb.doctors.map((doc) => (
                  <DoctorRow
                    key={doc.id}
                    doc={doc}
                    onSave={async (patch) => {
                      try {
                        const res = await api.updateDoctor(doc.id, patch);
                        showSuccess(`Updated ${doc.name} (KB v${res.kb_version}).`);
                        await loadAll();
                      } catch (err) {
                        showError(err);
                      }
                    }}
                    onDelete={async () => {
                      try {
                        const res = await api.deleteDoctor(doc.id);
                        showSuccess(`Removed ${doc.name} (KB v${res.kb_version}).`);
                        await loadAll();
                      } catch (err) {
                        showError(err);
                      }
                    }}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: SERVICES & PRICING */}
        {activeTab === 'pricing' && (
          <div className="space-y-5">
            <form onSubmit={handleAddService} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Add New Dental Service & Pricing</h2>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Service Name *"
                  value={newService.name}
                  onChange={(e) => setNewService({ ...newService, name: e.target.value })}
                  className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Consultation Fee (e.g. ₹500)"
                  value={newService.consultation_fee}
                  onChange={(e) => setNewService({ ...newService, consultation_fee: e.target.value })}
                  className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Treatment Price Range"
                  value={newService.treatment_price_range}
                  onChange={(e) => setNewService({ ...newService, treatment_price_range: e.target.value })}
                  className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <button
                  type="submit"
                  className="min-h-[42px] px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
                >
                  Add Service
                </button>
              </div>
            </form>

            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
              {kb.pricing.map((row) => (
                <PricingRow
                  key={row.id}
                  item={row}
                  onSave={async (patch) => {
                    try {
                      const res = await api.updatePricing(row.id, patch);
                      showSuccess(`Updated pricing for ${row.service_name} (KB v${res.kb_version}). Old cache invalidated.`);
                      await loadAll();
                    } catch (err) {
                      showError(err);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: INSURANCE */}
        {activeTab === 'insurance' && (
          <div className="space-y-5">
            <form onSubmit={handleAddInsurance} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Add Accepted Insurance Provider</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Insurance Provider Name *"
                  value={newInsurance.provider_name}
                  onChange={(e) => setNewInsurance({ ...newInsurance, provider_name: e.target.value })}
                  className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <label className="inline-flex items-center gap-2 min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg">
                  <input
                    type="checkbox"
                    checked={newInsurance.cashless_available}
                    onChange={(e) => setNewInsurance({ ...newInsurance, cashless_available: e.target.checked })}
                  />
                  <span>Cashless facility available</span>
                </label>
                <input
                  type="text"
                  placeholder="Reimbursement Policy"
                  value={newInsurance.reimbursement_policy}
                  onChange={(e) => setNewInsurance({ ...newInsurance, reimbursement_policy: e.target.value })}
                  className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="Required Documents"
                  value={newInsurance.required_documents}
                  onChange={(e) => setNewInsurance({ ...newInsurance, required_documents: e.target.value })}
                  className="min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="submit"
                className="min-h-[42px] px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
              >
                Add Provider
              </button>
            </form>

            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
              {kb.insurance.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No insurance providers added yet.</p>
              ) : (
                kb.insurance.map((ins) => (
                  <div key={ins.id} className="p-4 flex items-center justify-between gap-4 text-sm">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {ins.provider_name} · {ins.cashless_available ? 'Cashless' : 'Reimbursement'}
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Policy: {ins.reimbursement_policy} · Docs: {ins.required_documents}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.deleteInsurance(ins.id);
                        showSuccess('Insurance provider deleted.');
                        await loadAll();
                      }}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center text-red-700 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 5: CLINIC POLICIES */}
        {activeTab === 'policies' && (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
            {kb.policies.map((pol) => (
              <PolicyRow
                key={pol.id}
                policy={pol}
                onSave={async (content) => {
                  try {
                    const res = await api.updatePolicy(pol.id, { content });
                    showSuccess(`Updated ${pol.title} (KB v${res.kb_version}).`);
                    await loadAll();
                  } catch (err) {
                    showError(err);
                  }
                }}
              />
            ))}
          </div>
        )}

        {/* TAB 6: MISSING OWNER CHECKLIST & AUDIT HISTORY */}
        {activeTab === 'audit' && (
          <div className="space-y-5">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Information Needed From Clinic Owner ({kb.missingChecklist.length} remaining)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Any field marked FILL IN is withheld from AI responses and automatically routed to staff tickets.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await api.purgeRetention();
                    showSuccess(`Retention purge complete: ${res.deletedConversations} expired conversations removed.`);
                  }}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg shrink-0"
                >
                  Run Retention Purge ({kb.settings.retention_days}d)
                </button>
              </div>
              {kb.missingChecklist.length === 0 ? (
                <p className="text-xs text-teal-700 font-medium">All clinic fields have been verified.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                  {kb.missingChecklist.map((item, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
                      <p className="font-semibold text-slate-800">{item.field}</p>
                      <p className="text-slate-500">{item.section} · {item.currentValue}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900">Audit Log (Prices, Doctors, Policies & Staff)</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2.5 px-4">Timestamp (IST)</th>
                      <th className="py-2.5 px-4">Staff</th>
                      <th className="py-2.5 px-4">Action</th>
                      <th className="py-2.5 px-4">Entity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">{log.created_at_ist}</td>
                        <td className="py-2.5 px-4 font-medium text-slate-900">{log.staff_name}</td>
                        <td className="py-2.5 px-4 font-mono text-blue-700">{log.action}</td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {log.entity_type} #{log.entity_id}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DoctorRow({
  doc,
  onSave,
  onDelete,
}: {
  doc: FullKnowledgeBaseDto['doctors'][number];
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [form, setForm] = useState(doc);
  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="min-h-[40px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
        />
        <input
          type="text"
          value={form.qualifications}
          onChange={(e) => setForm({ ...form, qualifications: e.target.value })}
          className="min-h-[40px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
        />
        <input
          type="text"
          value={form.specialisation}
          onChange={(e) => setForm({ ...form, specialisation: e.target.value })}
          className="min-h-[40px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
        />
        <input
          type="text"
          value={form.experience}
          onChange={(e) => setForm({ ...form, experience: e.target.value })}
          className="min-h-[40px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
        />
        <input
          type="text"
          value={form.available_days}
          onChange={(e) => setForm({ ...form, available_days: e.target.value })}
          className="min-h-[40px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
        />
        <input
          type="text"
          value={form.consultation_hours}
          onChange={(e) => setForm({ ...form, consultation_hours: e.target.value })}
          className="min-h-[40px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setForm(doc)}
          className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onDelete()}
          className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-red-700 border border-red-200 hover:bg-red-50 rounded-lg"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => void onSave(form as unknown as Record<string, unknown>)}
          className="min-h-[38px] px-4 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function PricingRow({
  item,
  onSave,
}: {
  item: FullKnowledgeBaseDto['pricing'][number];
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [consultation_fee, setFee] = useState(item.consultation_fee);
  const [treatment_price_range, setRange] = useState(item.treatment_price_range);
  const [additional_charges, setExtra] = useState(item.additional_charges);

  return (
    <div className="p-4 space-y-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-sm font-semibold text-slate-900">{item.service_name}</span>
        <span className="text-slate-500 tabular-nums">
          Updated {item.last_updated.slice(0, 10)} by {item.updated_by}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Consultation Fee</label>
          <input
            type="text"
            value={consultation_fee}
            onChange={(e) => setFee(e.target.value)}
            className="w-full min-h-[40px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Treatment Price Range</label>
          <input
            type="text"
            value={treatment_price_range}
            onChange={(e) => setRange(e.target.value)}
            className="w-full min-h-[40px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Additional Charges</label>
          <input
            type="text"
            value={additional_charges}
            onChange={(e) => setExtra(e.target.value)}
            className="w-full min-h-[40px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setFee(item.consultation_fee);
            setRange(item.treatment_price_range);
            setExtra(item.additional_charges);
          }}
          className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onSave({ consultation_fee, treatment_price_range, additional_charges })}
          className="min-h-[38px] px-4 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
        >
          Save Price
        </button>
      </div>
    </div>
  );
}

function PolicyRow({
  policy,
  onSave,
}: {
  policy: FullKnowledgeBaseDto['policies'][number];
  onSave: (content: string) => Promise<void>;
}) {
  const [content, setContent] = useState(policy.content);
  return (
    <div className="p-4 space-y-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-sm font-semibold text-slate-900">{policy.title}</span>
        <span className="text-slate-500 tabular-nums">
          Updated {policy.updated_at.slice(0, 10)} by {policy.updated_by}
        </span>
      </div>
      <textarea
        rows={2}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full p-2.5 text-sm border border-slate-300 rounded-lg"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setContent(policy.content)}
          className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onSave(content)}
          className="min-h-[38px] px-4 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
        >
          Save Policy
        </button>
      </div>
    </div>
  );
}
