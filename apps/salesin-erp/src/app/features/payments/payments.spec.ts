import { describe, expect, it } from 'vitest';
import { daysBetween } from '../../core/utils/date';
import { buildAging } from './payments.service';

describe('buildAging', () => {
  it('buckets outstanding amounts by days past due per customer', () => {
    const rows = buildAging([
      { customer: 'C1', due_date: '2026-11-10', outstanding: 100 },
      { customer: 'C1', due_date: '2026-10-20', outstanding: 50 },
      { customer: 'C2', due_date: '2026-06-01', outstanding: 300 },
    ], '2026-11-02', daysBetween);
    expect(rows[0]).toMatchObject({ customer: 'C2', days90Plus: 300, total: 300 });
    expect(rows[1]).toMatchObject({ customer: 'C1', current: 100, days1To30: 50, total: 150 });
  });
});
