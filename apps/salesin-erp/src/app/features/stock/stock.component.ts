import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize, forkJoin, Observable, of } from 'rxjs';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { LanguageService } from '../../core/i18n/language.service';
import { frappeErrorMessage } from '../../core/http/frappe-error';
import { ErpNextItem } from '../../models/item.models';
import {
  ErpNextBin,
  ErpNextStockEntry,
  ErpNextStockEntryType,
  ErpNextStockLedgerEntry,
} from '../../models/stock.models';
import {
  PageTopbarAction,
  PageTopbarComponent,
} from '../../shared/components/page-topbar/page-topbar.component';
import { SidebarComponent } from '../../shared/components/sidebar/sidebar.component';
import { StockEntryRequest, StockService } from './stock.service';

type StockTab = 'entries' | 'levels' | 'movements';

interface StockDialogOptions {
  companies: Array<{ name: string; default_currency?: string }>;
  items: ErpNextItem[];
  stockEntryTypes: ErpNextStockEntryType[];
}

/**
 * Stock on hand, stock movements and `Stock Entry` creation.
 *
 * Reads come from `Bin` and `Stock Ledger Entry`, both of which ERPNext maintains
 * as read-only roll-ups. Entries are created as drafts and submitted explicitly,
 * because submitting posts stock and accounting entries.
 */
@Component({
  selector: 'app-stock',
  imports: [CommonModule, ReactiveFormsModule, SidebarComponent, PageTopbarComponent],
  templateUrl: './stock.component.html',
  styleUrl: './stock.component.scss',
})
export class StockComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(ErpNextAuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly stockService = inject(StockService);
  protected readonly i18n = inject(LanguageService);

  protected readonly userName = computed(() => this.auth.currentUser()?.fullName || 'User');
  protected readonly userImage = computed(() => this.auth.currentUser()?.imageUrl);
  protected readonly topbarActions: PageTopbarAction[] = [{ id: 'logout', label: 'Logout' }];

  protected readonly tab = signal<StockTab>('levels');
  protected readonly levels = signal<ErpNextBin[]>([]);
  protected readonly movements = signal<ErpNextStockLedgerEntry[]>([]);
  protected readonly entries = signal<ErpNextStockEntry[]>([]);
  protected readonly warehouses = signal<string[]>([]);
  protected readonly options = signal<StockDialogOptions>({
    companies: [],
    items: [],
    stockEntryTypes: [],
  });

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly dialogOpen = signal(false);
  protected readonly submittingEntry = signal<string | null>(null);

  /** Mirrors the form control so `entryPurpose` can be a reactive computed. */
  protected readonly selectedEntryType = signal('');

  protected readonly warehouseFilter = new FormControl('', { nonNullable: true });
  protected readonly searchText = new FormControl('', { nonNullable: true });

  protected readonly entryForm = this.formBuilder.nonNullable.group({
    stock_entry_type: ['', Validators.required],
    company: ['', Validators.required],
    posting_date: [this.today(), Validators.required],
    from_warehouse: [''],
    to_warehouse: [''],
  });

  protected readonly entryItems = this.formBuilder.array([this.createItemRow()]);

  /** The chosen `Stock Entry Type`'s purpose decides which warehouses are required. */
  protected readonly entryPurpose = computed(() => {
    const name = this.selectedEntryType();
    return (
      this.options().stockEntryTypes.find((entryType) => entryType.name === name)?.purpose ?? ''
    );
  });

  protected readonly needsFromWarehouse = computed(() => {
    const purpose = this.entryPurpose();
    return purpose === 'Material Issue' || purpose === 'Material Transfer';
  });

  protected readonly needsToWarehouse = computed(() => {
    const purpose = this.entryPurpose();
    return purpose === 'Material Receipt' || purpose === 'Material Transfer';
  });

  ngOnInit(): void {
    const session$: Observable<unknown> = this.auth.isAuthenticated()
      ? of(null)
      : this.auth.restoreSession();

    session$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.loadPage(),
      error: () => void this.router.navigate(['/login']),
    });
  }

  protected signOut(): void {
    this.auth.logout().subscribe({ next: () => void this.router.navigate(['/login']) });
  }

  protected handleTopbarAction(actionId: string): void {
    if (actionId === 'logout') {
      this.signOut();
    }
  }

  protected selectTab(tab: StockTab): void {
    this.tab.set(tab);
    this.reloadActiveTab();
  }

  protected applyFilters(): void {
    this.reloadActiveTab();
  }

  protected createItemRow() {
    return this.formBuilder.nonNullable.group({
      item_code: ['', Validators.required],
      qty: [1, Validators.required],
      uom: [''],
    });
  }

  protected addItemRow(): void {
    this.entryItems.push(this.createItemRow());
  }

  protected removeItemRow(index: number): void {
    if (this.entryItems.length > 1) {
      this.entryItems.removeAt(index);
    }
  }

  protected itemRow(index: number) {
    return this.entryItems.at(index);
  }

  protected chooseEntryType(event: Event): void {
    this.selectedEntryType.set((event.target as HTMLSelectElement).value);
  }

  protected openNewEntry(): void {
    const types = this.options().stockEntryTypes;
    const preferred =
      types.find((entryType) => entryType.purpose === 'Material Issue') ?? types[0];
    const defaultWarehouse = this.warehouses()[0] ?? '';

    this.entryForm.reset({
      stock_entry_type: preferred?.name ?? '',
      company: this.options().companies[0]?.name ?? '',
      posting_date: this.today(),
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
    if (this.saving()) {
      return;
    }
    this.dialogOpen.set(false);
  }

  protected saveEntry(): void {
    const rows = this.entryItems
      .getRawValue()
      .filter((row) => row.item_code && Number(row.qty) > 0);
    const value = this.entryForm.getRawValue();

    if (this.entryForm.invalid || !rows.length) {
      this.entryForm.markAllAsTouched();
      this.formError.set(this.i18n.t('stock.entryInvalid'));
      return;
    }
    if (this.needsFromWarehouse() && !value.from_warehouse) {
      this.formError.set(this.i18n.t('stock.fromWarehouseRequired'));
      return;
    }
    if (this.needsToWarehouse() && !value.to_warehouse) {
      this.formError.set(this.i18n.t('stock.toWarehouseRequired'));
      return;
    }

    const request: StockEntryRequest = {
      stockEntryType: value.stock_entry_type,
      company: value.company,
      postingDate: value.posting_date,
      fromWarehouse: value.from_warehouse || undefined,
      toWarehouse: value.to_warehouse || undefined,
      items: rows.map((row) => ({
        itemCode: row.item_code,
        qty: Number(row.qty),
        uom: row.uom || undefined,
      })),
    };

    this.saving.set(true);
    this.formError.set(null);
    this.stockService
      .createStockEntry(request)
      .pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.dialogOpen.set(false);
          this.tab.set('entries');
          this.loadEntries();
        },
        error: (error: unknown) => this.formError.set(frappeErrorMessage(error)),
      });
  }

  protected submitEntry(entry: ErpNextStockEntry, event: Event): void {
    event.stopPropagation();

    const message = this.i18n.t('stock.confirmSubmit').split('{name}').join(entry.name);
    if (!window.confirm(message)) {
      return;
    }

    this.submittingEntry.set(entry.name);
    this.stockService
      .submit('Stock Entry', entry.name)
      .pipe(finalize(() => this.submittingEntry.set(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadEntries(),
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
  }

  protected entryStatus(entry: ErpNextStockEntry): string {
    if (entry.docstatus === 2) {
      return this.i18n.t('stock.cancelled');
    }
    return entry.docstatus === 1 ? this.i18n.t('stock.submitted') : this.i18n.t('stock.draft');
  }

  protected today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private loadPage(): void {
    this.loading.set(true);
    forkJoin({
      companies: this.stockService.listCompanies(),
      items: this.stockService.listItems(),
      stockEntryTypes: this.stockService.listStockEntryTypes(),
      warehouses: this.stockService.listWarehouses(),
    })
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.options.set({
            companies: result.companies,
            items: result.items,
            stockEntryTypes: result.stockEntryTypes,
          });
          this.warehouses.set(result.warehouses);
          this.reloadActiveTab();
        },
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
  }

  private reloadActiveTab(): void {
    switch (this.tab()) {
      case 'levels':
        this.loadLevels();
        return;
      case 'movements':
        this.loadMovements();
        return;
      default:
        this.loadEntries();
    }
  }

  private loadLevels(): void {
    this.loading.set(true);
    this.error.set(null);
    this.stockService
      .listStockLevels({ warehouse: this.warehouseFilter.value, search: this.searchText.value })
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.levels.set(rows),
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
  }

  private loadMovements(): void {
    this.loading.set(true);
    this.error.set(null);
    this.stockService
      .listMovements({
        warehouse: this.warehouseFilter.value,
        itemCode: this.searchText.value.trim(),
      })
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.movements.set(rows),
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
  }

  private loadEntries(): void {
    this.loading.set(true);
    this.error.set(null);
    this.stockService
      .listStockEntries()
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.entries.set(rows),
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
  }
}
