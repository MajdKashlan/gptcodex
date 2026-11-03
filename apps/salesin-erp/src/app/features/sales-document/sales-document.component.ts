import { Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, finalize, forkJoin, map, Observable, of } from 'rxjs';
import { FrappeApiService } from '../../core/api/frappe-api.service';
import { frappeErrorMessage } from '../../core/http/frappe-error';
import { NotificationService } from '../../core/http/notification.service';
import { downloadBlob } from '../../core/utils/csv';
import { todayIso } from '../../core/utils/date';
import { ConfirmService } from '../../shared/components/confirm-dialog/confirm.service';
import { AppDatePipe, MoneyPipe, QtyPipe } from '../../shared/pipes/format.pipes';
import { OrdersService, SalesDocumentDetails } from '../orders/orders.service';
import { canMakeCreditNote, canMakeInvoice, canMakeOrder, canReceivePayment, isClosedStatus, SalesListRow } from '../orders/sales-documents';
import { PaymentsService } from '../payments/payments.service';

interface RelatedDocument {
  doctype: string;
  name: string;
  label: string;
  date?: string;
  amount?: number;
  currency?: string;
  status?: string;
  docstatus?: number;
  link: boolean;
}

/** Read-only view of one Quotation / Sales Order / Sales Invoice, with its workflow. */
@Component({
  selector: 'app-sales-document',
  imports: [RouterLink, ReactiveFormsModule, AppDatePipe, MoneyPipe, QtyPipe],
  templateUrl: './sales-document.component.html',
  styleUrl: './sales-document.component.scss',
})
export class SalesDocumentComponent implements OnInit {
  /** Route parameters (bound by `withComponentInputBinding`). */
  readonly doctype = input.required<string>();
  readonly name = input.required<string>();

  private readonly api = inject(FrappeApiService);
  private readonly ordersService = inject(OrdersService);
  private readonly paymentsService = inject(PaymentsService);
  private readonly confirm = inject(ConfirmService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly doc = signal<SalesDocumentDetails | null>(null);
  protected readonly related = signal<RelatedDocument[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly paymentOpen = signal(false);
  protected readonly paymentError = signal<string | null>(null);
  protected readonly modesOfPayment = signal<string[]>([]);
  protected readonly paymentForm = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    posting_date: [todayIso(), Validators.required],
    mode_of_payment: [''],
    reference_no: [''],
    submit_now: [true],
  });

  /** The document in the shape the shared workflow helpers expect. */
  protected readonly row = computed<SalesListRow | null>(() => {
    const doc = this.doc();
    if (!doc) return null;
    const doctype = this.doctype() as SalesListRow['doctype'];
    return {
      key: `${doctype}:${doc.name}`,
      name: doc.name,
      doctype,
      documentType: doctype === 'Quotation' ? 'Quote' : doctype === 'Sales Order' ? 'Order' : doc.is_return ? 'Credit Note' : 'Invoice',
      customer: doc.customer ?? doc.party_name ?? '',
      customer_name: doc.customer_name,
      date: doc.transaction_date ?? doc.posting_date ?? '',
      due: doc.delivery_date ?? doc.due_date ?? doc.valid_till,
      currency: doc.currency,
      grand_total: doc.grand_total,
      outstanding_amount: doc.outstanding_amount,
      status: doc.status,
      docstatus: doc.docstatus,
      is_return: doc.is_return,
    };
  });
  protected readonly typeLabel = computed(() => this.row()?.documentType ?? '');
  protected readonly status = computed(() => {
    const doc = this.doc();
    return doc?.status || (doc?.docstatus === 0 ? 'Draft' : doc?.docstatus === 2 ? 'Cancelled' : 'Submitted');
  });
  protected readonly closed = computed(() => isClosedStatus(this.doctype(), this.doc()?.status));
  protected readonly dueLabel = computed(() =>
    this.doctype() === 'Quotation' ? 'Valid until' : this.doctype() === 'Sales Order' ? 'Delivery date' : 'Due date');

  protected readonly canMakeOrder = computed(() => !!this.row() && canMakeOrder(this.row()!));
  protected readonly canMakeInvoice = computed(() => !!this.row() && canMakeInvoice(this.row()!));
  protected readonly canMakeCreditNote = computed(() => !!this.row() && canMakeCreditNote(this.row()!));
  protected readonly canPay = computed(() => !!this.row() && canReceivePayment(this.row()!));

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.ordersService.getDocument(this.doctype(), this.name())
      .pipe(finalize(() => this.loading.set(false)), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (doc) => {
          this.doc.set(doc);
          this.loadRelated(doc);
        },
        error: (error: unknown) => this.error.set(frappeErrorMessage(error)),
      });
  }

  /** ERPNext stores addresses as HTML with <br>; show them as plain lines. */
  protected plainAddress(html: string): string {
    return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim();
  }

  protected edit(): void {
    void this.router.navigate(['/sales'], { queryParams: { view: this.listView(), edit: `${this.doctype()}:${this.name()}` } });
  }

  protected submit(): void {
    this.confirm.ask({
      title: `Submit ${this.name()}?`,
      message: 'Submitting posts this document to ERPNext. It can then only be cancelled, not edited.',
      confirmLabel: 'Submit',
    }).subscribe((ok) => ok && this.run(this.ordersService.submit(this.doctype(), this.name()), `${this.name()} submitted.`));
  }

  protected cancelDocument(): void {
    this.confirm.ask({
      title: `Cancel ${this.name()}?`,
      message: 'Cancelling reverses its ledger entries. This cannot be undone.',
      confirmLabel: 'Cancel document',
      cancelLabel: 'Keep',
      danger: true,
    }).subscribe((ok) => ok && this.run(this.ordersService.cancel(this.doctype(), this.name()), `${this.name()} cancelled.`));
  }

  protected deleteDraft(): void {
    this.confirm.ask({ title: `Delete draft ${this.name()}?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })
      .subscribe((ok) => {
        if (!ok) return;
        this.busy.set(true);
        this.ordersService.delete(this.doctype(), this.name())
          .pipe(finalize(() => this.busy.set(false)))
          .subscribe({
            next: () => {
              this.notifications.success(`${this.name()} deleted.`);
              void this.router.navigate(['/sales'], { queryParams: { view: this.listView() } });
            },
            error: (error: unknown) => this.notifications.error(error),
          });
      });
  }

  protected duplicate(): void {
    this.busy.set(true);
    this.ordersService.duplicate(this.doctype(), this.name())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (created) => {
          this.notifications.success(`Draft ${created.name} created.`);
          void this.router.navigate(['/sales', this.doctype(), created.name]);
        },
        error: (error: unknown) => this.notifications.error(error),
      });
  }

  protected makeOrder(): void {
    this.transition(this.ordersService.makeOrderFromQuote(this.name()), 'Sales Order');
  }

  protected makeInvoice(): void {
    this.transition(this.ordersService.makeInvoiceFromOrder(this.name()), 'Sales Invoice');
  }

  protected makeCreditNote(): void {
    this.transition(this.ordersService.makeCreditNoteFromInvoice(this.name()), 'Sales Invoice');
  }

  protected downloadPdf(): void {
    this.busy.set(true);
    this.ordersService.downloadPdf(this.doctype(), this.name())
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (pdf) => downloadBlob(`${this.typeLabel()}-${this.name()}.pdf`, pdf),
        error: (error: unknown) => this.notifications.error(error),
      });
  }

  protected print(): void {
    window.open(this.api.printViewUrl(this.doctype(), this.name()), '_blank', 'noopener');
  }

  protected openPayment(): void {
    const doc = this.doc();
    if (!doc) return;
    this.paymentError.set(null);
    this.paymentForm.reset({
      amount: doc.outstanding_amount ?? Math.max(0, (doc.grand_total ?? 0) - (doc.advance_paid ?? 0)),
      posting_date: todayIso(),
      mode_of_payment: this.modesOfPayment()[0] ?? '',
      reference_no: '',
      submit_now: true,
    });
    this.paymentOpen.set(true);
    if (!this.modesOfPayment().length) {
      this.paymentsService.listModesOfPayment().subscribe((modes) => {
        this.modesOfPayment.set(modes);
        if (!this.paymentForm.controls.mode_of_payment.value) this.paymentForm.controls.mode_of_payment.setValue(modes[0] ?? '');
      });
    }
  }

  protected savePayment(): void {
    const value = this.paymentForm.getRawValue();
    if (!(Number(value.amount) > 0)) {
      this.paymentError.set('Enter an amount greater than zero.');
      return;
    }
    this.busy.set(true);
    this.paymentError.set(null);
    this.paymentsService.createPayment(this.doctype(), this.name(), Number(value.amount), {
      postingDate: value.posting_date,
      modeOfPayment: value.mode_of_payment || undefined,
      referenceNo: value.reference_no || undefined,
      submit: value.submit_now,
    })
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (name) => {
          this.paymentOpen.set(false);
          this.notifications.success(`Payment ${name} ${value.submit_now ? 'submitted' : 'saved as draft'}.`);
          this.load();
        },
        error: (error: unknown) => this.paymentError.set(frappeErrorMessage(error)),
      });
  }

  private transition(operation: Observable<{ name: string }>, targetDoctype: string): void {
    this.busy.set(true);
    operation.pipe(finalize(() => this.busy.set(false))).subscribe({
      next: (created) => {
        this.notifications.success(`${created.name} created as draft.`);
        void this.router.navigate(['/sales', targetDoctype, created.name]);
      },
      error: (error: unknown) => this.notifications.error(error),
    });
  }

  private run(operation: Observable<unknown>, message: string): void {
    this.busy.set(true);
    operation.pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => {
        this.notifications.success(message);
        this.load();
      },
      error: (error: unknown) => this.notifications.error(error),
    });
  }

  private listView(): string {
    const doctype = this.doctype();
    if (doctype === 'Quotation') return 'quotes';
    if (doctype === 'Sales Order') return 'orders';
    return this.doc()?.is_return ? 'credit-notes' : 'invoices';
  }

  /**
   * Documents created from, or paying, this one. Uses child-table filters, which
   * Frappe's list API supports for the parent doctype.
   */
  private loadRelated(doc: SalesDocumentDetails): void {
    const name = doc.name;
    const doctype = this.doctype();
    type Row = { name: string; posting_date?: string; transaction_date?: string; grand_total?: number; paid_amount?: number; currency?: string; paid_to_account_currency?: string; status?: string; docstatus?: number };
    const query = (target: string, filters: unknown[][], fields: string[], label: string, link: boolean) =>
      this.api.getList<Row>(target, { fields, filters, orderBy: 'modified desc', pageLength: 20 }).pipe(
        map((rows): RelatedDocument[] => rows.map((row) => ({
          doctype: target,
          name: row.name,
          label,
          date: row.posting_date ?? row.transaction_date,
          amount: row.grand_total ?? row.paid_amount,
          currency: row.currency ?? row.paid_to_account_currency,
          status: row.status ?? (row.docstatus === 2 ? 'Cancelled' : row.docstatus === 1 ? 'Submitted' : 'Draft'),
          docstatus: row.docstatus,
          link,
        }))),
        catchError(() => of([] as RelatedDocument[])),
      );
    const docFields = ['name', 'transaction_date', 'grand_total', 'currency', 'status', 'docstatus'];
    const invoiceFields = ['name', 'posting_date', 'grand_total', 'currency', 'status', 'docstatus'];
    const paymentFields = ['name', 'posting_date', 'paid_amount', 'paid_to_account_currency', 'status', 'docstatus'];
    const sources: Array<Observable<RelatedDocument[]>> = [];

    if (doctype === 'Quotation') {
      sources.push(query('Sales Order', [['Sales Order Item', 'prevdoc_docname', '=', name]], docFields, 'Sales order', true));
    }
    if (doctype === 'Sales Order') {
      sources.push(query('Sales Invoice', [['Sales Invoice Item', 'sales_order', '=', name]], invoiceFields, 'Invoice', true));
      sources.push(query('Delivery Note', [['Delivery Note Item', 'against_sales_order', '=', name]], invoiceFields, 'Delivery note', false));
    }
    if (doctype === 'Sales Invoice') {
      if (doc.return_against) {
        sources.push(of([{ doctype, name: doc.return_against, label: 'Original invoice', link: true }]));
      } else {
        sources.push(query('Sales Invoice', [['Sales Invoice', 'return_against', '=', name]], invoiceFields, 'Credit note', true));
      }
    }
    if (doctype !== 'Quotation') {
      sources.push(query('Payment Entry', [['Payment Entry Reference', 'reference_name', '=', name]], paymentFields, 'Payment', false));
    }

    forkJoin(sources.length ? sources : [of([])])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((lists) => {
        const seen = new Set<string>();
        this.related.set(lists.flat().filter((row) => {
          const key = row.doctype + row.name;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }));
      });
  }
}
