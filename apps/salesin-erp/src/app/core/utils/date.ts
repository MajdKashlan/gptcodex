/**
 * Date helpers for ERPNext date-only fields (`yyyy-MM-dd`).
 *
 * Never use `new Date().toISOString().slice(0, 10)` for "today": that is the UTC
 * date, which in Istanbul (UTC+3) is still yesterday until 03:00. Date-only strings
 * are also parsed as local calendar dates here, so they never shift by a day when
 * displayed.
 */

const pad = (value: number): string => String(value).padStart(2, '0');

/** Formats a Date as a local `yyyy-MM-dd` string. */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today's local calendar date as `yyyy-MM-dd`. */
export function todayIso(): string {
  return toIsoDate(new Date());
}

/** Parses `yyyy-MM-dd` (optionally followed by a time) as a local date. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, y, m, d, hh, mm, ss] = match;
  return new Date(Number(y), Number(m) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0), Number(ss ?? 0));
}

/** Adds whole days to a `yyyy-MM-dd` date. */
export function addDaysIso(value: string, days: number): string {
  const date = parseIsoDate(value) ?? new Date();
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Adds whole months to a `yyyy-MM-dd` date (day clamped to the month's end). */
export function addMonthsIso(value: string, months: number): string {
  const date = parseIsoDate(value) ?? new Date();
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return toIsoDate(date);
}

/** First day of the month containing `value`. */
export function startOfMonthIso(value: string): string {
  return value.slice(0, 8) + '01';
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) {
    return 0;
  }
  const utcStart = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const utcEnd = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((utcEnd - utcStart) / 86_400_000);
}

const dateFormatters = {
  short: new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' }),
  medium: new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
  month: new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }),
  datetime: new Intl.DateTimeFormat('en-US', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }),
};

export type DateStyle = keyof typeof dateFormatters;

/** Display formatting for ERPNext date / datetime strings. Empty input gives `—`. */
export function formatDate(value: string | null | undefined, style: DateStyle = 'medium'): string {
  const date = parseIsoDate(value);
  return date ? dateFormatters[style].format(date) : '—';
}
