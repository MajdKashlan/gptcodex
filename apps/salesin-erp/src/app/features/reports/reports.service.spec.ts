import { describe, expect, it } from 'vitest';
import { rollUpByMonth } from './reports.service';

describe('rollUpByMonth', () => {
  it('creates a bucket for every month in range and sums days into it', () => {
    const rows = rollUpByMonth([
      { date: '2026-01-05', net: 100, gross: 118, invoices: 1, returns: 0 },
      { date: '2026-01-20', net: -20, gross: -23.6, invoices: 1, returns: 1 },
      { date: '2026-03-01', net: 50, gross: 59, invoices: 1, returns: 0 },
    ], '2025-12-15', '2026-03-31');
    expect(rows.map((r) => r.period)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03']);
    expect(rows[1]).toMatchObject({ net: 80, invoices: 2, returns: 1 });
    expect(rows[2].net).toBe(0);
  });
});
