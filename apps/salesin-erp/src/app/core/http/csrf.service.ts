import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, finalize, map, Observable, of, shareReplay, tap } from 'rxjs';
import { ErpNextAuthService } from '../auth/erpnext-auth.service';
import { ERP_NEXT_CONFIG } from '../config/erpnext.config';

/** Header Frappe checks on unsafe requests when the session holds a CSRF token. */
export const CSRF_HEADER_NAME = 'X-Frappe-CSRF-Token';

/**
 * The session CSRF token, when one is obtainable.
 *
 * ## Why this is optional rather than required
 *
 * `HTTPRequest.validate_csrf_token` (frappe/auth.py) returns early unless the
 * session record already contains a token:
 *
 * ```python
 * or not (saved_token := frappe.session.data.csrf_token)
 * ```
 *
 * `Session.start()` (frappe/sessions.py) never writes `csrf_token`, so a session
 * created purely by `POST /api/method/login` - which is exactly what this app does -
 * never requires the header.
 *
 * A token is only ever persisted by `frappe.sessions.get_csrf_token()`, which:
 *
 * 1. is **not** whitelisted in v15 (no `@frappe.whitelist` decorator), so it cannot
 *    be called over HTTP - erp.hmgtr.com answers 403 "is not whitelisted"; and
 * 2. is invoked by the Desk page (`/app`), so a session *shared with the Desk* -
 *    that is, a same-origin deployment rather than this app's proxied dev setup -
 *    can end up needing the header.
 *
 * Rather than send a guaranteed-failing request, this service stays dormant unless
 * `ErpNextConfig.csrfTokenMethod` names a whitelisted helper installed on the
 * server. With no helper configured it resolves to `null` and the interceptor
 * simply omits the header, which is correct for login-created sessions.
 */
@Injectable({ providedIn: 'root' })
export class ErpNextCsrfService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(ErpNextAuthService);
  private readonly config = inject(ERP_NEXT_CONFIG);

  private token: string | null = null;
  private inFlight: Observable<string | null> | null = null;

  /** `true` when the server is known not to expose a token helper. */
  get isSupported(): boolean {
    const method = this.config.csrfTokenMethod;
    return typeof method === 'string' && method.trim() !== '';
  }

  /**
   * Resolves the CSRF token for the current session, fetching it at most once and
   * sharing that request between concurrent callers. Resolves to `null` whenever no
   * helper is configured or the helper is unavailable - never rejects, because a
   * missing token is a normal, supported state.
   */
  token$(): Observable<string | null> {
    if (!this.isSupported) {
      return of(null);
    }

    const cached = this.token;
    if (cached !== null) {
      return of(cached);
    }

    if (this.inFlight === null) {
      const method = (this.config.csrfTokenMethod ?? '').replace(/^\/+/, '');
      this.inFlight = this.http
        .get<{ message?: string }>(this.auth.apiUrl('/api/method/' + method))
        .pipe(
          map((response) => {
            const value =
              typeof response?.message === 'string' ? response.message.trim() : '';
            return value === '' ? null : value;
          }),
          tap((value) => {
            this.token = value;
          }),
          catchError(() => {
            // The helper is not installed (or not permitted): fall back to sending
            // no header, which is valid for sessions created via /api/method/login.
            this.token = null;
            return of(null);
          }),
          finalize(() => {
            this.inFlight = null;
          }),
          shareReplay({ bufferSize: 1, refCount: true }),
        );
    }

    return this.inFlight;
  }

  /** Drops the cached token so the next unsafe request fetches a fresh one. */
  invalidate(): void {
    this.token = null;
    this.inFlight = null;
  }
}