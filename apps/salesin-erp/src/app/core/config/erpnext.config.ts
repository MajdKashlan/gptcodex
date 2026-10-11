import { InjectionToken } from '@angular/core';

export interface ErpNextConfig {
  /**
   * ERPNext origin, or `''` for same-origin.
   *
   * Production serves this app from app.hmgtr.com behind a reverse proxy that
   * forwards `/api`, `/files`, `/private` and `/socket.io` to ERPNext, so `''` is
   * correct there, and `proxy.conf.json` does the same job in development.
   *
   * Do NOT point this at another origin unless you also solve the session cookie.
   * ERPNext's `sid` cookie is `SameSite=Lax`, and browsers never attach a Lax
   * cookie to a cross-site fetch, so the request would arrive unauthenticated and
   * every screen would bounce to /login - regardless of CORS configuration.
   */
  baseUrl: string;
  /**
   * Optional whitelisted server method returning the session CSRF token.
   *
   * Frappe v15 ships no whitelisted endpoint for the token, and a session created
   * by `POST /api/method/login` stores no token at all, which makes Frappe skip its
   * CSRF check. Leave this unset unless something demands it. See
   * `core/http/csrf.service.ts`.
   */
  csrfTokenMethod?: string;
}

export const ERP_NEXT_CONFIG = new InjectionToken<ErpNextConfig>('ERP_NEXT_CONFIG');

export const erpNextConfig: ErpNextConfig = {
  baseUrl: '',
};
