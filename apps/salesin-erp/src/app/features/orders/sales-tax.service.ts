import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of } from 'rxjs';
import { SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER } from '../../core/auth/auth.context';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { ErpNextListResponse } from '../../models/erpnext-document.models';
import { SalesTaxesAndChargesTemplate } from '../../models/sales-tax.models';

const TEMPLATE_DOCTYPE = 'Sales Taxes and Charges Template';

/**
 * Reads the tax templates a document can be created with.
 *
 * Only the template *name* is sent when saving a document - ERPNext expands the
 * template into tax rows and computes `net_total`, `total_taxes_and_charges` and
 * `grand_total` on the server. Keeping that arithmetic on the server is deliberate:
 * tax rules (charge type, inclusive rates, account heads, rounding) are ERPNext's
 * job, and duplicating them in the browser is how totals drift.
 */
@Injectable({ providedIn: 'root' })
export class SalesTaxService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(ErpNextAuthService);

  /**
   * Lists enabled templates for a company, the company default first.
   * Returns an empty list rather than failing when the user cannot read the
   * doctype, matching how the other option lists behave.
   */
  listTemplates(company: string): Observable<SalesTaxesAndChargesTemplate[]> {
    const fields = ['name', 'title', 'is_default', 'company'];
    let params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('order_by', 'is_default desc, name asc')
      .set('limit_page_length', '0');

    const filters: unknown[][] = [[TEMPLATE_DOCTYPE, 'disabled', '=', 0]];
    const trimmedCompany = company.trim();
    if (trimmedCompany !== '') {
      filters.unshift([TEMPLATE_DOCTYPE, 'company', '=', trimmedCompany]);
    }
    params = params.set('filters', JSON.stringify(filters));

    return this.http
      .get<ErpNextListResponse<SalesTaxesAndChargesTemplate>>(
        this.auth.apiUrl('/api/resource/' + encodeURIComponent(TEMPLATE_DOCTYPE)),
        {
          params,
          withCredentials: true,
          context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
        },
      )
      .pipe(
        map((response) => response.data ?? []),
        catchError(() => of([])),
      );
  }

  /** Name of the company's default template, or `''` when none is marked default. */
  defaultTemplateName(templates: readonly SalesTaxesAndChargesTemplate[]): string {
    return templates.find((template) => template.is_default === 1)?.name ?? '';
  }
}
