import { describe, expect, it } from 'vitest';
import { toDictField } from './frappe-api.service';

describe('toDictField (Frappe v16 aggregate syntax)', () => {
  it('converts string aggregates to dict syntax', () => {
    expect(toDictField('sum(base_grand_total) as total')).toEqual({ SUM: 'base_grand_total', as: 'total' });
    expect(toDictField('count(name) as count')).toEqual({ COUNT: 'name', as: 'count' });
    expect(toDictField('sum(`tabSales Order Item`.stock_qty) as qty')).toEqual({ SUM: '`tabSales Order Item`.stock_qty', as: 'qty' });
  });

  it('leaves plain and aliased fields untouched', () => {
    expect(toDictField('customer')).toBe('customer');
    expect(toDictField('`tabSales Order Item`.item_code as item_code')).toBe('`tabSales Order Item`.item_code as item_code');
  });
});
