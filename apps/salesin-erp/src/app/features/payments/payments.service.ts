import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of, switchMap } from 'rxjs';
import { FrappeApiService, FrappeFilter, Page } from '../../core/api/frappe-api.service';

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

export interface AgingSourceRow {
  customer: string;
  customer_name?: string;
  due_date?: string;
  outstanding: number;
}

export interface PaymentRequestOptions {
  postingDate?: string;
  modeOfPayment?: string;
  referenceNo?: string;
  referenceDate?: string;
  /** Submit the payment immediately rather than leaving it as a draft. */
  submit: boolean;
}

/** Identity fields Frappe sets itself; sending them back confuses an insert. */
const SERVER_MANAGED_FIELDS = [
  'name', 'owner', 'creation', 'modified', 'modified_by', 'docstatus', 'idx', 'doctype',
  '__islocal', '__unsaved', 'amended_from',
];

const OUTSTANDING_FILTERS: FrappeFilter[] = [
  ['Sales Invoice', 'docstatus', '=', 1],
  ['Sales Invoice', 'outstanding_amount', '>', 0],
  ['Sales Invoice', 'is_return', '=', 0],
];

/**
 * Receivables and payment collection.
 *
 * Payment Entries are never assembled field-by-field in the browser: ERPNext needs
 * ~13 account fields, and `get_payment_entry` already derives them from the source
 * document, including the reference allocation. The client only overrides what the
 * user actually typed. This is the ONLY place payments are created in the app.
 */
@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private readonly api = inject(FrappeApiService);

  /** Outstanding invoices, oldest due date first, one server page at a time. */
  outstandingPage(search: string, page: number, pageSize: number, customer?: string): Observable<Page<OutstandingInvoice>> {
    return this.api
      .getPage<Omit<OutstandingInvoice, 'doctype'>>('Sales Invoice', {
        fields: ['name', 'customer', 'customer_name', 'company', 'posting_date', 'due_date', 'currency', 'grand_total', 'outstanding_amount', 'status'],
        filters: [...OUTSTANDING_FILTERS, ...(customer ? [['Sales Invoice', 'customer', '=', customer]] : [])],
        orFilters: this.searchFilters(search),
        orderBy: 'due_date asc',
        page,
        pageSize,
      })
      .pipe(map(({ rows, total }) => ({ rows: rows.map((row) => ({ ...row, doctype: 'Sales Invoice' })), total })));
  }

  /** Outstanding totals grouped by customer and due date - the input to aging. */
  agingSource(search = ''): Observable<AgingSourceRow[]> {
    return this.api
      .getList<{ customer: string; customer_name?: string; due_date?: string; outstanding: number }>('Sales Invoice', {
        fields: ['customer', 'customer_name', 'due_date', 'sum(outstanding_amount) as outstanding'],
        filters: OUTSTANDING_FILTERS,
        orFilters: this.searchFilters(search),
        groupBy: 'customer, due_date',
        orderBy: 'customer asc',
        pageLength: 0,
      })
      .pipe(map((rows) => rows.map((row) => ({ ...row, outstanding: Number(row.outstanding) || 0 }))));
  }

  /** Enabled modes of payment. Optional lookup, so failures give an empty list. */
  listModesOfPayment(): Observable<string[]> {
    return this.api
      .getList<{ name: string }>('Mode of Payment', {
        fields: ['name'],
        filters: [['Mode of Payment', 'enabled', '=', 1]],
        orderBy: 'name asc',
        pageLength: 0,
      })
      .pipe(map((rows) => rows.map((row) => row.name)), catchError(() => of([])));
  }

  /**
   * Creates (and optionally submits) a Payment Entry against a Sales Invoice or
   * Sales Order. `party_amount` lets ERPNext allocate the amount itself;
   * `paid_amount` is deliberately not overwritten afterwards.
   */
  createPayment(doctype: string, name: string, amount: number, options: PaymentRequestOptions): Observable<string> {
    return this.api
      .call<Record<string, unknown>>('erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry', {
        dt: doctype,
        dn: name,
        party_amount: amount,
      })
      .pipe(
        switchMap((message) => {
          const payment = this.sanitize(message);
          if (options.postingDate) payment['posting_date'] = options.postingDate;
          if (options.referenceNo) {
            payment['reference_no'] = options.referenceNo;
            payment['reference_date'] = options.referenceDate || options.postingDate || payment['posting_date'];
          }
          if (!options.modeOfPayment) return of(payment);
          payment['mode_of_payment'] = options.modeOfPayment;
          // The Desk UI switches the "paid to" account when the mode changes; do the
          // same, otherwise the money is posted to the company's default account.
          return this.api
            .call<{ account?: string }>('erpnext.accounts.doctype.sales_invoice.sales_invoice.get_bank_cash_account', {
              mode_of_payment: options.modeOfPayment,
              company: payment['company'],
            })
            .pipe(
              map((result) => {
                if (result?.account && result.account !== payment['paid_to']) {
                  payment['paid_to'] = result.account;
                  delete payment['paid_to_account_currency'];
                  delete payment['paid_to_account_balance'];
                  delete payment['paid_to_account_type'];
                }
                return payment;
              }),
              catchError(() => of(payment)),
            );
        }),
        switchMap((payment) => this.api.insert<{ name: string }>('Payment Entry', payment)),
        switchMap((created) =>
          options.submit
            ? this.api.submit('Payment Entry', created.name).pipe(map(() => created.name))
            : of(created.name),
        ),
      );
  }

  private searchFilters(search: string): FrappeFilter[] {
    const term = search.trim();
    if (!term) return [];
    const like = `%${term}%`;
    return [
      ['Sales Invoice', 'customer', 'like', like],
      ['Sales Invoice', 'customer_name', 'like', like],
      ['Sales Invoice', 'name', 'like', like],
    ];
  }

  private sanitize(document: Record<string, unknown>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = { ...document };
    for (const field of SERVER_MANAGED_FIELDS) delete cleaned[field];
    return cleaned;
  }
}

export interface AgingRow {
  customer: string;
  name: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  total: number;
}

/** Buckets outstanding amounts by days past due, one row per customer. */
export function buildAging(rows: AgingSourceRow[], today: string, daysPastDue: (due: string, today: string) => number): AgingRow[] {
  const byCustomer = new Map<string, AgingRow>();
  for (const row of rows) {
    const entry = byCustomer.get(row.customer) ?? {
      customer: row.customer, name: row.customer_name || row.customer,
      current: 0, days1To30: 0, days31To60: 0, days61To90: 0, days90Plus: 0, total: 0,
    };
    const overdue = row.due_date ? daysPastDue(row.due_date, today) : 0;
    if (overdue <= 0) entry.current += row.outstanding;
    else if (overdue <= 30) entry.days1To30 += row.outstanding;
    else if (overdue <= 60) entry.days31To60 += row.outstanding;
    else if (overdue <= 90) entry.days61To90 += row.outstanding;
    else entry.days90Plus += row.outstanding;
    entry.total += row.outstanding;
    byCustomer.set(row.customer, entry);
  }
  return [...byCustomer.values()].sort((a, b) => b.total - a.total);
}
