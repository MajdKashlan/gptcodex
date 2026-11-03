import { describe, expect, it } from 'vitest';
import { isClosedStatus, mergePage, SalesListRow, sourcesForView, tabFilter } from './sales-documents';

const row = (name: string, modified: string): SalesListRow => ({
  key: name, name, doctype: 'Sales Order', documentType: 'Order', customer: 'C', date: '2026-01-01', modified,
});

describe('sales documents', () => {
  it('merges per-doctype lists newest first and slices the requested page', () => {
    const a = [row('A1', '2026-01-05'), row('A2', '2026-01-02')];
    const b = [row('B1', '2026-01-04'), row('B2', '2026-01-01')];
    expect(mergePage([a, b], 1, 2).map((r) => r.name)).toEqual(['A1', 'B1']);
    expect(mergePage([a, b], 2, 2).map((r) => r.name)).toEqual(['A2', 'B2']);
  });

  it('uses doctype-specific closed statuses', () => {
    expect(isClosedStatus('Sales Invoice', 'Paid')).toBe(true);
    expect(isClosedStatus('Sales Order', 'Paid')).toBe(false);
    expect(tabFilter(sourcesForView('orders')[0], 'open')).toEqual([
      ['Sales Order', 'status', 'not in', ['Closed', 'Completed', 'Cancelled']],
    ]);
  });

  it('the all view combines quotes, orders and every invoice', () => {
    expect(sourcesForView('all').map((s) => s.doctype)).toEqual(['Quotation', 'Sales Order', 'Sales Invoice']);
  });
});
