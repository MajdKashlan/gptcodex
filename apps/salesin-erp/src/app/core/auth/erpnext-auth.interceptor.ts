import {
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import {
  SKIP_ERP_NEXT_AUTH,
  SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER,
} from './auth.context';
import { ErpNextAuthService } from './erpnext-auth.service';

/** Adds ERPNext token auth only to configured ERPNext API requests. */
export const erpNextAuthInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(ErpNextAuthService);
  const router = inject(Router);

  if (!auth.isErpNextApiUrl(request.url)) {
    return next(request);
  }

  let headers = request.headers.set('Accept', 'application/json');
  const authorization = auth.authorizationHeader();

  if (!request.context.get(SKIP_ERP_NEXT_AUTH) && authorization) {
    headers = headers.set('Authorization', authorization);
  }

  return next(request.clone({ headers })).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        (error.status === 401 || error.status === 403) &&
        !request.context.get(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER)
      ) {
        auth.handleUnauthorized();
        void router.navigate(['/login']);
      }

      return throwError(() => error);
    }),
  );
};
