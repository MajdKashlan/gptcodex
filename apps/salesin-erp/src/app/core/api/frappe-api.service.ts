import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, tap, throwError } from 'rxjs';
import { ErpNextAuthService } from '../auth/erpnext-auth.service';

/** A Frappe filter: `[doctype, field, operator, value]` or `[field, operator, value]`. */
export type FrappeFilter = unknown[];

export interface ListArgs {
  fields?: string[];
  filters?: FrappeFilter[];
  orFilters?: FrappeFilter[];
  orderBy?: string;
  groupBy?: string;
  /** Zero-based row offset (`limit_start`). */
  start?: number;
  /** Rows to return. `0` means "no limit" - only use it for small lookup tables. */
  pageLength?: number;
  /** Required by Frappe v15 when listing a child table doctype directly. */
  parentDoctype?: string;
}

/**
 * How the server wants aggregate fields written.
 * - `dict`:   Frappe v16+ (`{"SUM": "grand_total", "as": "total"}`) - string SQL functions are rejected.
 * - `string`: Frappe v15 and older (`"sum(grand_total) as total"`).
 */
type AggregateSyntax = 'dict' | 'string';

const AGGREGATE_PATTERN = /^\s*(sum|count|avg|max|min)\s*\(\s*(.+?)\s*\)\s+as\s+(\w+)\s*$/i;

/** Converts `sum(x) as y` into Frappe v16's `{"SUM": "x", "as": "y"}`. Other fields pass through. */
export function toDictField(field: string): string | Record<string, string> {
  const match = AGGREGATE_PATTERN.exec(field);
  if (!match) return field;
  const [, fn, arg, alias] = match;
  return { [fn.toUpperCase()]: arg, as: alias };
}

export interface LinkOption {
  value: string;
  description?: string;
}

export interface Page<T> {
  rows: T[];
  total: number;
}

/**
 * The one place that knows how to talk to Frappe's REST API.
 *
 * Errors are never swallowed here: a permission or session problem must reach the
 * caller (and the auth interceptor) instead of turning into an empty list that
 * looks like "no data".
 */
@Injectable({ providedIn: 'root' })
export class FrappeApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(ErpNextAuthService);

  /**
   * Detected once per session. Aggregates are written as `sum(x) as y` throughout the
   * app; this service translates them for Frappe v16+, and falls back to the v15
   * string form if the server rejects the dict form.
   */
  private aggregateSyntax: AggregateSyntax | null = null;

  getList<T>(doctype: string, args: ListArgs = {}): Observable<T[]> {
    const fields = args.fields ?? ['name'];
    const hasAggregate = fields.some((field) => AGGREGATE_PATTERN.test(field));
    if (!hasAggregate) {
      return this.requestList<T>(doctype, args, fields);
    }

    const syntax = this.aggregateSyntax ?? 'dict';
    const attempt = this.requestList<T>(doctype, args, syntax === 'dict' ? fields.map(toDictField) : fields)
      .pipe(tap(() => (this.aggregateSyntax = syntax)));

    if (this.aggregateSyntax !== null) {
      return attempt;
    }
    // First aggregate query of the session: if the dict form is not understood
    // (older Frappe answers 417/500), retry with the string form and remember it.
    return attempt.pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
          return throwError(() => error);
        }
        return this.requestList<T>(doctype, args, fields).pipe(
          tap(() => (this.aggregateSyntax = 'string')),
          // Both forms failed: the first error is the meaningful one.
          catchError(() => throwError(() => error)),
        );
      }),
    );
  }

  private requestList<T>(doctype: string, args: ListArgs, fields: Array<string | Record<string, string>>): Observable<T[]> {
    let params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('limit_page_length', String(args.pageLength ?? 20));
    if (args.start) params = params.set('limit_start', String(args.start));
    if (args.filters?.length) params = params.set('filters', JSON.stringify(args.filters));
    if (args.orFilters?.length) params = params.set('or_filters', JSON.stringify(args.orFilters));
    if (args.orderBy) params = params.set('order_by', args.orderBy);
    if (args.groupBy) params = params.set('group_by', args.groupBy);
    if (args.parentDoctype) params = params.set('parent_doctype', args.parentDoctype);

    return this.http
      .get<{ data?: T[] }>(this.resourceUrl(doctype), { params })
      .pipe(map((response) => response.data ?? []));
  }

  /** Row count for the same filters a list uses (supports `or_filters`). */
  getCount(doctype: string, filters: FrappeFilter[] = [], orFilters: FrappeFilter[] = []): Observable<number> {
    return this.getList<{ count: number }>(doctype, {
      fields: ['count(name) as count'],
      filters,
      orFilters,
      pageLength: 1,
    }).pipe(map((rows) => Number(rows[0]?.count ?? 0)));
  }

  /** A page of rows plus the total row count, fetched in parallel. */
  getPage<T>(doctype: string, args: ListArgs & { page: number; pageSize: number }): Observable<Page<T>> {
    const { page, pageSize, ...listArgs } = args;
    return forkJoin({
      rows: this.getList<T>(doctype, {
        ...listArgs,
        start: (Math.max(1, page) - 1) * pageSize,
        pageLength: pageSize,
      }),
      total: this.getCount(doctype, listArgs.filters, listArgs.orFilters),
    });
  }

  getDoc<T>(doctype: string, name: string): Observable<T> {
    return this.http
      .get<{ data: T }>(this.resourceUrl(doctype, name))
      .pipe(map((response) => response.data));
  }

  insert<T = { name: string }>(doctype: string, doc: object): Observable<T> {
    return this.http
      .post<{ data: T }>(this.resourceUrl(doctype), doc)
      .pipe(map((response) => response.data));
  }

  update<T = { name: string }>(doctype: string, name: string, patch: object): Observable<T> {
    return this.http
      .put<{ data: T }>(this.resourceUrl(doctype, name), patch)
      .pipe(map((response) => response.data));
  }

  delete(doctype: string, name: string): Observable<void> {
    return this.http.delete(this.resourceUrl(doctype, name)).pipe(map(() => undefined));
  }

  /** Submits a draft (docstatus 0 → 1). Posts ledger entries, so confirm first. */
  submit(doctype: string, name: string): Observable<void> {
    return this.update(doctype, name, { docstatus: 1 }).pipe(map(() => undefined));
  }

  /** Cancels a submitted document (docstatus 1 → 2). `frappe.client.cancel(doctype, name)`. */
  cancel(doctype: string, name: string): Observable<void> {
    return this.call('frappe.client.cancel', { doctype, name }).pipe(map(() => undefined));
  }

  /** Calls a whitelisted server method and returns its `message`. */
  call<T = unknown>(method: string, args: Record<string, unknown> = {}, httpMethod: 'GET' | 'POST' = 'POST'): Observable<T> {
    const url = this.auth.apiUrl('/api/method/' + method);
    if (httpMethod === 'GET') {
      let params = new HttpParams();
      for (const [key, value] of Object.entries(args)) {
        if (value === undefined || value === null) continue;
        params = params.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
      return this.http.get<{ message: T }>(url, { params }).pipe(map((response) => response.message));
    }
    return this.http.post<{ message: T }>(url, args).pipe(map((response) => response.message));
  }

  /** Link-field search, as used by ERPNext's own autocomplete. */
  searchLink(doctype: string, txt: string, filters?: Record<string, unknown> | FrappeFilter[], pageLength = 20): Observable<LinkOption[]> {
    let params = new HttpParams()
      .set('doctype', doctype)
      .set('txt', txt)
      .set('page_length', String(pageLength));
    if (filters && (Array.isArray(filters) ? filters.length : Object.keys(filters).length)) {
      params = params.set('filters', JSON.stringify(filters));
    }
    return this.http
      .get<{ message?: LinkOption[]; results?: LinkOption[] }>(
        this.auth.apiUrl('/api/method/frappe.desk.search.search_link'),
        { params },
      )
      .pipe(map((response) => response.message ?? response.results ?? []));
  }

  /** Downloads a document's print format as PDF. */
  downloadPdf(doctype: string, name: string, format?: string): Observable<Blob> {
    let params = new HttpParams().set('doctype', doctype).set('name', name);
    if (format) params = params.set('format', format);
    return this.http.get(this.auth.apiUrl('/api/method/frappe.utils.print_format.download_pdf'), {
      params,
      responseType: 'blob',
    });
  }

  /** URL of the printable HTML view, for opening in a new tab. */
  printViewUrl(doctype: string, name: string): string {
    return this.auth.apiUrl(
      `/printview?doctype=${encodeURIComponent(doctype)}&name=${encodeURIComponent(name)}&trigger_print=1`,
    );
  }

  private resourceUrl(doctype: string, name?: string): string {
    const base = '/api/resource/' + encodeURIComponent(doctype);
    return this.auth.apiUrl(name === undefined ? base : base + '/' + encodeURIComponent(name));
  }
}
