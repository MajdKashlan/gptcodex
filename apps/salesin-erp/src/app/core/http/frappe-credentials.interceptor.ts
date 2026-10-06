import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { SKIP_ERP_NEXT_AUTH } from '../auth/auth.context';
import { ErpNextAuthService } from '../auth/erpnext-auth.service';
import { CSRF_HEADER_NAME, ErpNextCsrfService } from './csrf.service';
import { parseFrappeError } from './frappe-error';

/** Methods Frappe protects with a CSRF token when the session holds one. */
const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Applies the two things every ERPNext call needs, so no call site has to repeat
 * them, and centralises the `withCredentials: true` that used to appear inline at
 * 58 separate call sites.
 *
 * It also attaches `X-Frappe-CSRF-Token` on unsafe methods *when a token is
 * available*. That header is usually unnecessary - Frappe skips the check for
 * sessions created by `POST /api/method/login`, because such a session stores no
 * token - so it is only sent when `ErpNextConfig.csrfTokenMethod` is configured.
 * See `csrf.service.ts`. Requests carrying an API token are exempt regardless.
 *
 * Login and logout opt out with `SKIP_ERP_NEXT_AUTH`: they run before a session
 * exists (or after it is gone), so there is no token to fetch.
 */
export const frappeCredentialsInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(ErpNextAuthService);
  const csrf = inject(ErpNextCsrfService);

  if (!auth.isErpNextApiUrl(request.url)) {
    return next(request);
  }

  // A cached token belongs to exactly one session; never carry it while signed out.
  if (!auth.isAuthenticated()) {
    csrf.invalidate();
  }

  const method = request.method.toUpperCase();
  const requiresCsrf =
    UNSAFE_METHODS.has(method) &&
    !request.context.get(SKIP_ERP_NEXT_AUTH) &&
    auth.authorizationHeader() === null &&
    csrf.isSupported;

  const send = (csrfToken: string | null) => {
    const headers =
      csrfToken === null ? request.headers : request.headers.set(CSRF_HEADER_NAME, csrfToken);
    return next(request.clone({ headers, withCredentials: true }));
  };

  if (!requiresCsrf) {
    return send(null);
  }

  return csrf.token$().pipe(
    switchMap((token) => send(token)),
    catchError((error: unknown) => {
      if (!isCsrfFailure(error)) {
        return throwError(() => error);
      }
      // The token outlived its session - for example the cookie was rotated in
      // another tab - so refresh once and retry the original request.
      csrf.invalidate();
      return csrf.token$().pipe(switchMap((token) => send(token)));
    }),
  );
};

/** Recognises the 400 Frappe returns when a CSRF token is missing or stale. */
function isCsrfFailure(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || (error.status !== 400 && error.status !== 403)) {
    return false;
  }

  const info = parseFrappeError(error);

  if (info.excType !== null && /csrf/i.test(info.excType)) {
    return true;
  }

  return info.messages.some(
    (message) => /csrf/i.test(message) || /invalid request/i.test(message),
  );
}