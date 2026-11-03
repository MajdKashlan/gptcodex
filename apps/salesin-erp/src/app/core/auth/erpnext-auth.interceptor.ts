import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../http/notification.service';
import { SKIP_ERP_NEXT_AUTH, SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER } from './auth.context';
import { ErpNextAuthService } from './erpnext-auth.service';

/**
 * Adds ERPNext token auth to API requests and detects an expired session.
 *
 * Frappe answers 401 for some expired sessions, but most commonly the request simply
 * runs as `Guest` and fails with **403**. A 403 can also be a genuine permission
 * error, so on 403 the session is verified once (shared between concurrent failures)
 * and the user is only sent to the login page when ERPNext confirms they are a Guest.
 */
export const erpNextAuthInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(ErpNextAuthService);
  const router = inject(Router);
  const notifications = inject(NotificationService);

  if (!auth.isErpNextApiUrl(request.url)) {
    return next(request);
  }

  let headers = request.headers.set('Accept', 'application/json');
  const authorization = auth.authorizationHeader();
  if (!request.context.get(SKIP_ERP_NEXT_AUTH) && authorization) {
    headers = headers.set('Authorization', authorization);
  }

  const expire = () => {
    if (!auth.isAuthenticated()) {
      return;
    }
    auth.handleUnauthorized();
    notifications.info('Your ERPNext session has expired. Please sign in again.');
    const returnUrl = router.url.startsWith('/login') ? undefined : router.url;
    void router.navigate(['/login'], { queryParams: returnUrl ? { returnUrl } : {} });
  };

  return next(request.clone({ headers })).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        !request.context.get(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER) &&
        auth.isAuthenticated()
      ) {
        if (error.status === 401) {
          expire();
        } else if (error.status === 403) {
          auth.verifySession().subscribe((valid) => {
            if (!valid) expire();
          });
        }
      }
      return throwError(() => error);
    }),
  );
};
