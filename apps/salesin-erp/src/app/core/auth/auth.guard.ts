import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ErpNextAuthService } from './erpnext-auth.service';
import { hasSessionHint } from './session-hint';

/**
 * Protects the feature routes.
 *
 * The order matters: a live in-memory session short-circuits, the recorded login
 * hint decides whether asking ERPNext is worthwhile, and only then is the session
 * restored. An anonymous first-time visitor therefore makes no API call at all and
 * lands on the login page immediately, instead of briefly mounting a feature screen
 * it is not allowed to see.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(ErpNextAuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  if (!hasSessionHint()) {
    return router.createUrlTree(['/login']);
  }

  return auth.restoreSession().pipe(
    map(() => true),
    catchError(() => of(router.createUrlTree(['/login']))),
  );
};

/**
 * Keeps a signed-in user out of the login page: with a live session, or one that
 * can be restored, they are sent to the dashboard rather than shown the form.
 * With no session hint it allows the route without contacting ERPNext.
 */
export const redirectIfAuthenticated: CanActivateFn = () => {
  const auth = inject(ErpNextAuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return router.createUrlTree(['/']);
  }

  if (!hasSessionHint()) {
    return true;
  }

  return auth.restoreSession().pipe(
    map(() => router.createUrlTree(['/'])),
    catchError(() => of(true)),
  );
};
