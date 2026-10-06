import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize, forkJoin, Observable, of } from 'rxjs';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { LanguageService } from '../../core/i18n/language.service';
import { frappeErrorMessage } from '../../core/http/frappe-error';
import {
  PageTopbarAction,
  PageTopbarComponent,
} from '../../shared/components/page-topbar/page-topbar.component';
import { SidebarComponent } from '../../shared/components/sidebar/sidebar.component';
import { OutstandingInvoice, PaymentsService } from './payments.service';

type PaymentsTab = 'aging' | 'outstanding';

interface AgingRow {
  customer: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  total: number;
}

const PAGE_SIZE = 500;
const MS_PER_DAY = 86_400_000;

/**
 * Receivables and collection.
 *
 * Aging is derived from each invoice's `due_date` and `outstanding_amount`, both of
 * which come from the server, so the buckets are real data rather than estimates.
 */
@Component({
  selector: 'app-payments',
  imports: [CommonModule, ReactiveFormsModule, SidebarComponent, PageTopbarComponent],
  templateUrl: './payments.component.html',
  styleUrl: './payments.component.scss',
})
export class PaymentsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(ErpNextAuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly paymentsService = inject(PaymentsService);
  protected readonly i18n = inject(LanguageService);

  protected readonly userName = computed(() => this.auth.currentUser()?.fullName || 'User');
  protected readonly userImage = computed(() => this.auth.currentUser()?.imageUrl);
  protected readonly topbarActions: PageTopbarAction[] = [{ id: 'logout', label: 'Logout' }];

  protected readonly tab = signal<PaymentsTab>('outstanding');
  protected readonly invoices = signal<OutstandingInvoice[]>([]);
  protected readonly modesOfPayment = signal<string[]>([]);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly dialogOpen = signal(false);
  protected readonly payingInvoice = signal<OutstandingInvoice | null>(null);

  protected readonly searchText = new FormControl('', { nonNullable: true });

  protected readonly paymentForm = this.formBuilder.nonNullable.group({
    amount: [0, Validators.required],
    posting_date: [this.today(), Validators.required],
    mode_of_payment: [''],
    reference_no: [''],
    submit_now: [true],
  });

  protected readonly totalOutstanding = computed(() =>
    this.invoices().reduce((total, invoice) => total + (invoice.outstanding_amount ?? 0), 0),
  );

  /** `true` when the server returned a full page, so the total may be incomplete. */
  protected readonly truncated = computed(() => this.invoices().length >= PAGE_SIZE);

  protected readonly agingRows = computed<AgingRow[]>(() => {
    const today = new Date(this.today()).getTime();
    const byCustomer = new Map<string, AgingRow>();

    for (const invoice of this.invoices()) {
      const customer = invoice.customer_name || invoice.customer || '—';
      const row = byCustomer.get(customer) ?? {
        customer,
        current: 0,
        days1To30: 0,
        days31To60: 0,
        days61To90: 0,
        days90Plus: 0,
        total: 0,
      };

      const amount = invoice.outstanding_amount ?? 0;
      const overdueDays = invoice.due_date
        ? Math.floor((today - new Date(invoice.due_date).getTime()) / MS_PER_DAY)
        : 0;

      if (overdueDays <= 0) {
        row.current += amount;
      } else if (overdueDays <= 30) {
        row.days1To30 += amount;
      } else if (overdueDays <= 60) {
        row.days31To60 += amount;
      } else if (overdueDays <= 90) {
        row.days61To90 += amount;
      } else {
        row.days90Plus += amount;
      }
      row.total += amount;
      byCustomer.set(customer, row);
    }

    return [...byCustomer.values()].sort((first, second) => second.total - first.total);
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

  protected selectTab(tab: PaymentsTab): void {
    this.tab.set(tab);
  }

  protected applySearch(): void {
    this.loadInvoices();
  }

  /** Positive when the invoice is past its due date. */
  protected daysOverdue(invoice: OutstandingInvoice): number {
    if (!invoice.due_date) {
      return 0;
    }
    const today = new Date(this.today()).getTime();
    return Math.max(0, Math.floor((today - new Date(invoice.due_date).getTime()) / MS_PER_DAY));
  }

  protected recordPayment(invoice: OutstandingInvoice): void {
    this.payingInvoice.set(invoice);
    this.paymentForm.reset({
      amount: invoice.outstanding_amount ?? 0,
      posting_date: this.today(),
      mode_of_payment: this.modesOfPayment()[0] ?? '',
      reference_no: '',
      submit_now: true,
    });
    this.formError.set(null);
    this.dialogOpen.set(true);
  }

  protected closeDialog(): void {
    if (this.saving()) {
      return;
    }
    this.dialogOpen.set(false);
  }

  protected savePayment(): void {
    const invoice = this.payingInvoice();
    if (!invoice) {
      this.formError.set(this.i18n.t('payments.noneSelected'));
      return;
    }

    const value = this.paymentForm.getRawValue();
    const amount = Number(value.amount);
    if (!(amount > 0)) {
      this.formError.set(this.i18n.t('payments.amountInvalid'));
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
        next: () => {
          this.dialogOpen.set(false);
          this.loadInvoices();
        },
        error: (error: unknown) => this.formError.set(frappeErrorMessage(error)),
      });
  }

  protected today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private loadPage(): void {
    this.loading.set(true);
    forkJoin({
      modes: this.paymentsService.listModesOfPayment(),
      invoices: this.paymentsService.listOutstandingInvoices(this.searchText.value, PAGE_SIZE),
    })
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.modesOfPayment.set(result.modes);
          this.invoices.set(result.invoices);
        },
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
  }

  private loadInvoices(): void {
    this.loading.set(true);
    this.error.set(null);
    this.paymentsService
      .listOutstandingInvoices(this.searchText.value, PAGE_SIZE)
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.invoices.set(rows),
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
  }
}
