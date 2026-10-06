import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER } from '../../core/auth/auth.context';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { ErpNextListResponse } from '../../models/erpnext-document.models';

/** A submitted invoice that still has money outstanding. */
export interface OutstandingInvoice {
  name: string;
  doctype: string;
  customer?: string;
  customer_name?: string;
  company?: string;
  posting_date?: string;
  due_date?: string;
  currency?: string;
  grand_total?: number;
  outstanding_amount?: number;
  status?: string;
}

export interface PaymentRequestOptions {
  postingDate?: string;
  modeOfPayment?: string;
  referenceNo?: string;
  /** Submit the payment immediately rather than leaving it as a draft. */
  submit: boolean;
}

/** Identity fields Frappe sets itself; sending them back confuses an insert. */
const SERVER_MANAGED_FIELDS = [
  'name',
  'owner',
  'creation',
  'modified',
  'modified_by',
  'docstatus',
  'idx',
  'doctype',
  '__islocal',
  '__unsaved',
  'amended_from',
];

/**
 * Receivables and payment collection.
 *
 * Payment Entries are never assembled field-by-field in the browser: ERPNext needs
 * ~13 account fields (`paid_from`, `paid_to`, both account currencies, both
 * exchange rates, base amounts...), and `get_payment_entry` already derives them
 * from the invoice, including the correct reference allocation. The client only
 * overrides what the user actually typed.
 */
@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(ErpNextAuthService);

  /**
   * Submitted, non-return sales invoices with a remaining balance, oldest due date
   * first. Callers should compare the row count against `pageSize` to detect
   * truncation rather than presenting a partial total as complete.
   */
  listOutstandingInvoices(search = '', pageSize = 500): Observable<OutstandingInvoice[]> {
    const fields = [
      'name',
      'customer',
      'customer_name',
      'company',
      'posting_date',
      'due_date',
      'currency',
      'grand_total',
      'outstanding_amount',
      'status',
    ];

    let params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('limit_page_length', String(pageSize))
      .set('order_by', 'due_date asc')
      .set('filters', JSON.stringify([
        ['Sales Invoice', 'docstatus', '=', 1],
        ['Sales Invoice', 'outstanding_amount', '>', 0],
        ['Sales Invoice', 'is_return', '=', 0],
      ]));

    const term = search.trim();
    if (term !== '') {
      params = params.set('or_filters', JSON.stringify([
        ['Sales Invoice', 'customer', 'like', `%${term}%`],
        ['Sales Invoice', 'customer_name', 'like', `%${term}%`],
        ['Sales Invoice', 'name', 'like', `%${term}%`],
      ]));
    }

    return this.http
      .get<ErpNextListResponse<Omit<OutstandingInvoice, 'doctype'>>>(
        this.auth.apiUrl('/api/resource/Sales Invoice'),
        {
          params,
          withCredentials: true,
          context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
        },
      )
      .pipe(
        map((response) =>
          (response.data ?? []).map((record) => ({ ...record, doctype: 'Sales Invoice' })),
        ),
      );
  }

  /** Enabled modes of payment, for the collection dialog. */
  listModesOfPayment(): Observable<string[]> {
    const params = new HttpParams()
      .set('fields', JSON.stringify(['name']))
      .set('limit_page_length', '0')
      .set('order_by', 'name asc')
      .set('filters', JSON.stringify([['Mode of Payment', 'enabled', '=', 1]]));

    return this.http
      .get<ErpNextListResponse<{ name: string }>>(
        this.auth.apiUrl('/api/resource/Mode of Payment'),
        {
          params,
          withCredentials: true,
          context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
        },
      )
      .pipe(
        map((response) => (response.data ?? []).map((record) => record.name)),
        catchError(() => of([])),
      );
  }

  /**
   * Creates a Payment Entry for one document.
   *
   * `party_amount` is passed to `get_payment_entry` so ERPNext allocates the amount
   * across references itself. `paid_amount`/`received_amount` are deliberately NOT
   * overwritten afterwards: doing so desynchronises the allocation from the total.
   */
  createPayment(
    doctype: string,
    name: string,
    amount: number,
    options: PaymentRequestOptions,
  ): Observable<string> {
    return this.http
      .post<{ message: Record<string, unknown> }>(
        this.auth.apiUrl(
          '/api/method/erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry',
        ),
        { dt: doctype, dn: name, party_amount: amount },
        { withCredentials: true },
      )
      .pipe(
        switchMap(({ message }) => {
          const payment = this.sanitize(message);
          if (options.postingDate) {
            payment['posting_date'] = options.postingDate;
          }
          if (options.modeOfPayment) {
            payment['mode_of_payment'] = options.modeOfPayment;
          }
          if (options.referenceNo) {
            payment['reference_no'] = options.referenceNo;
          }

          return this.http.post<{ data: { name: string } }>(
            this.auth.apiUrl('/api/resource/Payment Entry'),
            payment,
            { withCredentials: true },
          );
        }),
        switchMap((created) =>
          options.submit
            ? this.submitPayment(created.data.name).pipe(map(() => created.data.name))
            : of(created.data.name),
        ),
      );
  }

  /** Submits a draft payment, which posts the GL entries and the allocation. */
  submitPayment(name: string): Observable<void> {
    return this.http
      .put<unknown>(
        this.auth.apiUrl('/api/resource/Payment Entry/' + encodeURIComponent(name)),
        { docstatus: 1 },
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }

  private sanitize(document: Record<string, unknown>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = { ...document };
    for (const field of SERVER_MANAGED_FIELDS) {
      delete cleaned[field];
    }
    return cleaned;
  }
}
