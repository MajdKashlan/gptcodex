import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of, shareReplay } from 'rxjs';
import { FrappeApiService } from '../api/frappe-api.service';

export interface CompanyInfo {
  name: string;
  default_currency?: string;
}

export interface AppContext {
  companies: CompanyInfo[];
  /** Default company (first one when the site has several). */
  company: string;
  /** Default company's currency, used for dashboard/report totals. */
  currency: string;
}

/** Site-wide lookups that every page needs, fetched once per session. */
@Injectable({ providedIn: 'root' })
export class AppContextService {
  private readonly api = inject(FrappeApiService);
  private cached$: Observable<AppContext> | null = null;

  context(): Observable<AppContext> {
    this.cached$ ??= this.api
      .getList<CompanyInfo>('Company', { fields: ['name', 'default_currency'], orderBy: 'creation asc', pageLength: 0 })
      .pipe(
        map((companies) => ({
          companies,
          company: companies[0]?.name ?? '',
          currency: companies[0]?.default_currency ?? '',
        })),
        catchError(() => {
          this.cached$ = null;
          return of({ companies: [], company: '', currency: '' });
        }),
        shareReplay(1),
      );
    return this.cached$;
  }

  /** Forget cached data (call on logout). */
  reset(): void {
    this.cached$ = null;
  }
}
