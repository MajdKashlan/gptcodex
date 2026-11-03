import { Component, computed, input, output } from '@angular/core';

/** Server-side pagination bar: "1–20 of 312" with previous/next. */
@Component({
  selector: 'app-pager',
  template: `
    <nav class="pager" aria-label="Pagination">
      <span class="pager-range">{{ rangeLabel() }}</span>
      <div class="pager-buttons">
        <button type="button" class="secondary-button" [disabled]="page() <= 1 || busy()" (click)="pageChange.emit(page() - 1)" aria-label="Previous page">‹ Prev</button>
        <span class="pager-page">Page {{ page() }} of {{ pageCount() }}</span>
        <button type="button" class="secondary-button" [disabled]="page() >= pageCount() || busy()" (click)="pageChange.emit(page() + 1)" aria-label="Next page">Next ›</button>
      </div>
    </nav>
  `,
  styles: `
    .pager { align-items: center; display: flex; flex-wrap: wrap; gap: 8px 16px; justify-content: space-between; padding: 10px 14px; }
    .pager-range { color: var(--text-secondary); font-size: 13px; }
    .pager-buttons { align-items: center; display: flex; gap: 8px; }
    .pager-page { color: var(--text-secondary); font-size: 13px; white-space: nowrap; }
    button { min-height: 36px; padding: 0 12px; cursor: pointer; }
  `,
})
export class PagerComponent {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  readonly busy = input(false);
  readonly pageChange = output<number>();

  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly rangeLabel = computed(() => {
    const total = this.total();
    if (!total) return 'No records';
    const start = (this.page() - 1) * this.pageSize() + 1;
    const end = Math.min(total, this.page() * this.pageSize());
    return `${start.toLocaleString('en-US')}–${end.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
  });
}
