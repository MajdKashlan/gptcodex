import { Component, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, map, of } from 'rxjs';
import { FrappeApiService } from '../../core/api/frappe-api.service';
import { frappeErrorMessage } from '../../core/http/frappe-error';
import { todayIso } from '../../core/utils/date';
import { PagerComponent } from '../../shared/components/pager/pager.component';
import { AppDatePipe, MoneyPipe } from '../../shared/pipes/format.pipes';
import { OrdersService } from '../orders/orders.service';
import { isClosedStatus, SalesListRow, SalesListView } from '../orders/sales-documents';
import { CustomerEditorData, CustomersService } from './customers.service';

interface CustomerStats {
  billedThisYear: number;
  billedAllTime: number;
  outstanding: number;
  overdue: number;
  openOrders: number;
  lastInvoice?: string;
}

const PAGE_SIZE = 10;

/** Customer overview: profile, contact, balances and their sales documents. */
@Component({
  selector: 'app-customer-detail',
  imports: [RouterLink, PagerComponent, AppDatePipe, MoneyPipe],
  templateUrl: './customer-detail.component.html',
  styleUrl: './customer-detail.component.scss',
})
export class CustomerDetailComponent implements OnInit {
  /** Route parameter. */
  readonly name = input.required<string>();

  private readonly api = inject(FrappeApiService);
  private readonly customersService = inject(CustomersService);
  private readonly ordersService = inject(OrdersService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly data = signal<CustomerEditorData | null>(null);
  protected readonly stats = signal<CustomerStats | null>(null);
  protected readonly currency = signal('');
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly docsView = signal<SalesListView>('all');
  protected readonly docs = signal<SalesListRow[]>([]);
  protected readonly docsTotal = signal(0);
  protected readonly docsPage = signal(1);
  protected readonly docsLoading = signal(false);
  protected readonly isClosedStatus = isClosedStatus;

  protected readonly docTabs: Array<{ view: SalesListView; label: string }> = [
    { view: 'all', label: 'All' },
    { view: 'quotes', label: 'Quotes' },
    { view: 'orders', label: 'Orders' },
    { view: 'invoices', label: 'Invoices' },
    { view: 'credit-notes', label: 'Credit notes' },
  ];

  ngOnInit(): void {
    this.customersService.get(this.name())
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.data.set(data);
          this.loadStats();
        },
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
    this.loadDocs();
  }

  protected setDocsView(view: SalesListView): void {
    this.docsView.set(view);
    this.docsPage.set(1);
    this.loadDocs();
  }

  protected goToDocsPage(page: number): void {
    this.docsPage.set(page);
    this.loadDocs();
  }

  protected edit(): void {
    void this.router.navigate(['/customers'], { queryParams: { edit: this.name() } });
  }

  protected statusLabel(row: SalesListRow): string {
    return row.status || (row.docstatus === 0 ? 'Draft' : 'Submitted');
  }

  private loadDocs(): void {
    this.docsLoading.set(true);
    this.ordersService.listPage(this.docsView(), 'all', '', this.docsPage(), PAGE_SIZE, this.name())
      .pipe(finalize(() => this.docsLoading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ rows, total }) => {
          this.docs.set(rows);
          this.docsTotal.set(total);
        },
        error: () => this.docs.set([]),
      });
  }

  /** Balances in company currency, aggregated by ERPNext. */
  private loadStats(): void {
    const customer = this.name();
    const yearStart = todayIso().slice(0, 4) + '-01-01';
    const submitted = [['Sales Invoice', 'docstatus', '=', 1], ['Sales Invoice', 'customer', '=', customer]];
    const sum = (field: string, extra: unknown[][]) => this.api
      .getList<{ total: number }>('Sales Invoice', { fields: [`sum(${field}) as total`], filters: [...submitted, ...extra], pageLength: 1 })
      .pipe(map((rows) => Number(rows[0]?.total ?? 0)), catchError(() => of(0)));

    forkJoin({
      year: sum('base_grand_total', [['Sales Invoice', 'posting_date', '>=', yearStart]]),
      all: sum('base_grand_total', []),
      outstanding: sum('outstanding_amount', []),
      overdue: sum('outstanding_amount', [['Sales Invoice', 'due_date', '<', todayIso()]]),
      openOrders: this.api.getCount('Sales Order', [
        ['Sales Order', 'customer', '=', customer],
        ['Sales Order', 'docstatus', '=', 1],
        ['Sales Order', 'status', 'not in', ['Closed', 'Completed', 'Cancelled']],
      ]).pipe(catchError(() => of(0))),
      last: this.api.getList<{ posting_date: string }>('Sales Invoice', {
        fields: ['posting_date'], filters: submitted, orderBy: 'posting_date desc', pageLength: 1,
      }).pipe(catchError(() => of([]))),
      company: this.api.getList<{ default_currency?: string }>('Company', { fields: ['default_currency'], pageLength: 1 })
        .pipe(catchError(() => of([]))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        this.currency.set(result.company[0]?.default_currency ?? '');
        this.stats.set({
          billedThisYear: result.year,
          billedAllTime: result.all,
          outstanding: result.outstanding,
          overdue: result.overdue,
          openOrders: result.openOrders,
          lastInvoice: result.last[0]?.posting_date,
        });
      });
  }
}
