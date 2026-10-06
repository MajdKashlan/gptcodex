import { InjectionToken } from '@angular/core';

export interface ErpNextConfig {
  /** ERPNext site root, with no trailing slash. */
  baseUrl: string;
  /**
   * Optional whitelisted server method returning the session CSRF token.
   *
   * Leave this unset unless something demands it. Frappe v15 ships no whitelisted
   * endpoint for the token (`frappe.sessions.get_csrf_token` carries no
   * `@frappe.whitelist` decorator), and a session created by `POST /api/method/login`
   * stores no token, which makes Frappe skip its CSRF check entirely. See
   * `core/http/csrf.service.ts` for the full reasoning.
   *
   * When set, the response must be `{ "message": "<token>" }`.
   */
  csrfTokenMethod?: string;
}

export const ERP_NEXT_CONFIG = new InjectionToken<ErpNextConfig>('ERP_NEXT_CONFIG');

export const erpNextConfig: ErpNextConfig = {
  baseUrl: 'https://erp.hmgtr.com',
};
