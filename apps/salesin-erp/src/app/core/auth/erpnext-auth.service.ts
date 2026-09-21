import { HttpClient, HttpContext } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, finalize, map, Observable, of, switchMap, tap, throwError } from 'rxjs';
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

@Injectable({ providedIn: 'root' })
export class ErpNextAuthService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ERP_NEXT_CONFIG);
  private readonly credentials = signal<ApiTokenCredentials | null>(null);
  private readonly authState = signal<AuthState>({ mode: 'anonymous', user: null });

  readonly state = this.authState.asReadonly();
  readonly isAuthenticated = computed(() => this.authState().mode !== 'anonymous');
  readonly currentUser = computed(() => this.authState().user);

  apiUrl(path: string): string {
    return this.config.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
  }

  isErpNextApiUrl(url: string): boolean {
    return url.startsWith(this.config.baseUrl.replace(/\/$/, ''));
  }

  authorizationHeader(): string | null {
    const credentials = this.credentials();
    return credentials
      ? 'token ' + credentials.apiKey + ':' + credentials.apiSecret
      : null;
  }

  loginWithApiToken(credentials: ApiTokenCredentials): Observable<string> {
    const sanitized = {
      apiKey: credentials.apiKey.trim(),
      apiSecret: credentials.apiSecret.trim(),
    };

    this.credentials.set(sanitized);

    return this.getUserProfile().pipe(
      tap((user) => this.authState.set({ mode: 'api-token', user })),
      map((user) => user.fullName),
      catchError((error: unknown) => {
        this.clearAuthentication();
        return throwError(() => error);
      }),
    );
  }

  loginWithPassword(credentials: PasswordCredentials): Observable<string> {
    return this.http
      .post<ErpNextLoginResponse>(
        this.apiUrl('/api/method/login'),
        { usr: credentials.username.trim(), pwd: credentials.password },
        {
          withCredentials: true,
          context: new HttpContext()
            .set(SKIP_ERP_NEXT_AUTH, true)
            .set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
        },
      )
      .pipe(
        map((response) => ({
          username: credentials.username.trim(),
          fullName: response.full_name?.trim() || credentials.username.trim(),
          imageUrl: null,
        })),
        tap((user) => this.authState.set({ mode: 'session', user })),
        map((user) => user.fullName),
      );
  }

  restoreSession(): Observable<string> {
    return this.getUserProfile(true).pipe(
      tap((user) => this.authState.set({ mode: 'session', user })),
      map((user) => user.fullName),
      catchError(() => {
        this.clearAuthentication();
        return throwError(() => new Error('No active ERPNext session.'));
      }),
    );
  }

  logout(): Observable<void> {
    const mode = this.authState().mode;
    this.clearAuthentication();

    if (mode !== 'session') {
      return new Observable<void>((subscriber) => subscriber.complete());
    }

    return this.http
      .get(this.apiUrl('/api/method/logout'), {
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_AUTH, true),
      })
      .pipe(
        map(() => undefined),
        finalize(() => this.clearAuthentication()),
      );
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
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }

  requestPasswordReset(username: string): Observable<void> {
    return this.http
      .post<ErpNextMessageResponse<unknown>>(
        this.apiUrl('/api/method/frappe.core.doctype.user.user.reset_password'),
        { user: username },
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }

  handleUnauthorized(): void {
    this.clearAuthentication();
  }

  private getLoggedInUser(withCredentials = false): Observable<string> {
    return this.http
      .get<ErpNextMessageResponse<string>>(
        this.apiUrl('/api/method/frappe.auth.get_logged_user'),
        {
          withCredentials,
          context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
        },
      )
      .pipe(map((response) => response.message));
  }

  private getUserProfile(withCredentials = false): Observable<UserProfile> {
    return this.getLoggedInUser(withCredentials).pipe(
      switchMap((username) =>
        this.http
          .get<{ data?: { full_name?: string; user_image?: string } }>(
            this.apiUrl('/api/resource/User/' + encodeURIComponent(username)),
            {
              params: { fields: JSON.stringify(['full_name', 'user_image']) },
              withCredentials,
            },
          )
          .pipe(
            map((response) => ({
              username,
              fullName: response.data?.full_name?.trim() || username,
              imageUrl: response.data?.user_image
                ? new URL(response.data.user_image, this.config.baseUrl).toString()
                : null,
            })),
            catchError(() => of({ username, fullName: username, imageUrl: null })),
          ),
      ),
    );
  }

  private clearAuthentication(): void {
    this.credentials.set(null);
    this.authState.set({ mode: 'anonymous', user: null });
  }
}
