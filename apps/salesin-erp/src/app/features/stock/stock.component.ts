import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, forkJoin, Observable } from 'rxjs';
import { Page } from '../../core/api/frappe-api.service';
import { frappeErrorMessage } from '../../core/http/frappe-error';
import { NotificationService } from '../../core/http/notification.service';
import { downloadCsv } from '../../core/utils/csv';
import { todayIso } from '../../core/utils/date';
import { ErpNextBin, ErpNextStockEntry, ErpNextStockEntryType, ErpNextStockLedgerEntry } from '../../models/stock.models';
import { ConfirmService } from '../../shared/components/confirm-dialog/confirm.service';
import { LinkInputComponent } from '../../shared/components/link-input/link-input.component';
import { PagerComponent } from '../../shared/components/pager/pager.component';
import { AppDatePipe, MoneyPipe, QtyPipe } from '../../shared/pipes/format.pipes';
import { StockEntryRequest, StockService } from './stock.service';

type StockTab = 'entries' | 'levels' | 'movements';
const PAGE_SIZE = 25;

/** Stock on hand, stock movements and Stock Entry creation. */
@Component({
  selector: 'app-stock',
  imports: [ReactiveFormsModule, RouterLink, LinkInputComponent, PagerComponent, AppDatePipe, MoneyPipe, QtyPipe],
  templateUrl: './stock.component.html',
  styleUrl: './stock.component.scss',
})
export class StockComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly stockService = inject(StockService);
  private readonly confirm = inject(ConfirmService);
  private readonly notifications = inject(NotificationService);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly tab = signal<StockTab>('levels');
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly levels = signal<ErpNextBin[]>([]);
  protected readonly movements = signal<ErpNextStockLedgerEntry[]>([]);
  protected readonly entries = signal<ErpNextStockEntry[]>([]);
  protected readonly warehouses = signal<string[]>([]);
  protected readonly companies = signal<Array<{ name: string }>>([]);
  protected readonly stockEntryTypes = signal<ErpNextStockEntryType[]>([]);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly dialogOpen = signal(false);
  protected readonly busyEntry = signal<string | null>(null);
  protected readonly selectedEntryType = signal('');

  protected readonly warehouseFilter = new FormControl('', { nonNullable: true });
  protected readonly searchText = new FormControl('', { nonNullable: true });

  protected readonly entryForm = this.formBuilder.nonNullable.group({
    stock_entry_type: ['', Validators.required],
    company: ['', Validators.required],
    posting_date: [todayIso(), Validators.required],
    from_warehouse: [''],
    to_warehouse: [''],
  });
  protected readonly entryItems = this.formBuilder.array([this.createItemRow()]);

  protected readonly entryPurpose = computed(() =>
    this.stockEntryTypes().find((entryType) => entryType.name === this.selectedEntryType())?.purpose ?? '');
  protected readonly needsFromWarehouse = computed(() => ['Material Issue', 'Material Transfer'].includes(this.entryPurpose()));
  protected readonly needsToWarehouse = computed(() => ['Material Receipt', 'Material Transfer'].includes(this.entryPurpose()));

  ngOnInit(): void {
    forkJoin({
      companies: this.stockService.listCompanies(),
      types: this.stockService.listStockEntryTypes(),
      warehouses: this.stockService.listWarehouses(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.companies.set(result.companies);
          this.stockEntryTypes.set(result.types);
          this.warehouses.set(result.warehouses);
        },
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
    this.load();
  }

  protected selectTab(tab: StockTab): void {
    this.tab.set(tab);
    this.page.set(1);
    this.load();
  }

  protected applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  protected load(): void {
    const query = { warehouse: this.warehouseFilter.value, search: this.searchText.value, page: this.page(), pageSize: PAGE_SIZE };
    this.loading.set(true);
    this.error.set(null);
    const handle = <T>(source: Observable<Page<T>>, target: (rows: T[]) => void) =>
      source.pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ({ rows, total }) => {
          target(rows);
          this.total.set(total);
        },
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
    switch (this.tab()) {
      case 'levels': handle(this.stockService.levels(query), (rows) => this.levels.set(rows)); break;
      case 'movements': handle(this.stockService.movements(query), (rows) => this.movements.set(rows)); break;
      default: handle(this.stockService.entries(query), (rows) => this.entries.set(rows));
    }
  }

  protected exportCsv(): void {
    const tab = this.tab();
    if (tab === 'levels') {
      downloadCsv(`stock-levels-${todayIso()}.csv`, ['Item', 'Warehouse', 'Actual', 'Reserved', 'Projected', 'Valuation rate', 'Stock value'],
        this.levels().map((r) => [r.item_code, r.warehouse, r.actual_qty, r.reserved_qty, r.projected_qty, r.valuation_rate, r.stock_value]));
    } else if (tab === 'movements') {
      downloadCsv(`stock-movements-${todayIso()}.csv`, ['Date', 'Item', 'Warehouse', 'Qty change', 'Qty after', 'Voucher type', 'Voucher'],
        this.movements().map((r) => [r.posting_date, r.item_code, r.warehouse, r.actual_qty, r.qty_after_transaction, r.voucher_type, r.voucher_no]));
    } else {
      downloadCsv(`stock-entries-${todayIso()}.csv`, ['Entry', 'Date', 'Type', 'From', 'To', 'Value', 'Status'],
        this.entries().map((r) => [r.name, r.posting_date, r.stock_entry_type, r.from_warehouse, r.to_warehouse, r.total_outgoing_value || r.total_incoming_value, this.entryStatus(r)]));
    }
  }

  // ---- new entry -----------------------------------------------------------
  protected createItemRow() {
    return this.formBuilder.nonNullable.group({
      item_code: ['', Validators.required],
      item_name: [''],
      qty: [1, [Validators.required, Validators.min(0.000001)]],
      uom: [''],
    });
  }

  protected addItemRow(): void {
    this.entryItems.push(this.createItemRow());
  }

  protected removeItemRow(index: number): void {
    if (this.entryItems.length > 1) this.entryItems.removeAt(index);
  }

  protected chooseItem(index: number, itemCode: string): void {
    this.stockService.itemInfo(itemCode).subscribe({
      next: (item) => this.entryItems.at(index).patchValue({ item_name: item.item_name ?? '', uom: item.stock_uom ?? '' }),
      error: () => undefined,
    });
  }

  protected chooseEntryType(value: string): void {
    this.selectedEntryType.set(value);
  }

  protected openNewEntry(): void {
    const types = this.stockEntryTypes();
    const preferred = types.find((entryType) => entryType.purpose === 'Material Receipt') ?? types[0];
    const defaultWarehouse = this.warehouseFilter.value || this.warehouses()[0] || '';
    this.entryForm.reset({
      stock_entry_type: preferred?.name ?? '',
      company: this.companies()[0]?.name ?? '',
      posting_date: todayIso(),
      from_warehouse: defaultWarehouse,
      to_warehouse: defaultWarehouse,
    });
    this.selectedEntryType.set(preferred?.name ?? '');
    this.entryItems.clear();
    this.entryItems.push(this.createItemRow());
    this.formError.set(null);
    this.dialogOpen.set(true);
  }

  protected closeDialog(): void {
    if (!this.saving()) this.dialogOpen.set(false);
  }

  protected saveEntry(): void {
    const rows = this.entryItems.getRawValue().filter((row) => row.item_code && Number(row.qty) > 0);
    const value = this.entryForm.getRawValue();
    if (this.entryForm.invalid || !rows.length) {
      this.entryForm.markAllAsTouched();
      this.formError.set('Choose an entry type, company and at least one item with a quantity.');
      return;
    }
    if (this.needsFromWarehouse() && !value.from_warehouse) {
      this.formError.set('Choose the source warehouse.');
      return;
    }
    if (this.needsToWarehouse() && !value.to_warehouse) {
      this.formError.set('Choose the target warehouse.');
      return;
    }
    if (this.needsFromWarehouse() && this.needsToWarehouse() && value.from_warehouse === value.to_warehouse) {
      this.formError.set('Source and target warehouse must be different.');
      return;
    }

    // Only send the warehouses this purpose uses: a target warehouse on a Material
    // Issue (or a source on a Receipt) is rejected by ERPNext.
    const request: StockEntryRequest = {
      stockEntryType: value.stock_entry_type,
      company: value.company,
      postingDate: value.posting_date,
      fromWarehouse: this.needsFromWarehouse() ? value.from_warehouse : undefined,
      toWarehouse: this.needsToWarehouse() ? value.to_warehouse : undefined,
      items: rows.map((row) => ({ itemCode: row.item_code, qty: Number(row.qty), uom: row.uom || undefined })),
    };

    this.saving.set(true);
    this.formError.set(null);
    this.stockService
      .createStockEntry(request)
      .pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.dialogOpen.set(false);
          this.notifications.success(`Stock entry ${created.name} saved as draft. Submit it to update stock.`);
          this.tab.set('entries');
          this.page.set(1);
          this.load();
        },
        error: (error: unknown) => this.formError.set(frappeErrorMessage(error)),
      });
  }

  // ---- entry workflow --------------------------------------------------------
  protected submitEntry(entry: ErpNextStockEntry): void {
    this.confirm.ask({
      title: `Submit ${entry.name}?`,
      message: 'Submitting updates stock levels and posts accounting entries. It can only be reversed by cancelling.',
      confirmLabel: 'Submit',
    }).subscribe((ok) => {
      if (ok) this.runEntryAction(entry, this.stockService.submit(entry.name), 'submitted');
    });
  }

  protected cancelEntry(entry: ErpNextStockEntry): void {
    this.confirm.ask({
      title: `Cancel ${entry.name}?`,
      message: 'Cancelling reverses the stock and accounting entries.',
      confirmLabel: 'Cancel entry',
      cancelLabel: 'Keep',
      danger: true,
    }).subscribe((ok) => {
      if (ok) this.runEntryAction(entry, this.stockService.cancel(entry.name), 'cancelled');
    });
  }

  protected deleteEntry(entry: ErpNextStockEntry): void {
    this.confirm.ask({ title: `Delete draft ${entry.name}?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })
      .subscribe((ok) => {
        if (ok) this.runEntryAction(entry, this.stockService.delete(entry.name), 'deleted');
      });
  }

  private runEntryAction(entry: ErpNextStockEntry, action: Observable<void>, verb: string): void {
    this.busyEntry.set(entry.name);
    action.pipe(finalize(() => this.busyEntry.set(null)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.notifications.success(`${entry.name} ${verb}.`);
        this.load();
      },
      error: (error: unknown) => this.notifications.error(error),
    });
  }

  protected entryStatus(entry: ErpNextStockEntry): string {
    return entry.docstatus === 2 ? 'Cancelled' : entry.docstatus === 1 ? 'Submitted' : 'Draft';
  }
}
