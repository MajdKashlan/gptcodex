import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, finalize, map, Observable, of, shareReplay, switchMap, tap, throwError } from 'rxjs';
import { ERP_NEXT_CONFIG } from '../config/erpnext.config';
import {
  ApiTokenCredentials,
  AuthState,
  ChangePasswordCredentials,
  ErpNextLoginResponse,
  ErpNextMessageResponse,
  PasswordCredentials,
  UserProfile,
} from './auth.models';
import {
  SKIP_ERP_NEXT_AUTH,
  SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER,
} from './auth.context';
import { forgetSessionHint, rememberSessionHint } from './session-hint';

@Injectable({ providedIn: 'root' })
export class ErpNextAuthService {
  private static readonly legacyRememberedCredentialsKey = 'salesin.erp.api-token';
  private readonly http = inject(HttpClient);
  private readonly config = inject(ERP_NEXT_CONFIG);
  private readonly credentials = signal<ApiTokenCredentials | null>(null);
  private readonly authState = signal<AuthState>({ mode: 'anonymous', user: null });

  private verifying$: Observable<boolean> | null = null;

  readonly state = this.authState.asReadonly();
  readonly isAuthenticated = computed(() => this.authState().mode !== 'anonymous');
  readonly currentUser = computed(() => this.authState().user);

  /** `''` for same-origin (reverse-proxied), or an explicit ERPNext origin. */
  private get apiOrigin(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  apiUrl(path: string): string {
    return this.apiOrigin + '/' + path.replace(/^\/+/, '');
  }

  isErpNextApiUrl(url: string): boolean {
    if (url.startsWith('/api/')) {
      return true;
    }
    const origin = this.apiOrigin;
    return origin !== '' && url.startsWith(origin);
  }

  authorizationHeader(): string | null {
    const credentials = this.credentials();
    return credentials
      ? 'token ' + credentials.apiKey + ':' + credentials.apiSecret
      : null;
  }

  loginWithApiToken(
    credentials: ApiTokenCredentials,
  ): Observable<string> {
    const sanitized = {
      apiKey: credentials.apiKey.trim(),
      apiSecret: credentials.apiSecret.trim(),
    };

    this.credentials.set(sanitized);

    return this.getUserProfile().pipe(
      tap((user) => {
        this.removeLegacyRememberedCredentials();
        rememberSessionHint();
        this.authState.set({ mode: 'api-token', user });
      }),
      map((user) => user.fullName),
      catchError((error: unknown) => {
        this.clearAuthentication();
        return throwError(() => error);
      }),
    );
  }

  loginWithPassword(credentials: PasswordCredentials): Observable<string> {
    this.clearAuthentication();

    return this.http
      .post<ErpNextLoginResponse>(
        this.apiUrl('/api/method/login'),
        { usr: credentials.username.trim(), pwd: credentials.password },
        {
          context: new HttpContext()
            .set(SKIP_ERP_NEXT_AUTH, true)
            .set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
        },
      )
      .pipe(
        switchMap(() => this.getUserProfile()),
        tap((user) => {
          rememberSessionHint();
          this.authState.set({ mode: 'session', user });
        }),
        map((user) => user.fullName),
      );
  }

  restoreSession(): Observable<string> {
    return this.getUserProfile().pipe(
      tap((user) => this.authState.set({ mode: 'session', user })),
      map((user) => user.fullName),
      catchError((error: unknown) => {
        if (
          !(error instanceof HttpErrorResponse) ||
          error.status === 401 ||
          error.status === 403
        ) {
          // Definitive answer: the stored session is gone, so stop asking next time.
          forgetSessionHint();
        }
        this.clearAuthentication();
        return throwError(() => new Error('No active ERPNext session.'));
      }),
    );
  }

  restoreAuthentication(): Observable<string> {
    this.removeLegacyRememberedCredentials();
    return this.restoreSession();
  }

  /**
   * Ends the ERPNext session. Local state is cleared even when the server call fails
   * (offline, already expired), so the user is never left "half signed in".
   */
  logout(): Observable<void> {
    return this.http
      .post(this.apiUrl('/api/method/logout'), {}, {
        context: new HttpContext()
          .set(SKIP_ERP_NEXT_AUTH, true)
          .set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(
        catchError(() => of(null)),
        map(() => {
          this.clearAuthentication();
          forgetSessionHint();
        }),
      );
  }

  /**
   * Asks ERPNext whether the current session is still valid. Concurrent callers share
   * one request. Network failures resolve `true` so being offline never logs anyone out.
   */
  verifySession(): Observable<boolean> {
    this.verifying$ ??= this.getLoggedInUser().pipe(
      map(() => true),
      catchError((error: unknown) =>
        of(!(error instanceof HttpErrorResponse ? error.status === 401 || error.status === 403 : true)),
      ),
      finalize(() => {
        this.verifying$ = null;
      }),
      shareReplay(1),
    );
    return this.verifying$;
  }

  changePassword(credentials: ChangePasswordCredentials): Observable<void> {
    return this.http
      .post<ErpNextMessageResponse<unknown>>(
        this.apiUrl('/api/method/frappe.core.doctype.user.user.update_password'),
        {
          old_password: credentials.oldPassword,
          new_password: credentials.newPassword,
          logout_all_sessions: 0,
        },
      )
      .pipe(map(() => undefined));
  }

  requestPasswordReset(username: string): Observable<void> {
    return this.http
      .post<ErpNextMessageResponse<unknown>>(
        this.apiUrl('/api/method/frappe.core.doctype.user.user.reset_password'),
        { user: username },
      )
      .pipe(map(() => undefined));
  }

  handleUnauthorized(): void {
    this.clearAuthentication();
    forgetSessionHint();
  }

  private removeLegacyRememberedCredentials(): void {
    try {
      localStorage.removeItem(ErpNextAuthService.legacyRememberedCredentialsKey);
    } catch {
      // Browser storage may be unavailable, such as during server rendering.
    }
  }

  private getLoggedInUser(): Observable<string> {
    return this.http
      .get<ErpNextMessageResponse<string>>(
        this.apiUrl('/api/method/frappe.auth.get_logged_user'),
        { context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true) },
      )
      .pipe(
        map((response) => response.message),
        switchMap((username) =>
          username && username !== 'Guest'
            ? of(username)
            : throwError(() => new Error('No active ERPNext session.')),
        ),
      );
  }

  private getUserProfile(): Observable<UserProfile> {
    return this.getLoggedInUser().pipe(
      switchMap((username) =>
        this.http
          .get<{ data?: { full_name?: string; user_image?: string } }>(
            this.apiUrl('/api/resource/User/' + encodeURIComponent(username)),
            {
              params: { fields: JSON.stringify(['full_name', 'user_image']) },
              context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
            },
          )
          .pipe(
            map((response) => ({
              username,
              fullName: response.data?.full_name?.trim() || username,
              // Left exactly as the server returned it: a relative /files/... path
              // then resolves against the current origin and is reverse-proxied.
              imageUrl: response.data?.user_image ?? null,
            })),
            catchError(() => of({ username, fullName: username, imageUrl: null })),
          ),
      ),
    );
  }

  private clearAuthentication(): void {
    this.credentials.set(null);
    this.authState.set({ mode: 'anonymous', user: null });
    this.removeLegacyRememberedCredentials();
  }
}
