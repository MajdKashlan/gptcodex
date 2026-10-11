import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { erpNextAuthInterceptor } from './core/auth/erpnext-auth.interceptor';
import { ERP_NEXT_CONFIG, erpNextConfig } from './core/config/erpnext.config';
import { frappeCredentialsInterceptor } from './core/http/frappe-credentials.interceptor';
import { LanguageService } from './core/i18n/language.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Instantiated during bootstrap so <html dir> and <html lang> are correct on
    // every route. Without this the login page - which never injects the service -
    // kept whatever direction a previously rendered page had left on <html>.
    provideAppInitializer(() => {
      inject(LanguageService);
    }),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideHttpClient(
      withInterceptors([erpNextAuthInterceptor, frappeCredentialsInterceptor]),
    ),
    { provide: ERP_NEXT_CONFIG, useValue: erpNextConfig },
  ]
};
