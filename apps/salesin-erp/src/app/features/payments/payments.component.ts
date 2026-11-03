import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { AppContextService } from '../../core/context/app-context.service';
import { frappeErrorMessage } from '../../core/http/frappe-error';
import { NotificationService } from '../../core/http/notification.service';
import { downloadCsv } from '../../core/utils/csv';
import { daysBetween, todayIso } from '../../core/utils/date';
import { PagerComponent } from '../../shared/components/pager/pager.component';
import { AppDatePipe, MoneyPipe } from '../../shared/pipes/format.pipes';
import { AgingRow, buildAging, OutstandingInvoice, PaymentsService } from './payments.service';

type PaymentsTab = 'aging' | 'outstanding';
const PAGE_SIZE = 25;

/**
 * Receivables and collection. Outstanding invoices are paged on the server; the
 * aging table is built from a grouped server query, so totals cover every invoice.
 */
@Component({
  selector: 'app-payments',
  imports: [ReactiveFormsModule, RouterLink, PagerComponent, AppDatePipe, MoneyPipe],
  templateUrl: './payments.component.html',
  styleUrl: './payments.component.scss',
})
export class PaymentsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly paymentsService = inject(PaymentsService);
  private readonly notifications = inject(NotificationService);
  private readonly appContext = inject(AppContextService);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly tab = signal<PaymentsTab>('outstanding');
  protected readonly invoices = signal<OutstandingInvoice[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly aging = signal<AgingRow[]>([]);
  protected readonly currency = signal('');
  protected readonly modesOfPayment = signal<string[]>([]);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly payingInvoice = signal<OutstandingInvoice | null>(null);

  protected readonly searchText = new FormControl('', { nonNullable: true });
  protected readonly paymentForm = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    posting_date: [todayIso(), Validators.required],
    mode_of_payment: [''],
    reference_no: [''],
    submit_now: [true],
  });

  protected readonly totalOutstanding = computed(() => this.aging().reduce((sum, row) => sum + row.total, 0));
  protected readonly totalOverdue = computed(() => this.aging().reduce((sum, row) => sum + row.total - row.current, 0));

  ngOnInit(): void {
    this.appContext.context().subscribe((context) => this.currency.set(context.currency));
    this.paymentsService.listModesOfPayment().subscribe((modes) => this.modesOfPayment.set(modes));
    this.reload();
  }

  protected selectTab(tab: PaymentsTab): void {
    this.tab.set(tab);
  }

  protected applySearch(): void {
    this.page.set(1);
    this.reload();
  }

  protected goToPage(page: number): void {
    this.page.set(page);
    this.loadInvoices();
  }

  protected daysOverdue(invoice: OutstandingInvoice): number {
    return invoice.due_date ? Math.max(0, daysBetween(invoice.due_date, todayIso())) : 0;
  }

  protected recordPayment(invoice: OutstandingInvoice): void {
    this.payingInvoice.set(invoice);
    this.paymentForm.reset({
      amount: invoice.outstanding_amount ?? 0,
      posting_date: todayIso(),
      mode_of_payment: this.modesOfPayment()[0] ?? '',
      reference_no: '',
      submit_now: true,
    });
    this.formError.set(null);
  }

  protected closeDialog(): void {
    if (!this.saving()) this.payingInvoice.set(null);
  }

  protected savePayment(): void {
    const invoice = this.payingInvoice();
    const value = this.paymentForm.getRawValue();
    const amount = Number(value.amount);
    if (!invoice) return;
    if (!(amount > 0)) {
      this.formError.set('Enter an amount greater than zero.');
      return;
    }
    if (amount > (invoice.outstanding_amount ?? 0) + 0.005) {
      this.formError.set('The amount is more than the outstanding balance. Record the extra as an advance in ERPNext instead.');
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    this.paymentsService
      .createPayment(invoice.doctype, invoice.name, amount, {
        postingDate: value.posting_date || undefined,
        modeOfPayment: value.mode_of_payment || undefined,
        referenceNo: value.reference_no || undefined,
        submit: value.submit_now,
      })
      .pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (name) => {
          this.payingInvoice.set(null);
          this.notifications.success(`Payment ${name} ${value.submit_now ? 'submitted' : 'saved as draft'}.`);
          this.reload();
        },
        error: (error: unknown) => this.formError.set(frappeErrorMessage(error)),
      });
  }

  protected exportAging(): void {
    downloadCsv(
      `receivables-aging-${todayIso()}.csv`,
      ['Customer', 'Current', '1-30', '31-60', '61-90', '90+', 'Total'],
      this.aging().map((row) => [row.name, row.current, row.days1To30, row.days31To60, row.days61To90, row.days90Plus, row.total]),
    );
  }

  private reload(): void {
    this.loadInvoices();
    this.paymentsService
      .agingSource(this.searchText.value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.aging.set(buildAging(rows, todayIso(), daysBetween)),
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
  }

  private loadInvoices(): void {
    this.loading.set(true);
    this.error.set(null);
    this.paymentsService
      .outstandingPage(this.searchText.value, this.page(), PAGE_SIZE)
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ rows, total }) => {
          this.invoices.set(rows);
          this.total.set(total);
        },
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
  }
}
