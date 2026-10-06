import { describe, expect, it } from 'vitest';
import { getPageCount, paginateCollection } from './orders-pagination';

describe('Orders pagination helpers', () => {
  it('should paginate a list by page number and size', () => {
    expect(paginateCollection([1, 2, 3, 4, 5], 1, 2)).toEqual([1, 2]);
    expect(paginateCollection([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    expect(paginateCollection([1, 2, 3, 4, 5], 3, 2)).toEqual([5]);
  });

  it('should calculate total pages for empty and non-empty collections', () => {
    expect(getPageCount([], 10)).toBe(1);
    expect(getPageCount([1, 2, 3, 4, 5], 2)).toBe(3);
    expect(getPageCount([1, 2, 3, 4], 10)).toBe(1);
  });
});
