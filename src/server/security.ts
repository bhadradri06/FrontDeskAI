import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getTodayIstYmd } from './time.ts';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function sanitizeText(input: unknown, maxLength = 2000): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function normalizeIndianPhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, '');
  let digits = cleaned;
  if (digits.startsWith('+91')) {
    digits = digits.slice(3);
  } else if (digits.startsWith('91') && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 11) {
    digits = digits.slice(1);
  }
  if (/^[6-9]\d{9}$/.test(digits)) {
    return `+91 ${digits}`;
  }
  return null;
}

export function validateFutureIstDate(dateStr: string): { valid: boolean; reason?: string } {
  const trimmed = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { valid: false, reason: 'Please provide a valid date in YYYY-MM-DD format.' };
  }
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return { valid: false, reason: 'The selected date is invalid.' };
  }
  const todayIst = getTodayIstYmd();
  if (trimmed < todayIst) {
    return {
      valid: false,
      reason: 'Appointment requests cannot be booked for dates in the past. Please choose today or a future date.',
    };
  }
  return { valid: true };
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(windowMs: number, maxRequests: number) {
  const buckets = new Map<string, RateBucket>();
  return (req: Request, res: Response, next: NextFunction) => {
    // Allow automated tests running without socket IP issues or with test bypass header only in NODE_ENV=test
    if (process.env.NODE_ENV === 'test') {
      return next();
    }
    const key = (req.ip || req.socket.remoteAddress || 'unknown') + ':' + req.path;
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (current.count >= maxRequests) {
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment before trying again.',
      });
    }
    current.count += 1;
    return next();
  };
}
