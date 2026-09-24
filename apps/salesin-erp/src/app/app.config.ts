import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { erpNextAuthInterceptor } from './core/auth/erpnext-auth.interceptor';
import { ERP_NEXT_CONFIG, erpNextConfig } from './core/config/erpnext.config';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideHttpClient(withInterceptors([erpNextAuthInterceptor])),
    { provide: ERP_NEXT_CONFIG, useValue: erpNextConfig },
  ]
};
