import { inject, Injectable } from '@angular/core';
import { catchError, Observable, of } from 'rxjs';
import { FrappeApiService } from '../../core/api/frappe-api.service';
import { SalesTaxesAndChargesTemplate } from '../../models/sales-tax.models';

const TEMPLATE_DOCTYPE = 'Sales Taxes and Charges Template';

/**
 * Reads the tax templates a document can be created with.
 *
 * Only the template *name* is sent when saving a document - ERPNext expands the
 * template into tax rows and computes the totals on the server, so tax rules are
 * never duplicated in the browser.
 */
@Injectable({ providedIn: 'root' })
export class SalesTaxService {
  private readonly api = inject(FrappeApiService);

  /** Enabled templates (optionally for one company), the default first. */
  listTemplates(company: string): Observable<SalesTaxesAndChargesTemplate[]> {
    const filters: unknown[][] = [[TEMPLATE_DOCTYPE, 'disabled', '=', 0]];
    if (company.trim()) filters.unshift([TEMPLATE_DOCTYPE, 'company', '=', company.trim()]);
    return this.api
      .getList<SalesTaxesAndChargesTemplate>(TEMPLATE_DOCTYPE, {
        fields: ['name', 'title', 'is_default', 'company'],
        filters,
        orderBy: 'is_default desc, name asc',
        pageLength: 0,
      })
      // Optional lookup: a role without access simply gets "No tax".
      .pipe(catchError(() => of([])));
  }
}
