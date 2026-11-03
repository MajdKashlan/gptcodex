import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, Observable } from 'rxjs';
import { AppContextService, CompanyInfo } from '../../core/context/app-context.service';
import { frappeErrorMessage } from '../../core/http/frappe-error';
import { downloadCsv } from '../../core/utils/csv';
import { addMonthsIso, daysBetween, formatDate, startOfMonthIso, todayIso } from '../../core/utils/date';
import { formatMoney } from '../../core/utils/format';
import { QtyPipe } from '../../shared/pipes/format.pipes';
import { AgingRow, buildAging, PaymentsService } from '../payments/payments.service';
import { PeriodRow, RankedRow, ReportsService, rollUpByMonth, WarehouseRow } from './reports.service';

type ReportTab = 'sales' | 'customers' | 'items' | 'aging' | 'stock';
type Preset = 'this-month' | 'last-month' | 'this-quarter' | 'this-year' | 'last-12' | 'custom';

const TOP_N = 25;

@Component({
  selector: 'app-reports',
  imports: [FormsModule, RouterLink, QtyPipe],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent implements OnInit {
  private readonly reports = inject(ReportsService);
  private readonly payments = inject(PaymentsService);
  private readonly appContext = inject(AppContextService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly tabs: Array<{ id: ReportTab; label: string; dated: boolean }> = [
    { id: 'sales', label: 'Sales by month', dated: true },
    { id: 'customers', label: 'By customer', dated: true },
    { id: 'items', label: 'By item', dated: true },
    { id: 'aging', label: 'Receivables aging', dated: false },
    { id: 'stock', label: 'Stock value', dated: false },
  ];
  protected readonly presets: Array<{ id: Preset; label: string }> = [
    { id: 'this-month', label: 'This month' },
    { id: 'last-month', label: 'Last month' },
    { id: 'this-quarter', label: 'This quarter' },
    { id: 'this-year', label: 'This year' },
    { id: 'last-12', label: 'Last 12 months' },
    { id: 'custom', label: 'Custom' },
  ];

  protected readonly tab = signal<ReportTab>('sales');
  protected readonly preset = signal<Preset>('last-12');
  protected readonly from = signal(addMonthsIso(startOfMonthIso(todayIso()), -11));
  protected readonly to = signal(todayIso());
  protected readonly company = signal('');
  protected readonly companies = signal<CompanyInfo[]>([]);
  protected readonly currency = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly periods = signal<PeriodRow[]>([]);
  protected readonly customers = signal<RankedRow[]>([]);
  protected readonly items = signal<RankedRow[]>([]);
  protected readonly aging = signal<AgingRow[]>([]);
  protected readonly warehouses = signal<WarehouseRow[]>([]);

  protected readonly dated = computed(() => this.tabs.find((t) => t.id === this.tab())?.dated ?? false);
  protected readonly salesTotals = computed(() => this.periods().reduce(
    (sum, row) => ({ net: sum.net + row.net, gross: sum.gross + row.gross, invoices: sum.invoices + row.invoices, returns: sum.returns + row.returns }),
    { net: 0, gross: 0, invoices: 0, returns: 0 },
  ));
  protected readonly maxPeriod = computed(() => Math.max(1, ...this.periods().map((row) => Math.abs(row.net))));
  protected readonly topCustomers = computed(() => this.customers().slice(0, TOP_N));
  protected readonly topItems = computed(() => this.items().slice(0, TOP_N));
  protected readonly customersTotal = computed(() => this.customers().reduce((sum, row) => sum + row.value, 0));
  protected readonly itemsTotal = computed(() => this.items().reduce((sum, row) => sum + row.value, 0));
  protected readonly agingTotals = computed(() => this.aging().reduce(
    (sum, row) => ({
      current: sum.current + row.current, d30: sum.d30 + row.days1To30, d60: sum.d60 + row.days31To60,
      d90: sum.d90 + row.days61To90, d90p: sum.d90p + row.days90Plus, total: sum.total + row.total,
    }),
    { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 },
  ));
  protected readonly stockTotal = computed(() => this.warehouses().reduce((sum, row) => sum + row.value, 0));
  protected readonly maxWarehouse = computed(() => Math.max(1, ...this.warehouses().map((row) => row.value)));
  protected readonly topN = TOP_N;
  protected readonly Math = Math;

  ngOnInit(): void {
    this.appContext.context().subscribe((context) => {
      this.companies.set(context.companies);
      this.currency.set(context.currency);
    });
    this.load();
  }

  protected selectTab(tab: ReportTab): void {
    this.tab.set(tab);
    this.load();
  }

  protected applyPreset(preset: Preset): void {
    this.preset.set(preset);
    const today = todayIso();
    const monthStart = startOfMonthIso(today);
    switch (preset) {
      case 'this-month': this.setRange(monthStart, today); break;
      case 'last-month': {
        const start = addMonthsIso(monthStart, -1);
        const end = addMonthsIso(monthStart, 0);
        this.setRange(start, formatEnd(end));
        break;
      }
      case 'this-quarter': {
        const month = Number(today.slice(5, 7));
        const quarterStart = `${today.slice(0, 4)}-${String(month - ((month - 1) % 3)).padStart(2, '0')}-01`;
        this.setRange(quarterStart, today);
        break;
      }
      case 'this-year': this.setRange(today.slice(0, 4) + '-01-01', today); break;
      case 'last-12': this.setRange(addMonthsIso(monthStart, -11), today); break;
      default: return;
    }
    this.load();
  }

  protected changeDate(which: 'from' | 'to', value: string): void {
    if (!value) return;
    this.preset.set('custom');
    if (which === 'from') this.from.set(value);
    else this.to.set(value);
    if (this.from() <= this.to()) this.load();
  }

  protected changeCompany(company: string): void {
    this.company.set(company);
    if (company) this.currency.set(this.companies().find((c) => c.name === company)?.default_currency ?? this.currency());
    this.load();
  }

  protected rangeLabel(): string {
    return `${formatDate(this.from())} – ${formatDate(this.to())}`;
  }

  protected monthLabel(period: string): string {
    return formatDate(period + '-01', 'month');
  }

  protected share(value: number, total: number): number {
    return total ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  }

  protected money(value: number): string {
    return formatMoney(value, this.currency());
  }

  protected exportCsv(): void {
    const suffix = `${this.from()}_${this.to()}`;
    switch (this.tab()) {
      case 'sales':
        downloadCsv(`sales-by-month-${suffix}.csv`, ['Month', 'Net sales', 'Gross (incl. tax)', 'Invoices', 'Credit notes'],
          this.periods().map((row) => [row.period, row.net, row.gross, row.invoices, row.returns]));
        break;
      case 'customers':
        downloadCsv(`sales-by-customer-${suffix}.csv`, ['Customer ID', 'Customer', 'Net sales', 'Invoices'],
          this.customers().map((row) => [row.key, row.label, row.value, row.count]));
        break;
      case 'items':
        downloadCsv(`sales-by-item-${suffix}.csv`, ['Item code', 'Item', 'Net sales', 'Qty (stock UOM)'],
          this.items().map((row) => [row.key, row.label, row.value, row.qty]));
        break;
      case 'aging':
        downloadCsv(`receivables-aging-${todayIso()}.csv`, ['Customer', 'Current', '1-30', '31-60', '61-90', '90+', 'Total'],
          this.aging().map((row) => [row.name, row.current, row.days1To30, row.days31To60, row.days61To90, row.days90Plus, row.total]));
        break;
      case 'stock':
        downloadCsv(`stock-value-${todayIso()}.csv`, ['Warehouse', 'Stock value', 'Qty', 'Item lines'],
          this.warehouses().map((row) => [row.warehouse, row.value, row.qty, row.items]));
    }
  }

  protected load(): void {
    const range = { from: this.from(), to: this.to(), company: this.company() || undefined };
    this.error.set(null);
    switch (this.tab()) {
      case 'sales':
        this.run(this.reports.salesByDay(range), (days) => this.periods.set(rollUpByMonth(days, range.from, range.to)));
        break;
      case 'customers':
        this.run(this.reports.salesByCustomer(range), (rows) => this.customers.set(rows));
        break;
      case 'items':
        this.run(this.reports.salesByItem(range), (rows) => this.items.set(rows));
        break;
      case 'aging':
        this.run(this.payments.agingSource(), (rows) => this.aging.set(buildAging(rows, todayIso(), daysBetween)));
        break;
      case 'stock':
        this.run(this.reports.stockByWarehouse(), (rows) => this.warehouses.set(rows));
    }
  }

  private setRange(from: string, to: string): void {
    this.from.set(from);
    this.to.set(to);
  }

  private run<T>(source: Observable<T>, apply: (value: T) => void): void {
    this.loading.set(true);
    source.pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: apply,
      error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
    });
  }
}

/** Day before the given first-of-month date. */
function formatEnd(firstOfNextMonth: string): string {
  const [y, m] = firstOfNextMonth.split('-').map(Number);
  const last = new Date(y, m - 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}
