import type { ClinicSettings, TicketStatus } from './types.ts';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export type ClockFn = () => Date;

let activeClock: ClockFn = () => new Date();

export function setTestClock(fn: ClockFn | null): void {
  activeClock = fn ?? (() => new Date());
}

export function getNow(): Date {
  return activeClock();
}

export function getNowIso(): string {
  return getNow().toISOString();
}

export function toIstDate(dateInput: string | Date): Date {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return new Date(d.getTime() + IST_OFFSET_MS);
}

export function formatIstDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date) + ' IST';
}

export function formatIstTimeOnly(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function getTodayIstYmd(now: Date = getNow()): string {
  const ist = toIstDate(now);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatCalendarAge(createdIso: string, now: Date = getNow()): string {
  const created = new Date(createdIso);
  const diffMs = Math.max(0, now.getTime() - created.getTime());
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins === 1) return '1 minute';
  if (mins < 60) return `${mins} minutes`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return '1 hour';
  if (hours < 24) return `${hours} hours`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day';
  return `${days} days`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseTimeToMinutes(timeStr: string, fallbackMinutes: number): number {
  if (!timeStr || timeStr.toUpperCase().includes('FILL IN')) {
    return fallbackMinutes;
  }
  const trimmed = timeStr.trim().toUpperCase();
  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (match12) {
    let h = Number(match12[1]);
    const m = Number(match12[2]);
    const ampm = match12[3];
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    return Number(match24[1]) * 60 + Number(match24[2]);
  }
  return fallbackMinutes;
}

/**
 * Computes how many clinic working minutes have elapsed between createdIso and now,
 * respecting configurable working days, opening/closing hours, and holidays in IST.
 * Closed hours and holidays do not count toward the 2-working-hour callback SLA.
 */
export function calculateWorkingMinutesElapsed(
  createdIso: string,
  settings: Pick<ClinicSettings, 'working_days' | 'opening_time' | 'closing_time' | 'holidays'>,
  now: Date = getNow()
): number {
  const startUtc = new Date(createdIso);
  if (Number.isNaN(startUtc.getTime()) || now.getTime() <= startUtc.getTime()) {
    return 0;
  }

  const openMins = parseTimeToMinutes(settings.opening_time, 9 * 60); // fallback 09:00 if FILL IN
  const closeMins = parseTimeToMinutes(settings.closing_time, 18 * 60); // fallback 18:00 if FILL IN
  if (closeMins <= openMins) {
    return Math.floor((now.getTime() - startUtc.getTime()) / 60000);
  }

  const workingDaySet = new Set(
    (settings.working_days && settings.working_days.length > 0
      ? settings.working_days
      : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    ).map((d) => d.toLowerCase())
  );
  const holidaySet = new Set((settings.holidays || []).map((h) => h.trim()));

  // Convert boundaries to IST pseudo-UTC dates so getUTC* gives IST calendar components
  const startIst = toIstDate(startUtc);
  const endIst = toIstDate(now);

  let cursorDay = new Date(Date.UTC(startIst.getUTCFullYear(), startIst.getUTCMonth(), startIst.getUTCDate()));
  const endDay = new Date(Date.UTC(endIst.getUTCFullYear(), endIst.getUTCMonth(), endIst.getUTCDate()));

  let totalWorkingMins = 0;
  let safetyDays = 0;

  while (cursorDay.getTime() <= endDay.getTime() && safetyDays < 365) {
    safetyDays += 1;
    const dayName = DAY_NAMES[cursorDay.getUTCDay()].toLowerCase();
    const y = cursorDay.getUTCFullYear();
    const m = String(cursorDay.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cursorDay.getUTCDate()).padStart(2, '0');
    const ymd = `${y}-${m}-${d}`;

    if (workingDaySet.has(dayName) && !holidaySet.has(ymd)) {
      const dayOpenMs = cursorDay.getTime() + openMins * 60000;
      const dayCloseMs = cursorDay.getTime() + closeMins * 60000;

      const overlapStart = Math.max(startIst.getTime(), dayOpenMs);
      const overlapEnd = Math.min(endIst.getTime(), dayCloseMs);

      if (overlapEnd > overlapStart) {
        totalWorkingMins += Math.floor((overlapEnd - overlapStart) / 60000);
      }
    }

    cursorDay = new Date(cursorDay.getTime() + 24 * 60 * 60 * 1000);
  }

  return totalWorkingMins;
}

export function isTicketOverdue(
  status: TicketStatus,
  workingMinutesElapsed: number,
  slaMinutes = 120
): boolean {
  if (status === 'RESOLVED' || status === 'CLOSED') {
    return false;
  }
  return workingMinutesElapsed > slaMinutes;
}

export function formatWorkingAge(workingMinutes: number): string {
  if (workingMinutes < 1) return '0 working mins';
  if (workingMinutes === 1) return '1 working min';
  if (workingMinutes < 60) return `${workingMinutes} working mins`;
  const hrs = Math.floor(workingMinutes / 60);
  const rem = workingMinutes % 60;
  if (rem === 0) return hrs === 1 ? '1 working hr' : `${hrs} working hrs`;
  return `${hrs}h ${rem}m working`;
}
