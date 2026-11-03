import { addDaysIso, addMonthsIso, daysBetween, formatDate, parseIsoDate, toIsoDate } from './date';
import { formatMoney } from './format';

describe('date utils', () => {
  it('formats local dates without UTC shift', () => {
    expect(toIsoDate(new Date(2026, 0, 5, 1, 30))).toBe('2026-01-05');
  });

  it('parses date-only strings as local calendar dates', () => {
    const date = parseIsoDate('2026-10-28');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(9);
    expect(date?.getDate()).toBe(28);
    expect(formatDate('2026-10-28')).toBe('Oct 28, 2026');
    expect(formatDate('')).toBe('—');
  });

  it('adds days and months across boundaries', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
  });
});

describe('formatMoney', () => {
  it('uses the given currency and never assumes USD', () => {
    expect(formatMoney(1234.5, 'EUR')).toBe('€1,234.50');
    expect(formatMoney(10, '')).toBe('10.00');
    expect(formatMoney(undefined, 'USD')).toBe('$0.00');
  });
});
